import assert from "node:assert/strict";
import { AGENT_API_UNCLASSIFIED_ERROR_CODE, agentApiErrorCodeFromBody, agentApiErrorTrace, taskStatusRejectionCode } from "./agentApiErrorTrace";
import { requestTraceReasonClassForStatus, setRequestTraceErrorCode } from "../middleware/requestObservability";

function respond(status: number, body: unknown, preset?: string) {
  const res: any = { statusCode: status, locals: {}, json: (b: unknown) => b };
  agentApiErrorTrace({} as never, res, () => {});
  if (preset) setRequestTraceErrorCode(res, preset);
  res.json(body);
  return res.locals as { traceErrorCode?: string; traceReasonClass?: string };
}

test("a 4xx takes the route's code first, then the body's, then unclassified; never free text", () => {
  assert.deepEqual(respond(404, { error: "Channel not found" }, "channel_not_found"), { traceErrorCode: "channel_not_found", traceReasonClass: "not_found" });
  assert.deepEqual(respond(409, { error: "Assignee @bob is ambiguous", code: "assignee_ambiguous" }), { traceErrorCode: "assignee_ambiguous", traceReasonClass: "conflict" });
  assert.deepEqual(respond(400, { error: "x", errorCode: "INVALID_ARG" }), { traceErrorCode: "invalid_arg", traceReasonClass: "invalid_input" });
  assert.deepEqual(respond(404, { status: "NOT_JOINABLE" }), { traceErrorCode: "not_joinable", traceReasonClass: "not_found" });
  assert.deepEqual(respond(403, { error: { code: "not_member", message: "no" } }), { traceErrorCode: "not_member", traceReasonClass: "forbidden" });
  assert.deepEqual(respond(404, { error: "User or agent not found: @alice" }), { traceErrorCode: AGENT_API_UNCLASSIFIED_ERROR_CODE, traceReasonClass: "not_found" });
  assert.deepEqual(respond(200, { ok: true }), {}, "a success records nothing");
  assert.deepEqual(respond(500, { code: "boom" }), {}, "5xx keeps its own path");
});

test("only code-shaped values count as codes", () => {
  assert.equal(agentApiErrorCodeFromBody({ code: "has spaces in it" }), null);
  assert.equal(agentApiErrorCodeFromBody({ code: "@alice" }), null);
  assert.equal(agentApiErrorCodeFromBody({ code: "x".repeat(65) }), null);
  assert.equal(agentApiErrorCodeFromBody({ code: "rate.limited:v2" }), "rate.limited:v2");
  assert.equal(agentApiErrorCodeFromBody(null), null);
});

test("statuses map to a closed set of classes", () => {
  assert.deepEqual([400, 401, 403, 404, 409, 410, 413, 422, 429, 418, 200, 503].map(requestTraceReasonClassForStatus), [
    "invalid_input", "forbidden", "forbidden", "not_found", "conflict", "gone", "invalid_input", "invalid_input", "rate_limited", "client_error", null, null,
  ]);
});

test("a refused task status change gets a code from the task service's message, never the message itself", () => {
  assert.deepEqual([
    "task not found",
    "resource receipt required before task can move to done",
    "already done",
    "cannot transition from done to todo",
    "task must be claimed before moving to in_progress",
    "task start state changed concurrently",
    "status changed concurrently",
    "something new",
  ].map(taskStatusRejectionCode), [
    "task_not_found", "task_resource_receipt_required", "task_status_unchanged", "task_status_transition_invalid",
    "task_not_claimed", "task_state_conflict", "task_state_conflict", "task_status_rejected",
  ]);
});
