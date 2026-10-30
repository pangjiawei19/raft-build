import { dbTest as test } from "../test/integration/dbTest";
import { closeTestDatabase } from "../test/integration/database";
import assert from "node:assert/strict";
import type { ActivityTurnSummary, TrajectoryEntry } from "@botiverse/raft-shared";
import { getDb } from "../db/index";
import { agents, channels, messages, servers, users } from "../db/schema";
import { appendAgentActivityEvent, projectAgentActivityHintFromPersistedEvent, listAgentSentMessagesBetween, listAgentTurnSummaries, listRecentAgentTrajectory, upsertAgentTurnSummaries } from "./agentActivityLogService";
import { rewriteDaemonActivityEntries } from "./agentLifecycleReducer";


afterEach(async () => {
  await closeTestDatabase();
});

async function seedAgent(agentId: string, suffix: string) {
  const db = getDb();
  const [owner] = await db.insert(users).values({
    id: `10000000-0000-4000-8000-${suffix.padStart(12, "0")}`,
    email: `owner-${suffix}@example.com`,
    name: `owner-${suffix}`,
    displayName: `owner-${suffix}`,
    passwordHash: "hash",
    emailVerified: true,
  }).returning();

  const [server] = await db.insert(servers).values({
    id: `20000000-0000-4000-8000-${suffix.padStart(12, "0")}`,
    name: `Server ${suffix}`,
    slug: `server-${suffix}`,
    ownerId: owner.id,
  }).returning();

  await db.insert(agents).values({
    id: agentId,
    serverId: server.id,
    name: `agent-${suffix}`,
    status: "active",
    model: "gpt-5",
    runtime: "codex",
  });
}

test("compaction terminal facts survive daemon normalization, database persistence and history readback", async ({ db }) => {
  void db;
  const agentId = "30000000-0000-4000-8000-000000000099";
  await seedAgent(agentId, "99");
  const entries = rewriteDaemonActivityEntries(
    (["compaction_failed", "input_too_large", "recovery_exhausted"] as const).map(failureReason => ({
      kind: "status" as const,
      detailKind: "runtime_error" as const,
      detail: "Context compaction interrupted",
      compaction: {
        outcome: "compaction_failed_or_exhausted" as const,
        reason: "overflow" as const,
        failureReason,
        willRetry: false,
        failureDiagnostic: {
          errorClass: "ProviderServerError" as const,
          errorReason: "provider_server_error" as const,
          fingerprint: "0123456789abcdef",
          reasonProvenance: "runtime_error_event" as const,
        },
      },
    })),
    { activity: "error", detailKind: "runtime_error", source: "canonical" },
  );
  assert.ok(entries);
  await appendAgentActivityEvent(agentId, "error", "Context compaction interrupted", entries, new Date("2026-09-14T00:00:00Z"), "compaction-terminal");
  const persisted = await listRecentAgentTrajectory(agentId);
  assert.equal(persisted.length, 3);
  assert.deepEqual(persisted.map(row => row.entry), entries);
  assert.deepEqual(persisted.map(row => row.entry.kind === "status" ? row.entry.compaction?.failureReason : undefined),
    ["compaction_failed", "input_too_large", "recovery_exhausted"]);
});

test("activity log dedupes projection writes per agent and dedupe key", async ({ db }) => {

  const agentId = "30000000-0000-4000-8000-000000000001";
  await seedAgent(agentId, "1");

  const entry: TrajectoryEntry = { kind: "status", activity: "offline", detail: "Runtime interrupted" };
  const firstInserted = await appendAgentActivityEvent(
    agentId,
    "offline",
    "Runtime interrupted",
    [entry],
    new Date("2026-05-12T00:00:00.000Z"),
    "agent:agent-1:machine:machine-1:connectionEpoch:epoch-1:readyReconcile:mark-inactive-offline",
  );
  const secondInserted = await appendAgentActivityEvent(
    agentId,
    "offline",
    "Runtime interrupted",
    [entry],
    new Date("2026-05-12T00:00:01.000Z"),
    "agent:agent-1:machine:machine-1:connectionEpoch:epoch-1:readyReconcile:mark-inactive-offline",
  );

  assert.equal(firstInserted, true);
  assert.equal(secondInserted, false);
  assert.deepEqual(await listRecentAgentTrajectory(agentId), [
    { timestamp: Date.parse("2026-05-12T00:00:00.000Z"), entry },
  ]);
});

test("activity log dedupe keys are scoped to a single agent", async ({ db }) => {

  const agentOne = "30000000-0000-4000-8000-000000000011";
  const agentTwo = "30000000-0000-4000-8000-000000000012";
  await seedAgent(agentOne, "11");
  await seedAgent(agentTwo, "12");

  const entry: TrajectoryEntry = { kind: "status", activity: "offline", detail: "Runtime interrupted" };
  const dedupeKey = "machine:shared-epoch:readyReconcile";
  const firstInserted = await appendAgentActivityEvent(
    agentOne,
    "offline",
    "Runtime interrupted",
    [entry],
    new Date("2026-05-12T00:00:00.000Z"),
    dedupeKey,
  );
  const secondInserted = await appendAgentActivityEvent(
    agentTwo,
    "offline",
    "Runtime interrupted",
    [entry],
    new Date("2026-05-12T00:00:00.000Z"),
    dedupeKey,
  );

  assert.equal(firstInserted, true);
  assert.equal(secondInserted, true);
  assert.equal((await listRecentAgentTrajectory(agentOne)).length, 1);
  assert.equal((await listRecentAgentTrajectory(agentTwo)).length, 1);
});

const turn = (startedAt: number, endedAt: number, extra: Partial<ActivityTurnSummary> = {}): ActivityTurnSummary => ({
  v: 1, startedAt, endedAt, outcome: "completed", actions: [], toolCalls: 0, problems: [], problemCount: 0, messagesSent: 0, ...extra,
});

test("task #17: turn summaries upsert by turn key and list newest first, paging by end time", async ({ db }) => {
  void db;
  const agentId = "30000000-0000-4000-8000-000000000171";
  await seedAgent(agentId, "171");
  await upsertAgentTurnSummaries(agentId, [
    { turnKey: "daemon:1000", summary: turn(1_000, 2_000) },
    { turnKey: "daemon:3000", summary: turn(3_000, 4_000) },
  ]);
  // A rebuilt turn replaces its row.
  await upsertAgentTurnSummaries(agentId, [{ turnKey: "daemon:1000", summary: turn(1_000, 2_500, { toolCalls: 2 }) }]);
  const listed = (await listAgentTurnSummaries(agentId)).summaries;
  assert.ok(listed.every((summary) => typeof summary.id === "string" && summary.id.length === 36), "each summary carries its row id");
  assert.deepEqual(listed.map(({ id: _id, ...summary }) => summary), [turn(3_000, 4_000), turn(1_000, 2_500, { toolCalls: 2 })]);
  // Two more turns ending in the same ms as the newest: paging by cursor skips none.
  await upsertAgentTurnSummaries(agentId, [
    { turnKey: "daemon:3500", summary: turn(3_500, 4_000) },
    { turnKey: "daemon:3600", summary: turn(3_600, 4_000) },
  ]);
  const seen: number[] = [];
  let before: Awaited<ReturnType<typeof listAgentTurnSummaries>>["next"];
  for (let page = 0; page < 5; page += 1) {
    const result = await listAgentTurnSummaries(agentId, { limit: 1, ...(before ? { before } : {}) });
    seen.push(...result.summaries.map((summary) => summary.startedAt));
    before = result.next;
    if (!before) break;
  }
  assert.deepEqual(seen.sort((a, b) => a - b), [1_000, 3_000, 3_500, 3_600]);
});

test("task #17: the agent's own sent messages in a time window, oldest first", async ({ db }) => {
  const agentId = "30000000-0000-4000-8000-000000000172";
  await seedAgent(agentId, "172");
  const [channel] = await db.insert(channels).values({ serverId: "20000000-0000-4000-8000-000000000172", name: "general" }).returning();
  const values = [
    { at: "2026-10-16T01:00:05Z", senderType: "agent" as const, senderId: agentId, content: "first" },
    { at: "2026-10-16T01:00:25Z", senderType: "agent" as const, senderId: agentId, content: "second" },
    { at: "2026-10-16T01:00:15Z", senderType: "user" as const, senderId: "10000000-0000-4000-8000-000000000172", content: "human" },
    { at: "2026-10-16T01:05:00Z", senderType: "agent" as const, senderId: agentId, content: "later" },
  ];
  const inserted = await db.insert(messages).values(values.map((value) => ({
    channelId: channel!.id, senderType: value.senderType, senderId: value.senderId, content: value.content, createdAt: new Date(value.at),
  }))).returning({ id: messages.id, content: messages.content });
  const idOf = (content: string) => inserted.find((row) => row.content === content)!.id;
  assert.deepEqual(
    await listAgentSentMessagesBetween(agentId, Date.parse("2026-10-16T01:00:00Z"), Date.parse("2026-10-16T01:01:00Z")),
    [
      { at: Date.parse("2026-10-16T01:00:05Z"), messageId: idOf("first") },
      { at: Date.parse("2026-10-16T01:00:25Z"), messageId: idOf("second") },
    ],
  );
});

test("task #17: the restart hint skips a Tool finished row, which marks a step, not a state", async ({ db }) => {
  void db;
  const hint = projectAgentActivityHintFromPersistedEvent({
    activity: "online",
    detail: "",
    createdAt: new Date(0),
    entries: [
      { kind: "status", activity: "online", detail: "", detailKind: "external_activity", producerFactId: "external/status-reported:s1" },
      { kind: "status", activity: "working", detail: "Tool finished", detailKind: "tool_end", tool: { ok: true } },
    ],
  });
  assert.equal(hint.detailKind, "external_activity");
});
