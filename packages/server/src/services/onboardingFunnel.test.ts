import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { test } from "vitest";
import { BasicTracer, MemoryTraceSink } from "@botiverse/raft-shared";
import type { Database } from "../db/index";
import { migratePglite } from "../db/pgliteMigrations";
import * as schema from "../db/schema";
import { machines } from "../db/schema";
import type { AgentOrchestrator } from "./agentOrchestrator";
import { SearchQueryAbortedError } from "../db/index";
import {
  buildOnboardingFunnelSql,
  classifyOnboardingFunnelFailure,
  onboardingFunnelSlotKey,
  parseOnboardingFunnelRows,
  recordMachineFirstConnected,
  runOnboardingFunnel,
  startMachineFirstConnectRecorder,
  summarizeOnboardingFunnel,
  type OnboardingFunnelServerRow,
} from "./onboardingFunnel";

const OWNER_1 = "11111111-1111-4111-8111-111111111111";
const OWNER_2 = "22222222-2222-4222-8222-222222222222";
const SERVER_A = "a0000000-0000-4000-8000-000000000001";
const SERVER_B = "b0000000-0000-4000-8000-000000000002";
const SERVER_C = "c0000000-0000-4000-8000-000000000003";
const SERVER_OLD = "d0000000-0000-4000-8000-000000000004";
const SERVER_JOINT = "e0000000-0000-4000-8000-000000000005";
const CHANNEL_A = "a1000000-0000-4000-8000-000000000001";
const MACHINE_A1 = "a2000000-0000-4000-8000-000000000001";
const MACHINE_A2 = "a2000000-0000-4000-8000-000000000002";
const AGENT_A = "a3000000-0000-4000-8000-000000000001";
const CINDY_A = "a3000000-0000-4000-8000-000000000002";
const AGENT_C = "c3000000-0000-4000-8000-000000000001";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function at(base: string, offsetMs: number): string {
  return new Date(Date.parse(base) + offsetMs).toISOString();
}

const A = "2026-10-10T10:00:00.000Z";
const C = "2026-10-10T23:00:00.000Z";

/**
 * A: owner 1's first server; a Computer added and connected, a hosted Cindy
 * that answers first, then the owner's own agent (opener, then a real reply).
 * B: owner 1's second server, nothing in it. C: owner 2's (an older server
 * outside the window exists), one agent that never ran. Plus a joint storage
 * server, which is not a cohort member.
 */
async function fixture() {
  const client = new PGlite();
  await migratePglite(client);
  const db = drizzle(client, { schema }) as unknown as Database;
  await client.exec(`
    INSERT INTO "users" ("id", "email", "name", "password_hash") VALUES
      ('${OWNER_1}', 'funnel-1@slock.test', 'funnel-1', 'test'),
      ('${OWNER_2}', 'funnel-2@slock.test', 'funnel-2', 'test');
    INSERT INTO "servers" ("id", "name", "slug", "owner_id", "kind", "created_at") VALUES
      ('${SERVER_A}', 'A', 'funnel-a', '${OWNER_1}', 'normal', '${A}'),
      ('${SERVER_B}', 'B', 'funnel-b', '${OWNER_1}', 'normal', '2026-10-11T00:00:00.000Z'),
      ('${SERVER_C}', 'C', 'funnel-c', '${OWNER_2}', 'normal', '${C}'),
      ('${SERVER_OLD}', 'Old', 'funnel-old', '${OWNER_2}', 'normal', '2026-09-01T00:00:00.000Z'),
      ('${SERVER_JOINT}', 'Joint', 'funnel-joint', '${OWNER_2}', 'joint_storage', '2026-10-12T00:00:00.000Z');
    INSERT INTO "channels" ("id", "server_id", "name") VALUES ('${CHANNEL_A}', '${SERVER_A}', 'general');
    INSERT INTO "daemons" ("id", "server_id", "user_id", "name", "api_key_hash", "created_at", "first_connected_at") VALUES
      ('${MACHINE_A1}', '${SERVER_A}', '${OWNER_1}', 'laptop', 'x', '${at(A, 5 * MIN)}', '${at(A, 20 * MIN)}'),
      ('${MACHINE_A2}', '${SERVER_A}', '${OWNER_1}', 'desktop', 'x', '${at(A, 2 * HOUR)}', NULL);
    INSERT INTO "agents" ("id", "server_id", "name", "created_at") VALUES
      ('${CINDY_A}', '${SERVER_A}', 'cindy', '${at(A, 1 * MIN)}'),
      ('${AGENT_A}', '${SERVER_A}', 'helper', '${at(A, 30 * MIN)}'),
      ('${AGENT_C}', '${SERVER_C}', 'helper', '${at(C, DAY + HOUR)}');
    INSERT INTO "agent_runtime_provisions" ("agent_id", "server_id", "provider", "state", "provisioned_name", "provisioned_instructions", "import_source")
      VALUES ('${CINDY_A}', '${SERVER_A}', 'antiproton', 'active', 'cindy', '', 'cindy_seed');
    INSERT INTO "agent_activity_events" ("id", "agent_id", "activity", "detail", "entries", "created_at") VALUES
      (gen_random_uuid(), '${CINDY_A}', 'thinking', '', '[]', '${at(A, 2 * MIN)}'),
      (gen_random_uuid(), '${AGENT_A}', 'online', '', '[]', '${at(A, 31 * MIN)}'),
      (gen_random_uuid(), '${AGENT_A}', 'thinking', '', '[]', '${at(A, 32 * MIN)}'),
      (gen_random_uuid(), '${AGENT_A}', 'working', '', '[]', '${at(A, 33 * MIN)}'),
      (gen_random_uuid(), '${AGENT_C}', 'online', '', '[]', '${at(C, DAY + 2 * HOUR)}');
    INSERT INTO "messages" ("id", "channel_id", "sender_type", "sender_id", "content", "agent_send_key", "created_at") VALUES
      (gen_random_uuid(), '${CHANNEL_A}', 'agent', '${CINDY_A}', 'hi', NULL, '${at(A, 3 * MIN)}'),
      (gen_random_uuid(), '${CHANNEL_A}', 'agent', '${AGENT_A}', 'opener', 'owner-opener-v2.0:${SERVER_A}:${OWNER_1}:intro', '${at(A, 31 * MIN)}'),
      (gen_random_uuid(), '${CHANNEL_A}', 'agent', '${AGENT_A}', 'hello', NULL, '${at(A, 35 * MIN)}'),
      (gen_random_uuid(), '${CHANNEL_A}', 'user', '${OWNER_1}', 'hey', NULL, '${at(A, 34 * MIN)}');
  `);
  return { client, db };
}

test("the funnel query derives each cohort server's milestones from the tables", async () => {
  const { client } = await fixture();
  try {
    const sqlText = buildOnboardingFunnelSql(new Date("2026-10-03T00:00:00.000Z"), new Date("2026-10-16T12:00:00.000Z"));
    const result = await client.query<Record<string, unknown>>(sqlText);
    const rows = parseOnboardingFunnelRows(result.rows)
      .sort((x, y) => (x.msToMilestone.first_agent_created ?? -1) - (y.msToMilestone.first_agent_created ?? -1)
        || x.cohortDay.localeCompare(y.cohortDay));
    assert.deepEqual(rows, [
      {
        cohortDay: "2026-10-11",
        ownerFirstServer: false,
        msToMilestone: {
          server_created: 0,
          computer_added: null,
          first_machine_connected: null,
          first_agent_created: null,
          first_agent_turn_started: null,
          first_agent_reply: null,
        },
      },
      {
        cohortDay: "2026-10-10",
        ownerFirstServer: true,
        msToMilestone: {
          server_created: 0,
          computer_added: 5 * MIN,
          first_machine_connected: 20 * MIN,
          // Hosted Cindy (created at +1 min, replying at +3) is not the owner's agent,
          // and the templated opener at +31 min is not a reply.
          first_agent_created: 30 * MIN,
          first_agent_turn_started: 32 * MIN,
          first_agent_reply: 35 * MIN,
        },
      },
      {
        // An older server outside the window still makes this not the owner's first.
        cohortDay: "2026-10-10",
        ownerFirstServer: false,
        msToMilestone: {
          server_created: 0,
          computer_added: null,
          first_machine_connected: null,
          first_agent_created: DAY + HOUR,
          first_agent_turn_started: null,
          first_agent_reply: null,
        },
      },
    ]);
  } finally {
    await client.close();
  }
});

test("first_connected_at is written once; a reconnect keeps the first time", async () => {
  const { client, db } = await fixture();
  try {
    await recordMachineFirstConnected(MACHINE_A2, db);
    const [first] = await db.select({ at: machines.firstConnectedAt }).from(machines).where(eq(machines.id, MACHINE_A2));
    assert.ok(first?.at);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await recordMachineFirstConnected(MACHINE_A2, db);
    await recordMachineFirstConnected(MACHINE_A1, db);
    const rows = await db.select({ id: machines.id, at: machines.firstConnectedAt }).from(machines);
    const byId = new Map(rows.map((row) => [row.id, row.at?.toISOString()]));
    assert.equal(byId.get(MACHINE_A2), first.at.toISOString());
    assert.equal(byId.get(MACHINE_A1), at(A, 20 * MIN));
  } finally {
    await client.close();
  }
});

function server(cohortDay: string, ownerFirstServer: boolean, reply: number | null): OnboardingFunnelServerRow {
  return {
    cohortDay,
    ownerFirstServer,
    msToMilestone: {
      server_created: 0,
      computer_added: null,
      first_machine_connected: null,
      first_agent_created: null,
      first_agent_turn_started: null,
      first_agent_reply: reply,
    },
  };
}

test("aggregates count reach by window; percentiles cover only servers that reached the milestone", () => {
  const rows = [
    server("2026-10-10", true, 10 * MIN),
    server("2026-10-10", true, 2 * HOUR),
    server("2026-10-10", true, 3 * DAY),
    server("2026-10-10", true, null),
    server("2026-10-10", false, 5 * MIN),
  ];
  const aggregates = summarizeOnboardingFunnel(rows);
  // 2 cohorts x 6 milestones, no server ids anywhere.
  assert.equal(aggregates.length, 12);
  assert.ok(aggregates.every((row) => !Object.keys(row).some((key) => key.includes("server_id"))));
  const reply = aggregates.find((row) => row.owner_first_server && row.milestone === "first_agent_reply");
  assert.deepEqual(reply, {
    cohort_day: "2026-10-10",
    owner_first_server: true,
    milestone: "first_agent_reply",
    cohort_size: 4,
    reached: 3,
    reached_1h: 1,
    reached_24h: 2,
    reached_7d: 3,
    p50_ms: 2 * HOUR,
    p90_ms: Math.round(2 * HOUR + (3 * DAY - 2 * HOUR) * 0.8),
  });
  const created = aggregates.find((row) => row.owner_first_server && row.milestone === "server_created");
  assert.equal(created?.reached, 4);
  const connected = aggregates.find((row) => !row.owner_first_server && row.milestone === "first_machine_connected");
  assert.deepEqual([connected?.reached, connected?.p50_ms, connected?.p90_ms], [0, 0, 0]);
});

test("slots are UTC 6-hour buckets", () => {
  assert.equal(onboardingFunnelSlotKey(new Date("2026-10-16T05:59:59.000Z")), "2026-10-16T00");
  assert.equal(onboardingFunnelSlotKey(new Date("2026-10-16T06:00:00.000Z")), "2026-10-16T06");
  assert.equal(onboardingFunnelSlotKey(new Date("2026-10-16T23:10:00.000Z")), "2026-10-16T18");
});

function tracer() {
  const sink = new MemoryTraceSink();
  return { sink, tracer: new BasicTracer({ sink }) };
}

test("a run claims its slot, queries the last 14 days of cohorts and emits one event per aggregate", async () => {
  const { sink, tracer: t } = tracer();
  const claimed: string[] = [];
  const queries: string[] = [];
  const result = await runOnboardingFunnel({
    now: () => new Date("2026-10-16T19:30:00.000Z"),
    claimSlot: async (slot) => { claimed.push(slot); return true; },
    queryPg: async (sqlText) => {
      queries.push(sqlText);
      return [{ cohort_day: "2026-10-16", owner_first_server: true, replied_ms: 1234.4 }];
    },
    tracer: t,
  });
  assert.equal(result.outcome, "ok");
  assert.deepEqual(claimed, ["2026-10-16T18"]);
  assert.match(queries[0]!, /s\.created_at >= '2026-10-03T00:00:00\.000Z'::timestamptz AND s\.created_at < '2026-10-16T19:30:00\.000Z'::timestamptz/);
  const events = sink.getAllLogEvents().filter((e) => e.name === "server.onboarding.funnel");
  assert.equal(events.length, 6);
  assert.deepEqual(events.find((e) => e.attrs?.milestone === "first_agent_reply")?.attrs, {
    cohort_day: "2026-10-16",
    owner_first_server: true,
    milestone: "first_agent_reply",
    cohort_size: 1,
    reached: 1,
    reached_1h: 1,
    reached_24h: 1,
    reached_7d: 1,
    p50_ms: 1234,
    p90_ms: 1234,
    slot: "2026-10-16T18",
  });
});

test("a failure names its path, reason and SQLSTATE, never the message", () => {
  // Drizzle wraps the pg error, without a name, and puts the SQL in the message.
  const drizzleWrapped = (cause: unknown) => Object.assign(new Error("Failed query: WITH cohort AS (...)"), { cause });
  assert.deepEqual(
    classifyOnboardingFunnelFailure(drizzleWrapped(Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" }))),
    { reason: "statement_timeout", sqlstate: "57014" },
  );
  assert.deepEqual(classifyOnboardingFunnelFailure(new SearchQueryAbortedError()), { reason: "aborted", sqlstate: "" });
  assert.deepEqual(
    classifyOnboardingFunnelFailure(drizzleWrapped(Object.assign(new Error("relation does not exist"), { code: "42P01" }))),
    { reason: "query_error", sqlstate: "42P01" },
  );
  assert.deepEqual(classifyOnboardingFunnelFailure(Object.assign(new Error("x"), { code: "ECONNRESET" })), { reason: "other", sqlstate: "" });
  assert.deepEqual(classifyOnboardingFunnelFailure("boom"), { reason: "other", sqlstate: "" });
});

test("another replica's claim skips the run; a failed query emits no aggregates", async () => {
  const { sink, tracer: t } = tracer();
  let queried = false;
  const skipped = await runOnboardingFunnel({
    claimSlot: async () => false,
    queryPg: async () => { queried = true; return []; },
    tracer: t,
  });
  assert.equal(skipped.outcome, "skipped_claimed");
  assert.equal(queried, false);

  const failed = await runOnboardingFunnel({
    claimSlot: async () => true,
    queryPath: "primary",
    queryPg: async () => {
      throw Object.assign(new Error("Failed query: WITH cohort AS (...)"), { cause: Object.assign(new Error("timeout"), { code: "57014" }) });
    },
    tracer: t,
  });
  assert.equal(failed.outcome, "error");
  assert.equal(sink.getAllLogEvents().filter((e) => e.name === "server.onboarding.funnel").length, 0);
  const span = sink.getAllSpans().find((s) => s.name === "server.onboarding_funnel.compute");
  assert.equal(span?.status, "error");
  assert.deepEqual(
    [span?.attrs?.path, span?.attrs?.reason, span?.attrs?.sqlstate, span?.attrs?.error_class],
    ["primary", "statement_timeout", "57014", "Error"],
  );
  assert.ok(!JSON.stringify(span?.attrs).includes("WITH cohort"));
});

test("machine:online stamps the machine; a failed write never throws into the reconnect", async () => {
  const orchestrator = new EventEmitter();
  const recorded: string[] = [];
  const stop = startMachineFirstConnectRecorder({
    orchestrator: orchestrator as unknown as AgentOrchestrator,
    record: async (machineId) => {
      recorded.push(machineId);
      if (machineId === "bad") throw new Error("db down");
    },
  });
  orchestrator.emit("machine:online", { machineId: MACHINE_A1, serverId: SERVER_A });
  orchestrator.emit("machine:online", { machineId: "bad", serverId: SERVER_A });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(recorded, [MACHINE_A1, "bad"]);
  stop();
  orchestrator.emit("machine:online", { machineId: MACHINE_A2, serverId: SERVER_A });
  assert.deepEqual(recorded, [MACHINE_A1, "bad"]);
});
