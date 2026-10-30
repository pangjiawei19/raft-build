/**
 * A runtime error only the owner can fix (rejected model credential) stops
 * automatic wakes at once and tells the owner once, in their DM with the
 * agent. Before this, every reminder or message woke the agent into the same
 * failure and the owner never heard (WangHuning, humanverse, 2026-10-13).
 * Real DB rows and the real ingest/deliver/start paths; only the machine
 * socket, Socket.IO and the inbox-chain source are stubbed.
 */
import { dbTest as test } from "../test/integration/dbTest";
import { closeTestDatabase } from "../test/integration/database";
import assert from "node:assert/strict";
import type { Server as SocketServer } from "socket.io";
import { and, eq } from "drizzle-orm";

import type { MachineToServerMessage, ServerToMachineMessage } from "@botiverse/raft-shared";

import { getDb } from "../db/index";
import { agents, machines, messages, serverMembers, servers, users } from "../db/schema";
import { referenceAgentInboxChain } from "../test/agentInboxChainReference";
import { AgentOrchestrator } from "./agentOrchestrator";
import * as channelService from "./channelService";
import { createMessage, deliverMessageToAgent } from "./messageService";

afterEach(async () => {
  await closeTestDatabase();
});

function fakeIo(): SocketServer {
  const operator = { in: () => operator, to: () => operator, socketsJoin: () => undefined, emit: () => true };
  return { in: () => operator, to: () => operator } as unknown as SocketServer;
}

class CapturingOrchestrator extends AgentOrchestrator {
  readonly starts: Array<Extract<ServerToMachineMessage, { type: "agent:start" }>> = [];

  protected override async sendToMachine(_machineId: string, msg: ServerToMachineMessage): Promise<boolean> {
    if (msg.type === "agent:start") this.starts.push(msg);
    return true;
  }

  protected override async selectResumeInbox(agentId: string): Promise<channelService.AgentInboxChainSelection> {
    return { source: "chain", rows: await referenceAgentInboxChain(agentId) } as channelService.AgentInboxChainSelection;
  }
}

async function seed() {
  const db = getDb();
  const [owner] = await db.insert(users).values({
    email: "auth-owner@example.com",
    name: "wanghuning",
    passwordHash: "hash",
    emailVerified: true,
  }).returning();
  const [server] = await db.insert(servers).values({ name: "Humanverse", slug: "humanverse-test", ownerId: owner!.id }).returning();
  await db.insert(serverMembers).values({ serverId: server!.id, userId: owner!.id, role: "owner" });
  const [machine] = await db.insert(machines).values({
    serverId: server!.id,
    userId: owner!.id,
    name: "auth-box",
    apiKeyHash: "hash-auth",
  }).returning();
  const [agent] = await db.insert(agents).values({
    serverId: server!.id,
    name: "deepseeker",
    // The daemon stops the runtime on an error that needs the owner; the
    // agent is not running when the next message or reminder arrives.
    status: "inactive",
    runtime: "kimi-sdk",
    model: "devin/swe-2",
    executionMode: "byoc",
    machineId: machine!.id,
    creatorType: "user",
    creatorId: owner!.id,
  }).returning();
  return { owner: owner!, server: server!, machine: machine!, agent: agent! };
}

function bindMachine(orchestrator: AgentOrchestrator, machineId: string, serverId: string): void {
  (orchestrator as any).machineConnections.set(machineId, {
    ws: {},
    machineId,
    serverId,
    principalKind: "computer",
    connectionEpochId: `epoch-${machineId}`,
    heartbeatTimer: null,
    runtimeAccountUsageTimer: null,
    lastPong: Date.now(),
    lastIngressAt: Date.now(),
    daemonVersion: "1.0.48",
    capabilities: new Set<string>(),
    runtimes: ["kimi-sdk"],
    migrationTransport: null,
    shutdownIntent: null,
    computerVersion: "1.0.48",
  });
}

const AUTH_DETAIL = "Built-in provider authentication failed. Check this agent's provider API key and region/provider selection, then retry starting this agent.";

function authErrorActivity(agentId: string, launchId: string, requiredAction: "user_reauth" | undefined = "user_reauth"): MachineToServerMessage {
  return {
    type: "agent:activity",
    agentId,
    launchId,
    activity: "error",
    detail: AUTH_DETAIL,
    detailKind: "runtime_error",
    isHeartbeat: false,
    runtimeError: {
      errorClass: "AuthError",
      errorReason: "auth_failed",
      fingerprint: "0123456789abcdef",
      reasonProvenance: "runtime_error_event",
      ...(requiredAction ? { requiredAction } : {}),
    },
  } as unknown as MachineToServerMessage;
}

async function ownerNotices(dmId: string) {
  return getDb().select({ content: messages.content }).from(messages)
    .where(and(eq(messages.channelId, dmId), eq(messages.messageType, "system")));
}

test("an AuthError from the current start pauses automatic wakes and tells the owner once", async ({ db: _db }) => {
  const { owner, server, machine, agent } = await seed();
  const orchestrator = new CapturingOrchestrator();
  orchestrator.setIO(fakeIo());
  try {
    bindMachine(orchestrator, machine.id, server.id);
    const breaker = (orchestrator as any).wakeCrashLoopBreaker;
    await breaker.recordStart(agent.id, "launch-1", Date.now());

    await orchestrator.handleMachineMessage(machine.id, authErrorActivity(agent.id, "launch-1"));

    assert.deepEqual(await breaker.automaticWakeHold(agent.id, Date.now()), { kind: "blocked", reason: "user_reauth" });
    const dm = await channelService.findOrCreateDM(server.id, owner.id, agent.id);
    assert.ok(dm);
    const notices = await ownerNotices(dm.id);
    assert.equal(notices.length, 1, "one notice to the owner");
    assert.match(notices[0]!.content, /@deepseeker stopped because its model credential was rejected\./);
    assert.equal(notices[0]!.content.includes(AUTH_DETAIL), false, "the runtime's error text is not copied into the DM");
    assert.ok(notices[0]!.content.includes(`/s/humanverse-test/agent/${agent.id}`), notices[0]!.content);

    // A reminder or message while paused does not start a process bound to fail.
    const message = await createMessage(dm.id, "user", owner.id, "ping");
    assert.deepEqual(await deliverMessageToAgent(orchestrator, message.id, agent.id), { status: "dropped", reason: "wake_suppressed" });
    assert.equal(orchestrator.starts.length, 0);

    // The owner starts it without fixing anything: it runs, fails the same way, pauses again, and is not told twice.
    const started = await orchestrator.startAgent(agent.id);
    assert.equal(started.outcome, "dispatched");
    const launchId = orchestrator.starts[0]!.launchId!;
    const carried = [
      ...(orchestrator.starts[0]!.wakeMessage ? [orchestrator.starts[0]!.wakeMessage] : []),
      ...(orchestrator.starts[0]!.resumeMessages ?? []),
    ];
    assert.ok(carried.some((m) => m.message_id === message.id), "the manual start carries the message that waited");
    assert.equal(
      carried.some((m) => String(m.content ?? "").includes("stopped because")),
      false,
      `the owner's notice is not carried to the agent; carried ${JSON.stringify(carried.map((m) => m.content))}`,
    );
    await orchestrator.handleMachineMessage(machine.id, authErrorActivity(agent.id, launchId));
    assert.deepEqual(await breaker.automaticWakeHold(agent.id, Date.now()), { kind: "blocked", reason: "user_reauth" });
    assert.equal((await ownerNotices(dm.id)).length, 1, "the same error is not reported again");
  } finally {
    await orchestrator.shutdown();
  }
});

test("an older daemon's AuthError (no requiredAction) still pauses; an error from an old launch does not", async ({ db: _db }) => {
  const { owner, server, machine, agent } = await seed();
  const orchestrator = new CapturingOrchestrator();
  orchestrator.setIO(fakeIo());
  try {
    bindMachine(orchestrator, machine.id, server.id);
    const breaker = (orchestrator as any).wakeCrashLoopBreaker;
    await breaker.recordStart(agent.id, "launch-2", Date.now());

    await orchestrator.handleMachineMessage(machine.id, authErrorActivity(agent.id, "launch-1", undefined));
    assert.equal(await breaker.automaticWakeHold(agent.id, Date.now()), null, "a late error from an earlier launch is ignored");

    await orchestrator.handleMachineMessage(machine.id, authErrorActivity(agent.id, "launch-2", undefined));
    assert.deepEqual(await breaker.automaticWakeHold(agent.id, Date.now()), { kind: "blocked", reason: "user_reauth" });
    const dm = await channelService.findOrCreateDM(server.id, owner.id, agent.id);
    assert.equal((await ownerNotices(dm!.id)).length, 1);
  } finally {
    await orchestrator.shutdown();
  }
});
