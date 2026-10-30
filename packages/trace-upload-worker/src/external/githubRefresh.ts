// External (antiproton) GitHub connector refresh outcomes:
// POST /api/external/github-refresh → OTLP logs (otel.logs, service.name=antiproton).
//
// Antiproton's own logs drop lines for busy agents, so alerting on connector
// refreshes reads these rows instead. The worker is the only boundary: a
// dedicated bearer token (never the ScopeDB key), one allowlisted kind, a fixed
// field set (anything else is dropped), and ids + fixed codes only. Rows are
// keyed by (tenant_id, agent_id, seq) so retried batches are deduplicated at
// query time.
import type { TraceUploadWorkerEnv } from "../env";
import { constantTimeEqual } from "../shared/auth";
import { HttpError, jsonResponse, readJsonObjectWithLimit, type JsonObject } from "../shared/http";
import { compactAttributes, postOtlpLogBatch } from "../traces/otlp";

export const GITHUB_REFRESH_PATH = "/api/external/github-refresh";
export const GITHUB_REFRESH_EVENT_NAME = "antiproton.github.refresh";
const MAX_ROWS = 500;
const MAX_BYTES = 256 * 1024;

export const GITHUB_REFRESH_OUTCOMES = [
  "rotated",
  "adopted",
  "broken",
  "unavailable",
  "store-failed",
  "kept-unstored",
  "interrupted-before",
  "propagate-failed",
] as const;
const OUTCOMES = new Set<string>(GITHUB_REFRESH_OUTCOMES);
const ENVS = new Set(["production", "preview"]);

// Bounded identifier/code strings: no free text gets through.
const ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const CODE_RE = /^[a-z0-9_.:-]{1,64}$/;

export interface GithubRefreshRow {
  at: string;
  tenant_id: string;
  agent_id: string;
  seq: number;
  env: string;
  outcome: string;
  scope?: string;
  connector_id?: string;
  mount?: string;
  why?: string;
  attempt?: number;
  stored?: boolean;
  reason_code?: string;
}

export async function ingestGithubRefreshBatch(request: Request, env: TraceUploadWorkerEnv): Promise<Response> {
  authorize(request, env);
  const body = await readJsonObjectWithLimit(request, MAX_BYTES);
  if (!Array.isArray(body.rows)) throw rejected(400, "rows_missing");
  if (body.rows.length > MAX_ROWS) throw rejected(413, "too_many_rows");
  const rows = body.rows.map((row, index) => readRow(row, index));
  // No sink = nowhere to put the rows. Answering 2xx would let the sender
  // advance its cursor and lose them silently, so ask it to retry instead.
  if (!env.TRACE_INGEST_OTLP_ENDPOINT) throw rejected(503, "sink_not_configured");
  if (rows.length > 0) {
    await postOtlpLogBatch(
      env,
      compactAttributes({
        "service.name": "antiproton",
        "service.revision": env.SLOCK_RELEASE_SHA,
        "deployment.environment": env.DEPLOYMENT_ENV,
        "telemetry.sdk.name": "slock-trace-upload-external",
      }),
      "antiproton/github-refresh",
      rows.map((row) => ({
        eventKey: `${row.tenant_id}:${row.agent_id}:${row.seq}`,
        record: {
          type: "event",
          schema_version: 1,
          name: GITHUB_REFRESH_EVENT_NAME,
          surface: "antiproton",
          time: row.at,
          attrs: {
            tenant_id: row.tenant_id,
            agent_id: row.agent_id,
            seq: row.seq,
            antiproton_env: row.env,
            outcome: row.outcome,
            scope: row.scope,
            connector_id: row.connector_id,
            mount: row.mount,
            why: row.why,
            attempt: row.attempt,
            stored: row.stored,
            reason_code: row.reason_code,
          },
        },
      })),
      "web_events",
    );
  }
  return jsonResponse({ ok: true, accepted: rows.length });
}

function authorize(request: Request, env: TraceUploadWorkerEnv): void {
  const expected = env.EXTERNAL_GITHUB_REFRESH_TOKEN?.trim();
  // Unconfigured = endpoint off; answer like an unknown route.
  if (!expected) throw new HttpError(404, "Not found");
  const header = request.headers.get("Authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!presented || !constantTimeEqual(presented, expected)) throw rejected(401, "bad_token");
}

function readRow(value: unknown, index: number): GithubRefreshRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw rejected(400, "row_not_object", index);
  const row = value as JsonObject;
  if (row.kind !== undefined && row.kind !== "github.refresh") throw rejected(400, "kind_not_allowed", index);
  const at = typeof row.at === "string" && !Number.isNaN(Date.parse(row.at)) ? new Date(row.at).toISOString() : null;
  if (!at) throw rejected(400, "at_invalid", index);
  const tenant = id(row.tenant_id);
  const agent = id(row.agent_id);
  if (!tenant || !agent) throw rejected(400, "identity_invalid", index);
  if (!Number.isSafeInteger(row.seq) || (row.seq as number) < 0) throw rejected(400, "seq_invalid", index);
  if (typeof row.env !== "string" || !ENVS.has(row.env)) throw rejected(400, "env_invalid", index);
  if (typeof row.outcome !== "string" || !OUTCOMES.has(row.outcome)) throw rejected(400, "outcome_invalid", index);
  return {
    at,
    tenant_id: tenant,
    agent_id: agent,
    seq: row.seq as number,
    env: row.env,
    outcome: row.outcome,
    scope: code(row.scope),
    connector_id: id(row.connector_id),
    mount: id(row.mount),
    why: code(row.why),
    attempt: Number.isSafeInteger(row.attempt) && (row.attempt as number) >= 0 ? (row.attempt as number) : undefined,
    stored: typeof row.stored === "boolean" ? row.stored : undefined,
    reason_code: code(row.reason_code),
  };
}

function id(value: unknown): string | undefined {
  return typeof value === "string" && ID_RE.test(value) ? value : undefined;
}

function code(value: unknown): string | undefined {
  return typeof value === "string" && CODE_RE.test(value) ? value : undefined;
}

// Rejections log one bounded line (status + reason, never the body) so a stuck
// sender shows up in the worker's own logs even when nothing reaches ScopeDB.
function rejected(status: number, reason: string, index?: number): HttpError {
  console.warn(`[TraceUploadWorker] external github-refresh rejected status=${status} reason=${reason}${index === undefined ? "" : ` row=${index}`}`);
  return new HttpError(status, reason);
}
