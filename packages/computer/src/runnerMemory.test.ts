import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { describeRunnerMemory, readRunnerMemorySample } from "./runnerMemory";
import { writeServiceMemorySample } from "./serviceMemory";

const MB = 1024 * 1024;
const now = Date.parse("2026-10-15T09:00:00Z");

const sample = {
  sampledAt: "2026-10-15T08:57:00Z",
  pid: 4242,
  uptimeMs: 3 * 60 * 60_000,
  rssBytes: 483 * MB,
  heapUsedBytes: 300 * MB,
  heapTotalBytes: 340 * MB,
  externalBytes: 21 * MB,
  arrayBuffersBytes: 4 * MB,
  heapSpaceUsedBytes: { old_space: 240 * MB, code_space: 31 * MB },
  lazySchemas: { registered: 372, built: 3 },
};

test("reads the daemon's sample file and prints one line for the live runner", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "runner-memory-"));
  try {
    const file = path.join(dir, "runner.memory.json");
    writeFileSync(file, JSON.stringify(sample));
    const read = await readRunnerMemorySample(file);
    assert.equal(
      describeRunnerMemory(read, 4242, now),
      "rss 483 MB, JS heap 300 MB used of 340 MB (code 31 MB), external 21 MB; runner up 3 h, sampled 3 min ago",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing, unreadable or foreign sample is never shown as the current runner's", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "runner-memory-"));
  try {
    assert.equal(await readRunnerMemorySample(path.join(dir, "absent.json")), null);
    const broken = path.join(dir, "broken.json");
    writeFileSync(broken, "{");
    assert.equal(await readRunnerMemorySample(broken), null);
    const partial = path.join(dir, "partial.json");
    writeFileSync(partial, JSON.stringify({ sampledAt: sample.sampledAt, pid: 1 }));
    assert.equal(await readRunnerMemorySample(partial), null);

    assert.match(describeRunnerMemory(null, 4242, now), /^no sample yet/);
    // Written by a previous runner (pid 4242); the live runner is 5151.
    assert.match(describeRunnerMemory(sample, 5151, now), /^no sample from the current runner yet/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the same line describes the service's sample", () => {
  assert.equal(
    describeRunnerMemory({ ...sample, pid: 77 }, 77, now, "service"),
    "rss 483 MB, JS heap 300 MB used of 340 MB (code 31 MB), external 21 MB; service up 3 h, sampled 3 min ago",
  );
  assert.match(describeRunnerMemory(null, 77, now, "service"), /^no sample yet \(the service writes one/);
  assert.match(
    describeRunnerMemory({ ...sample, pid: 77, rssBytes: 18 * MB, swapBytes: 182 * MB }, 77, now, "service"),
    /^rss 18 MB \(\+182 MB swapped out\), JS heap/,
  );
});

test("the service writes a sample doctor can read", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "service-memory-"));
  try {
    const file = path.join(dir, "run", "service.memory.json");
    writeServiceMemorySample(file, now);
    const read = await readRunnerMemorySample(file);
    assert.ok(read);
    assert.equal(read.pid, process.pid);
    assert.ok(read.rssBytes > 0 && read.heapUsedBytes > 0);
    assert.match(describeRunnerMemory(read, process.pid, now, "service"), /^rss \d+ MB, JS heap /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
