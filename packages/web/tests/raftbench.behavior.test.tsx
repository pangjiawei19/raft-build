import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "./helpers/domSetup";
import { TestIntlProvider } from "./helpers/intl";
import RaftBenchPage from "../src/raftbench/RaftBenchPage";
import { loadChannelSnapshots } from "../src/raftbench/liveMessages";
import { refreshServerFeatureFlags } from "../src/store/serverFeatureFlags";
import { getCurrentPrincipalId, setCurrentPrincipalId } from "../src/store/principalRuntime";
import type { OverviewSnapshot } from "../src/raftbench/liveMessages";
import { loadCostComparison } from "../src/raftbench/costMetrics";
import { loadTaskPeriods, loadTaskSnapshot } from "../src/raftbench/periodMetrics";
// These tests isolate legacy snapshot/metrics lifetime from the hosted API component.
// The actual hosted lifecycle is exercised separately in raftbenchHosted.behavior.
vi.mock("../src/raftbench/HostedAnalysis", async () => {
  const { useState } = await import("react");
  return { default: function MockHosted({ onEnabled }: { onEnabled: (value: boolean) => void }) {
    const [enabled, setEnabled] = useState(false);
    return <input aria-label="Enable analysis for this page session" type="checkbox" checked={enabled} onChange={event => { setEnabled(event.target.checked); onEnabled(event.target.checked); }} />;
  } };
});
vi.mock("../src/raftbench/costMetrics", () => ({ loadCostComparison: vi.fn() }));
const fixtures = vi.hoisted(() => ({
  channels: [] as Array<{ id: string; name: string; type: string; joined?: boolean; archivedAt?: string }>,
  activity: {} as Record<string, string | null>,
  server: { id: "s1", slug: "test", role: "admin" },
  principalId: "u1",
  epoch: 1,
  flagEnabled: true,
  flagUndetermined: false,
  visibility: "visible",
  toMessage: vi.fn(),
  loadChannels: vi.fn(),
}));
vi.mock("../src/store/serverStore", () => ({
  useServerStore: Object.assign(
    (select: (s: object) => unknown) => select({ current: fixtures.server, serverEpoch: fixtures.epoch }),
    { getState: () => ({ current: fixtures.server, serverEpoch: fixtures.epoch }) },
  ),
}));
vi.mock("../src/store/authStore", () => ({
  useAuthStore: Object.assign(
    (select: (s: object) => unknown) => select({ user: { id: fixtures.principalId } }),
    { getState: () => ({ user: { id: fixtures.principalId } }) },
  ),
}));
vi.mock("../src/store/channelStore", () => ({
  useChannelStore: Object.assign(
    (select: (s: object) => unknown) =>
      select({
        channels: fixtures.channels,
        loadChannels: fixtures.loadChannels,
      }),
    { getState: () => ({ channelActivity: fixtures.activity }) },
  ),
}));
vi.mock("../src/hooks/useAppNavigate", () => ({
  useAppNavigate: () => ({ toMessage: fixtures.toMessage }),
}));
// Cold direct routes have no message-page principal. This is intentionally real:
// the page must not depend on its receiver-private ingress fence.
vi.mock("../src/store/serverFeatureFlags", () => ({
  RAFTBENCH_OVERVIEW_FLAG_KEY: "raftbench_overview_v0",
  useServerFeatureFlag: () => ({ enabled: fixtures.flagEnabled, state: fixtures.flagUndetermined ? "undetermined" : fixtures.flagEnabled ? "enabled" : "disabled" }),
  refreshServerFeatureFlags: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../src/raftbench/liveMessages", () => ({
  loadChannelSnapshots: vi.fn(),
  OVERVIEW_CHANNEL_LIMIT: 20,
  MESSAGE_WINDOW_LIMIT: 200,
}));
vi.mock("../src/raftbench/periodMetrics", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/raftbench/periodMetrics")>(),
  loadTaskPeriods: vi.fn(),
  loadTaskSnapshot: vi.fn(),
}));
const snapshot: OverviewSnapshot = {
  channels: [
    {
      channelId: "c1",
      messages: 1,
      historyLimited: false,
      mayHaveOlder: false,
    },
  ],
  unavailableChannelIds: [],
  requestedChannels: 1,
  messages: [
    {
      id: "m1",
      channelId: "c1",
      senderType: "user",
      senderId: "u1",
      senderName: "Maya",
      content: "I already told you. Stop asking.",
      createdAt: "2026-10-15T09:00:00Z",
    },
  ],
  fetchedAt: "2026-10-15T09:01:00Z",
  historyLimited: false,
  mayHaveOlder: false,
};
function mount(openLegacy = true) {
  const view = render(
    <MemoryRouter>
      <TestIntlProvider>
        <RaftBenchPage />
      </TestIntlProvider>
    </MemoryRouter>,
  );
  if (openLegacy && view.queryByTestId("raftbench-legacy-rules")) fireEvent.click(view.getByText("Legacy phrase and repetition rules"));
  return view;
}
async function choose(view: ReturnType<typeof mount>, name: string) {
  fireEvent.click(view.getByRole("combobox"));
  await waitFor(() => expect(view.getByRole("option", { name })).toBeTruthy());
  const option = view.getByRole("option", { name });
  fireEvent.mouseMove(option);
  fireEvent.pointerMove(option, { pointerType: "mouse" });
  fireEvent.pointerDown(option, { button: 0, pointerType: "mouse" });
  fireEvent.pointerUp(option, { button: 0, pointerType: "mouse" });
  fireEvent.click(option);
  await waitFor(() =>
    expect(view.getByRole("combobox").textContent).toContain(name),
  );
}
beforeEach(() => {
  fixtures.channels = [{ id: "c1", name: "research", type: "channel" }, { id: "c2", name: "other", type: "private", joined: true }];
  fixtures.activity = {};
  vi.mocked(loadTaskPeriods).mockReset().mockResolvedValue({ current: { completed: 0, durationSamples: 0, meanHours: null, medianHours: null }, previous: { completed: 0, durationSamples: 0, meanHours: null, medianHours: null }, surfaces: 0 });
  vi.mocked(loadTaskSnapshot).mockReset().mockResolvedValue({ surfaces: 1, total: 2, todo: 0, inProgress: 0, inReview: 1, done: 1, closed: 0,
    humanCreated: 1, agentCreated: 1, durationSamples: 1, medianHours: 2, p90Hours: 2,
    firstCreatedAt: "2026-07-01T00:00:00.000Z", latestCreatedAt: "2026-07-02T00:00:00.000Z", latestUpdatedAt: "2026-08-09T00:00:00.000Z" });
  vi.mocked(loadCostComparison).mockReset().mockResolvedValue({ currentUsd: 0, previousUsd: 0, unpriced: false, estimated: true, start: "2026-10-11T00:00:00Z", end: "2026-10-18T00:00:00Z" });
  setCurrentPrincipalId(null);
  fixtures.epoch = 1;
  fixtures.flagEnabled = true;
  fixtures.flagUndetermined = false;
  fixtures.visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => fixtures.visibility });
  fixtures.server = { id: "s1", slug: "test", role: "admin" };
  fixtures.principalId = "u1";
  vi.mocked(refreshServerFeatureFlags).mockClear();
  fixtures.loadChannels.mockClear();
  vi.mocked(loadChannelSnapshots).mockReset();
  fixtures.toMessage.mockClear();
});
afterEach(() => cleanup());
test("cold direct route analyzes before the message-page principal initializes, then supports evidence and review", async () => {
  expect(getCurrentPrincipalId()).toBeNull();
  vi.mocked(loadChannelSnapshots).mockResolvedValue(snapshot);
  const view = mount();
  expect(loadChannelSnapshots).not.toHaveBeenCalled();
  await choose(view, "research");
  fireEvent.click(
    view.getByRole("checkbox", {
      name: "Enable analysis for this page session",
    }),
  );
  fireEvent.click(
    view.getByRole("button", { name: "Scan phrases and repeats" }),
  );
  await waitFor(() =>
    expect(view.getByTestId("raftbench-cue-count").textContent).toBe("1"),
  );
  expect(loadChannelSnapshots).toHaveBeenCalledWith(
    ["c1"],
    "s1",
    expect.any(AbortSignal),
  );
  expect(view.getByText("I already told you. Stop asking.")).toBeTruthy();
  fireEvent.change(view.getByLabelText("Reviewer note"), {
    target: { value: "Useful cue" },
  });
  fireEvent.click(view.getByRole("button", { name: "Confirm signal" }));
  expect(view.getByText(/Maya.*Confirmed/)).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Open original message" }));
  expect(fixtures.toMessage).toHaveBeenCalledWith("c1", "m1");
});
test("denied refresh clears old evidence rather than retaining inaccessible content", async () => {
  vi.mocked(loadChannelSnapshots)
    .mockResolvedValueOnce(snapshot)
    .mockRejectedValueOnce(new Error("403"));
  const view = mount();
  await choose(view, "research");
  fireEvent.click(
    view.getByRole("checkbox", {
      name: "Enable analysis for this page session",
    }),
  );
  fireEvent.click(
    view.getByRole("button", { name: "Scan phrases and repeats" }),
  );
  await waitFor(() =>
    expect(view.getByTestId("raftbench-cue-count").textContent).toBe("1"),
  );
  fireEvent.click(view.getByRole("button", { name: "Refresh phrase scan" }));
  await waitFor(() => expect(view.getByRole("alert")).toBeTruthy());
  expect(view.queryByText("I already told you. Stop asking.")).toBeNull();
  expect(view.queryByRole("button", { name: "Export evidence and review" })).toBeNull();
});
test("an old response cannot populate a newly selected channel", async () => {
  let resolve: ((s: OverviewSnapshot) => void) | undefined;
  vi.mocked(loadChannelSnapshots).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const view = mount();
  await choose(view, "research");
  fireEvent.click(
    view.getByRole("checkbox", {
      name: "Enable analysis for this page session",
    }),
  );
  fireEvent.click(
    view.getByRole("button", { name: "Scan phrases and repeats" }),
  );
  await choose(view, "other");
  await act(async () => resolve!(snapshot));
  expect(view.queryByTestId("raftbench-cue-count")).toBeNull();
  expect(view.queryByText("I already told you. Stop asking.")).toBeNull();
});
test.each(["principal", "server", "epoch", "role"])("responses from a changed %s never enter the page even before a render", async (changed) => {
  let resolve: ((s: OverviewSnapshot) => void) | undefined;
  vi.mocked(loadChannelSnapshots).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const view = mount();
  await choose(view, "research");
  fireEvent.click(
    view.getByRole("checkbox", {
      name: "Enable analysis for this page session",
    }),
  );
  fireEvent.click(
    view.getByRole("button", { name: "Scan phrases and repeats" }),
  );
  if (changed === "principal") fixtures.principalId = "u2";
  if (changed === "server") fixtures.server = { ...fixtures.server, id: "s2" };
  if (changed === "epoch") fixtures.epoch++;
  if (changed === "role") fixtures.server.role = "member";
  await act(async () => resolve!(snapshot));
  expect(view.queryByTestId("raftbench-cue-count")).toBeNull();
});

test("workspace overview is the default and channel drill-down never mixes nearby context", async () => {
  const other = {
    ...snapshot.messages[0],
    id: "m2",
    channelId: "c2",
    senderName: "Lin",
    content: "还是不行",
  };
  vi.mocked(loadChannelSnapshots).mockResolvedValue({
    ...snapshot,
    messages: [...snapshot.messages, other],
    channels: [
      ...snapshot.channels,
      {
        channelId: "c2",
        messages: 1,
        historyLimited: false,
        mayHaveOlder: false,
      },
    ],
    requestedChannels: 2,
  });
  const view = mount();
  expect(view.getByRole("combobox").textContent).toContain(
    "Workspace overview",
  );
  fireEvent.click(
    view.getByRole("checkbox", {
      name: "Enable analysis for this page session",
    }),
  );
  fireEvent.click(
    view.getByRole("button", { name: "Scan phrases and repeats" }),
  );
  await waitFor(() =>
    expect(view.getByTestId("raftbench-cue-count").textContent).toBe("2"),
  );
  expect(loadChannelSnapshots).toHaveBeenCalledWith(
    ["c1", "c2"],
    "s1",
    expect.any(AbortSignal),
  );
  fireEvent.click(view.getByRole("button", { name: "research · 1 cues" }));
  expect(view.getByText("I already told you. Stop asking.")).toBeTruthy();
  expect(view.queryByText("还是不行")).toBeNull();
});

test("members and guests cannot open the overview or initiate channel reads", () => {
  for (const role of ["member", "guest"]) {
    fixtures.server.role = role;
    const view = mount();
    expect(
      view.getByText("RaftBench is for server administrators"),
    ).toBeTruthy();
    expect(view.queryByRole("checkbox")).toBeNull();
    expect(loadChannelSnapshots).not.toHaveBeenCalled();
    expect(fixtures.loadChannels).not.toHaveBeenCalled();
    cleanup();
  }
});
test("admin consent is off by default and withdrawal clears findings and no export is available", async () => {
  vi.mocked(loadChannelSnapshots).mockResolvedValue(snapshot);
  const view = mount();
  const consent = view.getByRole("checkbox", {
    name: "Enable analysis for this page session",
  });
  expect((consent as HTMLInputElement).checked).toBe(false);
  expect(
    view
      .getByRole("button", { name: "Scan phrases and repeats" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(loadChannelSnapshots).not.toHaveBeenCalled();
  fireEvent.click(consent);
  fireEvent.click(
    view.getByRole("button", { name: "Scan phrases and repeats" }),
  );
  await waitFor(() =>
    expect(view.getByTestId("raftbench-cue-count").textContent).toBe("1"),
  );
  fireEvent.click(consent);
  expect(view.queryByTestId("raftbench-cue-count")).toBeNull();
  expect(view.queryByText("I already told you. Stop asking.")).toBeNull();
  expect(view.queryByRole("button", { name: "Export evidence and review" })).toBeNull();
});
test("role loss unmounts all evidence and consent instead of retaining an admin overview", async () => {
  vi.mocked(loadChannelSnapshots).mockResolvedValue(snapshot);
  const view = mount();
  fireEvent.click(
    view.getByRole("checkbox", {
      name: "Enable analysis for this page session",
    }),
  );
  fireEvent.click(
    view.getByRole("button", { name: "Scan phrases and repeats" }),
  );
  await waitFor(() =>
    expect(view.getByTestId("raftbench-cue-count").textContent).toBe("1"),
  );
  fixtures.server.role = "member";
  view.rerender(
    <MemoryRouter>
      <TestIntlProvider>
        <RaftBenchPage />
      </TestIntlProvider>
    </MemoryRouter>,
  );
  expect(view.queryByTestId("raftbench-cue-count")).toBeNull();
  expect(view.getByText("RaftBench is for server administrators")).toBeTruthy();
});

test("an unenrolled server cannot mount the reader, and disabling rollout clears an existing overview", async () => {
  fixtures.flagEnabled = false;
  let view = mount();
  expect(
    view.getByText("RaftBench is not enabled for this server"),
  ).toBeTruthy();
  expect(fixtures.loadChannels).not.toHaveBeenCalled();
  expect(loadChannelSnapshots).not.toHaveBeenCalled();
  cleanup();
  fixtures.flagEnabled = true;
  vi.mocked(loadChannelSnapshots).mockResolvedValue(snapshot);
  view = mount();
  fireEvent.click(
    view.getByRole("checkbox", {
      name: "Enable analysis for this page session",
    }),
  );
  fireEvent.click(
    view.getByRole("button", { name: "Scan phrases and repeats" }),
  );
  await waitFor(() =>
    expect(view.getByTestId("raftbench-cue-count").textContent).toBe("1"),
  );
  fixtures.flagEnabled = false;
  view.rerender(
    <MemoryRouter>
      <TestIntlProvider>
        <RaftBenchPage />
      </TestIntlProvider>
    </MemoryRouter>,
  );
  expect(view.queryByTestId("raftbench-cue-count")).toBeNull();
  expect(
    view.getByText("RaftBench is not enabled for this server"),
  ).toBeTruthy();
});

test("mounted admin refreshes rollout on a 30-second interval and window focus, and stops on unmount", async () => {
  let refreshTick: (() => void) | undefined;
  const interval = vi.spyOn(window, "setInterval").mockImplementation((handler, delay) => {
    if (delay === 30_000) refreshTick = handler as () => void;
    return 123;
  });
  const clear = vi.spyOn(window, "clearInterval");
  const view = mount();
  expect(refreshTick).toBeTypeOf("function");
  const clock = vi.spyOn(Date, "now").mockReturnValue(2000);
  await act(async () => { refreshTick!(); });
  expect(refreshServerFeatureFlags).toHaveBeenLastCalledWith("s1");
  vi.mocked(refreshServerFeatureFlags).mockClear();
  clock.mockReturnValue(4000);
  await act(async () => { window.dispatchEvent(new window.Event("focus")); });
  expect(refreshServerFeatureFlags).toHaveBeenCalledOnce();
  await act(async () => { window.dispatchEvent(new window.Event("focus")); });
  expect(refreshServerFeatureFlags).toHaveBeenCalledOnce();
  fixtures.visibility = "hidden";
  clock.mockReturnValue(6000);
  await act(async () => { refreshTick!(); });
  expect(refreshServerFeatureFlags).toHaveBeenCalledOnce();
  expect(loadChannelSnapshots).not.toHaveBeenCalled();
  view.unmount();
  expect(clear).toHaveBeenCalledWith(123);
  vi.mocked(refreshServerFeatureFlags).mockClear();
  window.dispatchEvent(new window.Event("focus"));
  expect(refreshServerFeatureFlags).not.toHaveBeenCalled();
  clock.mockRestore();
  interval.mockRestore();
  clear.mockRestore();
});

test("database task snapshot and comparison load before AI consent and remain after withdrawal", async () => {
  vi.mocked(loadTaskPeriods).mockResolvedValue({ current: { completed: 1, durationSamples: 1, meanHours: 2, medianHours: 2 }, previous: { completed: 0, durationSamples: 0, meanHours: null, medianHours: null }, surfaces: 1 });
  const view = mount();
  await waitFor(() => expect(view.getByText("1 / 0")).toBeTruthy());
  expect(view.getByTestId("raftbench-task-snapshot").textContent).toContain("2026-08-09");
  expect(loadTaskSnapshot).toHaveBeenCalledWith("s1", null, expect.any(AbortSignal));
  expect(loadTaskPeriods).toHaveBeenCalled();
  const consent = view.getByRole("checkbox", { name: "Enable analysis for this page session" });
  fireEvent.click(consent);
  expect(loadChannelSnapshots).not.toHaveBeenCalled();
  expect(view.getByTestId("raftbench-task-comparison")).toBeTruthy();
  fireEvent.click(consent);
  expect(view.getByText("1 / 0")).toBeTruthy();
});

test("undetermined rollout preserves existing evidence and notes but pauses new reads; explicit disable clears", async () => {
  vi.mocked(loadChannelSnapshots).mockResolvedValue(snapshot);
  const view = mount();
  fireEvent.click(view.getByRole("checkbox", { name: "Enable analysis for this page session" }));
  fireEvent.click(view.getByRole("button", { name: "Scan phrases and repeats" }));
  await waitFor(() => expect(view.getByTestId("raftbench-cue-count").textContent).toBe("1"));
  fireEvent.change(view.getByLabelText("Reviewer note"), { target: { value: "Keep this review" } });
  fixtures.flagUndetermined = true;
  view.rerender(<MemoryRouter><TestIntlProvider><RaftBenchPage /></TestIntlProvider></MemoryRouter>);
  expect(view.getByText("I already told you. Stop asking.")).toBeTruthy();
  expect((view.getByLabelText("Reviewer note") as HTMLTextAreaElement).value).toBe("Keep this review");
  expect(view.getByRole("button", { name: "Refresh phrase scan" }).hasAttribute("disabled")).toBe(true);
  expect(view.getByRole("button", { name: "Refresh task and cost metrics" }).hasAttribute("disabled")).toBe(false);
  fixtures.flagUndetermined = false; fixtures.flagEnabled = false;
  view.rerender(<MemoryRouter><TestIntlProvider><RaftBenchPage /></TestIntlProvider></MemoryRouter>);
  expect(view.queryByLabelText("Reviewer note")).toBeNull();
});
test("an initial undetermined flag never mounts readers or grants access", () => {
  fixtures.flagUndetermined = true;
  const view = mount();
  expect(view.queryByRole("checkbox")).toBeNull();
  expect(loadChannelSnapshots).not.toHaveBeenCalled();
  expect(loadTaskPeriods).not.toHaveBeenCalled();
});

test("overview includes unjoined public channels, excludes nonmember private channels, and caps by recent activity", async () => {
  fixtures.channels = [
    ...Array.from({ length: 22 }, (_, i) => ({ id: `p${i}`, name: `public${i}`, type: "channel", joined: false })),
    { id: "private-joined", name: "private joined", type: "private", joined: true },
    { id: "private-no", name: "private no", type: "private", joined: false },
    { id: "private-unknown", name: "private unknown", type: "private" },
    { id: "archived", name: "archived", type: "channel", archivedAt: "2026-01-01" },
    { id: "dm", name: "dm", type: "dm", joined: true },
    { id: "thread", name: "thread", type: "thread", joined: true },
  ];
  const expected = ["private-joined", ...Array.from({ length: 19 }, (_, i) => `p${21-i}`)];
  fixtures.activity = Object.fromEntries(fixtures.channels.map((c, i) => [c.id, new Date(Date.UTC(2026, 0, 1, i)).toISOString()]));
  vi.mocked(loadChannelSnapshots).mockResolvedValue({ ...snapshot, requestedChannels: 20, channels: expected.map((channelId) => ({ channelId, messages: 0, historyLimited: false, mayHaveOlder: false })) });
  const view = mount();
  expect(loadChannelSnapshots).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("checkbox", { name: "Enable analysis for this page session" }));
  expect(loadChannelSnapshots).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Scan phrases and repeats" }));
  await waitFor(() => expect(loadChannelSnapshots).toHaveBeenCalledWith(expected, "s1", expect.any(AbortSignal)));
  expect(view.getByText(/Public channels not joined: 22 available; 19 read/)).toBeTruthy();
});

test("unjoined public channel can be selected directly without changing membership", async () => {
  fixtures.channels = [{ id: "c1", name: "public unjoined", type: "channel", joined: false }];
  vi.mocked(loadChannelSnapshots).mockResolvedValue(snapshot);
  const view = mount();
  await choose(view, "public unjoined");
  fireEvent.click(view.getByRole("checkbox", { name: "Enable analysis for this page session" }));
  fireEvent.click(view.getByRole("button", { name: "Scan phrases and repeats" }));
  await waitFor(() => expect(loadChannelSnapshots).toHaveBeenCalledWith(["c1"], "s1", expect.any(AbortSignal)));
});


test("overview loads independently of AI and unmount aborts a late billing reply", async () => {
  let finish!: (value: Awaited<ReturnType<typeof loadCostComparison>>) => void;
  vi.mocked(loadCostComparison).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const view = mount();
  await waitFor(() => expect(loadCostComparison).toHaveBeenCalledWith("s1", expect.any(String), expect.any(AbortSignal)));
  expect(loadChannelSnapshots).not.toHaveBeenCalled();
  const signal = vi.mocked(loadCostComparison).mock.calls[0][2];
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => { finish({ currentUsd: 12, previousUsd: 10, unpriced: false, estimated: true, start: "2026-10-11T00:00:00Z", end: "2026-10-18T00:00:00Z" }); });
  expect(view.queryByTestId("raftbench-cost-comparison")).toBeNull();
});

test("legacy wording counts stay collapsed beside the independent AI service", () => {
  const view = mount(false);
  expect(view.getByTestId("raftbench-legacy-rules").hasAttribute("open")).toBe(false);
  expect(view.getByRole("button", { name: "Scan phrases and repeats" }).closest("details")).toBe(view.getByTestId("raftbench-legacy-rules"));
  fireEvent.click(view.getByText("Legacy phrase and repetition rules"));
  expect(view.getByTestId("raftbench-legacy-rules").hasAttribute("open")).toBe(true);
  expect(loadChannelSnapshots).not.toHaveBeenCalled();
});
