import { expect } from "vitest";
import { eq } from "drizzle-orm";
import { createApiTest } from "../test/integration/apiTest";
import { agentRuntimeProvisions, agents, channels, featureFlags, messages, raftbenchConfigs, raftbenchFindings, raftbenchLatestRuns, raftbenchServiceAgents, serverAgentMembers, serverMembers, servers } from "../db/schema";
import { advanceServer, dashboard, configure } from "../raftbench/controls";
import { mintAgentCredential } from "../services/agentCredentialService";

const test = createApiTest({ onboardingOpenerFlagDefaultEnabled: false });
const serverId = "90623df1-20ed-4321-88a1-e4e2b411a252";

test("background continuation retains findings and unique progress, and clears withdrawn scope", async ({ app, db, seed, onTestFinished }) => {
  const oldEnv = process.env.DEPLOYMENT_ENV;
  process.env.DEPLOYMENT_ENV = "staging";
  onTestFinished(() => { if (oldEnv === undefined) delete process.env.DEPLOYMENT_ENV; else process.env.DEPLOYMENT_ENV = oldEnv; });
  const owner = await seed.human();
  const administrator = await seed.human();
  await db.insert(featureFlags).values({ key: "raftbench_overview_v0", randomizationUnit: "server", salt: "synthetic", defaultEnabled: true }).onConflictDoUpdate({ target: featureFlags.key, set: { enabled: true, killSwitch: false, defaultEnabled: true } });
  await db.insert(servers).values({ id: serverId, ownerId: owner.id, name: "Synthetic QA", slug: "synthetic-qa" });
  await db.insert(serverMembers).values({ serverId, userId: owner.id, role: "owner", setupStatus: "complete" });
  await db.insert(serverMembers).values({ serverId, userId: administrator.id, role: "admin", setupStatus: "complete" });
  const [agent] = await db.insert(agents).values({ serverId, name: "AnalysisService", runtime: "external" }).returning();
  await db.insert(serverAgentMembers).values({ serverId, agentId: agent.id, role: "member" });
  const [channel] = await db.insert(channels).values({ serverId, name: "synthetic-qa", type: "channel" }).returning();

  await db.insert(messages).values(Array.from({ length: 80 }, (_, i) => ({ channelId: channel.id, senderId: owner.id, senderType: "user" as const, content: `Synthetic ${i} ${"progress ".repeat(500)}`, createdAt: new Date(Date.now() - 60000) })));
  await db.insert(raftbenchConfigs).values({ serverId, configuredByUserId: administrator.id, enabled: true, agentId: agent.id, channelIds: [channel.id], revision: 1 });
  await db.insert(raftbenchServiceAgents).values({ serverId, agentId: agent.id });
  const credential = await mintAgentCredential({ agentId: agent.id, scopes: ["read", "raftbench"], name: "Synthetic analysis", createdByUserId: owner.id });
  await db.insert(agentRuntimeProvisions).values({ agentId: agent.id, serverId, provider: "antiproton", state: "active", provisionedProfile: "raftbench_service", credentialId: credential.credentialId, provisionedName: "Synthetic analysis", provisionedInstructions: "Synthetic test only" });
  const call = (path: string, body?: unknown) => fetch(`${app.baseUrl}/internal/agent-api/raftbench/${path}`, { headers: { Authorization: `Bearer ${credential.apiKey}`, "Content-Type": "application/json" }, method: body === undefined ? "GET" : "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let firstId = "", previousId = "", batches = 0;
  const seen = new Set<string>();
  for (;;) {
    await advanceServer(serverId);
    const [run] = await db.select().from(raftbenchLatestRuns).where(eq(raftbenchLatestRuns.serverId, serverId));
    expect(run.runId).not.toBe(previousId); previousId = run.runId;
    if (batches) {
      const pending = await dashboard(serverId, owner.id);
      expect(pending.run?.status).toBe("queued"); expect(pending.pagination.total).toBe(1);
      expect(pending.run?.report?.patterns?.[0].explanation).toBe("Synthetic accepted finding");
    }
    const response = await call(`context?runId=${run.runId}`), context = await response.json();
    expect(response.status, JSON.stringify(context)).toBe(200);
    const [readRun] = await db.select().from(raftbenchLatestRuns).where(eq(raftbenchLatestRuns.serverId, serverId));
    for (const ref of readRun.fetched) { expect(seen.has(ref.messageId)).toBe(false); seen.add(ref.messageId); }
    if (!firstId) firstId = readRun.fetched[0].messageId; else expect(context.sourceText).not.toContain(firstId);
    const patterns = batches ? [] : [{ kind: "successful_practice", explanation: "Synthetic accepted finding", evidence: [{ target: "#synthetic-qa", messageId: firstId }], counterevidence: [], evidenceLevel: "conversation_only", intent: "unknown", suggestion: "Keep the synthetic checklist" }];
    const body = { runId: run.runId, revision: 1, status: "incomplete", reason: "One batch of an ongoing scan", patterns, gaps: ["partial_scan"] };
    const accepted = await call("submit", body);
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    expect((await call("submit", body)).status).toBe(200);
    batches++;
    const state = await dashboard(serverId, owner.id);
    expect(state.progress).toMatchObject({ readMessages: seen.size, completedBatches: batches });
    expect(state.pagination.total).toBe(1);
    if (readRun.exhausted) break;
    expect(batches).toBeLessThan(10);
  }
  expect(batches).toBeGreaterThan(1); expect(seen.size).toBe(80);
  await db.update(messages).set({ content: "Synthetic edited source" }).where(eq(messages.id, firstId));
  expect((await dashboard(serverId, owner.id)).pagination.total).toBe(0);
  expect(await db.select().from(raftbenchFindings)).toHaveLength(0);
  await configure(serverId, owner.id, { enabled: false, channelIds: [channel.id], expectedRevision: 1 });
  expect(await db.select().from(raftbenchFindings)).toHaveLength(0);
  expect((await dashboard(serverId, owner.id)).progress).toMatchObject({ readMessages: 0, completedBatches: 0, scannedThroughAt: null });
});
