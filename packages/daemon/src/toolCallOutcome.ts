import type { ToolCallOutcome } from "@botiverse/raft-shared";

/**
 * Per-launch bookkeeping that turns a runtime's tool start/end events into the
 * outcome recorded on the "Tool finished" activity entry. Durations are taken
 * here, at the daemon: the server stamps entries with its own receive time,
 * which includes network delay and is shared by every entry in a frame.
 */

/** Calls still open; a runtime that never ends a call must not grow this forever. */
export const MAX_OPEN_TOOL_CALLS = 256;

export function noteToolCallStart(starts: Map<string, number>, callId: string | undefined, nowMs: number): void {
  if (!callId) return;
  starts.delete(callId);
  starts.set(callId, nowMs);
  while (starts.size > MAX_OPEN_TOOL_CALLS) {
    const oldest = starts.keys().next().value;
    if (oldest === undefined) break;
    starts.delete(oldest);
  }
}

/**
 * The outcome of a finished call, or undefined when the runtime reported
 * nothing about it (no id, no result, no timing). The runtime's own duration
 * wins over the daemon's measurement.
 */
export function finishToolCall(
  starts: Map<string, number>,
  end: { callId?: string; ok?: boolean; durationMs?: number; exitCode?: number },
  nowMs: number,
): ToolCallOutcome | undefined {
  const startedAt = end.callId ? starts.get(end.callId) : undefined;
  if (end.callId) starts.delete(end.callId);
  const durationMs = validDuration(end.durationMs) ?? (startedAt !== undefined ? validDuration(nowMs - startedAt) : undefined);
  const outcome: ToolCallOutcome = {
    ...(end.callId ? { callId: end.callId } : {}),
    ...(typeof end.ok === "boolean" ? { ok: end.ok } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(Number.isInteger(end.exitCode) ? { exitCode: end.exitCode } : {}),
  };
  return Object.keys(outcome).length > 0 ? outcome : undefined;
}

function validDuration(ms: number | undefined): number | undefined {
  return typeof ms === "number" && Number.isFinite(ms) && ms >= 0 ? Math.round(ms) : undefined;
}
