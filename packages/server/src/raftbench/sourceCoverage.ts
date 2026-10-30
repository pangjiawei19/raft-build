import { inArray, sql } from "drizzle-orm";
import { currentTimeMs } from "@botiverse/raft-shared";
import { getDb, registerDatabaseCloseHookForTests } from "../db/index";
import { messages } from "../db/schema";

type Coverage = { totalMessages: number; windowMessages: number; earliestAt: string | null; latestAt: string | null; from: string; to: string; checkedAt: string };
const cache = new Map<string, { expiresAt: number; result: Promise<Coverage> }>();
registerDatabaseCloseHookForTests(async () => { cache.clear(); });
/** Call only after checking both the administrator's and service identity's live source ACLs. */
export async function sourceCoverage(serverId: string, revision: number, storageIds: string[], from: Date, to: Date): Promise<Coverage> {
  const key = JSON.stringify([serverId, revision, [...storageIds].sort(), from.toISOString(), Math.floor(to.getTime() / 30_000)]);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > currentTimeMs()) return cached.result;
  const result = (async () => {
    const [row] = storageIds.length ? await getDb().select({
      totalMessages: sql<number>`count(*)`.mapWith(Number),
      windowMessages: sql<number>`count(*) FILTER (WHERE ${messages.createdAt} >= ${from.toISOString()}::timestamptz AND ${messages.createdAt} < ${to.toISOString()}::timestamptz)`.mapWith(Number),
      earliestAt: sql<string | null>`min(${messages.createdAt})::text`,
      latestAt: sql<string | null>`max(${messages.createdAt})::text`,
    }).from(messages).where(inArray(messages.channelId, storageIds)) : [];
    return { totalMessages: row?.totalMessages ?? 0, windowMessages: row?.windowMessages ?? 0,
      earliestAt: row?.earliestAt ? new Date(row.earliestAt).toISOString() : null,
      latestAt: row?.latestAt ? new Date(row.latestAt).toISOString() : null,
      from: from.toISOString(), to: to.toISOString(), checkedAt: new Date(currentTimeMs()).toISOString() };
  })();
  if (cache.size >= 100) cache.delete(cache.keys().next().value!);
  cache.set(key, { expiresAt: currentTimeMs() + 30_000, result });
  try { return await result; }
  catch (error) { if (cache.get(key)?.result === result) cache.delete(key); throw error; }
}
