import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import {
  compareRuntimeCliVersions,
  observeRuntimeCliVersions,
  readRuntimeCliVersionState,
  runtimeCliVersionsPath,
  writeRuntimeCliVersionState,
} from "./runtimeCliVersionTracker";

const empty = { schemaVersion: 1 as const, versions: {}, downgrades: {} };
const at = new Date("2026-10-18T08:00:00.000Z");

test("versions compare by their dotted numbers whatever the CLI prints around them", () => {
  assert.ok(compareRuntimeCliVersions("codex-cli 0.163.0", "codex-cli 0.151.0")! > 0);
  assert.ok(compareRuntimeCliVersions("2.1.301 (Claude Code)", "2.1.400")! < 0);
  assert.equal(compareRuntimeCliVersions("1.2", "1.2.0"), 0);
  assert.equal(compareRuntimeCliVersions("dev", "1.0.0"), null);
});

test("the first detection only records; a later downgrade is a change and a notice", () => {
  const first = observeRuntimeCliVersions(empty, { codex: "codex-cli 0.163.0", claude: "2.1.301" }, at);
  assert.deepEqual(first.changes, []);
  const down = observeRuntimeCliVersions(first.next, { codex: "codex-cli 0.151.0", claude: "2.1.301" }, at);
  assert.deepEqual(down.changes, [{ runtime: "codex", from: "codex-cli 0.163.0", to: "codex-cli 0.151.0", direction: "downgrade" }]);
  assert.deepEqual(down.next.downgrades.codex, { from: "codex-cli 0.163.0", to: "codex-cli 0.151.0", at: at.toISOString() });
  assert.equal(down.next.downgrades.claude, undefined);
});

test("a notice clears once the version is back, and remembers the good version across a second step down", () => {
  const recorded = observeRuntimeCliVersions(empty, { codex: "0.163.0" }, at).next;
  const once = observeRuntimeCliVersions(recorded, { codex: "0.155.0" }, at).next;
  const twice = observeRuntimeCliVersions(once, { codex: "0.151.0" }, at).next;
  assert.equal(twice.downgrades.codex?.from, "0.163.0");
  const back = observeRuntimeCliVersions(twice, { codex: "0.163.0" }, at);
  assert.equal(back.changes[0]?.direction, "upgrade");
  assert.equal(back.next.downgrades.codex, undefined);
});

test("a runtime missing from one detection keeps its record", () => {
  const recorded = observeRuntimeCliVersions(empty, { codex: "0.163.0" }, at).next;
  const missing = observeRuntimeCliVersions(recorded, {}, at);
  assert.deepEqual(missing.changes, []);
  assert.equal(missing.next.versions.codex, "0.163.0");
});

test("the record round-trips through the Raft home, and a bad file reads as empty", async () => {
  const home = await mkdtemp(path.join(process.env.TMPDIR ?? tmpdir(), "runtime-cli-"));
  assert.deepEqual(await readRuntimeCliVersionState(home), empty);
  const state = observeRuntimeCliVersions(observeRuntimeCliVersions(empty, { codex: "0.163.0" }, at).next, { codex: "0.151.0" }, at).next;
  await writeRuntimeCliVersionState(home, state);
  assert.deepEqual(await readRuntimeCliVersionState(home), state);
  assert.match(await readFile(runtimeCliVersionsPath(home), "utf8"), /"schemaVersion": 1/);
});
