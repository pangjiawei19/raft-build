import assert from "node:assert/strict";
import "./helpers/domSetup";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import api from "../src/api/client";
import AgentActivityLog from "../src/components/agent/AgentActivityLog";
import { formatClockRange } from "../src/components/agent/AgentActivityOverview";
import type { TurnSummaryView } from "../src/components/agent/AgentActivityOverview";
import { useAgentStore } from "../src/store/agentStore";
import type { TrajectoryLogEntry } from "../src/store/agentStore";
import { ACTIVITY_OVERVIEW_WEB_FLAG_KEY, resetServerFeatureFlagsForTests, setServerFeatureFlagForTests } from "../src/store/serverFeatureFlags";
import { useServerStore } from "../src/store/serverStore";
import type { Server } from "../src/store/serverStore";
import { renderWithIntl } from "./helpers/intl";

// Task #17: the Activity tab's per-turn Overview, behind activity_overview_web_v0.
Element.prototype.scrollIntoView = function scrollIntoView() {};
const initialAgentState = useAgentStore.getState();
const initialServerState = useServerStore.getState();
const originalGet = api.get;

const server = {
  id: "server-1",
  name: "Acme",
  avatarUrl: null,
  slug: "acme",
  ownerId: "user-1",
  onboardingAgentId: null,
  hideHumansFromMembers: false,
  plan: "free",
  planDowngradedAt: null,
  role: "owner",
  createdAt: "2026-09-01T00:00:00.000Z",
} as Server;

const rawEntry: TrajectoryLogEntry = {
  timestamp: Date.UTC(2026, 9, 16, 1, 0, 0),
  entry: { kind: "tool_start", toolName: "Bash", toolInput: "grep -rn x src" },
};

function turn(overrides: Partial<TurnSummaryView>): TurnSummaryView {
  return {
    v: 1,
    startedAt: Date.UTC(2026, 9, 16, 1, 0, 0),
    endedAt: Date.UTC(2026, 9, 16, 1, 1, 41),
    outcome: "completed",
    actions: [],
    toolCalls: 0,
    problems: [],
    problemCount: 0,
    messagesSent: 0,
    ...overrides,
  };
}

function stubApi(summaries: TurnSummaryView[], seenUrls: string[] = []) {
  api.get = (async (url: string) => {
    seenUrls.push(url);
    if (url === "/agents/agent-1/activity-summaries") return { data: { summaries } };
    if (url === "/messages/context/reply-1") {
      return { data: { targetMessageId: "reply-1", messages: [{ id: "reply-1", content: "Fixed it: tests pass now.", createdAt: "2026-10-16T01:01:30.000Z" }] } };
    }
    throw new Error(`unexpected GET ${url}`);
  }) as typeof api.get;
}

function renderLog(machineId: string | null = "computer-1") {
  useServerStore.setState({ current: server, members: [] });
  return renderWithIntl(
    <MemoryRouter>
      <AgentActivityLog agentId="agent-1" machineId={machineId} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  api.get = originalGet;
  resetServerFeatureFlagsForTests();
  useAgentStore.setState(initialAgentState, true);
  useServerStore.setState(initialServerState, true);
});

test("with the flag off the tab is the raw log only", () => {
  useAgentStore.setState({ trajectoryLogs: { "agent-1": [rawEntry] }, loadTrajectoryLog: async () => {} } as never);
  stubApi([]);
  renderLog();
  assert.ok(screen.queryByTestId("activity-view-overview") === null);
  assert.ok(screen.queryByTestId("activity-overview") === null);
});

test("a turn shows who woke it, what it did, failing tests as process information, and its last reply", async () => {
  setServerFeatureFlagForTests("server-1", ACTIVITY_OVERVIEW_WEB_FLAG_KEY, true);
  useAgentStore.setState({ trajectoryLogs: { "agent-1": [rawEntry] }, loadTrajectoryLog: async () => {} } as never);
  stubApi([
    turn({
      id: "t1",
      trigger: { target: "#proj-runtime:9b526607", sender: "Tenny", channelId: "c1", messageId: "m1" },
      actions: [{ kind: "search", count: 3 }, { kind: "run_checks", count: 1 }],
      toolCalls: 4,
      problems: [{ kind: "run_checks", reason: "exit_nonzero", exitCode: 1, at: Date.UTC(2026, 9, 16, 1, 0, 20) }],
      problemCount: 1,
      messagesSent: 2,
      lastReplyMessageId: "reply-1",
    }),
    turn({
      id: "t2",
      startedAt: Date.UTC(2026, 9, 16, 0, 50),
      endedAt: Date.UTC(2026, 9, 16, 0, 50, 5),
      outcome: "failed",
      trigger: { hidden: "private_channel" },
      problems: [{ kind: "edit_file", reason: "call_failed", at: Date.UTC(2026, 9, 16, 0, 50, 4) }],
      problemCount: 1,
    }),
    turn({
      id: "t3",
      startedAt: Date.UTC(2026, 9, 16, 0, 40),
      endedAt: Date.UTC(2026, 9, 16, 0, 40, 9),
      trigger: { target: "dm:@richard", sender: "richard", channelId: "d1" },
      problems: [{ kind: "send_message", reason: "send_held", at: Date.UTC(2026, 9, 16, 0, 40, 8) }],
      problemCount: 1,
    }),
  ]);
  renderLog();

  await screen.findByText("Fixed it: tests pass now.");
  const [first, second, third] = screen.getAllByTestId("activity-overview-turn").map((node) => node.textContent ?? "");
  assert.match(first!, /replying to @Tenny in a thread in #proj-runtime/);
  assert.doesNotMatch(first!, /9b526607/);
  assert.match(first!, /took 1m 41s/);
  assert.match(first!, /searched 3 times and ran tests or checks once/);
  // Only failing tests: the turn is plainly Done, and the failure reads as process information.
  assert.match(first!, /Done/);
  assert.doesNotMatch(first!, /went wrong/);
  assert.match(first!, /some tests or checks failed/);
  assert.match(first!, /2 messages sent this turn/);
  // A trigger the viewer cannot see is named only by its kind; an error ending is its own badge.
  assert.match(second!, /replying to a message in a private channel/);
  assert.match(second!, /Ended with an error/);
  assert.match(second!, /No message sent this turn/);
  assert.match(third!, /replying to a direct message from @richard/);
  assert.match(third!, /Done, 1 step went wrong/);
  // Totals count only the steps that went wrong.
  assert.match(screen.getByTestId("activity-overview-now").textContent ?? "", /2 steps went wrong/);
});

test("a failed load offers a retry", async () => {
  setServerFeatureFlagForTests("server-1", ACTIVITY_OVERVIEW_WEB_FLAG_KEY, true);
  useAgentStore.setState({ trajectoryLogs: { "agent-1": [rawEntry] }, loadTrajectoryLog: async () => {} } as never);
  let calls = 0;
  api.get = (async (url: string) => {
    if (url !== "/agents/agent-1/activity-summaries") throw new Error(`unexpected GET ${url}`);
    calls += 1;
    if (calls === 1) throw new Error("network");
    return { data: { summaries: [turn({ id: "t1" })] } };
  }) as typeof api.get;
  renderLog();
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
  await screen.findByTestId("activity-overview-turn");
});

test("an agent with raw activity but no turn summaries gets the upgrade path and a way to the raw log", async () => {
  setServerFeatureFlagForTests("server-1", ACTIVITY_OVERVIEW_WEB_FLAG_KEY, true);
  useAgentStore.setState({ trajectoryLogs: { "agent-1": [rawEntry] }, loadTrajectoryLog: async () => {} } as never);
  stubApi([]);
  renderLog();

  await screen.findByText("No overview yet");
  assert.ok(screen.getByTestId("activity-overview-open-computer"));
  fireEvent.click(screen.getByRole("button", { name: "Show raw log" }));
  await waitFor(() => assert.ok(screen.queryByText("No overview yet") === null));
});

test("an agent without a computer is not told to upgrade one", async () => {
  setServerFeatureFlagForTests("server-1", ACTIVITY_OVERVIEW_WEB_FLAG_KEY, true);
  useAgentStore.setState({ trajectoryLogs: { "agent-1": [rawEntry] }, loadTrajectoryLog: async () => {} } as never);
  stubApi([]);
  renderLog(null);

  await screen.findByText("No overview yet");
  assert.ok(screen.queryByTestId("activity-overview-open-computer") === null);
  assert.ok(screen.getByText(/hasn't reported a finished turn yet/));
});

test("a turn's time range writes a shared minute or day-period word once", () => {
  assert.deepEqual(formatClockRange("上午03:04", "上午03:04"), { start: "上午03:04" });
  assert.deepEqual(formatClockRange("上午02:38", "上午02:44"), { start: "上午02:38", end: "02:44" });
  assert.deepEqual(formatClockRange("上午11:58", "下午12:03"), { start: "上午11:58", end: "下午12:03" });
  assert.deepEqual(formatClockRange("2:38 AM", "2:44 AM"), { start: "2:38", end: "2:44 AM" });
  assert.deepEqual(formatClockRange("14:38", "14:44"), { start: "14:38", end: "14:44" });
});
