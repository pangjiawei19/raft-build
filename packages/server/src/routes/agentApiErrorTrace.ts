import type { NextFunction, Request, Response } from "express";
import { requestTraceErrorCode, requestTraceReasonClassForStatus, setRequestTraceErrorCode } from "../middleware/requestObservability";

// Every 4xx an agent gets from /internal/agent-api is classified on the
// server.http.request span (error_code + reason_class), so "why do agents hit
// walls" can be counted (o11y trace gap T1). Codes and classes only: the
// body's free text (which can carry handles, channel names, ids) never goes on
// the span.

/** A body field that is a stable code: short, no spaces or punctuation beyond _ . : - */
const CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;

/** Fallback when a 4xx body carries no code; counted so routes still missing one can be found. */
export const AGENT_API_UNCLASSIFIED_ERROR_CODE = "unclassified";

/** The stable code a 4xx body carries (`code`, `errorCode`, `error.code` or a bare `status`), lower-cased. */
export function agentApiErrorCodeFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const nested = b.error && typeof b.error === "object" ? (b.error as Record<string, unknown>).code : undefined;
  for (const candidate of [b.code, b.errorCode, nested, b.status]) {
    if (typeof candidate === "string" && CODE_PATTERN.test(candidate)) return candidate.toLowerCase();
  }
  return null;
}

/** Wraps res.json: on a 4xx, record the route's code (or the body's, or `unclassified`) and its class. */
export function agentApiErrorTrace(_req: Request, res: Response, next: NextFunction): void {
  const json = res.json.bind(res);
  res.json = ((body?: unknown) => {
    const reasonClass = requestTraceReasonClassForStatus(res.statusCode);
    if (reasonClass) {
      const code = requestTraceErrorCode(res) ?? agentApiErrorCodeFromBody(body) ?? AGENT_API_UNCLASSIFIED_ERROR_CODE;
      setRequestTraceErrorCode(res, code, reasonClass);
    }
    return json(body);
  }) as Response["json"];
  next();
}

/** The span code for a task status change the task service refused (its message is free text). */
export function taskStatusRejectionCode(message: string): string {
  if (message === "task not found") return "task_not_found";
  if (message.startsWith("resource receipt")) return "task_resource_receipt_required";
  if (message.startsWith("already ")) return "task_status_unchanged";
  if (message.startsWith("cannot transition")) return "task_status_transition_invalid";
  if (message.startsWith("task must be claimed")) return "task_not_claimed";
  if (message.includes("concurrently")) return "task_state_conflict";
  return "task_status_rejected";
}
