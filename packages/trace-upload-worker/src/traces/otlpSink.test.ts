import assert from "node:assert/strict";
import { DEFAULT_BUNDLE_OTLP_TIMEOUT_MS, DEFAULT_OTLP_TIMEOUT_MS, getConfiguredOtlpTimeoutMs } from "./otlpSink";

test("TRACE_INGEST_OTLP_TIMEOUT_MS defaults to 10s and clamps to 1s-55s", () => {
  assert.equal(DEFAULT_OTLP_TIMEOUT_MS, 10_000);
  assert.equal(getConfiguredOtlpTimeoutMs({}), 10_000);
  assert.equal(getConfiguredOtlpTimeoutMs({ TRACE_INGEST_OTLP_TIMEOUT_MS: "" }), 10_000);
  assert.equal(getConfiguredOtlpTimeoutMs({ TRACE_INGEST_OTLP_TIMEOUT_MS: "not-a-number" }), 10_000);
  assert.equal(getConfiguredOtlpTimeoutMs({ TRACE_INGEST_OTLP_TIMEOUT_MS: "2500" }), 2_500);
  assert.equal(getConfiguredOtlpTimeoutMs({ TRACE_INGEST_OTLP_TIMEOUT_MS: " 2500 " }), 2_500);
  assert.equal(getConfiguredOtlpTimeoutMs({ TRACE_INGEST_OTLP_TIMEOUT_MS: "1" }), 1_000);
  assert.equal(getConfiguredOtlpTimeoutMs({ TRACE_INGEST_OTLP_TIMEOUT_MS: "-5" }), 1_000);
  assert.equal(getConfiguredOtlpTimeoutMs({ TRACE_INGEST_OTLP_TIMEOUT_MS: "600000" }), 55_000);
});

test("bundle routes use TRACE_INGEST_BUNDLE_OTLP_TIMEOUT_MS: default 55s, clamped 1s-120s, independent of the web timeout", () => {
  assert.equal(DEFAULT_BUNDLE_OTLP_TIMEOUT_MS, 55_000);
  assert.equal(getConfiguredOtlpTimeoutMs({}, "bundle"), 55_000);
  assert.equal(getConfiguredOtlpTimeoutMs({}, "bundle_logs"), 55_000);
  assert.equal(getConfiguredOtlpTimeoutMs({ TRACE_INGEST_OTLP_TIMEOUT_MS: "2000" }, "bundle"), 55_000);
  assert.equal(getConfiguredOtlpTimeoutMs({ TRACE_INGEST_BUNDLE_OTLP_TIMEOUT_MS: "90000" }, "bundle"), 90_000);
  assert.equal(getConfiguredOtlpTimeoutMs({ TRACE_INGEST_BUNDLE_OTLP_TIMEOUT_MS: "999999" }, "bundle_logs"), 120_000);
  assert.equal(getConfiguredOtlpTimeoutMs({ TRACE_INGEST_BUNDLE_OTLP_TIMEOUT_MS: "90000" }, "web"), 10_000);
  assert.equal(getConfiguredOtlpTimeoutMs({ TRACE_INGEST_BUNDLE_OTLP_TIMEOUT_MS: "90000" }, "web_events"), 10_000);
});
