import { fixturePasswordHash } from "../test/integration/credentials";
import { createApiTest } from "../test/integration/apiTest";
import { createTestApp } from "../test/integration/app";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { getDb } from "../db/index";
import { attestedSendEvents, inboxNotificationFacts, messages, tasks, users } from "../db/schema";
import { createServer } from "../services/serverService";
import { createAgent } from "../services/agentService";
import { addAgent, addHuman, createChannel } from "../services/channelService";
import { mintAgentCredential } from "../services/agentCredentialService";
import * as attestedSendService from "../services/attestedSendService";

// Glimpse G2-1: task writes (claim, status update, amend) run the send's
// freshness check when the request attests what its model context has seen,
// and hold with the send's envelope. Without an attestation (every client
// before G2) nothing changes. A rerun is held at most once per catch-up.

const test = createApiTest({ humanActivityMuteFlagDefaultEnabled: true, onboardingOpenerFlagDefaultEnabled: false });

type Fixture = {
  serverId: string;
  channelId: string;
  channelName: string;
  agentId: string;
  ownerToken: string;
  agentApiKey: string;
};

type Result = { status: number; body: any };

const originalAttestedSendMode = process.env.SLOCK_ATTESTED_SEND_MODE;

beforeEach(() => {
  process.env.SLOCK_ATTESTED_SEND_MODE = "on";
});

afterEach(() => {
  attestedSendService.__resetAttestedSendStateForTest();
  if (originalAttestedSendMode === undefined) {
    delete process.env.SLOCK_ATTESTED_SEND_MODE;
  } else {
    process.env.SLOCK_ATTESTED_SEND_MODE = originalAttestedSendMode;
  }
});

async function seedFixture(baseUrl: string): Promise<Fixture> {
  const db = getDb();
  const suffix = randomUUID();
  const email = `task-write-freshness-${suffix}@slock.test`;
  const [owner] = await db.insert(users).values({
    email,
    name: `task-write-freshness-${suffix}`,
    displayName: "Task Freshness Owner",
    passwordHash: await fixturePasswordHash("password123"),
    emailVerified: true,
    profileSetupCompletedAt: new Date(),
  }).returning();
  const server = await createServer("Task Write Freshness", `task-write-freshness-${suffix}`, owner.id);
  const agent = await createAgent(server.id, "BoardBot", { runtime: "claude", model: "sonnet" });
  const channel = await createChannel(server.id, "board");
  await addHuman(channel.id, owner.id);
  await addAgent(channel.id, agent.id);
  const minted = await mintAgentCredential({
    agentId: agent.id,
    scopes: ["send", "read", "tasks"],
    name: "task-write-freshness",
    createdByUserId: null,
  });
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123" }),
  });
  assert.equal(loginRes.status, 200, "owner login must succeed");
  const { accessToken } = await loginRes.json() as { accessToken: string };
  return {
    serverId: server.id,
    channelId: channel.id,
    channelName: channel.name,
    agentId: agent.id,
    ownerToken: accessToken,
    agentApiKey: minted.apiKey,
  };
}

function agentHeaders(f: Fixture) {
  return { Authorization: `Bearer ${f.agentApiKey}`, "Content-Type": "application/json" };
}

async function postJson(url: string, headers: Record<string, string>, body: Record<string, unknown>): Promise<Result> {
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() as any };
}

async function humanPost(baseUrl: string, f: Fixture, content: string): Promise<{ id: string; seq: number }> {
  const res = await fetch(`${baseUrl}/api/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${f.ownerToken}`, "Content-Type": "application/json", "X-Server-Id": f.serverId },
    body: JSON.stringify({ channelId: f.channelId, content }),
  });
  assert.equal(res.status, 200, `human send must succeed (${content})`);
  const message = await res.json() as { id: string; seq: number };
  // The board's hold counts the agent's inbox facts; wait until this one is recorded.
  await waitFor("agent inbox fact", async () => {
    const [fact] = await getDb().select({ id: inboxNotificationFacts.messageId }).from(inboxNotificationFacts).where(and(
      eq(inboxNotificationFacts.receiverType, "agent"),
      eq(inboxNotificationFacts.receiverId, f.agentId),
      eq(inboxNotificationFacts.messageId, message.id),
    ));
    return fact ?? null;
  });
  return message;
}

async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/**
 * A human-created task, so the agent's own writes are not what is new on the
 * board. Waits for the asynchronous channel summary, so it cannot land after
 * the messages a test posts next.
 */
async function humanTask(baseUrl: string, f: Fixture, title: string): Promise<{ taskNumber: number }> {
  const res = await fetch(`${baseUrl}/api/tasks/channel/${f.channelId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${f.ownerToken}`, "Content-Type": "application/json", "X-Server-Id": f.serverId },
    body: JSON.stringify({ tasks: [{ title }] }),
  });
  assert.equal(res.status, 200, `human task create failed: ${await res.text()}`);
  const [row] = await getDb().select().from(tasks).where(and(eq(tasks.channelId, f.channelId), eq(tasks.title, title)));
  assert.ok(row, `task ${title} must exist`);
  await waitFor("task.created_summary notice", async () => {
    const [notice] = await getDb().select({ id: messages.id }).from(messages).where(and(
      eq(messages.channelId, f.channelId),
      eq(messages.systemSubtype, "task.created_summary"),
    ));
    return notice ?? null;
  });
  return { taskNumber: row.taskNumber };
}

function claim(baseUrl: string, f: Fixture, taskNumber: number, seen: Record<string, unknown> = {}) {
  return postJson(`${baseUrl}/internal/agent-api/tasks/claim`, agentHeaders(f), {
    channel: `#${f.channelName}`,
    task_numbers: [taskNumber],
    ...seen,
  });
}

function updateStatus(baseUrl: string, f: Fixture, taskNumber: number, status: string, seen: Record<string, unknown> = {}) {
  return postJson(`${baseUrl}/internal/agent-api/tasks/update-status`, agentHeaders(f), {
    channel: `#${f.channelName}`,
    task_number: taskNumber,
    status,
    ...seen,
  });
}

function amend(baseUrl: string, f: Fixture, taskNumber: number, title: string, seen: Record<string, unknown> = {}) {
  return postJson(`${baseUrl}/internal/agent-api/tasks/amend`, agentHeaders(f), {
    channel: `#${f.channelName}`,
    task_number: taskNumber,
    title,
    ...seen,
  });
}

async function claimedBy(f: Fixture, taskNumber: number): Promise<string | null> {
  const [row] = await getDb().select().from(tasks).where(and(eq(tasks.channelId, f.channelId), eq(tasks.taskNumber, taskNumber)));
  return row?.claimedById ?? null;
}

function assertHeld(result: Result) {
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.state, "held", JSON.stringify(result.body));
}

function assertApplied(result: Result) {
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.notEqual(result.body.state, "held", JSON.stringify(result.body));
}

test("a task write without an attestation is never held, even with unread messages", async ({ app }) => {
  const f = await seedFixture(app.baseUrl);
  const task = await humanTask(app.baseUrl, f, "no attestation");
  await humanPost(app.baseUrl, f, "something the agent has not seen");

  assertApplied(await claim(app.baseUrl, f, task.taskNumber));
  assert.equal(await claimedBy(f, task.taskNumber), f.agentId);
  assertApplied(await updateStatus(app.baseUrl, f, task.taskNumber, "in_review"));
  assertApplied(await amend(app.baseUrl, f, task.taskNumber, "no attestation, renamed"));
});

test("claim: a stale boundary holds with the send's envelope; rerunning after reading applies it", async ({ app }) => {
  const f = await seedFixture(app.baseUrl);
  const task = await humanTask(app.baseUrl, f, "stale claim");
  const seen = await humanPost(app.baseUrl, f, "seen by the agent");
  const unseen = await humanPost(app.baseUrl, f, "posted after the agent read");

  const held = await claim(app.baseUrl, f, task.taskNumber, { seenUpToSeq: seen.seq });
  assertHeld(held);
  assert.equal(held.body.decision, "syncing_hold");
  assert.deepEqual(held.body.available_actions, ["check_messages", "retry_action"]);
  assert.ok(held.body.heldMessages.some((m: { id: string }) => m.id === unseen.id), JSON.stringify(held.body));
  assert.equal(held.body.newMessageCount, 1);
  assert.equal(held.body.continueAnywaySuggested, undefined, "task writes have no --anyway");
  assert.equal(await claimedBy(f, task.taskNumber), null, "a held claim is not applied");

  const rerun = await claim(app.baseUrl, f, task.taskNumber, { seenUpToSeq: held.body.seenUpToSeq });
  assertApplied(rerun);
  assert.equal(await claimedBy(f, task.taskNumber), f.agentId);
});

test("claim: a boundary that covers the board passes without a hold", async ({ app }) => {
  const f = await seedFixture(app.baseUrl);
  const task = await humanTask(app.baseUrl, f, "fresh claim");
  const latest = await humanPost(app.baseUrl, f, "the newest message");
  assertApplied(await claim(app.baseUrl, f, task.taskNumber, { seenUpToSeq: latest.seq }));
});

test("one hold per catch-up: newer messages after a hold do not hold the rerun again", async ({ app }) => {
  const f = await seedFixture(app.baseUrl);
  const task = await humanTask(app.baseUrl, f, "busy board");
  const seen = await humanPost(app.baseUrl, f, "seen");
  await humanPost(app.baseUrl, f, "unseen 1");

  const held = await claim(app.baseUrl, f, task.taskNumber, { seenUpToSeq: seen.seq });
  assertHeld(held);
  // While the agent reads the hold, the board keeps moving.
  await humanPost(app.baseUrl, f, "arrived during the read");

  const rerun = await claim(app.baseUrl, f, task.taskNumber, { seenUpToSeq: held.body.seenUpToSeq });
  assertApplied(rerun);
  assert.equal(await claimedBy(f, task.taskNumber), f.agentId);
});

test("a rerun that did not catch up to its last hold is held again", async ({ app }) => {
  const f = await seedFixture(app.baseUrl);
  const task = await humanTask(app.baseUrl, f, "not caught up");
  const seen = await humanPost(app.baseUrl, f, "seen");
  await humanPost(app.baseUrl, f, "unseen");

  assertHeld(await claim(app.baseUrl, f, task.taskNumber, { seenUpToSeq: seen.seq }));
  // Same stale boundary: the agent did not take in what the hold showed.
  assertHeld(await claim(app.baseUrl, f, task.taskNumber, { seenUpToSeq: seen.seq }));
  assert.equal(await claimedBy(f, task.taskNumber), null);
});

test("a hold covers only its own write: another write on the board is checked as usual", async ({ app }) => {
  const f = await seedFixture(app.baseUrl);
  const first = await humanTask(app.baseUrl, f, "first");
  const second = await humanTask(app.baseUrl, f, "second");
  const seen = await humanPost(app.baseUrl, f, "seen");
  await humanPost(app.baseUrl, f, "unseen");

  const held = await claim(app.baseUrl, f, first.taskNumber, { seenUpToSeq: seen.seq });
  assertHeld(held);
  assertApplied(await claim(app.baseUrl, f, first.taskNumber, { seenUpToSeq: held.body.seenUpToSeq }));

  // Later, something new lands; a different write with the old boundary is held.
  await humanPost(app.baseUrl, f, "much later");
  assertHeld(await claim(app.baseUrl, f, second.taskNumber, { seenUpToSeq: held.body.seenUpToSeq }));
  assert.equal(await claimedBy(f, second.taskNumber), null);
});

test("the last hold is found from another server instance (a rerun on another replica)", async ({ app }) => {
  const f = await seedFixture(app.baseUrl);
  const task = await humanTask(app.baseUrl, f, "two replicas");
  const seen = await humanPost(app.baseUrl, f, "seen");
  await humanPost(app.baseUrl, f, "unseen");

  const held = await claim(app.baseUrl, f, task.taskNumber, { seenUpToSeq: seen.seq });
  assertHeld(held);
  await humanPost(app.baseUrl, f, "arrived during the read");

  const replica = await createTestApp(0, { onboardingOpenerFlagDefaultEnabled: false });
  try {
    assertApplied(await claim(replica.baseUrl, f, task.taskNumber, { seenUpToSeq: held.body.seenUpToSeq }));
  } finally {
    await replica.close();
  }
  assert.equal(await claimedBy(f, task.taskNumber), f.agentId);
});

test("update-status and amend hold like a claim, and record the board's channel id with the hold", async ({ app }) => {
  const f = await seedFixture(app.baseUrl);
  const task = await humanTask(app.baseUrl, f, "update and amend");
  assertApplied(await claim(app.baseUrl, f, task.taskNumber));
  const seen = await humanPost(app.baseUrl, f, "seen");
  await humanPost(app.baseUrl, f, "unseen");

  const heldUpdate = await updateStatus(app.baseUrl, f, task.taskNumber, "in_review", { seenUpToSeq: seen.seq });
  assertHeld(heldUpdate);
  const [{ status }] = await getDb().select({ status: tasks.status }).from(tasks)
    .where(and(eq(tasks.channelId, f.channelId), eq(tasks.taskNumber, task.taskNumber)));
  assert.equal(status, "in_progress", "a held status update is not applied (the claim set in_progress)");

  const events = await getDb().select().from(attestedSendEvents)
    .where(and(eq(attestedSendEvents.agentId, f.agentId), eq(attestedSendEvents.eventType, "gate_triggered")));
  assert.equal(events.length, 1);
  assert.equal((events[0].metadata as Record<string, unknown>).channel_id, f.channelId);
  assert.equal((events[0].metadata as Record<string, unknown>).action, "task_update");
  assert.ok(String((events[0].metadata as Record<string, unknown>).write_key).startsWith("task_update:"));

  assertApplied(await updateStatus(app.baseUrl, f, task.taskNumber, "in_review", { seenUpToSeq: heldUpdate.body.seenUpToSeq }));

  await humanPost(app.baseUrl, f, "newer still");
  const heldAmend = await amend(app.baseUrl, f, task.taskNumber, "renamed", { seenUpToSeq: seen.seq });
  assertHeld(heldAmend);
  assert.equal(heldAmend.body.newMessageCount, 2);
});

test("reviewer isolation: a count-only hold, and the rerun passes since it cannot catch up", async ({ app }) => {
  const f = await seedFixture(app.baseUrl);
  const task = await humanTask(app.baseUrl, f, "isolated");
  const seen = await humanPost(app.baseUrl, f, "seen");
  await humanPost(app.baseUrl, f, "withheld");

  const held = await claim(app.baseUrl, f, task.taskNumber, { seenUpToSeq: seen.seq, freshnessContextMode: "withheld" });
  assertHeld(held);
  assert.equal(held.body.freshnessContextMode, "withheld");
  assert.equal(held.body.withheldMessageCount, 1);
  assert.equal(held.body.heldMessages, undefined, "no context bytes in isolation");

  assertApplied(await claim(app.baseUrl, f, task.taskNumber, { seenUpToSeq: seen.seq, freshnessContextMode: "withheld" }));
});
