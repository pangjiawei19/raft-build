import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { performance } from "node:perf_hooks";
import { afterEach, test } from "vitest";
import { BasicTracer, type TraceLogEvent } from "@botiverse/raft-shared";
import {
  __recordGcForTest,
  __resetStallRegistriesForTest,
  snapshotStall,
  startEventLoopStallDetector,
  trackActiveSpans,
  trackHttpServer,
} from "./eventLoopStall";

afterEach(() => __resetStallRegistriesForTest());

function collectingTracer() {
  const events: TraceLogEvent[] = [];
  const spans: string[] = [];
  const tracer = new BasicTracer({
    sink: { record: (s) => { spans.push(s.name); }, recordLogEvent: (e) => { events.push(e); } },
  });
  return { tracer, events, spans };
}

function blockFor(ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* busy */ }
}

test("a blocked loop emits one server.event_loop.stall with memory and open spans", async () => {
  const { tracer, events } = collectingTracer();
  const wrapped = trackActiveSpans(tracer);
  const job = wrapped.startSpan("server.agent_push.sweep", { surface: "server" });
  const stop = startEventLoopStallDetector(wrapped, { tickMs: 20, thresholdMs: 400, minIntervalMs: 60_000, observeGc: false });
  await new Promise((r) => setTimeout(r, 60));
  blockFor(700);
  await new Promise((r) => setTimeout(r, 60));
  stop();
  job.end();
  const stalls = events.filter((e) => e.name === "server.event_loop.stall");
  assert.equal(stalls.length, 1);
  const a = stalls[0]!.attrs!;
  assert.equal(stalls[0]!.surface, "server");
  assert.ok((a.stall_ms as number) >= 600, `stall_ms ${a.stall_ms}`);
  assert.match(a.background_spans as string, /^server\.agent_push\.sweep x1 \d+ms$/);
  for (const k of ["rss_mb", "heap_used_mb", "heap_total_mb", "external_mb"]) assert.equal(typeof a[k], "number", k);
});

test("at most one stall event per interval; a healthy loop emits nothing", async () => {
  const { tracer, events } = collectingTracer();
  const stop = startEventLoopStallDetector(tracer, { tickMs: 20, thresholdMs: 400, minIntervalMs: 60_000 });
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(events.length, 0);
  blockFor(600);
  await new Promise((r) => setTimeout(r, 60));
  blockFor(600);
  await new Promise((r) => setTimeout(r, 60));
  stop();
  assert.equal(events.filter((e) => e.name === "server.event_loop.stall").length, 1);
});

test("trackActiveSpans forwards spans unchanged and forgets them on end; HTTP/db spans are not listed", () => {
  const { tracer, spans } = collectingTracer();
  const wrapped = trackActiveSpans(tracer);
  const http = wrapped.startSpan("server.http.request", { surface: "server" });
  const job = wrapped.startSpan("server.slack_bridge.outbound.tick", { surface: "server" });
  assert.match(snapshotStall(1_000).background_spans, /slack_bridge\.outbound\.tick x1/);
  assert.doesNotMatch(snapshotStall(1_000).background_spans, /http\.request/);
  job.end();
  http.end();
  assert.equal(snapshotStall(1_000).background_spans, "");
  assert.deepEqual(spans.sort(), ["server.http.request", "server.slack_bridge.outbound.tick"]);
});

test("in-flight routes use the route template, never the raw URL, and finished requests drop out", async () => {
  // Deterministic: the handler holds the response until the test releases it,
  // and the test waits for the registry instead of sleeping (CI load-safe).
  let release!: () => void;
  const released = new Promise<void>((r) => { release = r; });
  const server = createServer((req, res) => {
    // Simulate express having matched a route template.
    Object.assign(req, { baseUrl: "/api/channels", route: { path: "/:id" } });
    void released.then(() => res.end("ok"));
  });
  trackHttpServer(server);
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  const done = new Promise<void>((resolve) => {
    request({ port, path: "/api/channels/3f2c9a8e-secret?token=x" }, (res) => { res.resume(); res.on("end", resolve); }).end();
  });
  const until = async (ok: () => boolean) => {
    for (let i = 0; i < 200 && !ok(); i += 1) await new Promise((r) => setTimeout(r, 10));
  };
  await until(() => snapshotStall(1_000).inflight_requests === 1);
  const during = snapshotStall(1_000);
  assert.equal(during.inflight_requests, 1);
  assert.match(during.inflight_routes, /^GET \/api\/channels\/:id x1 \d+ms$/);
  assert.doesNotMatch(during.inflight_routes, /secret|token/);
  release();
  await done;
  await until(() => snapshotStall(60_000).inflight_requests === 0);
  const after = snapshotStall(60_000);
  assert.equal(after.inflight_requests, 0);
  assert.match(after.finished_during_stall, /GET \/api\/channels\/:id x1/);
  await new Promise<void>((r) => server.close(() => r()));
});

test("a span that is never ended only bumps its count; tracked starts stay bounded", () => {
  const { tracer } = collectingTracer();
  const wrapped = trackActiveSpans(tracer);
  for (let i = 0; i < 1_000; i += 1) wrapped.startSpan("server.leaky.tick", { surface: "server" });
  const snap = snapshotStall(1_000);
  assert.match(snap.background_spans, /^server\.leaky\.tick x1000 \d+ms$/);
  assert.equal(snap.background_spans_open, 1_000);
  // Beyond the per-name cap spans are only counted; ending one still decrements.
  const extra = wrapped.startSpan("server.leaky.tick", { surface: "server" });
  assert.equal(snapshotStall(1_000).background_spans_open, 1_001);
  extra.end();
  assert.equal(snapshotStall(1_000).background_spans_open, 1_000);
});

test("ending a tracked span removes exactly that span; the next-oldest becomes the reported age", async () => {
  const { tracer } = collectingTracer();
  const wrapped = trackActiveSpans(tracer);
  const first = wrapped.startSpan("server.job.tick", { surface: "server" });
  await new Promise((r) => setTimeout(r, 50));
  const second = wrapped.startSpan("server.job.tick", { surface: "server" });
  const before = Number(/x2 (\d+)ms/.exec(snapshotStall(1_000).background_spans)![1]);
  first.end();
  const after = Number(/x1 (\d+)ms/.exec(snapshotStall(1_000).background_spans)![1]);
  assert.ok(before >= 45 && after < before, `before ${before} after ${after}`);
  second.end();
  assert.equal(snapshotStall(1_000).background_spans, "");
});

test("GC entries inside the stall window are reported as gc_count / gc_max_pause_ms", () => {
  const now = 100_000;
  __recordGcForTest(now - 50_000, 30); // well before the stall: ignored
  __recordGcForTest(now - 1_500, 120); // inside a 2 s stall
  __recordGcForTest(now - 400, 900);
  const snap = snapshotStall(2_000, now);
  assert.equal(snap.gc_count, 2);
  assert.equal(snap.gc_max_pause_ms, 900);
});

test("the stall snapshot is taken after GC entries queued during the stall are delivered", async () => {
  const { tracer, events } = collectingTracer();
  // Real GC on a busy CI machine would also land in the window (10-13: 3 real
  // GCs made gc_count 4); only the injected entry may count here.
  const stop = startEventLoopStallDetector(tracer, { tickMs: 20, thresholdMs: 200, minIntervalMs: 60_000, observeGc: false });
  await new Promise((r) => setTimeout(r, 60));
  blockFor(400);
  // Queued before the detector's timer gets to run, like an observer callback
  // dispatched right after a long GC. Without deferral the timer would
  // snapshot first and miss it.
  setImmediate(() => __recordGcForTest(performance.now() - 300, 350));
  await new Promise((r) => setTimeout(r, 80));
  stop();
  const stall = events.find((e) => e.name === "server.event_loop.stall");
  assert.ok(stall, "no stall event");
  assert.equal(stall!.attrs!.gc_count, 1);
  assert.equal(stall!.attrs!.gc_max_pause_ms, 350);
});
