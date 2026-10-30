import assert from "node:assert/strict";
import { handleRequest, type TraceUploadWorkerEnv } from "../index";

const TOKEN = "external-refresh-token-for-tests";

function env(overrides: Partial<TraceUploadWorkerEnv> = {}) {
  const calls: Array<{ url: string; body: string }> = [];
  const value: TraceUploadWorkerEnv = {
    SCOPE_ATTESTATION_SECRET: "unused",
    TRACE_BUNDLES: { put: async () => ({}) },
    TRACE_INGEST_OTLP_ENDPOINT: "https://telescope.test/v1/traces",
    TRACE_INGEST_FETCH: (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: String(init?.body ?? "") });
      return new Response(null, { status: 200 });
    }) as typeof fetch,
    EXTERNAL_GITHUB_REFRESH_TOKEN: TOKEN,
    DEPLOYMENT_ENV: "production",
    ...overrides,
  };
  return { env: value, calls };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    at: "2026-10-19T02:33:00.000Z",
    tenant_id: "raft_b31d4452",
    agent_id: "raft_379d8c2b",
    seq: 42,
    env: "production",
    outcome: "broken",
    scope: "agent",
    connector_id: "con_22c273c1",
    mount: "github",
    why: "expiring",
    attempt: 1,
    stored: false,
    reason_code: "oauth:invalid_grant",
    ...overrides,
  };
}

function post(body: unknown, token: string | null = TOKEN) {
  return new Request("https://trace-worker.test/api/external/github-refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

test("github-refresh forwards allowlisted rows as OTLP logs keyed by (tenant, agent, seq)", async () => {
  const { env: e, calls } = env();
  const res = await handleRequest(post({ rows: [row(), row({ seq: 43, outcome: "rotated", reason_code: undefined })] }), e);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, accepted: 2 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://telescope.test/v1/logs");
  const payload = JSON.parse(calls[0].body);
  const resource = payload.resourceLogs[0].resource.attributes;
  assert.ok(resource.some((a: any) => a.key === "service.name" && a.value.stringValue === "antiproton"));
  const [first] = payload.resourceLogs[0].scopeLogs[0].logRecords;
  const attrs = Object.fromEntries(first.attributes.map((a: any) => [a.key, a.value.stringValue ?? a.value.intValue ?? a.value.boolValue]));
  assert.equal(first.body.stringValue, "antiproton.github.refresh");
  assert.equal(attrs.outcome, "broken");
  assert.equal(attrs.connector_id, "con_22c273c1");
  assert.equal(attrs.reason_code, "oauth:invalid_grant");
  assert.equal(attrs["slock.trace_ingest.event_key"], "raft_b31d4452:raft_379d8c2b:42");
});

test("github-refresh drops unknown fields and free text", async () => {
  const { env: e, calls } = env();
  const res = await handleRequest(post({
    rows: [row({ access_token: "gho_secret", error_message: "Bad credentials for user x", reason_code: "Free text Not A Code" })],
  }), e);
  assert.equal(res.status, 200);
  assert.ok(!calls[0].body.includes("gho_secret"));
  assert.ok(!calls[0].body.includes("Bad credentials"));
  assert.ok(!calls[0].body.includes("Free text"));
});

test("github-refresh auth: unset token = 404, wrong or missing bearer = 401", async () => {
  assert.equal((await handleRequest(post({ rows: [row()] }), env({ EXTERNAL_GITHUB_REFRESH_TOKEN: undefined }).env)).status, 404);
  assert.equal((await handleRequest(post({ rows: [row()] }, "wrong"), env().env)).status, 401);
  assert.equal((await handleRequest(post({ rows: [row()] }, null), env().env)).status, 401);
});

test("github-refresh schema: other kinds, bad outcomes and oversized batches are rejected", async () => {
  const { env: e, calls } = env();
  assert.equal((await handleRequest(post({ rows: [row({ kind: "model.call" })] }), e)).status, 400);
  assert.equal((await handleRequest(post({ rows: [row({ outcome: "exploded" })] }), e)).status, 400);
  assert.equal((await handleRequest(post({ rows: [row({ env: "staging" })] }), e)).status, 400);
  assert.equal((await handleRequest(post({ rows: [row({ seq: -1 })] }), e)).status, 400);
  assert.equal((await handleRequest(post({ rows: Array.from({ length: 501 }, (_, i) => row({ seq: i })) }), e)).status, 413);
  assert.equal((await handleRequest(post({}), e)).status, 400);
  assert.equal(calls.length, 0);
});

test("github-refresh: sink failure is a retryable 503", async () => {
  const { env: e } = env({ TRACE_INGEST_FETCH: (async () => new Response("down", { status: 502 })) as typeof fetch });
  const res = await handleRequest(post({ rows: [row()] }), e);
  assert.equal(res.status, 503);
});

test("github-refresh: no OTLP sink configured is a retryable 503, never a silent 2xx", async () => {
  const { env: e, calls } = env({ TRACE_INGEST_OTLP_ENDPOINT: undefined });
  const res = await handleRequest(post({ rows: [row()] }), e);
  assert.equal(res.status, 503);
  assert.equal(calls.length, 0);
});

test("github-refresh keeps mixed-case mount names", async () => {
  const { env: e, calls } = env();
  assert.equal((await handleRequest(post({ rows: [row({ mount: "GitHub_Main" })] }), e)).status, 200);
  assert.ok(calls[0].body.includes("GitHub_Main"));
});
