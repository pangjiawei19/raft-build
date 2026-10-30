import { createHash } from "node:crypto";
import { and, desc, eq, inArray, not, sql } from "drizzle-orm";
import { currentDate, type RaftbenchReport } from "@botiverse/raft-shared";
import { getDb, type DatabaseExecutor, type DatabaseTransaction } from "../db/index";
import { messages, raftbenchConfigs, raftbenchFindings, raftbenchLatestRuns } from "../db/schema";

type Sources = Array<{ localId: string; storageId: string; target: string }>;
/** Model inputs remain independent: merge accepted, scrubbed results only on the server. */
export async function accumulateReport(tx: DatabaseTransaction, config: typeof raftbenchConfigs.$inferSelect,
  run: typeof raftbenchLatestRuns.$inferSelect, sources: Sources, report: RaftbenchReport) {
  for (const pattern of report.patterns) {
    const normalize = (ref: { target: string; messageId: string }) => {
      const source = run.fetched.find(value => value.target === ref.target && value.messageId.startsWith(ref.messageId));
      if (!source?.sourceVersion) throw new Error("Validated citation has no source version");
      const storage = sources.find(value => value.localId === source.channelId);
      if (!storage) throw new Error("Validated citation has no source scope");
      return { reference: { target: ref.target, messageId: source.messageId },
        source: { messageId: source.messageId, channelId: source.channelId, storageChannelId: storage.storageId, sourceVersion: source.sourceVersion } };
    };
    const evidence = pattern.evidence.map(normalize), counter = pattern.counterevidence.map(normalize);
    const sourceRefs = [...evidence, ...counter].map(value => value.source);
    const normalized = { ...pattern, evidence: evidence.map(value => value.reference), counterevidence: counter.map(value => value.reference) };
    const fingerprint = createHash("sha256").update(JSON.stringify([pattern.kind, sourceRefs.map(value => `${value.channelId}:${value.messageId}`).sort()])).digest("hex");
    await tx.insert(raftbenchFindings).values({ serverId: config.serverId, revision: config.revision, fingerprint, pattern: normalized, sourceRefs })
      .onConflictDoUpdate({ target: [raftbenchFindings.serverId, raftbenchFindings.revision, raftbenchFindings.fingerprint], set: { pattern: normalized, sourceRefs, updatedAt: currentDate() } });
  }
  const rows = run.fetched.length ? await tx.select({ seq: messages.seq }).from(messages).where(inArray(messages.id, run.fetched.map(ref => ref.messageId))) : [];
  const newReads = rows.filter(row => row.seq > config.readThroughSeq).length;
  await tx.update(raftbenchConfigs).set({ readMessages: config.readMessages + newReads,
    readThroughSeq: Math.max(config.readThroughSeq, run.nextSeq), completedBatches: config.completedBatches + 1,
    ...(run.exhausted ? { scannedThroughAt: run.to } : {}),
  }).where(eq(raftbenchConfigs.serverId, config.serverId));
}

/** Count and page only findings whose cited source versions and source scope still exist. */
export async function listFindings(serverId: string, revision: number, sources: Sources, requestedPage: number, executor: DatabaseExecutor = getDb()) {
  if (!sources.length) return { patterns: [], total: 0, page: 1, pageCount: 1 };
  const scope = and(eq(raftbenchFindings.serverId, serverId), eq(raftbenchFindings.revision, revision));
  const liveSources = sql`(jsonb_array_length(${raftbenchFindings.sourceRefs}) > 0 AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(${raftbenchFindings.sourceRefs}) AS ref
      LEFT JOIN ${messages} AS cited ON cited.id = (ref->>'messageId')::uuid
      WHERE cited.id IS NULL
        OR cited.channel_id <> (ref->>'storageChannelId')::uuid
        OR NOT (${sql.join(sources.map(source => sql`(ref->>'channelId' = ${source.localId} AND ref->>'storageChannelId' = ${source.storageId})`), sql` OR `)})
        OR encode(sha256(convert_to(cited.content, 'UTF8')), 'hex') <> ref->>'sourceVersion'
    ))`;
  // Withdraw the stored derived copy as well as hiding it from results.
  await executor.delete(raftbenchFindings).where(and(scope, not(liveSources)));
  const valid = and(scope, liveSources);
  const [count] = await executor.select({ total: sql<number>`count(*)`.mapWith(Number) }).from(raftbenchFindings).where(valid);
  const total = count?.total ?? 0, pageCount = Math.max(1, Math.ceil(total / 5)), page = Math.min(requestedPage, pageCount);
  const rows = await executor.select({ pattern: raftbenchFindings.pattern }).from(raftbenchFindings).where(valid)
    .orderBy(desc(raftbenchFindings.updatedAt), raftbenchFindings.id).limit(5).offset((page - 1) * 5);
  return { patterns: rows.map(row => row.pattern), total, page, pageCount };
}
