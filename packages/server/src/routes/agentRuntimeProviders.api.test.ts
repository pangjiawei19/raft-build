// Hosted runtime provider (raft-agent-provider.v1) end to end against a fake
// provider HTTP server: admin-only config with the token never returned, the
// create → provision worker flow (identical-body retry after a lost response,
// 5xx backoff, 4xx → failed + manual retry), PATCH on edit, delete revoking
// credentials before the provider DELETE, and cross-server isolation.
import { tokenForHuman, fixturePasswordHash } from "../test/integration/credentials";
import { createApiTest } from "../test/integration/apiTest";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ANTIPROTON_HOSTED_RUNTIME_FEATURE_FLAG_KEY } from "@botiverse/raft-shared";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db/index";
import { agentCredentials, agentRuntimeProvisions, agents, featureFlagRules, featureFlags, integrationAuditEvents, serverAgentMembers, serverMembers, servers, users } from "../db/schema";
import { createServer } from "../services/serverService";
import { createAgent } from "../services/agentService";
import { addAgent as addAgentToChannel, getOrCreateThread, listChannels } from "../services/channelService";
import { ActionCardError, prepareActionCard } from "../services/actionCardsService";
import { findAgentCredentialByApiKey } from "../services/agentCredentialService";
import { __setAgentRuntimeProviderTransportForTests, resolveProviderConfig } from "../services/agentRuntimeProviderService";
import { buildAgentConnectionLandingUrl } from "../services/agentConnectionService";
import {
  claimProvision,
  drainAgentRuntimeProvisions,
  getHostedRuntimeSummary,
  PROVISION_RETRY_BASE_MS,
  recordAgentProvisioning,
  retryAgentProvisioning,
  kickHostedRuntimePlanSync,
  startAgentRuntimeProvisionWorker,
  stopHostedAgentTurn,
} from "../services/agentRuntimeProvisionService";
import { onProvisionImported } from "../services/agentRuntimeProvisionImport";
import { isAgentRuntimeProviderEnabledForServer } from "../services/agentRuntimeProviderFeature";
import { ensureServerModelPickerSynced, hostedRuntimePlanFor, syncHostedRuntimeModelPickers, syncHostedRuntimeServerPlans } from "../services/hostedRuntimeServerPlanSync";
import { BasicTracer, MemoryTraceSink } from "@botiverse/raft-shared";
import { pullHostedRuntimeDailySpend, spendDaysToPull } from "../services/hostedRuntimeDailySpend";
import { withTraceRoot } from "../tracing/semanticTrace";
import { hostedRuntimeServerPlans, hostedRuntimeSpendPulls } from "../db/schema";
import { fireDueHostedCindyRecaps, getHostedOnboardingAgentState, HOSTED_CINDY_READY_TIMEOUT_MS, provisionHostedCindy, registerHostedCindyTriggers, resolveHostedCindySetupState, settleOverdueHostedCindys } from "../services/hostedCindyService";
import { triggerOwnerOnboardingOnAgentActivation } from "../services/onboardingService";
import { createAppReminder } from "../apps/reminder/crud";
import { createMessage } from "../services/messageService";
import { inboxNotificationFacts, messages, reminders } from "../db/schema";
import { ANTIPROTON_CINDY_FEATURE_FLAG_KEY, ANTIPROTON_MODEL_PICKER_FEATURE_FLAG_KEY, createFeatureFlag, createFeatureFlagRule, setFeatureFlagKillSwitch } from "../services/featureFlagService";
import { buildCindyMemoryMd, buildCindySeedFiles, EXTERNAL_AGENT_RUNTIME_ID, EXTERNAL_AGENT_RUNTIME_MODEL } from "@botiverse/raft-shared";
import { createHash } from "node:crypto";
import { createAgent as createAgentRow } from "../services/agentService";

const test = createApiTest({ humanActivityMuteFlagDefaultEnabled: true, onboardingOpenerFlagDefaultEnabled: false });

const PROVIDER_TOKEN = "pt-fake-provider-token-0123456789abcdef";
const RAFT_ORIGIN = "https://raft.example.test";

type Recorded = { method: string; path: string; headers: IncomingMessage["headers"]; body: string };
type Reply = { status: number; body?: unknown } | "lose-response";
type Handler = (request: Recorded) => Reply | Promise<Reply>;

async function startFakeProvider() {
  const requests: Recorded[] = [];
  const queue: Handler[] = [];
  let fallback: Handler = (request) => defaultReply(request);
  const lost = new Set<Recorded>();

  function defaultReply(request: Recorded): Reply {
    if (request.headers.authorization !== `Bearer ${PROVIDER_TOKEN}`) {
      return { status: 401, body: { error: { code: "unauthorized", message: "bad token" } } };
    }
    if (request.method === "POST" && request.path === "/provision/agents") {
      const body = JSON.parse(request.body) as { raftAgentId: string };
      return { status: 201, body: { providerAgentId: `raft_${body.raftAgentId}`, status: "active", push: { registered: true } } };
    }
    if (request.method === "GET") return { status: 404, body: { error: { code: "not_found", message: "no agent" } } };
    return { status: 200, body: {} };
  }

  const server = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", async () => {
      const recorded: Recorded = { method: req.method ?? "", path: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") };
      requests.push(recorded);
      const handler = queue.shift() ?? fallback;
      const reply = await handler(recorded);
      let answer = reply;
      if (answer === "lose-response") {
        // The provider did the work, but the answer never reaches Raft.
        lost.add(recorded);
        answer = defaultReply(recorded) as { status: number; body?: unknown };
      }
      res.writeHead(answer.status, { "content-type": "application/json" });
      res.end(answer.body === undefined ? "" : JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // Transport: real HTTP to the fake, but a "lost" answer surfaces as a timeout.
  const fetchThroughFake: typeof globalThis.fetch = async (input, init) => {
    const before = requests.length;
    const response = await globalThis.fetch(input, init);
    const text = await response.text();
    const recorded = requests[before];
    if (recorded && lost.has(recorded)) {
      const error = new Error("The operation was aborted due to timeout");
      error.name = "TimeoutError";
      throw error;
    }
    return new Response(text || null, { status: response.status, headers: response.headers });
  };
  // The fake stands in for the deployment's fixed antiproton base URL.
  __setAgentRuntimeProviderTransportForTests({ fetch: fetchThroughFake, baseUrl });
  return {
    baseUrl,
    requests,
    next(handler: Handler) { queue.push(handler); },
    setFallback(handler: Handler) { fallback = handler; },
    async close() {
      __setAgentRuntimeProviderTransportForTests(null);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function seedUser(email: string, name: string) {
  const [user] = await getDb().insert(users).values({
    email,
    name,
    displayName: name,
    passwordHash: await fixturePasswordHash("password123"),
    emailVerified: true,
    profileSetupCompletedAt: new Date(),
  }).returning();
  return user;
}

const ENV_KEYS = ["SLOCK_PROVIDER_CREDENTIAL_KEY", "SERVER_URL", "DEPLOYMENT_ENV", "ANTIPROTON_PROVISIONING_TOKEN"] as const;

function withEnv<T>(run: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.SLOCK_PROVIDER_CREDENTIAL_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.SERVER_URL = `${RAFT_ORIGIN}/`;
  delete process.env.DEPLOYMENT_ENV;
  delete process.env.ANTIPROTON_PROVISIONING_TOKEN;
  return run().finally(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  });
}

/** Deployment-level provider config: the only setting is the token secret (the base URL is the fake's). */
function configureDeployment(_fake: { baseUrl: string }) {
  process.env.ANTIPROTON_PROVISIONING_TOKEN = PROVIDER_TOKEN;
}

/** Per-server gate: a `server` stage allow rule on the flag, as the Feature Flag Admin writes it. */
async function enableFlagFor(serverId: string) {
  await getDb().insert(featureFlagRules).values({
    id: randomUUID(),
    flagKey: ANTIPROTON_HOSTED_RUNTIME_FEATURE_FLAG_KEY,
    stage: "server",
    priority: -100,
    decision: "allow",
    values: [serverId],
  });
}

/** `antiproton_model_picker` allowed for one server (off by default: Raft decides the model). */
async function enableModelPickerFor(serverId: string) {
  const [existing] = await getDb().select({ key: featureFlags.key }).from(featureFlags).where(eq(featureFlags.key, ANTIPROTON_MODEL_PICKER_FEATURE_FLAG_KEY));
  if (!existing) await createFeatureFlag({ key: ANTIPROTON_MODEL_PICKER_FEATURE_FLAG_KEY, randomizationUnit: "server", defaultEnabled: false });
  await createFeatureFlagRule({ flagKey: ANTIPROTON_MODEL_PICKER_FEATURE_FLAG_KEY, stage: "server", decision: "allow", values: [serverId] });
}

function api(baseUrl: string, token: string, serverId: string) {
  const headers = { Authorization: `Bearer ${token}`, "X-Server-Id": serverId, "Content-Type": "application/json" };
  return {
    get: (path: string) => fetch(`${baseUrl}/api${path}`, { headers }),
    send: (method: string, path: string, body?: unknown) =>
      fetch(`${baseUrl}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
  };
}

/** Advance the worker clock past any backoff. */
const later = (ms: number) => () => new Date(Date.now() + ms);

async function provisionRow(agentId: string) {
  const [row] = await getDb().select().from(agentRuntimeProvisions).where(eq(agentRuntimeProvisions.agentId, agentId));
  return row;
}

async function setupServer(baseUrl: string, slug: string) {
  const owner = await seedUser(`${slug}-owner@raft.test`, `${slug}-owner`);
  const member = await seedUser(`${slug}-member@raft.test`, `${slug}-member`);
  const server = await createServer(`Provider ${slug}`, slug, owner.id);
  await getDb().insert(serverMembers).values({ serverId: server.id, userId: member.id, role: "member" });
  return {
    server,
    owner: api(baseUrl, await tokenForHuman(owner.email), server.id),
    member: api(baseUrl, await tokenForHuman(member.email), server.id),
  };
}

async function configure(fake: { baseUrl: string }, target: { server: { id: string } }) {
  configureDeployment(fake);
  await enableFlagFor(target.server.id);
}

async function createHosted(client: ReturnType<typeof api>, name: string, description = "Be helpful.") {
  const res = await client.send("POST", "/agents", { name, description, external: true, provider: "antiproton" });
  const text = await res.text();
  assert.equal(res.status, 200, text);
  return JSON.parse(text) as { id: string; hostedRuntime?: { state: string } };
}

test("availability needs both the deployment env config and the server flag; the probe exposes nothing else", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      const a = await setupServer(app.baseUrl, "provider-gate-a");
      const b = await setupServer(app.baseUrl, "provider-gate-b");
      const probe = async (client: ReturnType<typeof api>) => {
        const res = await client.get("/agent-runtime-providers/antiproton");
        const text = await res.text();
        assert.equal(res.status, 200, text);
        assert.ok(!text.includes(PROVIDER_TOKEN) && !text.includes(fake.baseUrl), "the probe exposes no configuration");
        return JSON.parse(text) as { kind: string; available: boolean };
      };
      const createCode = async (client: ReturnType<typeof api>, name: string) => {
        const res = await client.send("POST", "/agents", { name, external: true, provider: "antiproton" });
        return { status: res.status, code: (await res.json() as { code?: string }).code };
      };

      assert.equal((await a.member.get("/agent-runtime-providers/antiproton")).status, 403);
      assert.equal((await a.owner.get("/agent-runtime-providers/nope")).status, 404);
      for (const method of ["PUT", "DELETE"]) {
        assert.equal((await a.owner.send(method, "/agent-runtime-providers/antiproton", { baseUrl: fake.baseUrl, token: PROVIDER_TOKEN })).status, 404, `${method} config route is gone`);
      }

      // Flag off (default) and no env: unavailable, create refused by the flag.
      assert.deepEqual(await probe(a.owner), { kind: "antiproton", available: false });
      assert.deepEqual(await createCode(a.owner, "gate-off"), { status: 403, code: "agent_runtime_provider_disabled" });

      // Env configured, flag still off: unavailable.
      configureDeployment(fake);
      assert.equal((await probe(a.owner)).available, false);
      assert.deepEqual(await createCode(a.owner, "gate-flag-off"), { status: 403, code: "agent_runtime_provider_disabled" });

      // Flag on for A only, env unset: unavailable with a clear configuration error.
      await enableFlagFor(a.server.id);
      delete process.env.ANTIPROTON_PROVISIONING_TOKEN;
      assert.equal((await probe(a.owner)).available, false);
      assert.deepEqual(await createCode(a.owner, "gate-no-token"), { status: 409, code: "agent_runtime_provider_not_configured" });

      // Both: available for A, still not for B (cross-server isolation).
      configureDeployment(fake);
      assert.equal((await probe(a.owner)).available, true);
      assert.equal((await probe(b.owner)).available, false);
      assert.deepEqual(await createCode(b.owner, "gate-b"), { status: 403, code: "agent_runtime_provider_disabled" });
      const created = await createHosted(a.owner, "gate-on");
      assert.equal(created.hostedRuntime?.state, "provisioning");
      assert.equal(fake.requests.length, 0, "availability never calls the provider");

      const managed = await a.owner.send("POST", "/agents", { name: "managed-hosted", provider: "antiproton" });
      assert.equal(managed.status, 400, "provider is only for external agents");
    } finally {
      await fake.close();
    }
  });
});

test("lowering the rollout stops new hosted agents only; the kill switch stops existing ones too", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      const a = await setupServer(app.baseUrl, "provider-flag-off");
      await configure(fake, a);
      const created = await createHosted(a.owner, "flag-off-agent");
      await getDb().delete(featureFlagRules).where(eq(featureFlagRules.flagKey, ANTIPROTON_HOSTED_RUNTIME_FEATURE_FLAG_KEY));
      const routes = [
        ["GET", `/agents/${created.id}/hosted-runtime`],
        ["POST", `/agents/${created.id}/hosted-runtime/retry`],
        ["GET", `/agents/${created.id}/hosted-runtime/usage`],
        ["GET", `/agents/${created.id}/hosted-runtime/model`],
        ["PUT", `/agents/${created.id}/hosted-runtime/model`],
        ["GET", `/agents/${created.id}/workspace-files`],
        ["GET", `/agents/${created.id}/workspace-files/read?path=state%2Fa.md`],
      ] as const;
      const providerDisabled = async (method: string, path: string) => {
        const res = await a.owner.send(method, path);
        return res.status === 403 && (await res.json() as { code?: string }).code === "agent_runtime_provider_disabled";
      };
      // No rule matches any more: a new hosted agent is refused, the existing one keeps working.
      const refused = await a.owner.send("POST", "/agents", { name: "flag-off-new", description: "Be helpful.", external: true, provider: "antiproton" });
      assert.equal(refused.status, 403);
      assert.equal((await refused.json() as { code: string }).code, "agent_runtime_provider_disabled");
      for (const [method, path] of routes) assert.equal(await providerDisabled(method, path), false, `${method} ${path}`);
      await drainAgentRuntimeProvisions();
      assert.equal((await provisionRow(created.id)).state, "active", "already-created agents are still provisioned");

      // The kill switch stops existing hosted agents too.
      await setFeatureFlagKillSwitch(ANTIPROTON_HOSTED_RUNTIME_FEATURE_FLAG_KEY, true);
      for (const [method, path] of routes) assert.equal(await providerDisabled(method, path), true, `${method} ${path}`);
      assert.equal((await a.owner.send("DELETE", `/agents/${created.id}`)).status, 200);
      await drainAgentRuntimeProvisions();
      assert.equal((await provisionRow(created.id)).state, "deleted", "and still deleted on the provider");
    } finally {
      await setFeatureFlagKillSwitch(ANTIPROTON_HOSTED_RUNTIME_FEATURE_FLAG_KEY, false);
      await fake.close();
    }
  });
});

test("create provisions with an identical-body retry after a lost answer, and the raw key never leaves the row", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      const a = await setupServer(app.baseUrl, "provider-create");
      await configure(fake, a);
      const created = await createHosted(a.owner, "hosted-agent", "You review pull requests.");
      assert.equal(created.hostedRuntime?.state, "provisioning");

      const pending = await provisionRow(created.id);
      assert.ok(pending.encryptedCredential && !pending.encryptedCredential.startsWith("sk_agent_"));
      assert.ok(pending.credentialId);

      fake.next(() => "lose-response");
      const first = await drainAgentRuntimeProvisions();
      assert.equal(first.retried, 1);
      const afterLoss = await provisionRow(created.id);
      assert.equal(afterLoss.state, "provisioning");
      assert.equal(afterLoss.lastErrorCode, "provider_timeout");
      assert.ok(afterLoss.nextAttemptAt.getTime() > Date.now(), "backoff before the retry");

      // Not due yet: nothing is sent.
      const posts = () => fake.requests.filter((r) => r.method === "POST");
      assert.equal((await drainAgentRuntimeProvisions()).claimed, 0);
      assert.equal(posts().length, 1);

      await drainAgentRuntimeProvisions({ now: later(PROVISION_RETRY_BASE_MS + 1_000) });
      assert.equal(posts().length, 2);
      assert.equal(posts()[0].body, posts()[1].body, "the retried POST is byte-identical");
      for (const post of posts()) {
        assert.equal(post.headers["idempotency-key"], created.id);
        assert.equal(post.headers.authorization, `Bearer ${PROVIDER_TOKEN}`);
      }
      const sent = JSON.parse(posts()[0].body) as Record<string, string>;
      assert.deepEqual(Object.keys(sent).sort(), ["credential", "instructions", "name", "plan", "raftAgentId", "raftOrigin", "raftServerId"]);
      assert.equal(sent.raftAgentId, created.id);
      assert.equal(sent.raftServerId, a.server.id);
      assert.equal(sent.raftOrigin, RAFT_ORIGIN);
      assert.equal(sent.name, "hosted-agent");
      assert.equal(sent.instructions, "You review pull requests.");
      const verified = await findAgentCredentialByApiKey(sent.credential);
      assert.equal(verified?.agentId, created.id, "the provider received a working sk_agent credential for this agent");

      const active = await provisionRow(created.id);
      assert.equal(active.state, "active");
      assert.equal(active.providerAgentId, `raft_${created.id}`);
      assert.equal(active.encryptedCredential, null, "raw key deleted once provisioning succeeded");
      assert.equal(active.lastErrorCode, null);

      for (const path of [`/agents/${created.id}`, "/agents", `/agents/${created.id}/external-status`, `/agents/${created.id}/hosted-runtime`, `/agents/${created.id}/credentials`]) {
        const res = await a.owner.get(path);
        const text = await res.text();
        assert.equal(res.status, 200, `${path}: ${text}`);
        assert.ok(!text.includes(sent.credential), `${path} never returns the raw key`);
        assert.ok(!text.includes(PROVIDER_TOKEN), `${path} never returns the provider token`);
      }
      const detail = await (await a.owner.get(`/agents/${created.id}`)).json() as { hostedRuntime: { state: string; providerAgentId: string; push: unknown } };
      assert.equal(detail.hostedRuntime.state, "active");
      assert.equal(detail.hostedRuntime.providerAgentId, `raft_${created.id}`);
      assert.deepEqual(detail.hostedRuntime.push, { registered: true, error: null });
      const memberView = await (await a.member.get(`/agents/${created.id}`)).json() as Record<string, unknown>;
      assert.equal(memberView.hostedRuntime, undefined, "only managers see provisioning details");
    } finally {
      await fake.close();
    }
  });
});

test("5xx backs off then succeeds; 4xx fails visibly without retrying until a manual retry", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      const a = await setupServer(app.baseUrl, "provider-errors");
      await configure(fake, a);

      const flaky = await createHosted(a.owner, "flaky-agent");
      fake.next(() => ({ status: 503, body: { error: { code: "internal", message: "busy" } } }));
      await drainAgentRuntimeProvisions();
      let row = await provisionRow(flaky.id);
      assert.equal(row.state, "provisioning");
      assert.equal(row.lastErrorHttpStatus, 503);
      const firstBackoff = row.nextAttemptAt.getTime() - Date.now();
      fake.next(() => ({ status: 502, body: { error: { code: "internal", message: "busy" } } }));
      await drainAgentRuntimeProvisions({ now: later(PROVISION_RETRY_BASE_MS + 1_000) });
      row = await provisionRow(flaky.id);
      assert.equal(row.attemptCount, 2);
      assert.ok(row.nextAttemptAt.getTime() - Date.now() > firstBackoff + PROVISION_RETRY_BASE_MS / 2, "exponential backoff grows");
      await drainAgentRuntimeProvisions({ now: later(10 * PROVISION_RETRY_BASE_MS) });
      row = await provisionRow(flaky.id);
      assert.equal(row.state, "active");
      assert.equal(row.attemptCount, 0);

      const refused = await createHosted(a.owner, "refused-agent");
      fake.next(() => ({ status: 409, body: { error: { code: "idempotency_conflict", message: "a different request was already made under this key" } } }));
      await drainAgentRuntimeProvisions();
      row = await provisionRow(refused.id);
      assert.equal(row.state, "failed");
      assert.ok(row.encryptedCredential, "kept for a manual retry");
      const postsBefore = fake.requests.length;
      await drainAgentRuntimeProvisions({ now: later(60 * 60_000) });
      assert.equal(fake.requests.length, postsBefore, "no automatic retry after a 4xx");
      const status = await (await a.owner.get(`/agents/${refused.id}/hosted-runtime`)).json() as {
        hostedRuntime: { state: string; lastError: { code: string; httpStatus: number; message: string } };
      };
      assert.equal(status.hostedRuntime.state, "failed");
      assert.equal(status.hostedRuntime.lastError.code, "idempotency_conflict");
      assert.equal(status.hostedRuntime.lastError.httpStatus, 409);

      assert.equal((await a.member.send("POST", `/agents/${refused.id}/hosted-runtime/retry`)).status, 403);
      const retry = await a.owner.send("POST", `/agents/${refused.id}/hosted-runtime/retry`);
      assert.equal(retry.status, 200);
      await drainAgentRuntimeProvisions();
      assert.equal((await provisionRow(refused.id)).state, "active");
    } finally {
      await fake.close();
    }
  });
});

test("an agent:create card can preset hosting and a model; prepare refuses what the confirm would refuse", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      const a = await setupServer(app.baseUrl, "provider-card");
      await enableModelPickerFor(a.server.id);
      const requester = await createAgent(a.server.id, "card-requester", { runtime: "claude" });
      const [channel] = await listChannels(a.server.id);
      const MODELS = {
        models: [{ id: "gpt-5.6-luna", label: "GPT-5.6 Luna", provider: "cloudflare" }, { id: "deepseek-flash", label: "DeepSeek Flash", provider: "deepseek" }],
        default: "deepseek-flash", defaultLabel: "DeepSeek Flash", locked: false,
      };
      const prepare = (action: Record<string, unknown>) => prepareActionCard({
        serverId: a.server.id,
        requesterAgentId: requester.id,
        targetChannelId: channel!.id,
        action: { type: "agent:create", name: "card-hosted", ...action } as never,
      });
      const refusal = async (action: Record<string, unknown>) => {
        try {
          await prepare(action);
        } catch (error) {
          assert.ok(error instanceof ActionCardError, String(error));
          return { status: error.status, code: error.code, message: error.message };
        }
        assert.fail("expected a refusal");
      };

      // Hosting off for the server: refused at prepare, with nothing asked of the provider.
      assert.equal((await refusal({ hosting: "antiproton" })).code, "HOSTED_RUNTIME_UNAVAILABLE");
      assert.equal(fake.requests.length, 0);
      // Shape rules: a hosted card names no computer, and a model needs hosting.
      assert.equal((await refusal({ hosting: "antiproton", suggestedComputer: "anything" })).code, "INVALID_PAYLOAD");
      assert.equal((await refusal({ model: "gpt-5.6-luna" })).code, "INVALID_PAYLOAD");
      assert.equal((await refusal({ hosting: "computer", model: "gpt-5.6-luna" })).code, "INVALID_PAYLOAD");

      await configure(fake, a);
      const plain = await prepare({ hosting: "antiproton" });
      assert.equal(plain.metadata.action.type === "agent:create" && plain.metadata.action.hosting, "antiproton");
      assert.equal(fake.requests.length, 0, "no model, no list read");

      fake.next(() => ({ status: 200, body: MODELS }));
      const withModel = await prepare({ hosting: "antiproton", model: "gpt-5.6-luna" });
      assert.deepEqual(
        withModel.metadata.action.type === "agent:create" && [withModel.metadata.action.hosting, withModel.metadata.action.model],
        ["antiproton", "gpt-5.6-luna"],
      );
      fake.next(() => ({ status: 200, body: MODELS }));
      const notOffered = await refusal({ hosting: "antiproton", model: "gpt-9" });
      assert.deepEqual([notOffered.status, notOffered.code], [422, "HOSTED_MODEL_NOT_OFFERED"]);
      assert.match(notOffered.message, /Offered: gpt-5\.6-luna, deepseek-flash/);
      fake.next(() => ({ status: 200, body: { ...MODELS, locked: true } }));
      assert.equal((await refusal({ hosting: "antiproton", model: "gpt-5.6-luna" })).code, "HOSTED_MODEL_LOCKED");
      // The list being unreadable does not block the card: the human picks in the dialog.
      fake.next(() => ({ status: 503, body: { error: { code: "busy", message: "later" } } }));
      await prepare({ hosting: "antiproton", model: "gpt-5.6-luna" });
    } finally {
      await fake.close();
    }
  });
});

test("a new hosted agent starts on the model its creator picked; a refused model needs an explicit choice to retry", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      const a = await setupServer(app.baseUrl, "provider-pick");
      await enableModelPickerFor(a.server.id);
      const MODELS = {
        models: [
          { id: "deepseek-flash", label: "DeepSeek Flash", provider: "deepseek" },
          { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", provider: "cloudflare" },
        ],
        default: "deepseek-flash", defaultLabel: "DeepSeek Flash", locked: false,
      };
      const models = (body: unknown = MODELS) => fake.next(() => ({ status: 200, body }));
      const errorOf = async (res: Response) => ({ status: res.status, code: (await res.json() as { code?: string }).code });
      const postBody = () => JSON.parse(fake.requests.filter((r) => r.method === "POST" && r.path === "/provision/agents").at(-1)!.body) as Record<string, unknown>;
      const create = (name: string, extra: Record<string, unknown>) =>
        a.owner.send("POST", "/agents", { name, external: true, provider: "antiproton", ...extra });

      // The list needs createAgents and an available provider; nothing is asked of the provider otherwise.
      assert.deepEqual(await errorOf(await a.owner.get("/agent-runtime-providers/antiproton/models")), { status: 404, code: "agent_runtime_provider_unavailable" });
      await configure(fake, a);
      assert.deepEqual(await errorOf(await a.member.get("/agent-runtime-providers/antiproton/models")), { status: 403, code: "agent_runtime_provider_forbidden" });
      assert.equal(fake.requests.length, 0);
      models({ ...MODELS, extra: "dropped" });
      const listRes = await a.owner.get("/agent-runtime-providers/antiproton/models");
      const listText = await listRes.text();
      assert.equal(listRes.status, 200, listText);
      assert.ok(!listText.includes(PROVIDER_TOKEN));
      assert.deepEqual(JSON.parse(listText), { ...MODELS, picker: true });
      assert.equal(fake.requests.at(-1)!.path, `/provision/models?raftServerId=${a.server.id}`);
      fake.next(() => ({ status: 503, body: { error: { code: "busy", message: "later" } } }));
      assert.deepEqual(await errorOf(await a.owner.get("/agent-runtime-providers/antiproton/models")), { status: 502, code: "hosted_runtime_model_unavailable" });

      // Refused before anything is written: not offered, locked, malformed, or without a provider.
      const agentsBefore = (await getDb().select({ id: agents.id }).from(agents)).length;
      models();
      assert.deepEqual(await errorOf(await create("pick-unknown", { hostedModel: "gpt-9" })), { status: 422, code: "hosted_runtime_model_not_offered" });
      models({ ...MODELS, locked: true });
      assert.deepEqual(await errorOf(await create("pick-locked", { hostedModel: "gpt-5.6-luna" })), { status: 409, code: "hosted_runtime_model_locked" });
      assert.deepEqual(await errorOf(await create("pick-bad", { hostedModel: 7 })), { status: 400, code: "hosted_runtime_model_invalid" });
      assert.deepEqual(await errorOf(await a.owner.send("POST", "/agents", { name: "pick-plain", external: true, hostedModel: "gpt-5.6-luna" })), { status: 400, code: "hosted_runtime_model_invalid" });
      assert.equal((await getDb().select({ id: agents.id }).from(agents)).length, agentsBefore);
      assert.equal(fake.requests.filter((r) => r.method === "POST").length, 0);

      // A pick is checked, stored and sent on the POST; no pick leaves `model` out (never a filled-in default).
      models();
      const luna = await create("pick-luna", { hostedModel: "gpt-5.6-luna" });
      assert.equal(luna.status, 200, await luna.clone().text());
      const lunaAgent = await luna.json() as { id: string };
      assert.equal((await provisionRow(lunaAgent.id)).provisionedModel, "gpt-5.6-luna");
      await drainAgentRuntimeProvisions();
      assert.equal(postBody().model, "gpt-5.6-luna");
      assert.equal((await provisionRow(lunaAgent.id)).state, "active");
      const plain = await createHosted(a.owner, "pick-default");
      await drainAgentRuntimeProvisions();
      assert.equal(postBody().raftAgentId, plain.id);
      assert.ok(!("model" in postBody()), "no pick: the field is left out");

      // Removed between the form and the POST: failed, not retried, and a retry must name a model.
      models();
      const gone = await (await create("pick-gone", { hostedModel: "gpt-5.6-luna" })).json() as { id: string };
      fake.next(() => ({ status: 422, body: { error: { code: "unknown_model", message: "gpt-5.6-luna is not offered", param: "model" } } }));
      await drainAgentRuntimeProvisions();
      let row = await provisionRow(gone.id);
      assert.equal(row.state, "failed");
      assert.equal(row.lastErrorCode, "unknown_model");
      const postsBefore = fake.requests.length;
      await drainAgentRuntimeProvisions({ now: later(60 * 60_000) });
      assert.equal(fake.requests.length, postsBefore, "a model refusal is not retried automatically");
      const status = await (await a.owner.get(`/agents/${gone.id}/hosted-runtime`)).json() as { hostedRuntime: { retryNeedsModel: boolean } };
      assert.equal(status.hostedRuntime.retryNeedsModel, true);
      assert.deepEqual(await errorOf(await a.owner.send("POST", `/agents/${gone.id}/hosted-runtime/retry`)), { status: 409, code: "hosted_runtime_model_required" });
      models({ ...MODELS, models: MODELS.models.slice(0, 1) });
      assert.deepEqual(await errorOf(await a.owner.send("POST", `/agents/${gone.id}/hosted-runtime/retry`, { model: "gpt-5.6-luna" })), { status: 422, code: "hosted_runtime_model_not_offered" });
      assert.equal((await provisionRow(gone.id)).state, "failed");
      // `null` is the default, chosen explicitly: the retried POST leaves `model` out.
      const retry = await a.owner.send("POST", `/agents/${gone.id}/hosted-runtime/retry`, { model: null });
      assert.equal(retry.status, 200, await retry.clone().text());
      row = await provisionRow(gone.id);
      assert.equal(row.state, "provisioning");
      assert.equal(row.provisionedModel, null);
      await drainAgentRuntimeProvisions();
      assert.equal(postBody().raftAgentId, gone.id);
      assert.ok(!("model" in postBody()));
      assert.equal((await provisionRow(gone.id)).state, "active");

      // Any other refusal keeps the plain retry, and the body (with its model) is resent unchanged.
      models();
      const conflict = await (await create("pick-conflict", { hostedModel: "gpt-5.6-luna" })).json() as { id: string };
      fake.next(() => ({ status: 409, body: { error: { code: "agent_id_taken", message: "taken" } } }));
      await drainAgentRuntimeProvisions();
      assert.equal((await provisionRow(conflict.id)).state, "failed");
      assert.equal((await provisionRow(conflict.id)).provisionedModel, "gpt-5.6-luna");
      assert.equal((await a.owner.send("POST", `/agents/${conflict.id}/hosted-runtime/retry`)).status, 200);
      await drainAgentRuntimeProvisions();
      assert.equal(postBody().model, "gpt-5.6-luna");
    } finally {
      await fake.close();
    }
  });
});

test("edits PATCH the provider in order; an edit during provisioning keeps the POST body frozen", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      const a = await setupServer(app.baseUrl, "provider-edit");
      await configure(fake, a);
      const created = await createHosted(a.owner, "edit-agent", "v1");

      const edit = await a.owner.send("PATCH", `/agents/${created.id}`, { displayName: "Edit Agent", description: "v2" });
      assert.equal(edit.status, 200, await edit.clone().text());
      await drainAgentRuntimeProvisions();
      const post = fake.requests.find((r) => r.method === "POST")!;
      assert.equal(JSON.parse(post.body).instructions, "v1", "POST replays the frozen body, never the edit");
      await drainAgentRuntimeProvisions();
      const patch = fake.requests.find((r) => r.method === "PATCH")!;
      assert.equal(patch.path, `/provision/agents/raft_${created.id}?raftServerId=${a.server.id}`, "PATCH carries the Raft server");
      assert.deepEqual(JSON.parse(patch.body), { name: "Edit Agent", instructions: "v2" });

      await a.owner.send("PATCH", `/agents/${created.id}`, { description: "v3" });
      await a.owner.send("PATCH", `/agents/${created.id}`, { description: "v4" });
      await drainAgentRuntimeProvisions();
      const patches = fake.requests.filter((r) => r.method === "PATCH");
      assert.deepEqual(JSON.parse(patches.at(-1)!.body), { name: "Edit Agent", instructions: "v4" }, "last write wins");
      const row = await provisionRow(created.id);
      assert.equal(row.syncedRevision, row.desiredRevision);
      assert.equal((await drainAgentRuntimeProvisions()).claimed, 0);
    } finally {
      await fake.close();
    }
  });
});

test("delete revokes the credential before the provider DELETE and retries until 2xx/404", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      const a = await setupServer(app.baseUrl, "provider-delete");
      await configure(fake, a);
      const created = await createHosted(a.owner, "doomed-agent");
      await drainAgentRuntimeProvisions();
      const credential = JSON.parse(fake.requests.find((r) => r.method === "POST")!.body).credential as string;
      assert.ok(await findAgentCredentialByApiKey(credential));

      const activeCredentialsAtDelete: number[] = [];
      const recordAndReply = (reply: Reply): Handler => async () => {
        const active = await getDb().select({ id: agentCredentials.id }).from(agentCredentials)
          .where(and(eq(agentCredentials.agentId, created.id), isNull(agentCredentials.revokedAt)));
        activeCredentialsAtDelete.push(active.length);
        return reply;
      };
      fake.next(recordAndReply({ status: 500, body: { error: { code: "internal", message: "down" } } }));
      fake.next(recordAndReply({ status: 401, body: { error: { code: "unauthorized", message: "token revoked" } } }));
      fake.next(recordAndReply({ status: 404, body: { error: { code: "not_found", message: "gone" } } }));

      const del = await a.owner.send("DELETE", `/agents/${created.id}`);
      assert.equal(del.status, 200);
      assert.equal(await findAgentCredentialByApiKey(credential), null, "credential unusable right after delete");
      assert.equal((await provisionRow(created.id)).state, "deleting");

      await drainAgentRuntimeProvisions();
      assert.equal((await provisionRow(created.id)).state, "deleting", "5xx keeps the tombstone");
      await drainAgentRuntimeProvisions({ now: later(PROVISION_RETRY_BASE_MS + 1_000) });
      assert.equal((await provisionRow(created.id)).state, "deleting", "4xx other than 404 keeps the tombstone");
      await drainAgentRuntimeProvisions({ now: later(60 * 60_000) });
      const row = await provisionRow(created.id);
      assert.equal(row.state, "deleted");
      assert.ok(row.deletedAt);
      const deletes = fake.requests.filter((r) => r.method === "DELETE");
      assert.equal(deletes.length, 3);
      assert.ok(deletes.every((r) => r.path === `/provision/agents/by-raft-agent/${created.id}?raftServerId=${a.server.id}`), "delete addresses the provider by Raft agent id");
      assert.deepEqual(activeCredentialsAtDelete, [0, 0, 0], "no active credential when the provider DELETE is sent");

    } finally {
      await fake.close();
    }
  });
});

test("deleting an agent whose POST is in flight still reaches the provider DELETE", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      const a = await setupServer(app.baseUrl, "provider-race");
      await configure(fake, a);
      const created = await createHosted(a.owner, "racing-agent");
      fake.next(async (request) => {
        // The Raft agent is deleted while the provider is still answering the POST.
        const del = await a.owner.send("DELETE", `/agents/${created.id}`);
        assert.equal(del.status, 200);
        const body = JSON.parse(request.body) as { raftAgentId: string };
        return { status: 201, body: { providerAgentId: `raft_${body.raftAgentId}`, push: { registered: true } } };
      });
      await drainAgentRuntimeProvisions();
      let row = await provisionRow(created.id);
      assert.equal(row.state, "deleting", "a late POST success does not resurrect the agent");
      assert.equal(row.providerAgentId, `raft_${created.id}`);
      fake.next(() => ({ status: 200, body: { status: "deleted" } }));
      await drainAgentRuntimeProvisions();
      row = await provisionRow(created.id);
      assert.equal(row.state, "deleted");
      assert.deepEqual(fake.requests.filter((r) => r.method === "DELETE").map((r) => r.path), [`/provision/agents/by-raft-agent/${created.id}?raftServerId=${a.server.id}`]);
    } finally {
      await fake.close();
    }
  });
});

test("POST succeeded but its answer was lost, then the agent is deleted: the provider DELETE is still sent by Raft agent id", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      const a = await setupServer(app.baseUrl, "provider-orphan");
      await configure(fake, a);
      const created = await createHosted(a.owner, "orphan-agent");
      fake.next(() => "lose-response");
      await drainAgentRuntimeProvisions();
      let row = await provisionRow(created.id);
      assert.equal(row.state, "provisioning");
      assert.equal(row.providerAgentId, null, "Raft never learned the provider id");

      assert.equal((await a.owner.send("DELETE", `/agents/${created.id}`)).status, 200);
      fake.next(() => ({ status: 200, body: { status: "deleted" } }));
      await drainAgentRuntimeProvisions();
      row = await provisionRow(created.id);
      assert.equal(row.state, "deleted");
      assert.deepEqual(
        fake.requests.filter((r) => r.method === "DELETE").map((r) => r.path),
        [`/provision/agents/by-raft-agent/${created.id}?raftServerId=${a.server.id}`],
      );

      // A provider that never created the agent answers 404: also done.
      const never = await createHosted(a.owner, "never-created-agent");
      fake.next(() => ({ status: 422, body: { error: { code: "credential_refused", message: "no" } } }));
      await drainAgentRuntimeProvisions();
      assert.equal((await provisionRow(never.id)).state, "failed");
      await a.owner.send("DELETE", `/agents/${never.id}`);
      fake.next(() => ({ status: 404, body: { error: { code: "not_found", message: "never created" } } }));
      await drainAgentRuntimeProvisions();
      assert.equal((await provisionRow(never.id)).state, "deleted");
    } finally {
      await fake.close();
    }
  });
});

test("live status passthrough GETs the provider by Raft agent id", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      const a = await setupServer(app.baseUrl, "provider-live");
      await configure(fake, a);
      const created = await createHosted(a.owner, "live-agent");
      await drainAgentRuntimeProvisions();
      fake.next(() => ({ status: 200, body: { providerAgentId: `raft_${created.id}`, status: "active", push: { registered: true, live: { ok: true } } } }));
      const res = await a.owner.get(`/agents/${created.id}/hosted-runtime?live=1`);
      assert.equal(res.status, 200);
      const body = await res.json() as { provider: { status: { status: string } } };
      assert.equal(body.provider.status.status, "active");
      const get = fake.requests.at(-1)!;
      assert.equal(get.method, "GET");
      assert.equal(get.path, `/provision/agents/by-raft-agent/${created.id}?raftServerId=${a.server.id}`);
    } finally {
      await fake.close();
    }
  });
});

test("stop interrupts a hosted agent's running turn through the provider and keeps the agent; a failure is retryable and traced", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      const a = await setupServer(app.baseUrl, "provider-stop");
      await configure(fake, a);
      const created = await createHosted(a.owner, "stop-agent");
      await drainAgentRuntimeProvisions();
      const stop = async () => {
        const res = await a.owner.send("POST", `/agents/${created.id}/stop`, {});
        return { status: res.status, body: await res.json() as { result?: string; code?: string } };
      };

      fake.next(() => ({ status: 200, body: { result: "interrupted", cancelledTurn: "turn_1" } }));
      assert.deepEqual(await stop(), { status: 200, body: { ok: true, result: "interrupted" } });
      const post = fake.requests.at(-1)!;
      assert.deepEqual([post.method, post.path], ["POST", `/provision/agents/by-raft-agent/${created.id}/stop?raftServerId=${a.server.id}`]);
      fake.next(() => ({ status: 200, body: { result: "not_running" } }));
      assert.deepEqual(await stop(), { status: 200, body: { ok: true, result: "not_running" } });
      fake.next(() => ({ status: 404, body: { error: { code: "not_found", message: "no such agent" } } }));
      assert.deepEqual(await stop(), { status: 200, body: { ok: true, result: "not_running" } }, "nothing the provider knows of is running");
      fake.next(() => ({ status: 503, body: { code: "stop_failed" } }));
      const failed = await stop();
      assert.deepEqual([failed.status, failed.body.code], [503, "hosted_stop_failed"]);
      assert.equal((await provisionRow(created.id))!.state, "active", "stop never deletes");

      const sink = new MemoryTraceSink();
      fake.next(() => ({ status: 200, body: { result: "interrupted", cancelledTurn: "turn_2" } }));
      await withTraceRoot(new BasicTracer({ sink }), "test.stop", { surface: "server", kind: "internal" }, () => stopHostedAgentTurn(created.id, a.server.id));
      const ok = sink.getAllLogEvents().find((e) => e.name === "server.hosted_agent.stop");
      assert.equal(ok?.attrs?.outcome, "interrupted");
      assert.ok(!("error_code" in (ok?.attrs ?? {})), "no error code unless it failed");
      fake.next(() => ({ status: 503, body: { error: { code: "stop_failed", message: "busy" } } }));
      const outcome = await withTraceRoot(new BasicTracer({ sink }), "test.stop", { surface: "server", kind: "internal" }, () => stopHostedAgentTurn(created.id, a.server.id));
      assert.deepEqual(outcome, { kind: "failed", code: "stop_failed" });
      const events = sink.getAllLogEvents().filter((e) => e.name === "server.hosted_agent.stop");
      const event = events.find((e) => e.attrs?.outcome === "failed");
      assert.deepEqual({ ...event?.attrs, duration_ms: typeof event?.attrs?.duration_ms }, {
        agent_id: created.id, server_id: a.server.id, outcome: "failed", error_code: "stop_failed", duration_ms: "number",
      });
    } finally {
      await fake.close();
    }
  });
});

test("hosted workspace files and usage are proxied to the provider by its agent id", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      const a = await setupServer(app.baseUrl, "provider-surface");
      await configure(fake, a);
      const created = await createHosted(a.owner, "surface-agent");
      const providerBase = `/provision/agents/raft_${created.id}`;
      const workspace = `/agents/${created.id}/workspace-files`;
      const errorOf = async (res: Response) => ({ status: res.status, code: (await res.json() as { code?: string }).code });

      // Still provisioning: the provider agent id is not known yet, nothing is called.
      const before = fake.requests.length;
      assert.deepEqual(await errorOf(await a.owner.get(workspace)), { status: 409, code: "hosted_runtime_workspace_not_ready" });
      assert.equal(fake.requests.length, before);
      await drainAgentRuntimeProvisions();

      assert.equal((await a.member.get(workspace)).status, 403, "private surface: editAgents or creator only");

      fake.next(() => ({
        status: 200,
        body: {
          files: [{ name: "notes", path: "state/notes", isDirectory: true, size: 0, modifiedAt: "2026-10-01T00:00:00.000Z", providerOnly: 1 }],
          truncated: true,
          omitted: 3,
        },
      }));
      const list = await a.owner.get(`${workspace}?dirPath=${encodeURIComponent("state/notes")}&includeHidden=true`);
      assert.equal(list.status, 200);
      assert.deepEqual(await list.json(), {
        files: [{ name: "notes", path: "state/notes", isDirectory: true, size: 0, modifiedAt: "2026-10-01T00:00:00.000Z" }],
        truncated: true,
        omitted: 3,
      });
      const listCall = fake.requests.at(-1)!;
      assert.equal(listCall.method, "GET");
      assert.equal(listCall.headers.authorization, `Bearer ${PROVIDER_TOKEN}`);
      assert.equal(listCall.path, `${providerBase}/workspace-files?raftServerId=${a.server.id}&dirPath=state%2Fnotes&includeHidden=true`);

      fake.next(() => ({ status: 200, body: { content: "hello", binary: false, size: 5, mimeType: "text/plain", encoding: "utf-8" } }));
      const read = await a.owner.get(`${workspace}/read?path=${encodeURIComponent("artifacts/a b.txt")}`);
      assert.equal(read.status, 200);
      const file = await read.json() as Record<string, unknown>;
      assert.equal(file.path, "artifacts/a b.txt");
      assert.equal(file.content, "hello");
      assert.equal(file.binary, false);
      assert.equal(file.size, 5);
      assert.equal(file.mimeType, "text/plain");
      assert.equal(file.encoding, "utf-8");
      assert.equal(typeof file.modifiedAt, "string");
      assert.equal(fake.requests.at(-1)!.path, `${providerBase}/workspace-files/read?raftServerId=${a.server.id}&path=artifacts%2Fa%20b.txt`);

      fake.next(() => ({ status: 404, body: { error: { code: "not_found", message: "no such file" } } }));
      assert.deepEqual(await errorOf(await a.owner.get(`${workspace}/read?path=missing.txt`)), { status: 404, code: "hosted_runtime_workspace_not_found" });
      fake.next(() => ({ status: 400, body: { error: { code: "not_a_directory", message: "is a file" } } }));
      assert.deepEqual(await errorOf(await a.owner.get(`${workspace}?dirPath=state%2Fa.md`)), { status: 400, code: "hosted_runtime_workspace_bad_request" });
      fake.next(() => ({ status: 502, body: { error: { code: "sandbox_unavailable", message: "backend down" } } }));
      assert.deepEqual(await errorOf(await a.owner.get(workspace)), { status: 502, code: "hosted_runtime_workspace_unavailable" });
      fake.next(() => "lose-response");
      assert.deepEqual(await errorOf(await a.owner.get(workspace)), { status: 502, code: "hosted_runtime_workspace_unavailable" });
      fake.next(() => ({ status: 200, body: { files: "not-a-list" } }));
      assert.deepEqual(await errorOf(await a.owner.get(workspace)), { status: 502, code: "hosted_runtime_workspace_unavailable" });

      // Usage: invalid windows are refused before any provider call.
      const usage = `/agents/${created.id}/hosted-runtime/usage`;
      const beforeInvalid = fake.requests.length;
      for (const query of [
        "from=2026-01-01T00:00:00.000Z&to=2026-03-01T00:00:00.000Z",
        "from=2026-02-01T00:00:00.000Z&to=2026-01-01T00:00:00.000Z",
        "from=yesterday",
        "bucket=5m",
      ]) {
        assert.deepEqual(await errorOf(await a.owner.get(`${usage}?${query}`)), { status: 400, code: "hosted_runtime_usage_invalid_query" }, query);
      }
      assert.equal(fake.requests.length, beforeInvalid);

      const usageBody = {
        raftAgentId: created.id,
        bucket: "1d",
        from: "2026-09-25T00:00:00.000Z",
        to: "2026-10-02T00:00:00.000Z",
        asOf: "2026-10-02T00:00:00.000Z",
        partial: false,
        rows: [
          { at: "2026-10-01T00:00:00.000Z", resource: "model.tokens", dimensions: { model: "m1", kind: "input" }, unit: "tokens", quantity: 10 },
          { at: "2026-10-01T00:00:00.000Z", resource: "model.tokens", dimensions: { model: "m1", kind: "output" }, unit: "tokens", quantity: 4, cost: 0.000036 },
          { at: "2026-10-01T00:00:00.000Z", resource: "tool.call", dimensions: { outcome: "succeeded" }, unit: "calls", quantity: 2, cost: null },
        ],
      };
      fake.next(() => ({ status: 200, body: usageBody }));
      const usageRes = await a.owner.get(usage);
      assert.equal(usageRes.status, 200);
      assert.equal(usageRes.headers.get("cache-control"), "no-store");
      assert.deepEqual(await usageRes.json(), usageBody);
      const usageCall = new URL(fake.requests.at(-1)!.path, "http://provider.test");
      assert.equal(usageCall.pathname, `${providerBase}/usage`);
      assert.ok(usageCall.search.startsWith(`?raftServerId=${a.server.id}&`));
      assert.equal(usageCall.searchParams.get("bucket"), "1d");
      const window = Date.parse(usageCall.searchParams.get("to")!) - Date.parse(usageCall.searchParams.get("from")!);
      assert.equal(window, 7 * 24 * 60 * 60 * 1000, "defaults to the last 7 days");

      fake.next(() => ({ status: 200, body: usageBody }));
      const explicit = await a.owner.get(`${usage}?from=2026-09-01T00:00:00Z&to=2026-09-02T00:00:00Z&bucket=1h`);
      assert.equal(explicit.status, 200);
      assert.equal(
        fake.requests.at(-1)!.path,
        `${providerBase}/usage?raftServerId=${a.server.id}&from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-02T00%3A00%3A00.000Z&bucket=1h`,
      );
    } finally {
      await fake.close();
    }
  });
});

test("a hosted agent's model is read and picked through the provider, by Raft agent id", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      const a = await setupServer(app.baseUrl, "provider-model");
      await enableModelPickerFor(a.server.id);
      // The provider already knows this server may pick (no pre-create sync in the queued answers below).
      await getDb().insert(hostedRuntimeServerPlans).values({ serverId: a.server.id, provider: "antiproton", syncedModelPicker: true });
      await configure(fake, a);
      const created = await createHosted(a.owner, "model-agent");
      const route = `/agents/${created.id}/hosted-runtime/model`;
      const modelPath = `/provision/agents/by-raft-agent/${created.id}/model?raftServerId=${a.server.id}`;
      const modelsPath = `/provision/models?raftServerId=${a.server.id}`;
      const errorOf = async (res: Response) => ({ status: res.status, code: (await res.json() as { code?: string }).code });
      const catalog = {
        models: [
          { id: "deepseek-flash", label: "DeepSeek Flash", provider: "deepseek" },
          { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", provider: "openai", extra: 1 },
        ],
        default: "deepseek-flash",
        defaultLabel: "DeepSeek Flash",
        locked: false,
      };
      // The two provider calls run in parallel; answer each by its path.
      const answer = (agentReply: Reply) => (request: Recorded): Reply =>
        request.path === modelsPath ? { status: 200, body: catalog } : agentReply;

      // Not active yet: nothing is called.
      const before = fake.requests.length;
      assert.deepEqual(await errorOf(await a.owner.get(route)), { status: 409, code: "hosted_runtime_model_not_ready" });
      assert.equal(fake.requests.length, before);
      await drainAgentRuntimeProvisions();

      assert.equal((await a.member.get(route)).status, 403, "editAgents or creator only");
      assert.equal((await a.member.send("PUT", route, { model: "gpt-5.6-luna" })).status, 403);

      const reading = answer({ status: 200, body: { model: "deepseek-flash", label: "DeepSeek Flash", source: "default", locked: false } });
      fake.next(reading); fake.next(reading);
      const read = await a.owner.get(route);
      assert.equal(read.status, 200);
      assert.equal(read.headers.get("cache-control"), "no-store");
      assert.deepEqual(await read.json(), {
        models: [
          { id: "deepseek-flash", label: "DeepSeek Flash", provider: "deepseek" },
          { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", provider: "openai" },
        ],
        default: "deepseek-flash",
        defaultLabel: "DeepSeek Flash",
        model: "deepseek-flash",
        label: "DeepSeek Flash",
        source: "default",
        locked: false,
        picker: true,
      });
      const readCalls = fake.requests.slice(-2).map((request) => `${request.method} ${request.path}`).sort();
      assert.deepEqual(readCalls, [`GET ${modelPath}`, `GET ${modelsPath}`].sort());
      assert.ok(fake.requests.slice(-2).every((request) => request.headers.authorization === `Bearer ${PROVIDER_TOKEN}`));

      // Pick a model.
      const picking = answer({ status: 200, body: { model: "gpt-5.6-luna", label: "GPT-5.6 Luna", source: "chosen", locked: false } });
      fake.next(picking); fake.next(picking);
      const picked = await a.owner.send("PUT", route, { model: "gpt-5.6-luna" });
      assert.equal(picked.status, 200);
      assert.equal((await picked.json() as { source: string; model: string }).source, "chosen");
      const put = fake.requests.slice(-2).find((request) => request.method === "PUT")!;
      assert.equal(put.path, modelPath);
      assert.deepEqual(JSON.parse(put.body), { model: "gpt-5.6-luna" });

      // Back to the default.
      const resetting = answer({ status: 200, body: { model: "deepseek-flash", label: "DeepSeek Flash", source: "default", locked: false } });
      fake.next(resetting); fake.next(resetting);
      assert.equal((await a.owner.send("PUT", route, { model: null })).status, 200);
      assert.deepEqual(JSON.parse(fake.requests.slice(-2).find((request) => request.method === "PUT")!.body), { model: null });

      // Refusals keep their meaning.
      const unknown = answer({ status: 422, body: { error: { code: "unknown_model", message: "not offered", param: "model" } } });
      fake.next(unknown); fake.next(unknown);
      assert.deepEqual(await errorOf(await a.owner.send("PUT", route, { model: "retired-model" })), { status: 422, code: "hosted_runtime_model_not_offered" });
      const locked = answer({ status: 409, body: { error: { code: "model_locked", message: "locked", param: "model" } } });
      fake.next(locked); fake.next(locked);
      assert.deepEqual(await errorOf(await a.owner.send("PUT", route, { model: "gpt-5.6-luna" })), { status: 409, code: "hosted_runtime_model_locked" });
      const down = answer("lose-response");
      fake.next(down); fake.next(down);
      assert.deepEqual(await errorOf(await a.owner.get(route)), { status: 502, code: "hosted_runtime_model_unavailable" });

      // Bad bodies never reach the provider.
      const beforeInvalid = fake.requests.length;
      for (const body of [{}, { model: "" }, { model: 3 }, { model: "x".repeat(201) }]) {
        assert.deepEqual(await errorOf(await a.owner.send("PUT", route, body)), { status: 400, code: "hosted_runtime_model_invalid" }, JSON.stringify(body));
      }
      assert.equal(fake.requests.length, beforeInvalid);
    } finally {
      await fake.close();
    }
  });
});

test("an external agent without a hosted runtime keeps the machine workspace path and has no usage", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      const a = await setupServer(app.baseUrl, "provider-surface-plain");
      await configure(fake, a);
      const plainRes = await a.owner.send("POST", "/agents", { name: "plain-surface", external: true });
      const plain = await plainRes.json() as { id: string };
      assert.equal(plainRes.status, 200, JSON.stringify(plain));
      const before = fake.requests.length;
      for (const path of [`/agents/${plain.id}/workspace-files`, `/agents/${plain.id}/workspace-files/read?path=a.md`]) {
        const res = await a.owner.get(path);
        assert.equal(res.status, 409, path);
        assert.equal((await res.json() as { code: string }).code, "machine_unassigned");
      }
      const usage = await a.owner.get(`/agents/${plain.id}/hosted-runtime/usage`);
      assert.equal(usage.status, 404);
      assert.equal((await usage.json() as { code: string }).code, "hosted_runtime_missing");
      assert.equal(fake.requests.length, before, "no provider call for a non-hosted agent");
    } finally {
      await fake.close();
    }
  });
});

test("a claimed row has exactly one executor until its lease expires", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      const a = await setupServer(app.baseUrl, "provider-lease");
      await configure(fake, a);
      const created = await createHosted(a.owner, "leased-agent");
      const now = new Date(Date.now() + 1_000);
      const winners = (await Promise.all([
        claimProvision(created.id, "replica-a", now),
        claimProvision(created.id, "replica-b", now),
      ])).filter(Boolean);
      assert.equal(winners.length, 1);
      assert.equal((await drainAgentRuntimeProvisions({ leaseOwner: "replica-c" })).claimed, 0, "leased rows are skipped");
      // After the lease expires another replica may take over (the POST is idempotent).
      const takeover = await claimProvision(created.id, "replica-c", new Date(Date.now() + 5 * 60_000));
      assert.ok(takeover);
      assert.equal(takeover.leaseGeneration, winners[0]!.leaseGeneration + 1);
    } finally {
      await fake.close();
    }
  });
});

test("the antiproton base URL is fixed by DEPLOYMENT_ENV; only the token is configurable", () => {
  __setAgentRuntimeProviderTransportForTests(null);
  const token = { ANTIPROTON_PROVISIONING_TOKEN: PROVIDER_TOKEN };
  assert.equal(resolveProviderConfig("antiproton", { ...token, DEPLOYMENT_ENV: "staging" })?.baseUrl, "https://preview.antiproton.ai");
  assert.equal(resolveProviderConfig("antiproton", { ...token, DEPLOYMENT_ENV: "production" })?.baseUrl, "https://antiproton.ai");
  for (const deploymentEnv of [undefined, "dev", "test", "release-qa", "slockdev", "constructor"]) {
    assert.equal(resolveProviderConfig("antiproton", { ...token, DEPLOYMENT_ENV: deploymentEnv }), null, `${deploymentEnv}: no default provider`);
  }
  assert.equal(resolveProviderConfig("antiproton", { DEPLOYMENT_ENV: "production" }), null, "no token → unavailable");
  assert.equal(resolveProviderConfig("antiproton", { DEPLOYMENT_ENV: "production", ANTIPROTON_PROVISIONING_TOKEN: "  " }), null);
});

// ---------------------------------------------------------------------------
// Account connections (raft-agent-provider.v1 connections extension)
// ---------------------------------------------------------------------------

async function setupConnectionServer(baseUrl: string, slug: string) {
  const base = await setupServer(baseUrl, slug);
  const admin = await seedUser(`${slug}-admin@raft.test`, `${slug}-admin`);
  const creator = await seedUser(`${slug}-creator@raft.test`, `${slug}-creator`);
  const guest = await seedUser(`${slug}-guest@raft.test`, `${slug}-guest`);
  await getDb().insert(serverMembers).values([
    { serverId: base.server.id, userId: admin.id, role: "admin" },
    { serverId: base.server.id, userId: creator.id, role: "member" },
    { serverId: base.server.id, userId: guest.id, role: "guest" },
  ]);
  return {
    ...base,
    creatorUser: creator,
    guestUser: guest,
    admin: api(baseUrl, await tokenForHuman(admin.email), base.server.id),
    creator: api(baseUrl, await tokenForHuman(creator.email), base.server.id),
    guest: api(baseUrl, await tokenForHuman(guest.email), base.server.id),
  };
}

function connectionRequests(fake: { requests: Recorded[] }) {
  return fake.requests.filter((r) => r.path.includes("/connections/"));
}

test("connect GitHub: owner/admin/creator only, returnUrl from the Raft origin, initiatedBy bound to the caller", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      const a = await setupConnectionServer(app.baseUrl, "conn-perm");
      await configure(fake, a);
      const created = await createHosted(a.owner, "conn-agent");
      await drainAgentRuntimeProvisions();
      // The member "creator" owns the agent (a member cannot create agents itself).
      await getDb().update(agents).set({ creatorType: "user", creatorId: a.creatorUser.id }).where(eq(agents.id, created.id));
      const path = `/agents/${created.id}/connections/github`;
      const expectedPath = `/provision/agents/by-raft-agent/${created.id}/connections/github?raftServerId=${a.server.id}`;
      fake.setFallback((request) => {
        if (request.method === "POST" && request.path === expectedPath) {
          return { status: 200, body: { url: "https://github.com/login/oauth/authorize?state=abc", expiresAt: "2026-09-29T00:10:00.000Z", scopes: ["public_repo"] } };
        }
        return { status: 500, body: { error: { code: "unexpected", message: request.path } } };
      });

      // Forbidden callers never reach the provider.
      for (const [who, client] of [["member", a.member], ["guest", a.guest]] as const) {
        for (const method of ["GET", "POST", "DELETE"]) {
          const res = method === "GET" ? await client.get(path) : await client.send(method, path, method === "POST" ? {} : undefined);
          assert.equal(res.status, 403, `${who} ${method}`);
        }
      }
      // A guest who is the agent's creator is still refused.
      await getDb().update(agents).set({ creatorId: a.guestUser.id }).where(eq(agents.id, created.id));
      assert.equal((await a.guest.send("POST", path, {})).status, 403, "guest creator");
      await getDb().update(agents).set({ creatorId: a.creatorUser.id }).where(eq(agents.id, created.id));
      assert.equal(connectionRequests(fake).length, 0, "forbidden callers never reach the provider");

      for (const [who, client] of [["owner", a.owner], ["admin", a.admin], ["creator", a.creator]] as const) {
        const res = await client.send("POST", path, who === "admin" ? { access: "private" } : {});
        const text = await res.text();
        assert.equal(res.status, 200, `${who}: ${text}`);
        assert.deepEqual(JSON.parse(text), { url: "https://github.com/login/oauth/authorize?state=abc", expiresAt: "2026-09-29T00:10:00.000Z", scopes: ["public_repo"] });
      }
      const posts = connectionRequests(fake);
      assert.equal(posts.length, 3);
      const bodies = posts.map((r) => JSON.parse(r.body) as { returnUrl: string; initiatedBy: { raftUserId: string }; access?: string });
      for (const body of bodies) {
        assert.equal(body.returnUrl, `${RAFT_ORIGIN}/api/connections/callback/${a.server.id}/${created.id}`);
      }
      const idOf = async (email: string) => (await getDb().select({ id: users.id }).from(users).where(eq(users.email, email)))[0]!.id;
      assert.deepEqual(bodies.map((b) => b.initiatedBy.raftUserId), [
        await idOf("conn-perm-owner@raft.test"),
        await idOf("conn-perm-admin@raft.test"),
        a.creatorUser.id,
      ]);
      assert.deepEqual(bodies.map((b) => b.access), [undefined, "private", undefined]);
      assert.ok(posts.every((r) => r.headers.authorization === `Bearer ${PROVIDER_TOKEN}`));

      assert.equal((await a.owner.send("POST", path, { access: "admin" })).status, 400, "unknown access");
      assert.equal((await a.owner.send("POST", `/agents/${created.id}/connections/gitlab`, {})).status, 404, "provider allowlist");

      const audits = await getDb().select().from(integrationAuditEvents).where(eq(integrationAuditEvents.eventType, "agent_connection.connect_initiated"));
      assert.equal(audits.filter((row) => row.targetId === created.id && row.outcome === "success").length, 3);
      assert.ok(audits.every((row) => !JSON.stringify(row).includes("state=abc")), "the one-time URL is not audited");
    } finally {
      await fake.close();
    }
  });
});

test("connection status resolves connectedBy, disconnect deletes, provider 404 means not supported or agent missing, non-provider agents are refused", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      const a = await setupConnectionServer(app.baseUrl, "conn-status");
      await configure(fake, a);
      const created = await createHosted(a.owner, "conn-status-agent");
      const path = `/agents/${created.id}/connections/github`;

      // Still provisioning: the provider does not know the agent yet.
      assert.equal((await a.owner.get(path)).status, 409);
      await drainAgentRuntimeProvisions();

      fake.next(() => ({ status: 200, body: { connected: true, account: "octocat", connectedAt: "2026-09-29T00:00:00.000Z", connectedBy: a.creatorUser.id, scopes: ["public_repo"] } }));
      const statusRes = await a.admin.get(path);
      const status = await statusRes.json();
      assert.equal(statusRes.status, 200, JSON.stringify(status));
      assert.deepEqual(status, {
        provider: "github",
        supported: true,
        connected: true,
        account: "octocat",
        connectedAt: "2026-09-29T00:00:00.000Z",
        connectedBy: { id: a.creatorUser.id, name: a.creatorUser.displayName },
        scopes: ["public_repo"],
        connectorId: null,
        connectors: [],
      });
      assert.equal(fake.requests.at(-1)!.path, `/provision/agents/by-raft-agent/${created.id}/connections/github?raftServerId=${a.server.id}`);

      fake.next(() => ({ status: 204 }));
      assert.equal((await a.owner.send("DELETE", path)).status, 204);
      assert.equal(fake.requests.at(-1)!.method, "DELETE");
      const disconnects = await getDb().select().from(integrationAuditEvents).where(eq(integrationAuditEvents.eventType, "agent_connection.disconnected"));
      assert.equal(disconnects.filter((row) => row.targetId === created.id).length, 1);

      // The provider answers unknown routes and unknown agents alike with 404
      // `not_found`, so a connections 404 is classified by looking the agent up.
      const agentLookupPath = `/provision/agents/by-raft-agent/${created.id}?raftServerId=${a.server.id}`;
      const routeMissing = { status: 404, body: { error: { code: "not_found", message: "route is not part of raft-agent-provider.v1" } } };
      const isAgentLookup = (request: Recorded) => request.method === "GET" && request.path === agentLookupPath;

      // Connections 404 + agent lookup 200: the agent exists, the connections route does not → unsupported.
      fake.setFallback((request) => isAgentLookup(request) ? { status: 200, body: { providerAgentId: `raft_${created.id}`, status: "active" } } : routeMissing);
      let before = fake.requests.length;
      const unsupported = await a.owner.get(path);
      assert.equal(unsupported.status, 200);
      assert.deepEqual(await unsupported.json(), { provider: "github", supported: false });
      assert.deepEqual(fake.requests.slice(before).map((r) => `${r.method} ${r.path}`), [
        `GET /provision/agents/by-raft-agent/${created.id}/connections/github?raftServerId=${a.server.id}`,
        `GET ${agentLookupPath}`,
      ], "exactly one follow-up agent lookup");
      const startUnsupported = await a.owner.send("POST", path, {});
      assert.equal(startUnsupported.status, 409);
      assert.equal((await startUnsupported.json() as { code: string }).code, "agent_connection_unsupported");

      // Connections 404 + agent lookup 404: the provider no longer knows the agent (stale provisioning).
      const missingMessage = `no provisioned agent made from Raft agent ${created.id}`;
      fake.setFallback((request) => isAgentLookup(request) ? { status: 404, body: { error: { code: "not_found", message: missingMessage } } } : routeMissing);
      for (const method of ["GET", "POST"] as const) {
        before = fake.requests.length;
        const res = method === "GET" ? await a.owner.get(path) : await a.owner.send("POST", path, {});
        assert.equal(res.status, 409, method);
        assert.deepEqual(await res.json(), {
          error: "This agent no longer exists at its provider; connections are unavailable. Recreate the agent.",
          code: "agent_connection_agent_missing_at_provider",
          providerMessage: missingMessage,
        }, method);
        assert.equal(fake.requests.slice(before).filter(isAgentLookup).length, 1, `${method}: one agent lookup`);
      }

      // Connections 404 + agent lookup failing: that call's error, not a guess.
      fake.setFallback((request) => isAgentLookup(request) ? { status: 503, body: { error: { code: "down", message: "later" } } } : routeMissing);
      assert.equal((await a.owner.get(path)).status, 502);

      // Non-404 connection errors never trigger the lookup.
      before = fake.requests.length;
      fake.setFallback(() => ({ status: 503, body: { error: { code: "down", message: "later" } } }));
      assert.equal((await a.owner.send("POST", path, {})).status, 502);
      assert.equal(fake.requests.slice(before).filter(isAgentLookup).length, 0);

      // A plain external agent (no provider) is not provider-backed.
      const plainRes = await a.owner.send("POST", "/agents", { name: "plain-external", external: true });
      const plain = await plainRes.json() as { id: string };
      assert.equal(plainRes.status, 200, JSON.stringify(plain));
      const connectionsBefore = connectionRequests(fake).length;
      const refused = await a.owner.send("POST", `/agents/${plain.id}/connections/github`, {});
      assert.equal(refused.status, 400);
      assert.equal((await refused.json() as { code: string }).code, "agent_connection_not_provider_backed");
      assert.equal(connectionRequests(fake).length, connectionsBefore);

      // Another server cannot address the agent.
      const b = await setupServer(app.baseUrl, "conn-status-b");
      assert.equal((await b.owner.get(path)).status, 404);
    } finally {
      await fake.close();
    }
  });
});

test("the provider return lands on the API origin and is forwarded to the web landing page", async ({ app }) => {
  const serverId = randomUUID();
  const agentId = randomUUID();
  const by = randomUUID();
  const res = await fetch(`${app.baseUrl}/api/connections/callback/${serverId}/${agentId}?connection=github&status=pending&pending=pnd_abc-123&by=${by}&extra=x`, { redirect: "manual" });
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get("location")!);
  assert.equal(location.pathname, "/connections/callback");
  assert.deepEqual(Object.fromEntries(location.searchParams), { connection: "github", status: "pending", pending: "pnd_abc-123", by, serverId, agentId });
  // A bare "connected" is not an outcome any more: only a confirmed pending id attaches a connection.
  const legacy = new URL(buildAgentConnectionLandingUrl({ serverId, agentId, query: { connection: "github", status: "connected", pending: "x" } })!);
  assert.deepEqual(Object.fromEntries(legacy.searchParams), { connection: "github", status: "failed", serverId, agentId });
  assert.equal((await fetch(`${app.baseUrl}/api/connections/callback/nope/${agentId}`, { redirect: "manual" })).status, 404);
  const odd = new URL(buildAgentConnectionLandingUrl({ serverId, agentId, query: { connection: "gitlab", status: "pwned", by: "<script>" } })!);
  assert.deepEqual(Object.fromEntries(odd.searchParams), { status: "failed", serverId, agentId });
});

test("confirming a pending connection re-checks permission and sends the session user, not the query `by`", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      const a = await setupConnectionServer(app.baseUrl, "conn-confirm");
      await configure(fake, a);
      const created = await createHosted(a.owner, "conn-confirm-agent");
      await drainAgentRuntimeProvisions();
      await getDb().update(agents).set({ creatorType: "user", creatorId: a.creatorUser.id }).where(eq(agents.id, created.id));
      const path = `/agents/${created.id}/connections/github/confirm`;
      const confirmPath = `/provision/agents/by-raft-agent/${created.id}/connections/github/confirm?raftServerId=${a.server.id}`;
      fake.setFallback((request) => {
        if (request.method !== "POST" || request.path !== confirmPath) return { status: 500 };
        const body = JSON.parse(request.body) as { pending: string; raftUserId: string };
        if (body.pending !== "pnd_ok" || body.raftUserId !== a.creatorUser.id) {
          return { status: 404, body: { error: { code: "not_found", message: "expired, used or mismatched" } } };
        }
        return { status: 200, body: { connected: true, connectorId: "ctr_new", account: "octocat", connectedAt: "2026-09-29T00:00:00.000Z", connectedBy: a.creatorUser.id } };
      });

      for (const client of [a.member, a.guest]) {
        assert.equal((await client.send("POST", path, { pending: "pnd_ok", by: a.creatorUser.id })).status, 403);
      }
      assert.equal(connectionRequests(fake).length, 0, "no confirm call without permission");
      assert.equal((await a.creator.send("POST", path, {})).status, 400);

      const ok = await a.creator.send("POST", path, { pending: "pnd_ok" });
      const okBody = await ok.json() as { connected: boolean; account: string; connectedBy: { id: string }; connectorId: string };
      assert.equal(ok.status, 200, JSON.stringify(okBody));
      assert.equal(okBody.connected, true);
      assert.equal(okBody.connectorId, "ctr_new", "confirm creates a tenant connector and returns its id");
      assert.equal(okBody.account, "octocat");
      assert.equal(okBody.connectedBy.id, a.creatorUser.id);
      const sent = JSON.parse(connectionRequests(fake).at(-1)!.body) as Record<string, unknown>;
      assert.deepEqual(sent, { pending: "pnd_ok", raftUserId: a.creatorUser.id });

      // The owner cannot complete the creator's flow: the provider sees the owner's id and refuses.
      const foreign = await a.owner.send("POST", path, { pending: "pnd_ok", raftUserId: a.creatorUser.id });
      assert.equal(foreign.status, 404);
      assert.equal((await foreign.json() as { code: string }).code, "agent_connection_pending_invalid");
      assert.notEqual((JSON.parse(connectionRequests(fake).at(-1)!.body) as { raftUserId: string }).raftUserId, a.creatorUser.id);

      const expired = await a.creator.send("POST", path, { pending: "pnd_expired" });
      assert.equal(expired.status, 404);
      assert.equal((await expired.json() as { code: string }).code, "agent_connection_pending_invalid");

      const before = connectionRequests(fake).length;
      assert.equal((await a.creator.send("POST", path, { pending: "bad id/../x" })).status, 404, "malformed pending ids never reach the provider");
      assert.equal(connectionRequests(fake).length, before);

      const audits = await getDb().select().from(integrationAuditEvents).where(eq(integrationAuditEvents.eventType, "agent_connection.confirmed"));
      const confirmed = audits.filter((row) => row.targetId === created.id && row.outcome === "success");
      assert.equal(confirmed.length, 1);
      assert.equal((confirmed[0]!.metadata as { connectorId?: string }).connectorId, "ctr_new");
    } finally {
      await fake.close();
    }
  });
});

test("a provider refusal (4xx) surfaces its sanitized reason on connect and confirm", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      const a = await setupConnectionServer(app.baseUrl, "conn-refused");
      await configure(fake, a);
      const created = await createHosted(a.owner, "conn-refused-agent");
      await drainAgentRuntimeProvisions();
      const reason = "Agent has no github plugin mount; add exactly one. token ghp_abcdef0123456789 Bearer secret-value";
      fake.setFallback(() => ({ status: 409, body: { error: { code: "github_mount_missing", message: reason } } }));

      for (const [path, body] of [
        [`/agents/${created.id}/connections/github`, {}],
        [`/agents/${created.id}/connections/github/confirm`, { pending: "pnd_ok" }],
      ] as const) {
        const res = await a.owner.send("POST", path, body);
        const text = await res.text();
        assert.equal(res.status, 409, text);
        const json = JSON.parse(text) as { code: string; providerCode: string; providerMessage: string; error: string };
        assert.equal(json.code, "agent_connection_provider_refused");
        assert.equal(json.providerCode, "github_mount_missing");
        assert.match(json.providerMessage, /^Agent has no github plugin mount; add exactly one\./);
        assert.equal(json.error, json.providerMessage);
        assert.ok(!text.includes("ghp_abcdef0123456789") && !text.includes("secret-value"), "token-shaped text is redacted");
        assert.ok(!text.includes(PROVIDER_TOKEN));
      }

      // Confirm 404 keeps its own code but still carries the provider's reason.
      fake.setFallback(() => ({ status: 404, body: { error: { code: "pending_expired", message: "The pending connection expired." } } }));
      const expired = await a.owner.send("POST", `/agents/${created.id}/connections/github/confirm`, { pending: "pnd_old" });
      assert.equal(expired.status, 404);
      assert.deepEqual(
        await expired.json(),
        { error: "The connection link expired or is invalid; start again", code: "agent_connection_pending_invalid", providerCode: "pending_expired", providerMessage: "The pending connection expired." },
      );
    } finally {
      await fake.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Tenant connectors: one server-level GitHub connection shared by several agents
// ---------------------------------------------------------------------------

async function setupConnectorServer(baseUrl: string, slug: string) {
  const a = await setupConnectionServer(baseUrl, slug);
  const idOf = async (email: string) => (await getDb().select({ id: users.id }).from(users).where(eq(users.email, email)))[0]!.id;
  return {
    ...a,
    ownerId: await idOf(`${slug}-owner@raft.test`),
    adminId: await idOf(`${slug}-admin@raft.test`),
    memberId: await idOf(`${slug}-member@raft.test`),
  };
}

test("connection status lists the server's connectors with resolved creators, per-caller authority and never a token", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      const a = await setupConnectorServer(app.baseUrl, "conn-list");
      await configure(fake, a);
      const created = await createHosted(a.owner, "conn-list-agent");
      await drainAgentRuntimeProvisions();
      await getDb().update(agents).set({ creatorType: "user", creatorId: a.creatorUser.id }).where(eq(agents.id, created.id));
      const outsider = await seedUser("conn-list-outsider@raft.test", "conn-list-outsider");
      fake.setFallback(() => ({
        status: 200,
        body: {
          connected: true,
          connectorId: "ctr_mine",
          account: "octocat",
          connectedAt: "2026-09-29T00:00:00.000Z",
          connectedBy: a.creatorUser.id,
          // Built at runtime so secret scanners don't flag this test sample.
          token: "gh" + "p_toplevelsecret0123456789",
          connectors: [
            { id: "ctr_mine", account: "octocat", creatorRaftUserId: a.creatorUser.id, createdAt: "2026-09-29T00:00:00.000Z", current: true, accessToken: "ghp_mysecret0123456789" },
            { id: "ctr_admin", account: "hubot", creatorRaftUserId: a.adminId, createdAt: "2026-09-28T00:00:00.000Z", current: false },
            { id: "ctr_gone", account: "ex", creatorRaftUserId: outsider.id, createdAt: null, current: false },
            { id: "bad id/..", account: "x", creatorRaftUserId: a.adminId },
            "junk",
          ],
        },
      }));
      const path = `/agents/${created.id}/connections/github`;

      const res = await a.creator.get(path);
      const text = await res.text();
      assert.equal(res.status, 200, text);
      assert.ok(!text.includes("ghp_"), "no provider token field is passed through");
      const body = JSON.parse(text) as { connectorId: string; connectors: unknown[] };
      assert.equal(body.connectorId, "ctr_mine");
      assert.deepEqual(body.connectors, [
        { id: "ctr_mine", account: "octocat", createdAt: "2026-09-29T00:00:00.000Z", creator: { id: a.creatorUser.id, name: "conn-list-creator", displayName: "conn-list-creator" }, current: true, canManage: true },
        { id: "ctr_admin", account: "hubot", createdAt: "2026-09-28T00:00:00.000Z", creator: { id: a.adminId, name: "conn-list-admin", displayName: "conn-list-admin" }, current: false, canManage: false },
        // Not a member of this server: no name is resolved.
        { id: "ctr_gone", account: "ex", createdAt: null, creator: { id: outsider.id, name: null, displayName: null }, current: false, canManage: false },
      ]);

      const asAdmin = await (await a.admin.get(path)).json() as { connectors: { id: string; canManage: boolean }[] };
      assert.deepEqual(asAdmin.connectors.map((c) => c.canManage), [true, true, true], "owner/admin may manage every connector");
    } finally {
      await fake.close();
    }
  });
});

test("switching an agent's connector and disconnecting a connector need the connector's creator or an owner/admin", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      const a = await setupConnectorServer(app.baseUrl, "conn-assign");
      await configure(fake, a);
      const created = await createHosted(a.owner, "conn-assign-agent");
      await drainAgentRuntimeProvisions();
      // The member "creator" owns the agent, so it may manage it but only its own connectors.
      await getDb().update(agents).set({ creatorType: "user", creatorId: a.creatorUser.id }).where(eq(agents.id, created.id));
      const statusPath = `/provision/agents/by-raft-agent/${created.id}/connections/github?raftServerId=${a.server.id}`;
      const connectors = [
        { id: "ctr_creator", account: "octocat", creatorRaftUserId: a.creatorUser.id, createdAt: "2026-09-29T00:00:00.000Z", current: false },
        { id: "ctr_admin", account: "hubot", creatorRaftUserId: a.adminId, createdAt: "2026-09-29T00:00:00.000Z", current: false },
        { id: "ctr_member", account: "monalisa", creatorRaftUserId: a.memberId, createdAt: "2026-09-29T00:00:00.000Z", current: false },
        { id: "ctr_guest", account: "ghost", creatorRaftUserId: a.guestUser.id, createdAt: "2026-09-29T00:00:00.000Z", current: false },
      ];
      fake.setFallback((request) => {
        if (request.method === "GET" && request.path === statusPath) return { status: 200, body: { connected: false, connectorId: null, account: null, connectors } };
        if (request.method === "PUT" && request.path === statusPath) return { status: 200, body: {} };
        if (request.method === "DELETE" && request.path.startsWith("/provision/connectors/")) return { status: 204 };
        return { status: 500, body: { error: { code: "unexpected", message: `${request.method} ${request.path}` } } };
      });
      const agentPath = `/agents/${created.id}/connections/github`;
      const mutations = () => fake.requests.filter((r) => r.method === "PUT" || (r.method === "DELETE" && r.path.startsWith("/provision/connectors/")));
      const assign = (client: ReturnType<typeof api>, connectorId: unknown) => client.send("PUT", agentPath, { connectorId });
      const disconnect = (client: ReturnType<typeof api>, connectorId: string) => client.send("DELETE", `${agentPath}/connectors/${connectorId}`);

      // Refused: never reaches the provider's mutating routes.
      // Guests are refused before the route (guest gate), so no route code is asserted for them.
      const refusals: [string, () => Promise<Response>, number, string | null][] = [
        ["agent creator, someone else's connector (PUT)", () => assign(a.creator, "ctr_admin"), 403, "agent_connection_connector_forbidden"],
        ["agent creator, someone else's connector (DELETE)", () => disconnect(a.creator, "ctr_admin"), 403, "agent_connection_connector_forbidden"],
        ["connector creator who cannot manage the agent (PUT)", () => assign(a.member, "ctr_member"), 403, "agent_connection_forbidden"],
        ["connector creator who cannot manage the agent (DELETE)", () => disconnect(a.member, "ctr_member"), 403, "agent_connection_forbidden"],
        ["guest (PUT)", () => assign(a.guest, "ctr_guest"), 403, null],
        ["guest (DELETE)", () => disconnect(a.guest, "ctr_guest"), 403, null],
        ["unknown connector (PUT)", () => assign(a.owner, "ctr_nope"), 404, "agent_connection_connector_not_found"],
        ["unknown connector (DELETE)", () => disconnect(a.owner, "ctr_nope"), 404, "agent_connection_connector_not_found"],
        ["missing connectorId", () => assign(a.owner, undefined), 400, "agent_connection_invalid"],
      ];
      for (const [label, call, status, code] of refusals) {
        const res = await call();
        const json = await res.json() as { code: string; error: string };
        assert.equal(res.status, status, `${label}: ${JSON.stringify(json)}`);
        if (code) assert.equal(json.code, code, label);
        if (code === "agent_connection_connector_forbidden") assert.match(json.error, /creator or a server admin/);
      }
      // A guest who created both the agent and the connector is still refused.
      await getDb().update(agents).set({ creatorId: a.guestUser.id }).where(eq(agents.id, created.id));
      assert.equal((await assign(a.guest, "ctr_guest")).status, 403, "guest creator");
      await getDb().update(agents).set({ creatorId: a.creatorUser.id }).where(eq(agents.id, created.id));
      assert.equal(mutations().length, 0, "refused callers never reach the provider");

      // Allowed: the acting role Raft vouches for goes to the provider.
      const allowed: [string, ReturnType<typeof api>, string, string, string][] = [
        ["connector creator", a.creator, "ctr_creator", a.creatorUser.id, "creator"],
        ["admin, own connector", a.admin, "ctr_admin", a.adminId, "creator"],
        ["admin, other's connector", a.admin, "ctr_creator", a.adminId, "admin"],
        ["owner", a.owner, "ctr_member", a.ownerId, "admin"],
      ];
      for (const [label, client, connectorId, actingRaftUserId, actingRole] of allowed) {
        const put = await assign(client, connectorId);
        const putBody = await put.json() as { supported: boolean; connectors: unknown[] };
        assert.equal(put.status, 200, `${label}: ${JSON.stringify(putBody)}`);
        assert.equal(putBody.connectors.length, connectors.length, `${label}: returns the refreshed status`);
        assert.deepEqual(JSON.parse(mutations().at(-1)!.body), { connectorId, actingRaftUserId, actingRole }, label);

        const del = await disconnect(client, connectorId);
        assert.equal(del.status, 204, label);
        const sent = mutations().at(-1)!;
        assert.equal(sent.path, `/provision/connectors/${connectorId}?raftServerId=${a.server.id}`);
        assert.deepEqual(JSON.parse(sent.body), { actingRaftUserId, actingRole }, label);
      }

      // Partial failure: the provider could not detach some agents (502 + `failed`). Not a success; retrying the same call completes it.
      let partialOnce = true;
      fake.setFallback((request) => {
        if (request.method === "GET" && request.path === statusPath) return { status: 200, body: { connected: false, connectors } };
        if (request.method === "DELETE" && request.path.startsWith("/provision/connectors/")) {
          if (partialOnce) {
            partialOnce = false;
            return { status: 502, body: { error: { code: "partial", message: "some agents were not detached" }, failed: [randomUUID(), randomUUID()] } };
          }
          return { status: 204 };
        }
        return { status: 500 };
      });
      const partial = await disconnect(a.owner, "ctr_admin");
      assert.equal(partial.status, 502);
      assert.deepEqual(await partial.json(), {
        error: "Disconnect partially completed; retry to finish",
        code: "agent_connection_connector_disconnect_partial",
        failedCount: 2,
      });
      assert.equal((await disconnect(a.owner, "ctr_admin")).status, 204, "retry completes the cleanup");
      const partialAudits = await getDb().select().from(integrationAuditEvents).where(eq(integrationAuditEvents.eventType, "agent_connection.connector_disconnected"));
      assert.equal(partialAudits.filter((row) => row.targetId === created.id && row.outcome === "failure").length, 1);
      fake.setFallback((request) => {
        if (request.method === "GET" && request.path === statusPath) return { status: 200, body: { connected: false, connectorId: null, account: null, connectors } };
        return { status: 204 };
      });

      // Agent-level DELETE only detaches this agent (the existing rule, no connector check).
      fake.next(() => ({ status: 204 }));
      assert.equal((await a.creator.send("DELETE", agentPath)).status, 204);
      assert.equal(fake.requests.at(-1)!.path, statusPath);

      // The connector vanished between the lookup and the PUT: provider 404 + agent still there.
      fake.setFallback((request) => {
        if (request.method === "GET" && request.path === statusPath) return { status: 200, body: { connected: false, connectors } };
        if (request.method === "GET") return { status: 200, body: { providerAgentId: `raft_${created.id}` } };
        return { status: 404, body: { error: { code: "not_found", message: "no connector" } } };
      });
      const raced = await assign(a.owner, "ctr_creator");
      assert.equal(raced.status, 404);
      assert.equal((await raced.json() as { code: string }).code, "agent_connection_connector_not_found");

      const audits = await getDb().select().from(integrationAuditEvents).where(eq(integrationAuditEvents.targetId, created.id));
      const assigned = audits.filter((row) => row.eventType === "agent_connection.connector_assigned" && row.outcome === "success");
      const disconnected = audits.filter((row) => row.eventType === "agent_connection.connector_disconnected" && row.outcome === "success");
      assert.equal(assigned.length, 4);
      assert.equal(disconnected.length, 5, "four in the matrix plus the completed retry");
      assert.deepEqual(assigned.map((row) => (row.metadata as { actingRole: string }).actingRole).sort(), ["admin", "admin", "creator", "creator"]);
    } finally {
      await fake.close();
    }
  });
});

test("server spend is proxied for owners and admins, with provider agent ids mapped back to this server's agents", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      const a = await setupServer(app.baseUrl, "provider-spend-a");
      const b = await setupServer(app.baseUrl, "provider-spend-b");
      const admin = await seedUser("provider-spend-a-admin@raft.test", "provider-spend-a-admin");
      await getDb().insert(serverMembers).values({ serverId: a.server.id, userId: admin.id, role: "admin" });
      const adminClient = api(app.baseUrl, await tokenForHuman(admin.email), a.server.id);
      await configure(fake, a);
      await enableFlagFor(b.server.id);
      const small = await createHosted(a.owner, "spend-small");
      const big = await createHosted(a.owner, "spend-big");
      const other = await createHosted(b.owner, "spend-other-server");
      await drainAgentRuntimeProvisions();
      const spend = "/billing/hosted-runtime-usage";
      const errorOf = async (res: Response) => ({ status: res.status, code: (await res.json() as { code?: string }).code });

      const before = fake.requests.length;
      assert.deepEqual(await errorOf(await a.member.get(spend)), { status: 403, code: "hosted_runtime_spend_forbidden" });
      for (const query of ["bucket=week", "from=yesterday", "from=2026-02-01T00:00:00Z&to=2026-01-01T00:00:00Z", "from=2025-01-01T00:00:00Z&to=2026-03-01T00:00:00Z"]) {
        assert.deepEqual(await errorOf(await a.owner.get(`${spend}?${query}`)), { status: 400, code: "hosted_runtime_spend_invalid_query" }, query);
      }
      assert.equal(fake.requests.length, before, "refusals never call the provider");

      fake.next(() => ({
        status: 200,
        body: {
          currency: "USD", estimated: true, tenantId: "raft_provider-spend-a",
          today: { day: "2026-10-13", spentUsd: 1.84, limitUsd: 5, exempt: false, platformLimitReached: false, refusing: false, resetsAt: "2026-10-14T00:00:00.000Z" },
          from: "2026-09-13T00:00:00.000Z", to: "2026-10-14T00:00:00.000Z", bucket: "month", totalUsd: 4.31,
          periods: [
            { start: "2026-09-01T00:00:00.000Z", totalUsd: 2.47, resources: [{ resource: "model.tokens", costUsd: 2.47 }], unpriced: [] },
            { start: "2026-10-01T00:00:00.000Z", totalUsd: 1.84, resources: [{ resource: "model.tokens", costUsd: 1.84 }], unpriced: ["tool.call js.run calls"] },
          ],
          agents: [
            { providerAgentId: `raft_${big.id}`, totalUsd: 3 },
            { providerAgentId: "raft_gone-1", totalUsd: 0.25 },
            { providerAgentId: `raft_${other.id}`, totalUsd: 0.5 },
            { providerAgentId: `raft_${small.id}`, totalUsd: 0.56 },
          ],
        },
      }));
      const res = await adminClient.get(`${spend}?bucket=month`);
      const text = await res.text();
      assert.equal(res.status, 200, text);
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.ok(!text.includes(PROVIDER_TOKEN) && !text.includes("raft_"), "no token and no provider ids reach the browser");
      assert.deepEqual(JSON.parse(text), {
        currency: "USD", estimated: true,
        today: { day: "2026-10-13", spentUsd: 1.84, limitUsd: 5, exempt: false, platformLimitReached: false, refusing: false, resetsAt: "2026-10-14T00:00:00.000Z" },
        from: "2026-09-13T00:00:00.000Z", to: "2026-10-14T00:00:00.000Z", bucket: "month", totalUsd: 4.31,
        periods: [
          { start: "2026-10-01T00:00:00.000Z", totalUsd: 1.84, unpriced: ["tool.call js.run calls"] },
          { start: "2026-09-01T00:00:00.000Z", totalUsd: 2.47, unpriced: [] },
        ],
        agents: [
          { agentId: big.id, name: "spend-big", totalUsd: 3 },
          { agentId: null, name: null, totalUsd: 0.75 },
          { agentId: small.id, name: "spend-small", totalUsd: 0.56 },
        ],
      }, "another server's agent is never resolved here; it joins the unknown entry");
      const call = fake.requests.at(-1)!;
      assert.equal(call.method, "GET");
      assert.equal(call.headers.authorization, `Bearer ${PROVIDER_TOKEN}`);
      assert.equal(call.path, `/provision/usage?raftServerId=${a.server.id}&bucket=month`);

      fake.next(() => ({ status: 404, body: { error: { code: "not_found", message: "no tenant" } } }));
      assert.deepEqual(await errorOf(await a.owner.get(spend)), { status: 404, code: "hosted_runtime_spend_not_enabled" });
      fake.next(() => ({ status: 400, body: { error: { code: "invalid", message: "bad window" } } }));
      assert.deepEqual(await errorOf(await a.owner.get(spend)), { status: 400, code: "hosted_runtime_spend_invalid_query" });
      fake.next(() => ({ status: 503, body: { error: { code: "busy", message: "later" } } }));
      assert.deepEqual(await errorOf(await a.owner.get(spend)), { status: 502, code: "hosted_runtime_spend_unavailable" });
      fake.next(() => ({ status: 200, body: { today: "not-an-object" } }));
      assert.deepEqual(await errorOf(await a.owner.get(spend)), { status: 502, code: "hosted_runtime_spend_unavailable" });

      // Rollout rules removed: a server that already has hosted agents keeps its spend card.
      await getDb().delete(featureFlagRules).where(eq(featureFlagRules.flagKey, ANTIPROTON_HOSTED_RUNTIME_FEATURE_FLAG_KEY));
      const beforeRulesOff = fake.requests.length;
      await a.owner.get(spend);
      assert.equal(fake.requests.length, beforeRulesOff + 1, "the provider is still asked");
      // Kill switch: the card is hidden and the provider is not asked.
      await setFeatureFlagKillSwitch(ANTIPROTON_HOSTED_RUNTIME_FEATURE_FLAG_KEY, true);
      const beforeOff = fake.requests.length;
      assert.deepEqual(await errorOf(await a.owner.get(spend)), { status: 404, code: "hosted_runtime_spend_not_enabled" });
      assert.equal(fake.requests.length, beforeOff);
    } finally {
      await setFeatureFlagKillSwitch(ANTIPROTON_HOSTED_RUNTIME_FEATURE_FLAG_KEY, false);
      await fake.close();
    }
  });
});

test("a provision with an import source is created awaiting import, then imported once; import failures stay apart from the POST's", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    const imported: string[] = [];
    const unsubscribe = onProvisionImported((event) => { imported.push(`${event.agentId}:${event.importSource}`); });
    try {
      const owner = await seedUser("import-owner@raft.test", "import-owner");
      const server = await createServer("Provider import", "provider-import", owner.id);
      configureDeployment(fake);
      await enableFlagFor(server.id);
      const createWithImport = (name: string) => createAgentRow(server.id, name, {
        runtime: EXTERNAL_AGENT_RUNTIME_ID,
        model: EXTERNAL_AGENT_RUNTIME_MODEL,
        description: "Onboarding partner",
        creatorType: "user",
        creatorId: owner.id,
        afterInsert: (tx, agent) => recordAgentProvisioning(tx, { agent, provider: "antiproton", createdByUserId: owner.id, importSource: "cindy_seed" }),
      });
      const importPath = (agentId: string) => `/provision/agents/by-raft-agent/${agentId}/import?raftServerId=${server.id}`;
      const posts = () => fake.requests.filter((r) => r.method === "POST" && r.path === "/provision/agents");
      const imports = (agentId: string) => fake.requests.filter((r) => r.method === "POST" && r.path === importPath(agentId));

      // Happy path: POST with awaitImport, then exactly one import of Cindy's seed.
      const cindy = await createWithImport("cindy-hosted");
      await drainAgentRuntimeProvisions();
      assert.equal((JSON.parse(posts().at(-1)!.body) as { awaitImport?: boolean }).awaitImport, true);
      assert.deepEqual((JSON.parse(posts().at(-1)!.body) as { firstTurn?: unknown }).firstTurn, { reasoning: "off" });
      assert.equal((JSON.parse(posts().at(-1)!.body) as { budget?: unknown }).budget, "onboarding");
      assert.equal((JSON.parse(posts().at(-1)!.body) as { plan?: unknown }).plan, "free");
      assert.equal((await getHostedRuntimeSummary(cindy.id))!.import!.state, "pending");
      await drainAgentRuntimeProvisions();
      assert.equal(imports(cindy.id).length, 1);
      const request = imports(cindy.id)[0]!;
      assert.equal(request.headers["idempotency-key"], cindy.id);
      const body = JSON.parse(request.body) as { migrationId: string; files: Array<{ path: string; contentBase64: string; sha256: string }>; totalBytes: number };
      assert.equal(body.migrationId, cindy.id);
      const expected = [
        { path: "MEMORY.md", content: buildCindyMemoryMd("cindy-hosted") },
        ...buildCindySeedFiles({ hosted: true }).map((f) => ({ path: f.relativePath, content: f.content })),
      ];
      assert.deepEqual(body.files.map((f) => f.path), expected.map((f) => f.path));
      for (const [i, file] of body.files.entries()) {
        const bytes = Buffer.from(file.contentBase64, "base64");
        assert.equal(bytes.toString("utf8"), String(expected[i]!.content));
        assert.equal(file.sha256, createHash("sha256").update(bytes).digest("hex"));
      }
      assert.equal(body.totalBytes, expected.reduce((n, f) => n + Buffer.byteLength(String(f.content)), 0));
      // Hosted variant: no `raft reminder` scheduling for her daily recap.
      const objectives = Buffer.from(body.files.find((f) => f.path === "notes/onboarding_objectives.md")!.contentBase64, "base64").toString("utf8");
      assert.match(objectives, /with\s+the Reminder app/);
      assert.doesNotMatch(objectives, /schedule a daily 10:00 reminder in the same anchor/);
      assert.deepEqual(imported, [`${cindy.id}:cindy_seed`]);
      assert.deepEqual((await getHostedRuntimeSummary(cindy.id))!.import, { state: "done", error: null });
      await drainAgentRuntimeProvisions();
      assert.equal(imports(cindy.id).length, 1, "imported exactly once");

      // A 5xx backs off in the import fields; a 4xx stops until a manual retry, which never re-POSTs.
      const second = await createWithImport("cindy-second");
      await drainAgentRuntimeProvisions();
      const postsBefore = posts().length;
      fake.next(() => ({ status: 503, body: { error: { code: "busy", message: "later" } } }));
      await drainAgentRuntimeProvisions();
      let summary = (await getHostedRuntimeSummary(second.id))!;
      assert.equal(summary.state, "active");
      assert.equal(summary.lastError, null, "the POST's error stays clean");
      assert.deepEqual([summary.import!.state, summary.import!.error!.code], ["pending", "busy"]);
      fake.next(() => ({ status: 422, body: { error: { code: "import_too_large", message: "too big" } } }));
      await drainAgentRuntimeProvisions({ now: later(PROVISION_RETRY_BASE_MS * 4) });
      summary = (await getHostedRuntimeSummary(second.id))!;
      assert.deepEqual([summary.import!.state, summary.import!.error!.code], ["failed", "import_too_large"]);
      await drainAgentRuntimeProvisions({ now: later(PROVISION_RETRY_BASE_MS * 64) });
      assert.equal(imports(second.id).length, 2, "a failed import waits for a retry");
      assert.equal(await getDb().transaction((tx) => retryAgentProvisioning(tx, second.id)), "requeued");
      // A different import already sealed is a failure to look at, not a success.
      fake.next(() => ({ status: 409, body: { error: { code: "already_imported", message: "sealed" } } }));
      await drainAgentRuntimeProvisions();
      summary = (await getHostedRuntimeSummary(second.id))!;
      assert.deepEqual([summary.import!.state, summary.import!.error!.code], ["failed", "already_imported"]);
      assert.equal(await getDb().transaction((tx) => retryAgentProvisioning(tx, second.id)), "requeued");
      await drainAgentRuntimeProvisions();
      assert.deepEqual((await getHostedRuntimeSummary(second.id))!.import, { state: "done", error: null });
      assert.equal(posts().length, postsBefore, "no POST after the first one");
      assert.deepEqual(imported, [`${cindy.id}:cindy_seed`, `${second.id}:cindy_seed`]);

      // No import source: no awaitImport, no import, no import summary.
      const plain = await createHosted(api(app.baseUrl, await tokenForHuman(owner.email), server.id), "plain-hosted");
      await drainAgentRuntimeProvisions();
      await drainAgentRuntimeProvisions();
      assert.ok(!("awaitImport" in (JSON.parse(posts().at(-1)!.body) as Record<string, unknown>)));
      assert.ok(!("firstTurn" in (JSON.parse(posts().at(-1)!.body) as Record<string, unknown>)));
      assert.ok(!("budget" in (JSON.parse(posts().at(-1)!.body) as Record<string, unknown>)));
      assert.equal((JSON.parse(posts().at(-1)!.body) as { plan?: unknown }).plan, "free");
      assert.equal(imports(plain.id).length, 0);
      assert.equal((await getHostedRuntimeSummary(plain.id))!.import, null);
    } finally {
      unsubscribe();
      await fake.close();
    }
  });
});

test("hosted Cindy is ready only once active AND imported, whatever antiproton_cindy says; the import hook briefs her", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    const triggered: string[] = [];
    const off = registerHostedCindyTriggers({
      io: {} as never,
      orchestrator: {} as never,
      trigger: async (_io, _orchestrator, serverId, agentId) => { triggered.push(`${serverId}:${agentId}`); },
    });
    try {
      const owner = await seedUser("cindy-ready-owner@raft.test", "cindy-ready-owner");
      const server = await createServer("Hosted Cindy", "hosted-cindy-ready", owner.id);
      configureDeployment(fake);
      await enableFlagFor(server.id);
      const createCindy = (name: string) => createAgentRow(server.id, name, {
        runtime: EXTERNAL_AGENT_RUNTIME_ID,
        model: EXTERNAL_AGENT_RUNTIME_MODEL,
        creatorType: "user",
        creatorId: owner.id,
        afterInsert: (tx, agent) => recordAgentProvisioning(tx, { agent, provider: "antiproton", createdByUserId: owner.id, importSource: "cindy_seed" }),
      });
      const cindy = await createCindy("cindy");

      // antiproton_cindy is off (never created): it only gates creating one, so the
      // provision alone makes her a hosted Cindy for onboarding.
      assert.equal(await getHostedOnboardingAgentState(server.id, cindy.id), "pending");

      await drainAgentRuntimeProvisions(); // POST → active, import still pending
      assert.equal(await getHostedOnboardingAgentState(server.id, cindy.id), "pending");
      assert.deepEqual(triggered, []);
      await drainAgentRuntimeProvisions(); // import lands → hook briefs her
      assert.equal(await getHostedOnboardingAgentState(server.id, cindy.id), "ready");
      assert.deepEqual(triggered, [`${server.id}:${cindy.id}`]);

      // A refused import: failed, and no briefing.
      const second = await createCindy("cindy-two");
      await drainAgentRuntimeProvisions();
      fake.next(() => ({ status: 422, body: { error: { code: "import_too_large", message: "too big" } } }));
      await drainAgentRuntimeProvisions();
      assert.equal(await getHostedOnboardingAgentState(server.id, second.id), "failed");
      assert.deepEqual(triggered, [`${server.id}:${cindy.id}`]);

      // Not a Cindy import source: not a hosted Cindy.
      const plain = await createHosted(api(app.baseUrl, await tokenForHuman(owner.email), server.id), "plain-agent");
      assert.equal(await getHostedOnboardingAgentState(server.id, plain.id), null);
    } finally {
      off();
      await fake.close();
    }
  });
});

test("the server fires a ready hosted Cindy's Day-2 recap once and posts her wake into the anchor thread; nothing else fires", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      const owner = await seedUser("cindy-d2-owner@raft.test", "cindy-d2-owner");
      const server = await createServer("Hosted Cindy D2", "hosted-cindy-d2", owner.id);
      configureDeployment(fake);
      await enableFlagFor(server.id);
      const cindy = await createAgentRow(server.id, "cindy", {
        runtime: EXTERNAL_AGENT_RUNTIME_ID,
        model: EXTERNAL_AGENT_RUNTIME_MODEL,
        creatorType: "user",
        creatorId: owner.id,
        afterInsert: (tx, agent) => recordAgentProvisioning(tx, { agent, provider: "antiproton", createdByUserId: owner.id, importSource: "cindy_seed" }),
      });
      const [channel] = await listChannels(server.id);
      // Her opener channel always has her as a member (sendOwnerOpenerV2 adds her).
      await addAgentToChannel(channel!.id, cindy.id);
      // The D2 anchor is her own opener message (ensureOnboardingDay2Reminder).
      const anchor = await createMessage(channel!.id, "agent", cindy.id, "welcome");
      const scheduleRecap = (fireAt: Date) => createAppReminder({
        serverId: server.id,
        ownerAgentId: cindy.id,
        targetChannelId: channel!.id,
        msgId: anchor.id,
        title: "D2 recap: explain wake; recap yesterday; next step; ask about daily recap.",
        fireAt,
        payload: { kind: "onboarding_d2_recap" },
        recurrence: null,
        createdBy: { type: "agent", id: cindy.id },
      });
      const recap = await scheduleRecap(new Date(Date.now() - 1_000));
      const io = app.app.get("io") as never;
      // The push fails: the wake must still be unread in her inbox.
      const realOrchestrator = app.app.get("agentOrchestrator") as Record<string, unknown>;
      const orchestrator = Object.assign(Object.create(realOrchestrator), {
        deliverMessage: async () => ({ status: "dropped", reason: "agent_unavailable" }),
      }) as never;
      const sweep = () => fireDueHostedCindyRecaps({ io, orchestrator });
      const wakes = async () => {
        const thread = await getOrCreateThread(anchor.id, cindy.id, "agent");
        return (await getDb().select().from(messages).where(eq(messages.channelId, thread.id)))
          .filter((m) => m.content.startsWith("Reminder fired: D2 recap:"));
      };

      // Not ready (not imported yet): nothing fires.
      assert.deepEqual(await sweep(), { due: 0, fired: 0, delivered: 0 });
      await drainAgentRuntimeProvisions();
      await drainAgentRuntimeProvisions();

      // Ready, with antiproton_cindy off (it only gates creating one): concurrent sweeps fire it once; the wake is a persisted system message in the anchor thread.
      const [a, b] = await Promise.all([sweep(), sweep()]);
      assert.equal(a.fired + b.fired, 1);
      assert.equal(a.delivered + b.delivered, 1);
      const posted = await wakes();
      assert.equal(posted.length, 1);
      assert.equal(posted[0]!.messageType, "system");
      const facts = await getDb().select().from(inboxNotificationFacts).where(eq(inboxNotificationFacts.messageId, posted[0]!.id));
      const cindyFact = facts.find((f) => f.receiverType === "agent" && f.receiverId === cindy.id);
      assert.equal(cindyFact?.unreadEligible, true, "unread in Cindy's inbox even though the push was dropped");
      const ownerFact = facts.find((f) => f.receiverType === "user" && f.receiverId === owner.id);
      assert.ok(!ownerFact || ownerFact.unreadEligible === false, "born-read for the owner");
      const [row] = await getDb().select().from(reminders).where(eq(reminders.id, recap.id));
      assert.equal(row!.status, "fired");
      assert.equal((await sweep()).fired, 0, "fired once");

      // Not yet due: nothing.
      await scheduleRecap(new Date(Date.now() + 60 * 60_000));
      assert.equal((await sweep()).fired, 0);
      assert.equal((await wakes()).length, 1);

      // An anchor written by the owner: she still gets the wake unread (the sweep follows the thread for her).
      const ownerAnchor = await createMessage(channel!.id, "user", owner.id, "owner's note");
      await createAppReminder({
        serverId: server.id,
        ownerAgentId: cindy.id,
        targetChannelId: channel!.id,
        msgId: ownerAnchor.id,
        title: "D2 recap: anchored on the owner's message.",
        fireAt: new Date(Date.now() - 1_000),
        payload: { kind: "onboarding_d2_recap" },
        recurrence: null,
        createdBy: { type: "agent", id: cindy.id },
      });
      assert.deepEqual(await sweep(), { due: 1, fired: 1, delivered: 1 });
      const ownerThread = await getOrCreateThread(ownerAnchor.id, cindy.id, "agent");
      const [ownerAnchored] = (await getDb().select().from(messages).where(eq(messages.channelId, ownerThread.id)))
        .filter((m) => m.content.startsWith("Reminder fired: D2 recap: anchored"));
      const [herFact] = await getDb().select().from(inboxNotificationFacts).where(and(
        eq(inboxNotificationFacts.messageId, ownerAnchored!.id),
        eq(inboxNotificationFacts.receiverType, "agent"),
        eq(inboxNotificationFacts.receiverId, cindy.id),
      ));
      assert.equal(herFact?.unreadEligible, true);
    } finally {
      await fake.close();
    }
  });
});

test("a hosted Cindy is created once per server under antiproton_cindy; the setup projection backstops a missing one; the daily cap falls back", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    const savedCap = process.env.HOSTED_CINDY_DAILY_CAP;
    try {
      const owner = await seedUser("cindy-create-owner@raft.test", "cindy-create-owner");
      const server = await createServer("Hosted Cindy create", "hosted-cindy-create", owner.id);
      configureDeployment(fake);
      await enableFlagFor(server.id);

      // Flag off: nothing.
      assert.deepEqual(await provisionHostedCindy({ serverId: server.id, ownerUserId: owner.id }), { outcome: "disabled" });
      await createFeatureFlag({ key: ANTIPROTON_CINDY_FEATURE_FLAG_KEY, randomizationUnit: "server", defaultEnabled: false });
      await createFeatureFlagRule({ flagKey: ANTIPROTON_CINDY_FEATURE_FLAG_KEY, stage: "server", decision: "allow", values: [server.id] });

      // Concurrent callers (server create + backstop): exactly one Cindy.
      const results = await Promise.all([1, 2, 3].map(() => provisionHostedCindy({ serverId: server.id, ownerUserId: owner.id })));
      const created = results.filter((r) => r.outcome === "created");
      assert.equal(created.length, 1, JSON.stringify(results));
      assert.ok(results.every((r) => r.outcome === "created" || r.outcome === "exists"));
      const cindyId = (created[0] as { agentId: string }).agentId;
      const [cindy] = await getDb().select().from(agents).where(eq(agents.id, cindyId));
      assert.deepEqual([cindy!.name, cindy!.displayName, cindy!.runtime, cindy!.avatarUrl], ["Cindy", "Cindy", "external", "pixel:mug"]);
      const [linked] = await getDb().select({ onboardingAgentId: servers.onboardingAgentId }).from(servers).where(eq(servers.id, server.id));
      assert.equal(linked!.onboardingAgentId, cindyId);
      const [membership] = await getDb().select({ role: serverAgentMembers.role }).from(serverAgentMembers).where(and(eq(serverAgentMembers.serverId, server.id), eq(serverAgentMembers.agentId, cindyId)));
      assert.equal(membership?.role, "admin");
      const row = await provisionRow(cindyId);
      assert.deepEqual([row!.importSource, row!.state, row!.provisionedModel], ["cindy_seed", "provisioning", null]);

      // The owner goes through the real flow: stamped `normal` (not `grandfathered` by the
      // checkpoint her link crosses), so the survey and the handoff are still owed.
      const [ownerSetup] = await getDb().select({ status: serverMembers.setupStatus, reason: serverMembers.setupCompletionReason })
        .from(serverMembers).where(and(eq(serverMembers.serverId, server.id), eq(serverMembers.userId, owner.id)));
      assert.deepEqual(ownerSetup, { status: "complete", reason: "normal" });
      const ownerProjection = await api(app.baseUrl, await tokenForHuman(owner.email), server.id).get(`/servers/${server.id}/setup-projection`);
      const projected = await ownerProjection.json() as { postSetup?: { surveyPending: boolean; handoffPending: boolean } };
      assert.deepEqual(projected.postSetup, { surveyPending: true, handoffPending: true });
      assert.deepEqual(await provisionHostedCindy({ serverId: server.id, ownerUserId: owner.id }), { outcome: "exists" });

      // A Cindy whose server link was lost (a crash before links committed together): the backstop relinks her.
      await getDb().update(servers).set({ onboardingAgentId: null }).where(eq(servers.id, server.id));
      await getDb().update(serverAgentMembers).set({ role: "member" }).where(and(eq(serverAgentMembers.serverId, server.id), eq(serverAgentMembers.agentId, cindyId)));
      assert.deepEqual(await provisionHostedCindy({ serverId: server.id, ownerUserId: owner.id }), { outcome: "exists" });
      const [relinked] = await getDb().select({ onboardingAgentId: servers.onboardingAgentId }).from(servers).where(eq(servers.id, server.id));
      assert.equal(relinked!.onboardingAgentId, cindyId, "relinked to the same Cindy, no second one");
      const [relinkedRole] = await getDb().select({ role: serverAgentMembers.role }).from(serverAgentMembers).where(and(eq(serverAgentMembers.serverId, server.id), eq(serverAgentMembers.agentId, cindyId)));
      assert.equal(relinkedRole?.role, "admin");
      assert.equal((await getDb().select().from(agents).where(and(eq(agents.serverId, server.id), eq(agents.name, "Cindy")))).length, 1);

      // Backstop: a second server that committed without its Cindy gets one when its owner loads setup.
      // `user` rules on its owner (no server rules) are enough: both flags evaluate for the server's owner.
      const second = await createServer("Hosted Cindy backstop", "hosted-cindy-backstop", owner.id);
      await createFeatureFlagRule({ flagKey: ANTIPROTON_HOSTED_RUNTIME_FEATURE_FLAG_KEY, stage: "user", decision: "allow", values: [owner.id] });
      await createFeatureFlagRule({ flagKey: ANTIPROTON_CINDY_FEATURE_FLAG_KEY, stage: "user", decision: "allow", values: [owner.id] });
      const projection = await api(app.baseUrl, await tokenForHuman(owner.email), second.id).get(`/servers/${second.id}/setup-projection`);
      assert.equal(projection.status, 200);
      const [backstopped] = await getDb().select({ onboardingAgentId: servers.onboardingAgentId }).from(servers).where(eq(servers.id, second.id));
      assert.ok(backstopped!.onboardingAgentId, "the backstop created her");

      // Daily cap reached: falls back to the computer flow.
      process.env.HOSTED_CINDY_DAILY_CAP = "2";
      const third = await createServer("Hosted Cindy capped", "hosted-cindy-capped", owner.id);
      await enableFlagFor(third.id);
      await createFeatureFlagRule({ flagKey: ANTIPROTON_CINDY_FEATURE_FLAG_KEY, stage: "server", decision: "allow", values: [third.id] });
      assert.deepEqual(await provisionHostedCindy({ serverId: third.id, ownerUserId: owner.id }), { outcome: "cap_reached" });
    } finally {
      if (savedCap === undefined) delete process.env.HOSTED_CINDY_DAILY_CAP; else process.env.HOSTED_CINDY_DAILY_CAP = savedCap;
      await fake.close();
    }
  });
});

test("hosted Cindy setup (flag rolled back after she was created): usable while on her way, one automatic retry after a timeout, then failed; the owner's Create Cindy converts her in place", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      const owner = await seedUser("cindy-fallback-owner@raft.test", "cindy-fallback-owner");
      const server = await createServer("Hosted Cindy fallback", "hosted-cindy-fallback", owner.id);
      configureDeployment(fake);
      await enableFlagFor(server.id);
      await createFeatureFlag({ key: ANTIPROTON_CINDY_FEATURE_FLAG_KEY, randomizationUnit: "server", defaultEnabled: false });
      await createFeatureFlagRule({ flagKey: ANTIPROTON_CINDY_FEATURE_FLAG_KEY, stage: "server", decision: "allow", values: [server.id] });
      const created = await provisionHostedCindy({ serverId: server.id, ownerUserId: owner.id });
      assert.equal(created.outcome, "created");
      const cindyId = (created as { agentId: string }).agentId;
      // Rolled back: the flag only stops new hosted Cindys; this one keeps her state and fallback.
      await getDb().delete(featureFlagRules).where(eq(featureFlagRules.flagKey, ANTIPROTON_CINDY_FEATURE_FLAG_KEY));
      const client = api(app.baseUrl, await tokenForHuman(owner.email), server.id);
      const setupState = async () => (await (await client.get(`/agents/${cindyId}/hosted-runtime`)).json() as { onboardingSetup: string | null }).onboardingSetup;
      const backdate = (field: "createdAt" | "setupRetryAt") => getDb().update(agentRuntimeProvisions)
        .set({ [field]: new Date(Date.now() - HOSTED_CINDY_READY_TIMEOUT_MS - 1_000) })
        .where(eq(agentRuntimeProvisions.agentId, cindyId));
      // The provider is down from here on: she never becomes ready.
      fake.setFallback(() => ({ status: 503, body: { error: { code: "busy", message: "down" } } }));

      // On her way: usable, no banner.
      assert.equal(await setupState(), "usable");
      // Past 3 minutes: one automatic retry, still usable.
      await backdate("createdAt");
      assert.equal(await resolveHostedCindySetupState({ serverId: server.id, agentId: cindyId }), "usable");
      const afterRetry = await provisionRow(cindyId);
      assert.ok(afterRetry!.setupRetryAt, "the retry is recorded");
      // Not ready 3 minutes after the retry either: failed, and the retry is not repeated.
      await backdate("setupRetryAt");
      assert.equal(await setupState(), "failed");
      const failedRow = await provisionRow(cindyId);
      assert.equal(failedRow!.setupRetryOutcome, "failed");

      const computerCindy = { name: "Cindy", description: "Onboarding Assistant", avatarUrl: "pixel:mug", runtime: "codex", onboarding: true };
      // The provider does not confirm the delete: nothing changes, she stays a failed hosted Cindy.
      const unconfirmed = await client.send("POST", "/agents", computerCindy);
      assert.equal(unconfirmed.status, 503, await unconfirmed.clone().text());
      assert.equal((await unconfirmed.json() as { code: string }).code, "hosted_cindy_delete_unconfirmed");
      const [stillHosted] = await getDb().select().from(agents).where(eq(agents.id, cindyId));
      assert.equal(stillHosted!.runtime, "external");
      assert.notEqual((await provisionRow(cindyId))!.state, "deleted");

      // Confirmed: the same agent becomes the computer Cindy; the hosted side is gone.
      fake.setFallback(() => ({ status: 200, body: { status: "deleted" } }));
      const converted = await client.send("POST", "/agents", computerCindy);
      assert.equal(converted.status, 200, await converted.clone().text());
      assert.equal((await converted.json() as { id: string }).id, cindyId, "converted in place, same id");
      const [now] = await getDb().select().from(agents).where(eq(agents.id, cindyId));
      assert.equal(now!.runtime, "codex");
      assert.equal((now!.envVars as Record<string, string> | null)?.SLOCK_ONBOARDING_MEMORY_SEED ?? (now!.runtimeConfig as { envVars?: Record<string, string> } | null)?.envVars?.SLOCK_ONBOARDING_MEMORY_SEED, "first-cindy");
      assert.equal((await provisionRow(cindyId))!.state, "deleted");
      assert.ok(fake.requests.some((r) => r.method === "DELETE" && r.path.startsWith(`/provision/agents/by-raft-agent/${cindyId}`)));
      const liveCredentials = await getDb().select().from(agentCredentials).where(and(eq(agentCredentials.agentId, cindyId), isNull(agentCredentials.revokedAt)));
      assert.equal(liveCredentials.length, 0, "her hosted credential is revoked");
      assert.equal((await getDb().select().from(agents).where(and(eq(agents.serverId, server.id), eq(agents.name, "Cindy")))).length, 1);
      const [linked] = await getDb().select({ onboardingAgentId: servers.onboardingAgentId }).from(servers).where(eq(servers.id, server.id));
      assert.equal(linked!.onboardingAgentId, cindyId);

      // Only a failed hosted Cindy converts: a computer (or active) Cindy is still a 409.
      assert.equal((await client.send("POST", "/agents", computerCindy)).status, 409);

      // An opener already sent while she was hosted is not sent again after the conversion.
      await getDb().update(serverMembers).set({ onboardingOwnerOpenerV2SentAt: new Date() })
        .where(and(eq(serverMembers.serverId, server.id), eq(serverMembers.userId, owner.id)));
      assert.equal(await triggerOwnerOnboardingOnAgentActivation(app.app.get("io") as never, app.app.get("agentOrchestrator") as never, server.id, cindyId), false);
    } finally {
      await fake.close();
    }
  });
});

test("the sweep settles an overdue hosted Cindy nobody looks at: one retry, then failed, then left alone", async ({ app: _app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      const owner = await seedUser("cindy-overdue-owner@raft.test", "cindy-overdue-owner");
      const server = await createServer("Hosted Cindy overdue", "hosted-cindy-overdue", owner.id);
      configureDeployment(fake);
      await enableFlagFor(server.id);
      await createFeatureFlag({ key: ANTIPROTON_CINDY_FEATURE_FLAG_KEY, randomizationUnit: "server", defaultEnabled: false });
      await createFeatureFlagRule({ flagKey: ANTIPROTON_CINDY_FEATURE_FLAG_KEY, stage: "server", decision: "allow", values: [server.id] });
      const created = await provisionHostedCindy({ serverId: server.id, ownerUserId: owner.id });
      const cindyId = (created as { agentId: string }).agentId;
      fake.setFallback(() => ({ status: 503, body: { error: { code: "busy", message: "down" } } }));
      const backdate = (field: "createdAt" | "setupRetryAt") => getDb().update(agentRuntimeProvisions)
        .set({ [field]: new Date(Date.now() - HOSTED_CINDY_READY_TIMEOUT_MS - 1_000) })
        .where(eq(agentRuntimeProvisions.agentId, cindyId));

      assert.equal(await settleOverdueHostedCindys(), 0, "not overdue yet");
      await backdate("createdAt");
      assert.equal(await settleOverdueHostedCindys(), 1);
      assert.ok((await provisionRow(cindyId))!.setupRetryAt, "retried without anyone loading her");
      await backdate("setupRetryAt");
      assert.equal(await settleOverdueHostedCindys(), 1);
      assert.equal((await provisionRow(cindyId))!.setupRetryOutcome, "failed");
      assert.equal(await settleOverdueHostedCindys(), 0, "settled: not checked again");

      // A retry that worked: nobody looks, the sweep still records `ok`.
      const second = await createServer("Hosted Cindy rescued", "hosted-cindy-rescued", owner.id);
      await enableFlagFor(second.id);
      await createFeatureFlagRule({ flagKey: ANTIPROTON_CINDY_FEATURE_FLAG_KEY, stage: "server", decision: "allow", values: [second.id] });
      const rescued = (await provisionHostedCindy({ serverId: second.id, ownerUserId: owner.id }) as { agentId: string }).agentId;
      await getDb().update(agentRuntimeProvisions)
        .set({ createdAt: new Date(Date.now() - HOSTED_CINDY_READY_TIMEOUT_MS - 1_000) })
        .where(eq(agentRuntimeProvisions.agentId, rescued));
      await settleOverdueHostedCindys();
      assert.ok((await provisionRow(rescued))!.setupRetryAt);
      fake.setFallback((request) => request.method === "POST" && request.path === "/provision/agents"
        ? { status: 201, body: { providerAgentId: `raft_${rescued}`, status: "active", push: { registered: true } } }
        : { status: 200, body: {} });
      await drainAgentRuntimeProvisions();
      await drainAgentRuntimeProvisions();
      assert.ok((await provisionRow(rescued))!.importedAt, "the retry worked");
      await settleOverdueHostedCindys();
      assert.equal((await provisionRow(rescued))!.setupRetryOutcome, "ok");
    } finally {
      await fake.close();
    }
  });
});

test("the provider learns each hosted server's plan once, again when it changes, and retries with backoff after a failure", async ({ app }) => {
  assert.deepEqual(["free", "pro", "founder", "partner", null].map(hostedRuntimePlanFor), ["free", "pro", "pro", "pro", "free"]);
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      const hosted = await setupServer(app.baseUrl, "plan-sync-hosted");
      const plain = await setupServer(app.baseUrl, "plan-sync-plain");
      await configure(fake, hosted);
      await getDb().update(servers).set({ plan: "founder" }).where(eq(servers.id, hosted.server.id));
      const agent = await createHosted(hosted.owner, "planned");
      await drainAgentRuntimeProvisions();
      const post = fake.requests.find((r) => r.method === "POST" && r.path === "/provision/agents");
      assert.equal((JSON.parse(post!.body) as { plan?: unknown }).plan, "pro", "the POST carries the server's plan");
      const puts = () => fake.requests.filter((r) => r.method === "PUT" && r.path.startsWith("/provision/servers/"));

      // First pass: only the server with a hosted agent, once.
      assert.deepEqual(await syncHostedRuntimeServerPlans(), { checked: 1, synced: 1, failed: 0 });
      assert.equal(puts().length, 1);
      assert.equal(puts()[0]!.path, `/provision/servers/${hosted.server.id}/plan`);
      assert.deepEqual(JSON.parse(puts()[0]!.body), { plan: "pro" });
      assert.deepEqual(await syncHostedRuntimeServerPlans(), { checked: 0, synced: 0, failed: 0 }, "confirmed: nothing to send");
      assert.ok(!puts().some((r) => r.path.includes(plain.server.id)), "a server without hosted agents is left alone");

      // A downgrade that fails at the provider: recorded, backed off, then sent.
      await getDb().update(servers).set({ plan: "free" }).where(eq(servers.id, hosted.server.id));
      fake.next(() => ({ status: 503, body: { error: { code: "busy", message: "down" } } }));
      assert.deepEqual(await syncHostedRuntimeServerPlans(), { checked: 1, synced: 0, failed: 1 });
      const [failed] = await getDb().select().from(hostedRuntimeServerPlans).where(eq(hostedRuntimeServerPlans.serverId, hosted.server.id));
      assert.deepEqual([failed!.syncedPlan, failed!.failedAttempts, failed!.lastErrorCode], ["pro", 1, "http_503"]);
      assert.deepEqual(await syncHostedRuntimeServerPlans(), { checked: 0, synced: 0, failed: 0 }, "backing off");
      assert.deepEqual(await syncHostedRuntimeServerPlans({ now: new Date(Date.now() + 60_000) }), { checked: 1, synced: 1, failed: 0 });
      assert.deepEqual(JSON.parse(puts().at(-1)!.body), { plan: "free" });
      const [synced] = await getDb().select().from(hostedRuntimeServerPlans).where(eq(hostedRuntimeServerPlans.serverId, hosted.server.id));
      assert.deepEqual([synced!.syncedPlan, synced!.failedAttempts, synced!.nextAttemptAt], ["free", 0, null]);

      // Its only hosted agent deleted: no more syncing for that server.
      await getDb().update(agentRuntimeProvisions).set({ state: "deleted" }).where(eq(agentRuntimeProvisions.agentId, agent.id));
      await getDb().update(servers).set({ plan: "partner" }).where(eq(servers.id, hosted.server.id));
      assert.deepEqual(await syncHostedRuntimeServerPlans(), { checked: 0, synced: 0, failed: 0 });
    } finally {
      await fake.close();
    }
  });
});

test("the worker's plan sync runs in its own trace, so the per-server events are recorded", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    const sink = new MemoryTraceSink();
    const worker = { stop: async () => {} };
    try {
      const hosted = await setupServer(app.baseUrl, "plan-sync-trace");
      await configure(fake, hosted);
      await createHosted(hosted.owner, "traced");
      Object.assign(worker, startAgentRuntimeProvisionWorker({ tracer: new BasicTracer({ sink }), intervalMs: 60_000 }));
      const span = async () => sink.getAllSpans().find((candidate) => candidate.name === "server.hosted_runtime.plan_sync");
      for (let i = 0; i < 100 && !(await span()); i += 1) await new Promise((resolve) => setTimeout(resolve, 100));
      const recorded = await span();
      assert.ok(recorded, "the plan sync opened its root span");
      const synced = recorded.events.find((event) => event.name === "server.hosted_runtime.plan_synced");
      assert.deepEqual(synced?.attrs, { server_id: hosted.server.id, plan: "free" });
      const result = recorded.events.find((event) => event.name === "server.hosted_runtime.plan_sync.result");
      assert.deepEqual(result?.attrs, { checked: 1, synced: 1, failed: 0, model_picker_checked: 1, model_picker_synced: 1, model_picker_failed: 0 });
      assert.ok(recorded.events.some((event) => event.name === "server.hosted_runtime.model_picker_synced" && event.attrs?.enabled === false));

      // A pass with nothing to sync opens no span (the hourly heartbeat already went out with the first).
      const putsBefore = fake.requests.filter((r) => r.method === "PUT").length;
      kickHostedRuntimePlanSync();
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      assert.equal(sink.getAllSpans().filter((candidate) => candidate.name === "server.hosted_runtime.plan_sync").length, 1);
      assert.equal(fake.requests.filter((r) => r.method === "PUT").length, putsBefore);
    } finally {
      await worker.stop();
      await fake.close();
    }
  });
});

test("yesterday's hosted spend is pulled once per server and for the onboarding budget, as trace events; failures retry", async ({ app }) => {
  assert.deepEqual(spendDaysToPull(new Date("2026-10-14T00:20:00Z")), ["2026-10-12", "2026-10-11", "2026-10-10"], "not before 00:30");
  assert.deepEqual(spendDaysToPull(new Date("2026-10-14T00:40:00Z")), ["2026-10-13", "2026-10-12", "2026-10-11"]);
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      const hosted = await setupServer(app.baseUrl, "spend-daily");
      await configure(fake, hosted);
      const agent = await createHosted(hosted.owner, "spender");
      const now = new Date();
      const [day] = spendDaysToPull(now);
      const dayMs = Date.parse(`${day}T00:00:00Z`);
      // Hosted for ten days before that day.
      await getDb().update(agentRuntimeProvisions).set({ createdAt: new Date(dayMs - 10 * 24 * 60 * 60_000) }).where(eq(agentRuntimeProvisions.agentId, agent.id));
      let onboardingDown = true;
      let routeMissingFor: string | null = null;
      fake.setFallback((request) => {
        if (routeMissingFor && request.path.startsWith(`/provision/usage?raftServerId=${routeMissingFor}`)) {
          return { status: 404, body: { error: { code: "route_not_found", message: "no such route" } } };
        }
        if (request.path.startsWith(`/provision/usage?raftServerId=${hosted.server.id}`)) {
          return { status: 200, body: { agents: [], today: { onboardingLimitUsd: 1, onboardingUsd: 0, plan: "free" }, agentDays: [
            { raftAgentId: agent.id, budget: null, days: [{ day, usd: 0.42 }] },
            { raftAgentId: "cindy-agent", budget: "onboarding", days: [{ day, usd: 1.01 }] },
          ] } };
        }
        // No spend anywhere else: a 200 with nothing in it.
        if (request.path.startsWith("/provision/usage?")) return { status: 200, body: { agents: [], agentDays: [] } };
        if (request.path.startsWith("/provision/budgets/onboarding")) {
          if (onboardingDown) return { status: 503, body: { error: { code: "busy", message: "down" } } };
          const date = new URL(request.path, "http://x").searchParams.get("date");
          return { status: 200, body: { date, limitUsd: 30, spentUsd: date === day ? 31 : 0, capped: date === day } };
        }
        return { status: 200, body: {} };
      });
      const sink = new MemoryTraceSink();
      const tracer = new BasicTracer({ sink });
      const pass = (at: Date) => withTraceRoot(tracer, "test.spend_pull", { surface: "server", kind: "internal" }, () => pullHostedRuntimeDailySpend({ now: at }));
      const events = (name: string) => sink.getAllSpans().flatMap((span) => span.events).filter((event) => event.name === name);

      const first = await pass(now);
      assert.equal(first.failed, 3, "three onboarding days down");
      const all = events("server.hosted_runtime.agent_daily_spend").filter((event) => event.attrs?.server_id === hosted.server.id);
      const cindyDay = all.find((event) => event.attrs?.budget === "onboarding");
      assert.deepEqual([cindyDay?.attrs?.usd, cindyDay?.attrs?.onboarding_limit_usd, cindyDay?.attrs?.agent_age_days], [1.01, 1, null]);
      const spend = all.filter((event) => event.attrs?.budget === null);
      assert.equal(spend.length, 1, "one agent-day, for that day only");
      assert.equal(spend[0]!.attrs?.agent_id, agent.id);
      assert.equal(spend[0]!.attrs?.usd, 0.42);
      assert.equal(spend[0]!.attrs?.budget, null);
      assert.equal(spend[0]!.attrs?.agent_age_days, 10);
      assert.equal(typeof spend[0]!.attrs?.pull_id, "string");
      assert.equal(spend[0]!.attrs?.onboarding_limit_usd, null);
      const failed = events("server.hosted_runtime.spend_pull.result").filter((event) => event.attrs?.outcome === "failed");
      assert.ok(failed.every((event) => event.attrs?.scope === "onboarding" && event.attrs?.error_code === "busy"));

      // Done scopes are not pulled again; the failed ones wait out their backoff.
      const putsBefore = fake.requests.length;
      assert.deepEqual(await pass(now), { pulled: 0, failed: 0 });
      assert.equal(fake.requests.length, putsBefore);

      // A 404 (a missing route) is a failure, never a zero-spend day.
      const other = await setupServer(app.baseUrl, "spend-daily-route");
      await configure(fake, other);
      const otherAgent = await createHosted(other.owner, "spender-two");
      await getDb().update(agentRuntimeProvisions).set({ createdAt: new Date(dayMs - 24 * 60 * 60_000) }).where(eq(agentRuntimeProvisions.agentId, otherAgent.id));
      routeMissingFor = other.server.id;
      const routeMissing = await pass(now);
      assert.ok(routeMissing.failed >= 1);
      const [otherRow] = await getDb().select().from(hostedRuntimeSpendPulls)
        .where(and(eq(hostedRuntimeSpendPulls.day, day!), eq(hostedRuntimeSpendPulls.scope, `server:${other.server.id}`)));
      assert.deepEqual([otherRow!.completedAt, otherRow!.lastErrorCode], [null, "route_not_found"]);

      onboardingDown = false;
      routeMissingFor = null;
      const later = await pass(new Date(now.getTime() + 4 * 60 * 60_000));
      assert.equal(later.failed, 0);
      const budgets = events("server.hosted_runtime.onboarding_budget_daily");
      const capped = budgets.find((event) => event.attrs?.day === day);
      assert.deepEqual([capped?.attrs?.limit_usd, capped?.attrs?.spent_usd, capped?.attrs?.capped], [30, 31, true]);
      assert.equal(new Set(budgets.map((event) => event.attrs?.day)).size, budgets.length, "each day written once");
      assert.equal(events("server.hosted_runtime.agent_daily_spend").filter((event) => event.attrs?.server_id === hosted.server.id).length, 2, "the server day is not written twice");
    } finally {
      await fake.close();
    }
  });
});

test("with antiproton_cindy off, a new owner's new server keeps the original onboarding: no hosted Cindy, setup not started", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      configureDeployment(fake);
      // Hosted agents on for every server, from before the server exists; only antiproton_cindy is off.
      await getDb().insert(featureFlagRules).values({
        id: randomUUID(), flagKey: ANTIPROTON_HOSTED_RUNTIME_FEATURE_FLAG_KEY, stage: "percentage", priority: -100, decision: "allow", values: [], percentageBasisPoints: 10_000,
      });
      const owner = await seedUser("cindy-off-owner@raft.test", "cindy-off-owner");
      const token = await tokenForHuman(owner.email);
      const res = await fetch(`${app.baseUrl}/api/servers`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Cindy off", slug: "cindy-off-server" }),
      });
      const text = await res.text();
      assert.ok(res.status === 200 || res.status === 201, text);
      const serverId = (JSON.parse(text) as { id: string }).id;
      assert.equal(await isAgentRuntimeProviderEnabledForServer(serverId, "antiproton"), true, "hosted agents are on here");

      const [server] = await getDb().select({ onboardingAgentId: servers.onboardingAgentId }).from(servers).where(eq(servers.id, serverId));
      assert.equal(server!.onboardingAgentId, null, "no Cindy yet");
      assert.equal((await getDb().select().from(agentRuntimeProvisions).where(eq(agentRuntimeProvisions.serverId, serverId))).length, 0, "no hosted Cindy");
      const [ownerSetup] = await getDb().select({ status: serverMembers.setupStatus, reason: serverMembers.setupCompletionReason })
        .from(serverMembers).where(and(eq(serverMembers.serverId, serverId), eq(serverMembers.userId, owner.id)));
      assert.deepEqual(ownerSetup, { status: "not_started", reason: null });

      // Loading setup (the backstop path) does not create one either, and setup is still owed.
      const projection = await api(app.baseUrl, token, serverId).get(`/servers/${serverId}/setup-projection`);
      const body = await projection.json() as { phase: string | null; surface: string };
      assert.notEqual(body.phase, "complete");
      assert.notEqual(body.surface, "complete");
      assert.equal((await getDb().select().from(agentRuntimeProvisions).where(eq(agentRuntimeProvisions.serverId, serverId))).length, 0);
      assert.ok(!fake.requests.some((r) => r.path.startsWith("/provision/agents")), "nothing reached the provider");
    } finally {
      await fake.close();
    }
  });
});

test("with antiproton_model_picker off, the provider decides the hosted model: none sent, no picker, other picks refused", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      const a = await setupServer(app.baseUrl, "provider-no-picker");
      await configure(fake, a);
      const MODELS = {
        models: [{ id: "deepseek-flash", label: "DeepSeek Flash", provider: "deepseek" }, { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", provider: "cloudflare" }],
        default: "deepseek-flash", defaultLabel: "DeepSeek Flash", locked: false,
      };
      const errorOf = async (res: Response) => ({ status: res.status, code: (await res.json() as { code?: string }).code });
      const postBody = () => JSON.parse(fake.requests.filter((r) => r.method === "POST" && r.path === "/provision/agents").at(-1)!.body) as Record<string, unknown>;

      // The list says the server does not pick.
      fake.next(() => ({ status: 200, body: MODELS }));
      const list = await a.owner.get("/agent-runtime-providers/antiproton/models");
      assert.deepEqual(await list.json(), { ...MODELS, picker: false });

      // No pick: no model sent, so the provider's admin settings and default (DeepSeek Flash) decide.
      const plain = await createHosted(a.owner, "raft-decides");
      await drainAgentRuntimeProvisions();
      assert.ok(!("model" in postBody()), "the provider decides");
      assert.equal((await provisionRow(plain.id))!.provisionedModel, null);

      // Another model is refused before anything is written; DeepSeek Flash itself is fine.
      const before = (await getDb().select().from(agents).where(eq(agents.serverId, a.server.id))).length;
      assert.deepEqual(
        await errorOf(await a.owner.send("POST", "/agents", { name: "wants-luna", external: true, provider: "antiproton", hostedModel: "gpt-5.6-luna" })),
        { status: 403, code: "model_picker_disabled" },
      );
      assert.equal((await getDb().select().from(agents).where(eq(agents.serverId, a.server.id))).length, before);
      const named = await a.owner.send("POST", "/agents", { name: "names-deepseek", external: true, provider: "antiproton", hostedModel: "deepseek-flash" });
      assert.equal(named.status, 200, await named.clone().text());
      // Naming DeepSeek Flash is accepted but not recorded as a choice that would override the provider's admin.
      assert.equal((await provisionRow((await named.json() as { id: string }).id))!.provisionedModel, null);

      // Changing a hosted agent's model: refused, except back to Raft's model or the default.
      const route = `/agents/${plain.id}/hosted-runtime/model`;
      const puts = () => fake.requests.filter((r) => r.method === "PUT" && r.path.includes("/model")).length;
      assert.deepEqual(await errorOf(await a.owner.send("PUT", route, { model: "gpt-5.6-luna" })), { status: 403, code: "model_picker_disabled" });
      assert.equal(puts(), 0, "nothing reached the provider");
      // Asking for DeepSeek Flash follows the provider's default instead of pinning it.
      await drainAgentRuntimeProvisions();
      // The model list and the agent's PUT go out together; answer each by path.
      fake.setFallback((request) => request.path.startsWith("/provision/models")
        ? { status: 200, body: MODELS }
        : { status: 200, body: { model: "deepseek-flash", label: "DeepSeek Flash", source: "default", locked: false } });
      const back = await a.owner.send("PUT", route, { model: "deepseek-flash" });
      assert.equal(back.status, 200, await back.clone().text());
      const sent = fake.requests.filter((r) => r.method === "PUT" && r.path.includes("/model")).at(-1)!;
      assert.deepEqual(JSON.parse(sent.body), { model: null });

      // An agent's card naming another model is refused at prepare.
      const requester = await createAgent(a.server.id, "card-requester-np", { runtime: "claude" });
      const [channel] = await listChannels(a.server.id);
      await assert.rejects(
        prepareActionCard({
          serverId: a.server.id,
          requesterAgentId: requester.id,
          targetChannelId: channel!.id,
          action: { type: "agent:create", name: "card-luna", hosting: "antiproton", model: "gpt-5.6-luna" } as never,
        }),
        (error: unknown) => error instanceof ActionCardError && error.code === "HOSTED_MODEL_PICKER_DISABLED" && error.status === 403,
      );
    } finally {
      await fake.close();
    }
  });
});

test("the provider learns each hosted server's model-picker state, again when it flips, and a 404 (route not deployed yet) retries", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      const hosted = await setupServer(app.baseUrl, "picker-sync-hosted");
      const plain = await setupServer(app.baseUrl, "picker-sync-plain");
      await configure(fake, hosted);
      await createHosted(hosted.owner, "picker-synced");
      const puts = () => fake.requests.filter((r) => r.method === "PUT" && r.path.endsWith("/model-picker"));

      // Before the provider has the route: 404, recorded and backed off, never final.
      fake.setFallback((request) => request.path.endsWith("/model-picker")
        ? { status: 404, body: { error: { code: "not_found", message: "no route" } } }
        : { status: 200, body: {} });
      assert.deepEqual(await syncHostedRuntimeModelPickers(), { checked: 1, synced: 0, failed: 1 });
      const [failed] = await getDb().select().from(hostedRuntimeServerPlans).where(eq(hostedRuntimeServerPlans.serverId, hosted.server.id));
      assert.deepEqual([failed!.syncedModelPicker, failed!.modelPickerFailedAttempts, failed!.modelPickerLastErrorCode], [null, 1, "http_404"]);
      assert.deepEqual(await syncHostedRuntimeModelPickers(), { checked: 0, synced: 0, failed: 0 }, "backing off");

      // Route deployed: the off state is sent once, only for the server with a hosted agent.
      fake.setFallback(() => ({ status: 200, body: { raftServerId: hosted.server.id, modelPicker: false, updatedAt: new Date().toISOString() } }));
      const later = new Date(Date.now() + 60 * 60_000);
      assert.deepEqual(await syncHostedRuntimeModelPickers({ now: later }), { checked: 1, synced: 1, failed: 0 });
      assert.equal(puts().at(-1)!.path, `/provision/servers/${hosted.server.id}/model-picker`);
      assert.deepEqual(JSON.parse(puts().at(-1)!.body), { enabled: false });
      assert.ok(!puts().some((r) => r.path.includes(plain.server.id)));
      assert.deepEqual(await syncHostedRuntimeModelPickers({ now: later }), { checked: 0, synced: 0, failed: 0 }, "confirmed");

      // The flag flips on in Feature Flag Admin: the next pass sends it.
      await enableModelPickerFor(hosted.server.id);
      assert.deepEqual(await syncHostedRuntimeModelPickers({ now: later }), { checked: 1, synced: 1, failed: 0 });
      assert.deepEqual(JSON.parse(puts().at(-1)!.body), { enabled: true });
      const [synced] = await getDb().select().from(hostedRuntimeServerPlans).where(eq(hostedRuntimeServerPlans.serverId, hosted.server.id));
      assert.deepEqual([synced!.syncedModelPicker, synced!.modelPickerFailedAttempts, synced!.modelPickerNextAttemptAt], [true, 0, null]);
    } finally {
      await fake.close();
    }
  });
});

test("a picked model's create first tells the provider the server may pick, so its first hosted agent is not refused", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      const a = await setupServer(app.baseUrl, "picker-presync");
      await configure(fake, a);
      await enableModelPickerFor(a.server.id);
      const MODELS = {
        models: [{ id: "deepseek-flash", label: "DeepSeek Flash", provider: "deepseek" }, { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", provider: "cloudflare" }],
        default: "deepseek-flash", defaultLabel: "DeepSeek Flash", locked: false,
      };
      fake.setFallback((request) => request.path.startsWith("/provision/models")
        ? { status: 200, body: MODELS }
        : request.path.endsWith("/model-picker")
          ? { status: 200, body: { raftServerId: a.server.id, modelPicker: true, updatedAt: new Date().toISOString() } }
          : request.method === "POST" && request.path === "/provision/agents"
            ? { status: 201, body: { providerAgentId: "p1", status: "active", push: { registered: true } } }
            : { status: 200, body: {} });
      const res = await a.owner.send("POST", "/agents", { name: "luna-first", external: true, provider: "antiproton", hostedModel: "gpt-5.6-luna" });
      assert.equal(res.status, 200, await res.clone().text());
      await drainAgentRuntimeProvisions();
      const order = fake.requests.filter((r) => r.path.endsWith("/model-picker") || (r.method === "POST" && r.path === "/provision/agents")).map((r) => r.method);
      assert.deepEqual(order, ["PUT", "POST"], "the picker state goes out before the create");
      const [synced] = await getDb().select().from(hostedRuntimeServerPlans).where(eq(hostedRuntimeServerPlans.serverId, a.server.id));
      assert.equal(synced!.syncedModelPicker, true);

      // A database error inside the pre-sync is never the caller's failure.
      assert.equal(await ensureServerModelPickerSynced("not-a-uuid"), false, "the query throws on a malformed id; the sync swallows it");

      // The provider still refuses (the pre-sync failed): retried, never a final failure.
      const refusing = await a.owner.send("POST", "/agents", { name: "luna-refused", external: true, provider: "antiproton", hostedModel: "gpt-5.6-luna" });
      const refusedId = (await refusing.json() as { id: string }).id;
      fake.next(() => ({ status: 403, body: { error: { code: "model_picker_disabled", message: "not allowed" } } }));
      await drainAgentRuntimeProvisions();
      const refusedRow = await provisionRow(refusedId);
      assert.deepEqual([refusedRow!.state, refusedRow!.lastErrorCode], ["provisioning", "model_picker_disabled"], "backing off, not failed");
      await drainAgentRuntimeProvisions({ now: later(PROVISION_RETRY_BASE_MS * 4) });
      assert.equal((await provisionRow(refusedId))!.state, "active", "the retry succeeds");


      // Already confirmed: the next picked create does not PUT again.
      const before = fake.requests.filter((r) => r.path.endsWith("/model-picker")).length;
      const second = await a.owner.send("POST", "/agents", { name: "luna-second", external: true, provider: "antiproton", hostedModel: "gpt-5.6-luna" });
      assert.equal(second.status, 200);
      await drainAgentRuntimeProvisions();
      assert.equal(fake.requests.filter((r) => r.path.endsWith("/model-picker")).length, before);

      // The picker turned off before a picked create got through: final, with the reason,
      // and the retry asks for a model again (never stuck provisioning).
      const stranded = await a.owner.send("POST", "/agents", { name: "luna-stranded", external: true, provider: "antiproton", hostedModel: "gpt-5.6-luna" });
      const strandedId = (await stranded.json() as { id: string }).id;
      await getDb().delete(featureFlagRules).where(eq(featureFlagRules.flagKey, ANTIPROTON_MODEL_PICKER_FEATURE_FLAG_KEY));
      fake.setFallback((request) => request.method === "POST" && request.path === "/provision/agents"
        ? { status: 403, body: { error: { code: "model_picker_disabled", message: "not allowed" } } }
        : { status: 200, body: { raftServerId: a.server.id, modelPicker: false, updatedAt: new Date().toISOString() } });
      await drainAgentRuntimeProvisions();
      const strandedRow = await provisionRow(strandedId);
      assert.deepEqual([strandedRow!.state, strandedRow!.lastErrorCode], ["failed", "model_picker_disabled"]);
      assert.equal((await getHostedRuntimeSummary(strandedId))!.retryNeedsModel, true);
    } finally {
      await fake.close();
    }
  });
});

test("replicas syncing together (a deploy restarts every task) send each server's plan and picker state once", async ({ app }) => {
  await withEnv(async () => {
    const fake = await startFakeProvider();
    try {
      const hosted = await setupServer(app.baseUrl, "sync-claim");
      await configure(fake, hosted);
      await createHosted(hosted.owner, "claimed");
      fake.setFallback(() => ({ status: 200, body: {} }));
      const plans = await Promise.all([1, 2, 3, 4].map(() => syncHostedRuntimeServerPlans()));
      assert.equal(plans.reduce((sum, r) => sum + r.synced, 0), 1, JSON.stringify(plans));
      assert.equal(fake.requests.filter((r) => r.method === "PUT" && r.path.endsWith("/plan")).length, 1);
      const pickers = await Promise.all([1, 2, 3, 4].map(() => syncHostedRuntimeModelPickers()));
      assert.equal(pickers.reduce((sum, r) => sum + r.synced, 0), 1, JSON.stringify(pickers));
      assert.equal(fake.requests.filter((r) => r.method === "PUT" && r.path.endsWith("/model-picker")).length, 1);
    } finally {
      await fake.close();
    }
  });
});
