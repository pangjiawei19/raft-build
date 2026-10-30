import assert from "node:assert/strict";

import { finishToolCall, MAX_OPEN_TOOL_CALLS, noteToolCallStart } from "./toolCallOutcome";

test("the daemon measures a call from its start to its end by call id", () => {
  const starts = new Map<string, number>();
  noteToolCallStart(starts, "a", 1_000);
  noteToolCallStart(starts, "b", 1_200);
  assert.deepEqual(finishToolCall(starts, { callId: "b", ok: true }, 1_700), { callId: "b", ok: true, durationMs: 500 });
  assert.deepEqual(finishToolCall(starts, { callId: "a", ok: false }, 3_000), { callId: "a", ok: false, durationMs: 2_000 });
  assert.equal(starts.size, 0, "finished calls are forgotten");
});

test("the runtime's own duration wins; nonsense durations are dropped", () => {
  const starts = new Map<string, number>();
  noteToolCallStart(starts, "a", 1_000);
  assert.deepEqual(finishToolCall(starts, { callId: "a", durationMs: 42.6 }, 9_000), { callId: "a", durationMs: 43 });
  noteToolCallStart(starts, "b", 1_000);
  assert.deepEqual(finishToolCall(starts, { callId: "b", durationMs: -1 }, 1_010), { callId: "b", durationMs: 10 });
});

test("an end the runtime said nothing about yields no outcome; an unknown id still reports what it has", () => {
  const starts = new Map<string, number>();
  assert.equal(finishToolCall(starts, {}, 5), undefined);
  assert.deepEqual(finishToolCall(starts, { callId: "never-started", ok: true, exitCode: 2 }, 5), { callId: "never-started", ok: true, exitCode: 2 });
});

test("open calls are bounded so a runtime that never ends a call cannot grow the map", () => {
  const starts = new Map<string, number>();
  for (let i = 0; i < MAX_OPEN_TOOL_CALLS + 10; i++) noteToolCallStart(starts, `c${i}`, i);
  assert.equal(starts.size, MAX_OPEN_TOOL_CALLS);
  assert.equal(starts.has("c0"), false, "the oldest open call is dropped first");
  assert.equal(starts.has(`c${MAX_OPEN_TOOL_CALLS + 9}`), true);
});
