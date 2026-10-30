// The one place that POSTs OTLP/HTTP JSON to the Telescope collector. Every
// post is bounded by a per-route timeout (web: TRACE_INGEST_OTLP_TIMEOUT_MS;
// background bundle ingest: TRACE_INGEST_BUNDLE_OTLP_TIMEOUT_MS) and every failure becomes an
// OtlpSinkError (503) with a bounded reason, so a slow or refusing collector
// fails requests fast instead of holding them until the ALB idle timeout.
import type { TraceUploadWorkerEnv } from "../env";
import { HttpError } from "../shared/http";

// Prod trace-upload target response p99 is 1.1-1.9s hourly, p99.9 ~5.8s; 10s
// clears the healthy tail while staying well under the ALB 60s idle timeout.
export const DEFAULT_OTLP_TIMEOUT_MS = 10_000;
const MIN_OTLP_TIMEOUT_MS = 1_000;
const MAX_OTLP_TIMEOUT_MS = 55_000;
// Bundle ingest runs after the upload already answered 200, so it is not bound
// by the ALB and has no automatic replay: a slow-but-successful collector must
// still get the batch. Bound it only so a dead collector cannot hang it forever.
export const DEFAULT_BUNDLE_OTLP_TIMEOUT_MS = 55_000;
const MAX_BUNDLE_OTLP_TIMEOUT_MS = 120_000;

export const OTLP_SINK_RETRY_AFTER_SECONDS = 30;

export type OtlpSinkFailureReason = "sink_timeout" | "sink_refused" | "sink_http" | "sink_network";

export type OtlpSinkRoute = "web" | "web_events" | "bundle" | "bundle_logs";

export class OtlpSinkError extends HttpError {
  override readonly name = "OtlpSinkError";
  override readonly retryAfterSeconds = OTLP_SINK_RETRY_AFTER_SECONDS;

  constructor(
    readonly reason: OtlpSinkFailureReason,
    message: string,
    readonly sinkStatus: number | null = null,
  ) {
    super(503, message);
  }
}

type OtlpTimeoutEnv = Pick<TraceUploadWorkerEnv, "TRACE_INGEST_OTLP_TIMEOUT_MS" | "TRACE_INGEST_BUNDLE_OTLP_TIMEOUT_MS">;

export function getConfiguredOtlpTimeoutMs(env: OtlpTimeoutEnv, route: OtlpSinkRoute = "web"): number {
  return route === "bundle" || route === "bundle_logs"
    ? parseTimeout(env.TRACE_INGEST_BUNDLE_OTLP_TIMEOUT_MS, DEFAULT_BUNDLE_OTLP_TIMEOUT_MS, MAX_BUNDLE_OTLP_TIMEOUT_MS)
    : parseTimeout(env.TRACE_INGEST_OTLP_TIMEOUT_MS, DEFAULT_OTLP_TIMEOUT_MS, MAX_OTLP_TIMEOUT_MS);
}

function parseTimeout(value: string | undefined, fallback: number, max: number): number {
  const raw = value?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(MIN_OTLP_TIMEOUT_MS, parsed));
}

export async function postOtlpJson(
  env: TraceUploadWorkerEnv,
  route: OtlpSinkRoute,
  endpoint: string,
  payload: unknown,
  items: number,
): Promise<void> {
  const fetchImpl = env.TRACE_INGEST_FETCH ?? fetch;
  const timeoutMs = getConfiguredOtlpTimeoutMs(env, route);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(env.TRACE_INGEST_OTLP_AUTHORIZATION ? { Authorization: env.TRACE_INGEST_OTLP_AUTHORIZATION } : {}),
  };
  const signal = AbortSignal.timeout(timeoutMs);
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    const timedOut = signal.aborted || isAbortError(err);
    throw sinkFailure(
      route,
      items,
      startedAt,
      timedOut
        ? new OtlpSinkError("sink_timeout", `OTLP sink timed out after ${timeoutMs}ms`)
        : new OtlpSinkError("sink_network", `OTLP sink request failed: ${err instanceof Error ? err.name : "Error"}`),
    );
  }
  if (!response.ok) {
    // The body read shares the abort signal, so a stalled error body cannot hang either.
    const body = await response.text().catch(() => "");
    const reason: OtlpSinkFailureReason = response.status === 503 || response.status === 429 ? "sink_refused" : "sink_http";
    throw sinkFailure(
      route,
      items,
      startedAt,
      new OtlpSinkError(reason, `OTLP HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`, response.status),
    );
  }
  // Read the (small) success body to completion so the keep-alive connection is
  // returned to the pool; cancelling the stream can close the socket instead.
  await response.text().catch(() => "");
}

function sinkFailure(route: OtlpSinkRoute, items: number, startedAt: number, error: OtlpSinkError): OtlpSinkError {
  console.warn(
    `[TraceUploadWorker] otlp sink failed reason=${error.reason} route=${route} items=${items} status=${error.sinkStatus ?? "-"} duration_ms=${Date.now() - startedAt}`,
  );
  return error;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}
