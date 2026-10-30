import assert from "node:assert/strict";
import { isLegacyStartFailureDetail, isLegacyUnkindedStartFailure, LEGACY_RUNTIME_NOT_FOUND_DETAIL, legacySpawnFailureCarrier } from "./legacySpawnFailure";

test("a legacy not-found failure is a missing runtime only when the computer's own list also lacks it", () => {
  assert.deepEqual(legacySpawnFailureCarrier({ detail: LEGACY_RUNTIME_NOT_FOUND_DETAIL, runtime: "codex", machineRuntimes: ["claude"] }), { reason: "runtime_not_found" });
  // Old daemons used this text for any "not found" error: with the runtime listed it is something else.
  assert.deepEqual(legacySpawnFailureCarrier({ detail: LEGACY_RUNTIME_NOT_FOUND_DETAIL, runtime: "codex", machineRuntimes: ["claude", "codex"] }), { reason: "runtime_spawn_failed" });
  // No list from the computer: absence is not confirmed, but the failure still counts.
  assert.deepEqual(legacySpawnFailureCarrier({ detail: LEGACY_RUNTIME_NOT_FOUND_DETAIL, runtime: "codex", machineRuntimes: null }), { reason: "runtime_spawn_failed" });
  assert.deepEqual(legacySpawnFailureCarrier({ detail: "Start failed: boom", runtime: "codex", machineRuntimes: [] }), { reason: "runtime_spawn_failed" });
});

test("only an offline frame with no detail kind and a fixed failed-start message is a Computer < 1.0.16 failed start", () => {
  assert.equal(isLegacyUnkindedStartFailure({ detailKind: undefined, activity: "offline", detail: LEGACY_RUNTIME_NOT_FOUND_DETAIL }), true);
  assert.equal(isLegacyUnkindedStartFailure({ detailKind: undefined, activity: "offline", detail: "Start failed: spawn EACCES" }), true);
  assert.equal(isLegacyUnkindedStartFailure({ detailKind: undefined, activity: "offline", detail: "Runtime interrupted" }), false);
  assert.equal(isLegacyUnkindedStartFailure({ detailKind: undefined, activity: "online", detail: LEGACY_RUNTIME_NOT_FOUND_DETAIL }), false);
  assert.equal(isLegacyUnkindedStartFailure({ detailKind: "runtime_unavailable", activity: "offline", detail: LEGACY_RUNTIME_NOT_FOUND_DETAIL }), false, "kinded frames take the runtime_unavailable path");
});

test("only the old daemons' fixed failed-start messages mark a carrier-less frame as a failed start", () => {
  assert.equal(isLegacyStartFailureDetail(LEGACY_RUNTIME_NOT_FOUND_DETAIL), true);
  assert.equal(isLegacyStartFailureDetail("Runtime failed to start. Check the Computer logs for details and retry."), true);
  assert.equal(isLegacyStartFailureDetail("Start failed: spawn EACCES"), true);
  // A probe of a stopped agent answers with the same kind and no carrier.
  assert.equal(isLegacyStartFailureDetail("Agent not running"), false);
  assert.equal(isLegacyStartFailureDetail(undefined), false);
});
