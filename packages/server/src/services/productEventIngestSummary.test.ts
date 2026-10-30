import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { BasicTracer, MemoryTraceSink } from "@botiverse/raft-shared";
import { countIngest } from "./productEventIngest";
import {
  flushProductEventIngestSummary,
  PRODUCT_EVENT_SUMMARY_INTERVAL_MS,
  resetProductEventIngestSummaryForTest,
  startProductEventIngestSummary,
} from "./productEventIngestSummary";
import { productScopeDbStore, resolveProductScopeDbConfig } from "./productEventScopeDbWriter";

afterEach(() => {
  resetProductEventIngestSummaryForTest();
  vi.useRealTimers();
});

function tracer() {
  const sink = new MemoryTraceSink();
  return { sink, tracer: new BasicTracer({ sink }) };
}

function outcomes(sink: MemoryTraceSink) {
  return sink.getAllLogEvents()
    .filter((e) => e.name === "server.product_events.outcome")
    .map((e) => e.attrs);
}

test("startup names the env pair the writer uses, never a value", () => {
  const { sink, tracer: t } = tracer();
  startProductEventIngestSummary(t, "trace_events");
  const events = sink.getAllLogEvents();
  assert.deepEqual(events.map((e) => [e.name, e.attrs]), [["server.product_events.store", { store: "trace_events" }]]);
});

test("each window reports every outcome it saw, once, with counts; an idle window reports nothing", () => {
  const { sink, tracer: t } = tracer();
  let now = 1_000_000;
  startProductEventIngestSummary(t, "none", { now: () => now });

  countIngest("unconfigured", 3);
  countIngest("public_visit_flag_off", 1);
  countIngest("public_visit_flag_off", 2);
  countIngest("gated", 0); // nothing happened: not reported
  now += 600_000;
  flushProductEventIngestSummary(now);
  assert.deepEqual(outcomes(sink), [
    { outcome: "unconfigured", count: 3, window_s: 600, store: "none" },
    { outcome: "public_visit_flag_off", count: 3, window_s: 600, store: "none" },
  ]);

  sink.clear();
  now += 600_000;
  flushProductEventIngestSummary(now);
  assert.deepEqual(outcomes(sink), []);
});

test("the window closes on its own timer", () => {
  vi.useFakeTimers();
  const { sink, tracer: t } = tracer();
  startProductEventIngestSummary(t, "product");
  countIngest("written", 5);
  vi.advanceTimersByTime(PRODUCT_EVENT_SUMMARY_INTERVAL_MS);
  assert.deepEqual(outcomes(sink), [{ outcome: "written", count: 5, window_s: 600, store: "product" }]);
});

test("before startup nothing is kept (tests and tools never start it)", () => {
  countIngest("gated", 4);
  const { sink, tracer: t } = tracer();
  startProductEventIngestSummary(t, "product");
  flushProductEventIngestSummary();
  assert.deepEqual(outcomes(sink), []);
});

test("the reported store is the pair resolveProductScopeDbConfig takes", () => {
  const trace = { SCOPEDB_TRACE_EVENTS_ENDPOINT: "https://trace.example", SCOPEDB_TRACE_EVENTS_WRITE_KEY: "trace-key" };
  const product = { SCOPEDB_PRODUCT_ENDPOINT: "https://product.example", SCOPEDB_PRODUCT_WRITE_KEY: "product-key" };
  const quiet = () => {};
  const cases: Array<[NodeJS.ProcessEnv, string | null]> = [
    [{}, null],
    [{ SCOPEDB_TRACE_EVENTS_ENDPOINT: "https://trace.example" }, null],
    [trace, "https://trace.example"],
    [{ ...trace, ...product }, "https://product.example"],
    [{ ...trace, SCOPEDB_PRODUCT_ENDPOINT: "https://product.example" }, "https://trace.example"],
    [{ SCOPEDB_PRODUCT_WRITE_KEY: "product-key" }, null],
    [product, "https://product.example"],
  ];
  const storeOf: Record<string, string> = {
    "https://trace.example": "trace_events",
    "https://product.example": "product",
  };
  for (const [env, endpoint] of cases) {
    assert.equal(resolveProductScopeDbConfig(env, quiet)?.endpoint ?? null, endpoint);
    assert.equal(productScopeDbStore(env), endpoint ? storeOf[endpoint] : "none", JSON.stringify(Object.keys(env)));
  }
});
