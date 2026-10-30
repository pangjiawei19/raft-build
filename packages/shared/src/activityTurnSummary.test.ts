import assert from "node:assert/strict";
import { test } from "vitest";
import { ACTIVITY_TURN_PROBLEM_LIMIT, ActivityTurnAccumulator, classifyShellCommand, classifyToolCall } from "./activityTurnSummary";
import type { TrajectoryEntry } from "./index";

test("shell commands classify by their leading program, prefixes stripped", () => {
  assert.equal(classifyShellCommand("grep -rn foo src | head"), "search");
  assert.equal(classifyShellCommand("cd /repo/packages/server && sed -n 1,40p src/a.ts"), "read_file");
  assert.equal(classifyShellCommand("export PATH=/x:$PATH; npx vitest run src/a.test.ts"), "run_checks");
  assert.equal(classifyShellCommand("NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit"), "run_checks");
  assert.equal(classifyShellCommand("pnpm --filter @botiverse/raft-web test settings"), "run_checks");
  assert.equal(classifyShellCommand("git push origin HEAD:refs/heads/agent/x"), "version_control");
  assert.equal(classifyShellCommand("stamp pr merge 9983 --repo botiverse/slock"), "version_control");
  assert.equal(classifyShellCommand("python3 - <<'EOF'\nprint(1)\nEOF"), "run_command");
  // Only the first line decides: a later `vitest` in a heredoc body does not.
  assert.equal(classifyShellCommand("grep -n test package.json\nnpx vitest"), "search");
});

test("tool calls classify across runtime tool names and Raft CLI commands", () => {
  assert.equal(classifyToolCall("Read", "src/a.ts"), "read_file");
  assert.equal(classifyToolCall("StrReplaceFile", "src/a.ts"), "edit_file");
  assert.equal(classifyToolCall("command_execution", "git status"), "version_control");
  assert.equal(classifyToolCall("Bash", "raft message send --target \"#proj-runtime:9b526607\" <<'RAFTMSG'"), "send_message");
  assert.equal(classifyToolCall("Bash", "raft message read --target \"#proj-runtime:9b526607\" --unread"), "read_messages");
  assert.equal(classifyToolCall("Bash", "raft task claim --channel \"#proj-runtime\" --number 17"), "raft_action");
  assert.equal(classifyToolCall("send_message", ""), "send_message");
  assert.equal(classifyToolCall("WebSearch", "oar"), "web");
  assert.equal(classifyToolCall("mcp__linear__create_issue", ""), "mcp");
  assert.equal(classifyToolCall("SomethingNew", ""), "other");
  // External hooks carry the tool input as JSON.
  assert.equal(classifyToolCall("Bash", JSON.stringify({ command: "npx vitest run", description: "Run tests" })), "run_checks");
  assert.equal(classifyToolCall("Bash", JSON.stringify({ command: "raft message send --target \"#general\" <<'M'" })), "send_message");
  assert.equal(classifyToolCall("Read", JSON.stringify({ file_path: "src/a.ts" })), "read_file");
});

const start = (toolName: string, toolInput: string, callId?: string): TrajectoryEntry => ({ kind: "tool_start", toolName, toolInput, ...(callId ? { callId } : {}) });
const end = (tool: { callId?: string; ok?: boolean; exitCode?: number; durationMs?: number }): TrajectoryEntry => ({
  kind: "status", activity: "working", detail: "Tool finished", detailKind: "tool_end", tool,
});

test("a turn folds into counts, problems and the last reply", () => {
  const acc = new ActivityTurnAccumulator(1_000, { target: "#proj-runtime:9b526607", sender: "Tenny", messageId: "07a75d55" });
  acc.addEntry(start("Bash", "raft message read --target \"#proj-runtime:9b526607\" --unread", "t1"), 1_100);
  acc.addEntry(end({ callId: "t1", ok: true }), 1_200);
  acc.addEntry(start("Bash", "grep -rn listRecentActivityLog src", "t2"), 1_300);
  acc.addEntry(start("Bash", "sed -n 1,40p src/a.ts", "t3"), 1_310);
  acc.addEntry(end({ callId: "t3", ok: true }), 1_320);
  acc.addEntry(end({ callId: "t2", ok: true }), 1_330);
  acc.addEntry(start("Bash", "npx vitest run src/routes/agents.api.test.ts", "t4"), 1_400);
  acc.addEntry(end({ callId: "t4", ok: true, exitCode: 1, durationMs: 6200 }), 7_600);
  acc.addEntry(start("Edit", "src/routes/agents.api.test.ts", "t5"), 7_700);
  acc.addEntry(end({ callId: "t5", ok: false }), 7_710);
  acc.addEntry({ kind: "thinking", text: "" }, 7_720);
  acc.noteSendHeld(7_800);
  acc.noteMessageSent("ae33b93f");
  acc.noteMessageSent("d2c98a0b");

  assert.deepEqual(acc.finish("completed", 8_000), {
    v: 1,
    startedAt: 1_000,
    endedAt: 8_000,
    outcome: "completed",
    trigger: { target: "#proj-runtime:9b526607", sender: "Tenny", messageId: "07a75d55" },
    actions: [
      { kind: "read_messages", count: 1 },
      { kind: "search", count: 1 },
      { kind: "read_file", count: 1 },
      { kind: "run_checks", count: 1 },
      { kind: "edit_file", count: 1 },
    ],
    toolCalls: 5,
    problems: [
      { kind: "run_checks", reason: "exit_nonzero", exitCode: 1, at: 7_600 },
      { kind: "edit_file", reason: "call_failed", at: 7_710 },
      { kind: "send_message", reason: "send_held", at: 7_800 },
    ],
    problemCount: 3,
    messagesSent: 2,
    lastReplyMessageId: "d2c98a0b",
  });
});

test("ends without a call id pair up in order; an unknown outcome is not a problem", () => {
  const acc = new ActivityTurnAccumulator(0);
  acc.addEntry(start("Bash", "git status"), 1);
  acc.addEntry(start("Read", "a.ts"), 2);
  acc.addEntry(end({ ok: false }), 3);
  acc.addEntry(end({}), 4);
  acc.addEntry(end({ callId: "nobody", exitCode: 0 }), 5);
  const summary = acc.finish("interrupted", 6);
  assert.deepEqual(summary.problems, [{ kind: "version_control", reason: "call_failed", at: 3 }]);
  assert.equal(summary.trigger, undefined);
  assert.equal(summary.lastReplyMessageId, undefined);
});

test("problems are capped but still counted", () => {
  const acc = new ActivityTurnAccumulator(0);
  for (let i = 0; i < ACTIVITY_TURN_PROBLEM_LIMIT + 5; i += 1) {
    acc.addEntry(start("Bash", "pnpm test", `c${i}`), i);
    acc.addEntry(end({ callId: `c${i}`, ok: true, exitCode: 1 }), i);
  }
  const summary = acc.finish("completed", 100);
  assert.equal(summary.problems.length, ACTIVITY_TURN_PROBLEM_LIMIT);
  assert.equal(summary.problemCount, ACTIVITY_TURN_PROBLEM_LIMIT + 5);
});
