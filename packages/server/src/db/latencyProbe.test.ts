import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { BasicTracer, type TraceLogEvent } from "@botiverse/raft-shared";
import { dbProbeDuration, dbProbeErrorsTotal, dbProbeReconnectsTotal, dbProbeTimeoutsTotal } from "../metrics";
import { resolveDbProbeTargets, startDbLatencyProbe, type DbProbeClient, type DbProbeTarget } from "./latencyProbe";

afterEach(() => {
  dbProbeDuration.reset();
  dbProbeTimeoutsTotal.reset();
  dbProbeErrorsTotal.reset();
  dbProbeReconnectsTotal.reset();
});

const PROD = { DEPLOYMENT_ENV: "production" };

test("targets: pooled from DATABASE_URL, direct only when DB_PROBE_DIRECT_URL is set", () => {
  assert.deepEqual(resolveDbProbeTargets({ ...PROD, DATABASE_URL: "postgres://pooled" }), [
    { endpoint: "pooled", connectionString: "postgres://pooled" },
  ]);
  assert.deepEqual(
    resolveDbProbeTargets({ ...PROD, DATABASE_URL: "postgres://pooled", DB_PROBE_DIRECT_URL: "postgres://direct" }).map((t) => t.endpoint),
    ["pooled", "direct"],
  );
});

test("targets: on by default only in production, switch overrides, never for PGlite", () => {
  const url = { DATABASE_URL: "postgres://pooled" };
  assert.equal(resolveDbProbeTargets({ ...PROD, ...url }).length, 1);
  // Unset elsewhere: off, so auto-suspending staging/preview computes stay asleep.
  assert.deepEqual(resolveDbProbeTargets({ ...url, DEPLOYMENT_ENV: "staging" }), []);
  assert.deepEqual(resolveDbProbeTargets(url), []);
  assert.equal(resolveDbProbeTargets({ ...url, DEPLOYMENT_ENV: "staging", DB_LATENCY_PROBE: "1" }).length, 1);
  for (const off of ["0", "false", "off", "OFF"]) {
    assert.deepEqual(resolveDbProbeTargets({ ...PROD, ...url, DB_LATENCY_PROBE: off }), [], off);
  }
  assert.deepEqual(resolveDbProbeTargets({ ...PROD, DATABASE_URL: "pglite://./data" }), []);
  assert.deepEqual(resolveDbProbeTargets(PROD), []);
});

type FakeResult = number | "timeout" | "error" | { reconnectMs: number };

function fakeClients(results: Record<string, FakeResult[]>) {
  const calls: Record<string, number> = {};
  let clock = 0;
  const createClient = (target: DbProbeTarget): DbProbeClient => ({
    async query() {
      const list = results[target.endpoint]!;
      const i = calls[target.endpoint] = (calls[target.endpoint] ?? 0) + 1;
      const r = list[Math.min(i - 1, list.length - 1)]!;
      if (r === "timeout") throw new Error("Query read timeout");
      if (r === "error") throw new Error("Too many database connection attempts");
      if (typeof r === "object") {
        clock += r.reconnectMs;
        return { freshConnection: true };
      }
      clock += r;
      return { freshConnection: false };
    },
    async end() {},
  });
  return { createClient, calls, now: () => clock };
}

async function histogramCount(endpoint: string): Promise<number> {
  const metric = await dbProbeDuration.get();
  return metric.values.find((v) => v.metricName === "slock_db_probe_duration_seconds_count" && v.labels.endpoint === endpoint)?.value ?? 0;
}

async function counter(c: typeof dbProbeTimeoutsTotal, endpoint: string): Promise<number> {
  return (await c.get()).values.find((v) => v.labels.endpoint === endpoint)?.value ?? 0;
}

test("observes successes, counts timeouts and errors separately, emits one event per slow or failed probe", async () => {
  const events: TraceLogEvent[] = [];
  const tracer = new BasicTracer({ sink: { record: () => undefined, recordLogEvent: (e) => { events.push(e); } } });
  const fake = fakeClients({ pooled: [5, 1400, "timeout", 5], direct: [5, "error", 5, 5] });
  const stop = startDbLatencyProbe(
    tracer,
    [{ endpoint: "pooled", connectionString: "x" }, { endpoint: "direct", connectionString: "y" }],
    { intervalMs: 5, createClient: fake.createClient, now: fake.now },
  );
  await new Promise((resolve) => setTimeout(resolve, 120));
  stop();
  assert.ok((fake.calls.pooled ?? 0) >= 4, `pooled calls ${fake.calls.pooled}`);
  assert.equal(await counter(dbProbeTimeoutsTotal, "pooled"), 1);
  assert.equal(await counter(dbProbeErrorsTotal, "pooled"), 0);
  assert.equal(await counter(dbProbeErrorsTotal, "direct"), 1);
  assert.equal(await counter(dbProbeTimeoutsTotal, "direct"), 0);
  // The timeout is not in the histogram: pooled histogram count = calls - 1.
  assert.equal(await histogramCount("pooled"), fake.calls.pooled! - 1);
  const slow = events.filter((e) => e.name === "server.db.probe.slow");
  assert.ok(slow.some((e) => e.attrs?.endpoint === "pooled" && e.attrs?.outcome === "ok" && e.attrs?.duration_ms === 1400));
  assert.ok(slow.some((e) => e.attrs?.endpoint === "pooled" && e.attrs?.outcome === "timeout"));
  assert.ok(slow.some((e) => e.attrs?.endpoint === "direct" && e.attrs?.outcome === "error"));
  // Fast probes emit nothing.
  assert.ok(slow.every((e) => e.attrs?.outcome !== "ok" || (e.attrs?.duration_ms as number) >= 300));
  assert.ok(slow.every((e) => e.surface === "server"));
});

test("backs off after consecutive failures instead of retrying every interval", async () => {
  const tracer = new BasicTracer({ sink: { record: () => undefined, recordLogEvent: () => undefined } });
  const fake = fakeClients({ pooled: ["error"] });
  const stop = startDbLatencyProbe(tracer, [{ endpoint: "pooled", connectionString: "x" }], {
    intervalMs: 10,
    createClient: fake.createClient,
    now: fake.now,
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  stop();
  // Without backoff ~20 attempts; with 10, 20, 40, 80 ms delays only ~4.
  assert.ok((fake.calls.pooled ?? 0) <= 6, `calls ${fake.calls.pooled}`);
});

test("a probe that had to reconnect is counted, not observed, and its event says so", async () => {
  const events: TraceLogEvent[] = [];
  const tracer = new BasicTracer({ sink: { record: () => undefined, recordLogEvent: (e) => { events.push(e); } } });
  // fail -> reconnect (700 ms handshake + query) -> steady 5 ms
  const fake = fakeClients({ pooled: ["error", { reconnectMs: 700 }, 5] });
  const stop = startDbLatencyProbe(tracer, [{ endpoint: "pooled", connectionString: "x" }], {
    intervalMs: 5,
    createClient: fake.createClient,
    now: fake.now,
  });
  await new Promise((resolve) => setTimeout(resolve, 120));
  stop();
  assert.equal(await counter(dbProbeErrorsTotal, "pooled"), 1);
  assert.equal(await counter(dbProbeReconnectsTotal, "pooled"), 1);
  // Only the steady probes after the reconnect are in the histogram.
  assert.equal(await histogramCount("pooled"), fake.calls.pooled! - 2);
  const metric = await dbProbeDuration.get();
  const sum = metric.values.find((v) => v.metricName === "slock_db_probe_duration_seconds_sum" && v.labels.endpoint === "pooled")?.value ?? 0;
  assert.ok(sum < 0.7, `the 700 ms reconnect leaked into the histogram (sum ${sum})`);
  const reconnect = events.find((e) => e.name === "server.db.probe.slow" && e.attrs?.outcome === "ok");
  assert.equal(reconnect?.attrs?.fresh_connection, true);
  assert.equal(reconnect?.attrs?.duration_ms, 700);
});
