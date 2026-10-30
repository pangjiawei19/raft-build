import assert from "node:assert/strict";
import { register } from "../metrics";
import {
  createProductEventSinkFromEnv,
  resolveProductScopeDbConfig,
  PRODUCT_EVENTS_INGEST_STATEMENT,
  PUBLIC_VISITORS_INGEST_STATEMENT,
  ScopeDbProductEventSink,
  ScopeDbPublicVisitorSink,
  type ProductEventRow,
} from "./productEventScopeDbWriter";

function row(index: number): ProductEventRow {
  return {
    uuid: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    event: "activity_open",
    source: "web",
    timestamp: "2026-10-05T10:00:00.000Z",
    received_at: "2026-10-05T10:00:01.000Z",
    analytics_id: null,
    server_id: null,
    client_session_id: "tab-1",
    app_version: null,
    platform: null,
    properties: { from: "rail" },
  };
}

async function ingestCount(outcome: string): Promise<number> {
  const metric = await register.getSingleMetric("slock_product_event_ingest_total")?.get();
  return metric?.values.find((value) => value.labels.outcome === outcome)?.value ?? 0;
}

test("rows are written in batches with the product ingest statement", async () => {
  const inserts: Array<{ lines: number; statement: string }> = [];
  const sink = new ScopeDbProductEventSink({ endpoint: "x", apiKey: "y", batchSize: 2, flushIntervalMs: 60_000 }, {
    insert: async (data: string, statement: string) => {
      inserts.push({ lines: data.split("\n").length, statement });
      return { num_rows_inserted: data.split("\n").length };
    },
  } as never);
  const writtenBefore = await ingestCount("written");

  sink.enqueue([row(1)]);
  assert.equal(inserts.length, 0, "below batch size: waits for the timer");
  sink.enqueue([row(2), row(3)]);
  await sink.flush();

  assert.deepEqual(inserts.map((insert) => insert.lines), [2, 1]);
  assert.ok(inserts.every((insert) => insert.statement === PRODUCT_EVENTS_INGEST_STATEMENT));
  assert.equal((await ingestCount("written")) - writtenBefore, 3);
});

test("a batch that keeps failing and a full queue are counted as lost, never thrown", async () => {
  const sink = new ScopeDbProductEventSink({ endpoint: "x", apiKey: "y", batchSize: 2, maxQueueSize: 3, flushIntervalMs: 60_000, maxAttempts: 1 }, {
    insert: async () => {
      throw new Error("insert failed for 11111111-1111-4111-8111-111111111111");
    },
  } as never);
  const lostBefore = await ingestCount("lost");

  sink.enqueue([row(1)]);
  sink.enqueue([row(2), row(3), row(4), row(5)]); // 5 queued > max 3: 2 dropped
  await sink.flush();

  assert.equal((await ingestCount("lost")) - lostBefore, 5);
});

test("concurrent flushes share one drain, so shutdown waits for every queued row", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const written: number[] = [];
  const sink = new ScopeDbProductEventSink({ endpoint: "x", apiKey: "y", batchSize: 2, flushIntervalMs: 60_000 }, {
    insert: async (data: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      written.push(data.split("\n").length);
      return { num_rows_inserted: data.split("\n").length };
    },
  } as never);

  sink.enqueue([row(1), row(2)]); // full batch: starts a drain
  sink.enqueue([row(3), row(4), row(5)]); // more rows while it runs
  await Promise.all([sink.flush(), sink.flush()]);

  assert.equal(maxInFlight, 1, "never two writes at once");
  assert.equal(written.reduce((a, b) => a + b, 0), 5, "the awaited flush covers rows queued mid-drain");
});

test("the writer reuses the trace events' ScopeDB config unless a complete product pair is set", () => {
  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(message);
  const trace = { SCOPEDB_TRACE_EVENTS_ENDPOINT: "https://trace.example", SCOPEDB_TRACE_EVENTS_WRITE_KEY: "trace-key" };

  assert.equal(resolveProductScopeDbConfig({}, warn), null);
  assert.equal(resolveProductScopeDbConfig({ SCOPEDB_TRACE_EVENTS_ENDPOINT: "https://trace.example" }, warn), null);
  assert.deepEqual(resolveProductScopeDbConfig(trace, warn), { endpoint: "https://trace.example", apiKey: "trace-key" });
  assert.deepEqual(
    resolveProductScopeDbConfig({ ...trace, SCOPEDB_PRODUCT_ENDPOINT: "https://product.example", SCOPEDB_PRODUCT_WRITE_KEY: "product-key" }, warn),
    { endpoint: "https://product.example", apiKey: "product-key" },
  );
  assert.equal(warnings.length, 0);

  // Half a product pair is never mixed with the trace pair.
  assert.deepEqual(
    resolveProductScopeDbConfig({ ...trace, SCOPEDB_PRODUCT_ENDPOINT: "https://product.example" }, warn),
    { endpoint: "https://trace.example", apiKey: "trace-key" },
  );
  assert.equal(warnings.length, 1);
  assert.equal(createProductEventSinkFromEnv({}), null);
  assert.ok(createProductEventSinkFromEnv(trace) instanceof ScopeDbProductEventSink);
});

test("a failed write is retried with backoff instead of dropped, and rows carry the environment", async () => {
  let calls = 0;
  const written: string[] = [];
  const sink = new ScopeDbProductEventSink({
    endpoint: "x", apiKey: "y", deploymentEnvironment: "staging",
    batchSize: 2, flushIntervalMs: 60_000, retryBaseMs: 5, maxAttempts: 5,
  }, {
    insert: async (data: string) => {
      calls += 1;
      if (calls <= 2) throw new Error("429 too many requests");
      written.push(...data.split("\n"));
      return { num_rows_inserted: data.split("\n").length };
    },
  } as never);
  const lostBefore = await ingestCount("lost");

  sink.enqueue([row(1), row(2)]); // full batch: first attempt fails, then backs off
  const deadline = Date.now() + 2_000;
  while (written.length < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(calls, 3, "two failures, then the retry succeeds");
  assert.equal(written.length, 2);
  assert.equal((await ingestCount("lost")) - lostBefore, 0, "nothing lost to a transient failure");
  assert.equal(JSON.parse(written[0]!).deployment_environment, "staging");
});

// Tenny, 2026-10-14: the visitor-id table is written on its own, so a missing
// or failing product.public_visitors never costs product.events rows.
test("public visitor rows go to their own table, and their failures are counted apart", async () => {
  assert.equal(
    PUBLIC_VISITORS_INGEST_STATEMENT,
    'SELECT $0["uuid"]::string AS uuid, $0["event"]::string AS event, $0["server_id"]::string AS server_id, '
      + '$0["received_at"]::timestamp AS received_at, $0["anonymous_id"]::string AS anonymous_id, '
      + '$0["deployment_environment"]::string AS deployment_environment '
      + "INSERT INTO product.public_visitors (uuid, event, server_id, received_at, anonymous_id, deployment_environment)",
  );
  const written: string[] = [];
  const visitors = new ScopeDbPublicVisitorSink({ endpoint: "x", apiKey: "y", deploymentEnvironment: "staging", flushIntervalMs: 60_000, maxAttempts: 1 }, {
    insert: async () => {
      throw new Error("table product.public_visitors does not exist");
    },
  } as never);
  const events = new ScopeDbProductEventSink({ endpoint: "x", apiKey: "y", flushIntervalMs: 60_000 }, {
    insert: async (data: string) => {
      written.push(data);
      return { num_rows_inserted: data.split("\n").length };
    },
  } as never);
  const lostBefore = await ingestCount("lost");
  const visitorLostBefore = await ingestCount("public_visitor_lost");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    visitors.enqueue([{
      uuid: "00000000-0000-4000-8000-000000000001",
      event: "public_page_viewed",
      server_id: "10000000-0000-4000-8000-000000000001" as never,
      received_at: "2026-10-14T10:00:00.000Z",
      anonymous_id: "20000000-0000-4000-8000-000000000001",
    }]);
    events.enqueue([row(1)]);
    await Promise.all([visitors.flush(), events.flush()]);
    assert.equal(written.length, 1, "product.events still written");
    assert.equal((await ingestCount("public_visitor_lost")) - visitorLostBefore, 1);
    assert.equal((await ingestCount("lost")) - lostBefore, 0);
    assert.ok(warn.mock.calls.every((call) => !call.join(" ").includes("20000000-0000-4000-8000-000000000001")), "no visitor id in logs");
  } finally {
    warn.mockRestore();
  }
});
