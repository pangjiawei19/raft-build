import assert from "node:assert/strict";
import { test } from "vitest";
import { BasicTracer, type TraceLogEvent } from "@botiverse/raft-shared";
import { startProcessMemorySampler, toMemorySample } from "./processMemory";

test("toMemorySample converts bytes to rounded megabytes", () => {
  const MB = 1_048_576;
  assert.deepEqual(
    toMemorySample({ rss: 1439.4 * MB, heapUsed: 365.6 * MB, heapTotal: 400 * MB, external: 12 * MB, arrayBuffers: 3 * MB }, 60_000),
    { interval_ms: 60_000, rss_mb: 1439, heap_used_mb: 366, heap_total_mb: 400, external_mb: 12, array_buffers_mb: 3 },
  );
});

test("the sampler emits one server.process.memory event per interval", async () => {
  const events: TraceLogEvent[] = [];
  const tracer = new BasicTracer({ sink: { record: () => undefined, recordLogEvent: (event) => { events.push(event); } } });
  const stop = startProcessMemorySampler(tracer, 30);
  await new Promise((resolve) => setTimeout(resolve, 100));
  stop();
  assert.ok(events.length >= 2, `got ${events.length} events`);
  const event = events[0]!;
  assert.equal(event.name, "server.process.memory");
  assert.equal(event.surface, "server");
  for (const key of ["rss_mb", "heap_used_mb", "heap_total_mb", "external_mb", "array_buffers_mb"]) {
    assert.equal(typeof event.attrs?.[key], "number", key);
  }
  assert.ok((event.attrs?.rss_mb as number) > 0);
});
