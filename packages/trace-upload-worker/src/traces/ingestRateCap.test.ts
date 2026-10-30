import assert from "node:assert/strict";
import { test } from "vitest";
import { capRecordsPerMinute, readIngestPerMinuteCap, TRACE_INGEST_PER_MINUTE_CAP } from "./ingestRateCap";

const describe = (r: { name: string; time: string }) => r;

test("keeps the first N records per name and start minute and reports the rest", () => {
  const records = [
    { name: "a", time: "2026-10-16T19:30:01.000Z" },
    { name: "a", time: "2026-10-16T19:30:02.000Z" },
    { name: "a", time: "2026-10-16T19:30:59.999Z" },
    { name: "b", time: "2026-10-16T19:30:03.000Z" },
    { name: "a", time: "2026-10-16T19:31:00.000Z" },
  ];

  const { kept, drops } = capRecordsPerMinute(records, "span", describe, 2);

  assert.deepEqual(kept, [records[0], records[1], records[3], records[4]]);
  assert.deepEqual(drops, [{ recordType: "span", name: "a", minute: "2026-10-16T19:30", kept: 2, dropped: 1 }]);
});

test("counts by the record's own time, so a backlog spread over many minutes is not capped", () => {
  // A catch-up upload: 3,000 spans of one name spread over 10 minutes (300/minute).
  const records = Array.from({ length: 3000 }, (_, i) => ({
    name: "daemon.agent.delivery.routed",
    time: new Date(Date.UTC(2026, 9, 16, 12, 0, 0) + i * 200).toISOString(),
  }));

  const { kept, drops } = capRecordsPerMinute(records, "span", describe, 500);

  assert.equal(kept.length, 3000);
  assert.deepEqual(drops, []);
});

test("normalises non-UTC offsets to the same UTC minute", () => {
  const records = [
    { name: "a", time: "2026-10-16T19:30:10.000Z" },
    { name: "a", time: "2026-10-16T15:30:20.000-04:00" },
  ];

  const { kept, drops } = capRecordsPerMinute(records, "event", describe, 1);

  assert.equal(kept.length, 1);
  assert.deepEqual(drops, [{ recordType: "event", name: "a", minute: "2026-10-16T19:30", kept: 1, dropped: 1 }]);
});

test("keeps records whose time does not parse and never counts them", () => {
  const records = [
    { name: "a", time: "not-a-time" },
    { name: "a", time: "also-bad" },
  ];

  const { kept, drops } = capRecordsPerMinute(records, "span", describe, 1);

  assert.equal(kept.length, 2);
  assert.deepEqual(drops, []);
});

test("cap 0 disables the cap", () => {
  const records = Array.from({ length: 10 }, () => ({ name: "a", time: "2026-10-16T19:30:00.000Z" }));
  assert.equal(capRecordsPerMinute(records, "span", describe, 0).kept.length, 10);
});

test("reads the cap from env with a safe default", () => {
  assert.equal(readIngestPerMinuteCap({}), TRACE_INGEST_PER_MINUTE_CAP);
  assert.equal(readIngestPerMinuteCap({ TRACE_INGEST_PER_MINUTE_CAP: "" }), TRACE_INGEST_PER_MINUTE_CAP);
  assert.equal(readIngestPerMinuteCap({ TRACE_INGEST_PER_MINUTE_CAP: "1200" }), 1200);
  assert.equal(readIngestPerMinuteCap({ TRACE_INGEST_PER_MINUTE_CAP: "0" }), 0);
  assert.equal(readIngestPerMinuteCap({ TRACE_INGEST_PER_MINUTE_CAP: "-1" }), TRACE_INGEST_PER_MINUTE_CAP);
  assert.equal(readIngestPerMinuteCap({ TRACE_INGEST_PER_MINUTE_CAP: "abc" }), TRACE_INGEST_PER_MINUTE_CAP);
});
