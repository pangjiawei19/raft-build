import type { SpawnFailureActivityDiagnostic } from "@botiverse/raft-shared";

/**
 * Failed-start frames from daemons older than the typed `spawnFailure`
 * carrier (Computer < 1.0.34). Without a reason the wake breaker never counted
 * them, so an agent whose runtime could not start (a codex agent on a computer
 * without the Codex CLI) was woken again on every automatic wake, forever.
 *
 * Those daemons chose a fixed user message per failure class. The
 * "not found" one was picked for any error text containing "not found", so on
 * its own it does not prove the runtime is missing; it does when the
 * computer's own `ready` runtime list (same lookup as the start) also lacks
 * the agent's runtime. Every other legacy failed start still counts, as
 * `runtime_spawn_failed`, toward the ordinary failed-start threshold.
 */
export const LEGACY_RUNTIME_NOT_FOUND_DETAIL = "Runtime executable not found. Ensure the required CLI is installed and available on PATH.";
// The other fixed failed-start messages of those daemons. Only these mark a
// failed start: a carrier-less frame of the same kind can be something else
// (a probe answering "Agent not running").
const LEGACY_START_FAILURE_DETAILS = new Set([
  LEGACY_RUNTIME_NOT_FOUND_DETAIL,
  "Runtime failed to start. Check the Computer logs for details and retry.",
  "Local agent proxy could not start. Check if another daemon or service is using the required local port.",
  "Runner credential mint failed. Ensure the server is deployed and the daemon binary is compatible.",
]);
// Computer < 1.0.16 prefixed the raw error instead of the generic message.
const LEGACY_START_FAILED_PREFIX = "Start failed: ";

export function isLegacyStartFailureDetail(detail: unknown): boolean {
  return typeof detail === "string" && (LEGACY_START_FAILURE_DETAILS.has(detail) || detail.startsWith(LEGACY_START_FAILED_PREFIX));
}

/**
 * A frame with no `detailKind` (Computer < 1.0.16) reported a failed start
 * only as an offline activity carrying one of the fixed messages.
 */
export function isLegacyUnkindedStartFailure(input: { detailKind: unknown; activity: unknown; detail: unknown }): boolean {
  return input.detailKind === undefined && input.activity === "offline" && isLegacyStartFailureDetail(input.detail);
}

/**
 * The reason a carrier-less failed start is counted under. `machineRuntimes`
 * is the runtime list the computer reported at `ready`; null when unknown, in
 * which case absence cannot be confirmed.
 */
export function legacySpawnFailureCarrier(input: {
  detail: unknown;
  runtime: string;
  machineRuntimes: readonly string[] | null;
}): SpawnFailureActivityDiagnostic {
  const runtimeAbsent = input.detail === LEGACY_RUNTIME_NOT_FOUND_DETAIL
    && input.machineRuntimes !== null
    && !input.machineRuntimes.includes(input.runtime);
  return { reason: runtimeAbsent ? "runtime_not_found" : "runtime_spawn_failed" };
}
