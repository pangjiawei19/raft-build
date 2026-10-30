import assert from "node:assert/strict";
import { test } from "vitest";
import { mergeIncompleteRuntimeInventory, normalizeRuntimeDetectionReport } from "./agentOrchestrator";

test("task #1268: normalizeRuntimeDetectionReport — absent = null (synchronous daemon), pending/complete/incomplete kept, junk defaults", () => {
  assert.equal(normalizeRuntimeDetectionReport(undefined, 5), null);
  assert.deepEqual(normalizeRuntimeDetectionReport({ status: "pending" }, 5), { status: "pending", updatedAtMs: 5 });
  assert.deepEqual(normalizeRuntimeDetectionReport({ status: "complete", durationMs: 10 }, 5), { status: "complete", updatedAtMs: 5 });
  assert.deepEqual(
    normalizeRuntimeDetectionReport({ status: "incomplete", reason: "deadline", unfinishedRuntimes: ["codex", 7, ""] }, 5),
    { status: "incomplete", reason: "deadline", unfinishedRuntimes: ["codex"], updatedAtMs: 5 },
  );
  assert.deepEqual(normalizeRuntimeDetectionReport({ status: "incomplete", reason: "bogus" }, 5), { status: "incomplete", reason: "child_failed", unfinishedRuntimes: [], updatedAtMs: 5 });
  assert.deepEqual(normalizeRuntimeDetectionReport({ status: "weird" }, 5), { status: "complete", updatedAtMs: 5 });
});

test("task #1268: mergeIncompleteRuntimeInventory keeps only the unfinished runtimes (and their versions) from the previous inventory", () => {
  const previous = { runtimes: ["codex", "grok"], runtimeVersions: { codex: "0.75.1", grok: "1.0" } };
  assert.deepEqual(
    mergeIncompleteRuntimeInventory(previous, { runtimes: ["claude"], runtimeVersions: { claude: "2.0.0" } }, ["codex"]),
    { runtimes: ["claude", "codex"], runtimeVersions: { claude: "2.0.0", codex: "0.75.1" } },
  );
  assert.deepEqual(mergeIncompleteRuntimeInventory(null, { runtimes: ["claude"], runtimeVersions: {} }, ["codex"]), { runtimes: ["claude"], runtimeVersions: {} });
  assert.deepEqual(mergeIncompleteRuntimeInventory(previous, { runtimes: ["codex"], runtimeVersions: { codex: "0.80.0" } }, ["codex"]), { runtimes: ["codex"], runtimeVersions: { codex: "0.80.0" } });
  assert.deepEqual(mergeIncompleteRuntimeInventory(previous, { runtimes: [], runtimeVersions: {} }, []), { runtimes: [], runtimeVersions: {} });
});
