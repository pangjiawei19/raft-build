import assert from "node:assert/strict";
import type { TraceUploadWorkerEnv } from "../env";
import { HttpError } from "../shared/http";
import { chargeTraceUploadBudget, resetTraceUploadBudgetsForTest } from "./uploadRateLimit";

function envWith(overrides: Partial<TraceUploadWorkerEnv> = {}) {
  return { SCOPE_ATTESTATION_SECRET: "s", TRACE_BUNDLES: {}, ...overrides } as TraceUploadWorkerEnv;
}

const NOW = new Date("2026-10-14T05:30:00Z");
const input = { serverId: "server-1", subjectId: "machine:m1", bundleSizeBytes: 100 };

function captureWarnings() {
  const warnings: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  return { warnings, restore: () => { console.warn = original; } };
}

function is429(error: unknown): boolean {
  return error instanceof HttpError && error.status === 429;
}

beforeEach(() => resetTraceUploadBudgetsForTest());

test("observe mode (the default) logs uploads over the count cap and lets them through", () => {
  const env = envWith({ TRACE_UPLOAD_HOURLY_LIMIT: "2" });
  const { warnings, restore } = captureWarnings();
  try {
    for (let i = 0; i < 4; i += 1) chargeTraceUploadBudget(env, input, NOW);
  } finally {
    restore();
  }
  assert.equal(warnings.length, 2);
  assert.equal(warnings[0]![0], "[TraceUploadRateLimit] over_limit");
  const fields = warnings[1]![1] as Record<string, unknown>;
  assert.deepEqual({ mode: fields.mode, reason: fields.reason, count: fields.count, bytes: fields.bytes },
    { mode: "observe", reason: "count", count: 4, bytes: 400 });
});

test("enforce mode answers 429 past the count cap", () => {
  const env = envWith({ TRACE_UPLOAD_HOURLY_LIMIT: "2", TRACE_UPLOAD_RATE_LIMIT_MODE: "enforce" });
  const { restore } = captureWarnings();
  try {
    chargeTraceUploadBudget(env, input, NOW);
    chargeTraceUploadBudget(env, input, NOW);
    assert.throws(() => chargeTraceUploadBudget(env, input, NOW), is429);
    // A refused upload is not counted, so the caller stays at the cap, not past it.
    assert.throws(() => chargeTraceUploadBudget(env, input, NOW), is429);
  } finally {
    restore();
  }
});

test("the byte cap applies on its own", () => {
  const env = envWith({ TRACE_UPLOAD_HOURLY_BYTES_LIMIT: "250", TRACE_UPLOAD_RATE_LIMIT_MODE: "enforce" });
  const { warnings, restore } = captureWarnings();
  try {
    chargeTraceUploadBudget(env, input, NOW);
    chargeTraceUploadBudget(env, input, NOW);
    assert.throws(() => chargeTraceUploadBudget(env, input, NOW), is429);
  } finally {
    restore();
  }
  assert.equal((warnings[0]![1] as Record<string, unknown>).reason, "bytes");
});

test("budgets are separate per server, per subject and per hour; the log carries no object key or token", () => {
  const env = envWith({ TRACE_UPLOAD_HOURLY_LIMIT: "1", TRACE_UPLOAD_RATE_LIMIT_MODE: "enforce" });
  const { warnings, restore } = captureWarnings();
  try {
    chargeTraceUploadBudget(env, input, NOW);
    chargeTraceUploadBudget(env, { ...input, subjectId: "machine:m2" }, NOW);
    chargeTraceUploadBudget(env, { ...input, serverId: "server-2" }, NOW);
    assert.throws(() => chargeTraceUploadBudget(env, input, NOW), is429);
    // A new UTC hour starts every subject from zero.
    chargeTraceUploadBudget(env, input, new Date("2026-10-14T06:00:00Z"));
  } finally {
    restore();
  }
  assert.deepEqual(Object.keys(warnings[0]![1] as object).sort(), [
    "bytes", "bytes_limit", "count", "limit", "mode", "reason", "server_id", "subject_id",
  ]);
});

test("a zero cap disables that check; both zero never logs or refuses", () => {
  const env = envWith({ TRACE_UPLOAD_HOURLY_LIMIT: "0", TRACE_UPLOAD_HOURLY_BYTES_LIMIT: "0", TRACE_UPLOAD_RATE_LIMIT_MODE: "enforce" });
  const { warnings, restore } = captureWarnings();
  try {
    for (let i = 0; i < 5; i += 1) chargeTraceUploadBudget(env, { ...input, bundleSizeBytes: 1e12 }, NOW);
  } finally {
    restore();
  }
  assert.equal(warnings.length, 0);
});
