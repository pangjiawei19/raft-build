import assert from "node:assert/strict";
import { test } from "vitest";
import type { AgentMessage, TrajectoryEntry } from "@botiverse/raft-shared";
import { TurnSummaryTracker, turnOutcomeForActivity, turnTriggerFromMessages } from "./turnSummaryTracker";

const toolStart: TrajectoryEntry = { kind: "tool_start", toolName: "Bash", toolInput: "git push origin HEAD", callId: "c1" };
const toolEnd: TrajectoryEntry = { kind: "status", activity: "working", detail: "Tool finished", detailKind: "tool_end", tool: { callId: "c1", ok: false } };

test("a turn opened by begin folds entries and send outcomes until finish", () => {
  const tracker = new TurnSummaryTracker();
  assert.deepEqual(tracker.begin("a", 10, { target: "#general", sender: "richard", messageId: "m1" }), []);
  tracker.observe("a", [toolStart, { kind: "thinking", text: "x" }], 11);
  tracker.observe("a", [toolEnd], 12);
  tracker.noteSendOutcome("a", { state: "held" }, 13);
  tracker.noteSendOutcome("a", { state: "sent", messageId: "r1" }, 14);
  const [entry] = tracker.finish("a", "completed", 20);
  assert.ok(entry?.kind === "turn_summary");
  assert.deepEqual(entry.summary, {
    v: 1,
    startedAt: 10,
    endedAt: 20,
    outcome: "completed",
    trigger: { target: "#general", sender: "richard", messageId: "m1" },
    actions: [{ kind: "version_control", count: 1 }],
    toolCalls: 1,
    problems: [
      { kind: "version_control", reason: "call_failed", at: 12 },
      { kind: "send_message", reason: "send_held", at: 13 },
    ],
    problemCount: 2,
    messagesSent: 1,
    lastReplyMessageId: "r1",
  });
  assert.deepEqual(tracker.finish("a", "completed", 21), [], "a turn is summarized once");
});

test("a new turn closes one that never ended; tool activity without a begin opens a turn without trigger", () => {
  const tracker = new TurnSummaryTracker();
  tracker.observe("a", [toolStart], 5);
  const [previous] = tracker.begin("a", 30, undefined, "failed");
  assert.ok(previous?.kind === "turn_summary");
  assert.equal(previous.summary.outcome, "failed");
  assert.equal(previous.summary.startedAt, 5);
  assert.equal(previous.summary.trigger, undefined);
  tracker.noteSendOutcome("b", { state: "sent", messageId: "x" }, 31);
  assert.deepEqual(tracker.finish("b", "completed", 32), [], "no turn, no summary");
});

test("the turn ends on idle, stop and crash frames only", () => {
  assert.equal(turnOutcomeForActivity("online", "idle"), "completed");
  assert.equal(turnOutcomeForActivity("offline", "stopped"), "interrupted");
  assert.equal(turnOutcomeForActivity("offline", "runtime_crashed"), "failed");
  assert.equal(turnOutcomeForActivity("offline", "runtime_unavailable"), "failed");
  assert.equal(turnOutcomeForActivity("error", "runtime_error"), null, "a runtime error may still recover within the turn");
  assert.equal(turnOutcomeForActivity("working", "tool_end"), null);
});

test("the trigger is the first message's reply target, sender and id", () => {
  const message = (overrides: Partial<AgentMessage>): AgentMessage => ({
    channel_id: "c", channel_name: "proj-runtime", channel_type: "channel", sender_id: "u", sender_name: "Tenny",
    sender_type: "agent", content: "hi", timestamp: "2026-10-16T00:00:00Z", message_id: "07a75d55-0000", ...overrides,
  });
  assert.deepEqual(turnTriggerFromMessages([message({})]), { target: "#proj-runtime", channelId: "c", sender: "Tenny", messageId: "07a75d55-0000" });
  assert.deepEqual(
    turnTriggerFromMessages([message({ channel_type: "thread", channel_name: "thread-9b526607", parent_channel_name: "proj-runtime", parent_channel_type: "channel" })])?.target,
    "#proj-runtime:9b526607",
  );
  assert.equal(turnTriggerFromMessages([]), undefined);
});
