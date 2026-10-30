// Hourly per-subject budget for trace bundle uploads: a count cap and a byte
// cap, keyed by server + attested subject (always `machine:<id>` today).
// Baseline 10-14: per machine-hour p50 10, p99 24, p99.9 40, max 222 uploads,
// so 300/hour only stops a runaway or replayed token; the byte cap bounds the
// "repeat 50 MB bundles" storage cost.
//
// Counted in this process's memory, not in the bundle store (no per-upload
// store round trip or cost, nothing to clean up). Uploads are spread across
// the trace-upload tasks, so the effective cap is the configured one times the
// task count: prod runs 1-4 tasks (2 by default), i.e. at most 1,200 uploads /
// 4 GiB per machine-hour. A task restart starts its counts from zero.
//
// `observe` (the default) never rejects: an upload over either cap is logged
// as `[TraceUploadRateLimit] over_limit` and allowed. `enforce` answers 429.
import type { TraceUploadWorkerEnv } from "../env";
import { HttpError } from "../shared/http";

export const TRACE_UPLOAD_HOURLY_LIMIT = 300;
export const TRACE_UPLOAD_HOURLY_BYTES_LIMIT = 1024 * 1024 * 1024;
/** Bounds memory if subjects explode; past it, new subjects are not counted this hour. */
const MAX_TRACKED_SUBJECTS = 100_000;

export type TraceUploadRateLimitMode = "observe" | "enforce";

interface TraceUploadBudgetInput {
  serverId: string;
  subjectId: string;
  bundleSizeBytes: number;
}

let currentHour = "";
const counters = new Map<string, { count: number; bytes: number }>();

export function chargeTraceUploadBudget(env: TraceUploadWorkerEnv, input: TraceUploadBudgetInput, now = new Date()): void {
  const limit = readNonNegativeInteger(env.TRACE_UPLOAD_HOURLY_LIMIT, TRACE_UPLOAD_HOURLY_LIMIT);
  const bytesLimit = readNonNegativeInteger(env.TRACE_UPLOAD_HOURLY_BYTES_LIMIT, TRACE_UPLOAD_HOURLY_BYTES_LIMIT);
  if (limit <= 0 && bytesLimit <= 0) return;
  const mode = readMode(env.TRACE_UPLOAD_RATE_LIMIT_MODE);

  const hour = now.toISOString().slice(0, 13);
  if (hour !== currentHour) {
    // Only the current hour is ever read, so earlier hours are dropped whole.
    counters.clear();
    currentHour = hour;
  }
  const key = `${input.serverId}\u0000${input.subjectId}`;
  const current = counters.get(key) ?? { count: 0, bytes: 0 };
  const count = current.count + 1;
  const bytes = current.bytes + input.bundleSizeBytes;
  const overCount = limit > 0 && count > limit;
  const overBytes = bytesLimit > 0 && bytes > bytesLimit;

  if (overCount || overBytes) {
    // No IP, token or object key: server, subject and the hour's totals only.
    console.warn("[TraceUploadRateLimit] over_limit", {
      mode,
      server_id: input.serverId,
      subject_id: input.subjectId,
      count,
      bytes,
      limit,
      bytes_limit: bytesLimit,
      reason: overCount ? "count" : "bytes",
    });
    if (mode === "enforce") throw new HttpError(429, "Trace bundle upload rate limit exceeded");
  }

  if (counters.has(key) || counters.size < MAX_TRACKED_SUBJECTS) counters.set(key, { count, bytes });
}

/** Test helper: forget all counts. */
export function resetTraceUploadBudgetsForTest(): void {
  counters.clear();
  currentHour = "";
}

function readNonNegativeInteger(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function readMode(raw: string | undefined): TraceUploadRateLimitMode {
  return raw === "enforce" ? "enforce" : "observe";
}
