import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import "./helpers/domSetup";
import { TestIntlProvider } from "./helpers/intl";
import HostedAnalysis from "../src/raftbench/HostedAnalysis";
const fixture = vi.hoisted(() => ({ server: { id: "s1", role: "admin" }, epoch: 1, principal: "u1", get: vi.fn(), post: vi.fn(), put: vi.fn(), enabled: vi.fn(), toMessage: vi.fn(), toAgent: vi.fn() }));
vi.mock("../src/api/client", () => ({ default: { get: fixture.get, post: fixture.post, put: fixture.put } }));
vi.mock("../src/store/serverStore", () => ({ useServerStore: Object.assign((select: (s: object) => unknown) => select({ current: fixture.server, serverEpoch: fixture.epoch }), { getState: () => ({ current: fixture.server, serverEpoch: fixture.epoch }) }) }));
vi.mock("../src/store/authStore", () => ({ useAuthStore: Object.assign((select: (s: object) => unknown) => select({ user: { id: fixture.principal } }), { getState: () => ({ user: { id: fixture.principal } }) }) }));
vi.mock("../src/hooks/useAppNavigate", () => ({ useAppNavigate: () => ({ toMessage: fixture.toMessage, toAgent: fixture.toAgent }) }));
const options = [{ value: "c1", label: "research" }, { value: "c2", label: "other" }];
function base() { return { enabled: false, revision: 0, channelIds: [], agentId: null, provisioning: null, intervalMinutes: 15, run: null, pagination: { page: 1, pageCount: 1, total: 0, pageSize: 5 } }; }
function running() { return { ...base(), enabled: true, revision: 1, channelIds: ["c1"], agentId: "a1", provisioning: { state: "active", error: null, profile: "raftbench_service" }, run: { runId: "r1", status: "running", from: "2026-10-17T00:00:00Z", to: "2026-10-18T00:00:00Z", updatedAt: "2026-10-18T00:01:00Z", fetchedMessages: 340, stopReason: "more_pages", exhausted: false, failureReason: null, report: null } }; }
function mount(allowed = true) { return render(<TestIntlProvider><HostedAnalysis allowed={allowed} options={options} onEnabled={fixture.enabled} /></TestIntlProvider>); }
beforeEach(() => { fixture.server = { id: "s1", role: "admin" }; fixture.epoch = 1; fixture.principal = "u1"; fixture.get.mockReset().mockResolvedValue({ data: base() }); fixture.post.mockReset().mockResolvedValue({ data: { agentId: "a2" } }); fixture.put.mockReset().mockResolvedValue({ data: { saved: true } }); fixture.enabled.mockClear(); fixture.toMessage.mockClear(); fixture.toAgent.mockClear(); });
afterEach(cleanup);
test("a dedicated agent card can be created, inspected and explicitly assigned", async () => {
  let created = false;
  fixture.get.mockImplementation((path: string) => Promise.resolve({ data: path === "/raftbench/agents" ? { agents: created ? [{ agentId: "a2", name: "raftbench-service", state: "active", ready: true }] : [] } : base() }));
  fixture.post.mockImplementation(() => { created = true; return Promise.resolve({ data: { agentId: "a2" } }); });
  const view = mount();
  fireEvent.click(await view.findByRole("button", { name: "Create service agent" }));
  await waitFor(() => expect(fixture.post).toHaveBeenCalledWith("/raftbench/agents", {}, expect.any(Object)));
  fireEvent.click(await view.findByRole("button", { name: "raftbench-service" }));
  expect(fixture.toAgent).toHaveBeenCalledWith("a2");
  fireEvent.change(view.getByLabelText("Analyze messages since (UTC)"), { target: { value: "2026-09-01" } });
  fireEvent.click(view.getByRole("button", { name: "Assign agent" }));
  await waitFor(() => expect(fixture.put).toHaveBeenCalledWith("/raftbench/assignment", { agentId: "a2", expectedRevision: 0, channelIds: ["c1", "c2"], historyFrom: "2026-09-01T00:00:00.000Z" }, expect.any(Object)));
});
test("one enable saves selected sources and starts automatically without a second load action", async () => {
  const view = mount();
  const enable = await view.findByRole("button", { name: "Enable and start analysis" });
  await waitFor(() => expect(enable.hasAttribute("disabled")).toBe(false));
  fireEvent.click(view.getByRole("checkbox", { name: "other" }));
  fixture.get.mockResolvedValue({ data: running() });
  fireEvent.click(enable);
  await waitFor(() => expect(fixture.put).toHaveBeenCalledWith("/raftbench", { enabled: true, channelIds: ["c1"], expectedRevision: 0 }, expect.any(Object)));
  expect(await view.findByText("Reading channel messages…")).toBeTruthy();
  expect(fixture.enabled).toHaveBeenLastCalledWith(true);
  expect(view.queryByRole("button", { name: /Load/ })).toBeNull();
});
test("read progress uses the server count and never invents a percentage or total", async () => {
  fixture.get.mockResolvedValue({ data: running() }); const view = mount();
  const progress = await view.findByRole("progressbar", { name: "Analysis progress" });
  expect(progress.getAttribute("aria-valuetext")).toBe("340 messages read");
  expect(progress.hasAttribute("aria-valuenow")).toBe(false);
  expect(progress.hasAttribute("aria-valuemax")).toBe(false);
  expect(view.getByText(/The total is not known yet/)).toBeTruthy();
});
test("completed results page on the server, retain counterevidence and open source messages", async () => {
  const state = running(); const pattern = { kind: "repeated_clarification", explanation: "Synthetic supported explanation", evidence: [{ target: "#research", messageId: "00000000-0000-4000-8000-000000000001" }], counterevidence: [{ target: "#other", messageId: "00000000-0000-4000-8000-000000000002" }], evidenceLevel: "conversation_only", intent: "unknown", suggestion: "Draft a reusable acceptance checklist" };
  const completed = { ...state, run: { ...state.run, status: "ready", report: { status: "complete", gaps: ["missing_tool_outcomes"], patterns: [pattern] } }, pagination: { page: 1, pageCount: 2, total: 8, pageSize: 5 } };
  fixture.get.mockResolvedValue({ data: completed }); const view = mount();
  expect(await view.findByText("Synthetic supported explanation")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: /Counterevidence #other/ }));
  expect(fixture.toMessage).toHaveBeenCalledWith("c2", "00000000-0000-4000-8000-000000000002");
  fixture.get.mockResolvedValue({ data: { ...completed, pagination: { ...completed.pagination, page: 2 } } });
  fireEvent.click(view.getByRole("button", { name: "Next page" }));
  await waitFor(() => expect(fixture.get).toHaveBeenLastCalledWith("/raftbench", expect.objectContaining({ params: { page: 2 } })));
  expect(view.queryByRole("progressbar")).toBeNull();
});
test.each(["principal", "server", "role", "epoch"])("a late result cannot appear after %s changes", async kind => {
  let finish!: (value: { data: ReturnType<typeof running> }) => void;
  fixture.get.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = mount();
  if (kind === "principal") fixture.principal = "u2";
  if (kind === "server") fixture.server = { id: "s2", role: "admin" };
  if (kind === "role") fixture.server.role = "member";
  if (kind === "epoch") fixture.epoch += 1;
  await act(async () => { finish({ data: running() }); });
  expect(view.queryByRole("progressbar")).toBeNull();
  expect(fixture.enabled).not.toHaveBeenCalledWith(true);
});
test("a failed provision is not shown as ongoing analysis and withdrawal clears progress", async () => {
  fixture.get.mockResolvedValue({ data: { ...running(), run: null, provisioning: { state: "failed", profile: "raftbench_service", error: "provider_refused" } } });
  const view = mount(); expect(await view.findByRole("alert")).toBeTruthy(); expect(view.queryByRole("progressbar")).toBeNull();
  fixture.get.mockResolvedValue({ data: { ...base(), revision: 2 } });
  fireEvent.click(view.getByRole("button", { name: "Disable and clear results" }));
  await waitFor(() => expect(fixture.enabled).toHaveBeenLastCalledWith(false));
  expect(view.queryByRole("progressbar")).toBeNull();
});
test("model identity comes from the hosted API and skipped chunks stay explicitly unknown", async () => {
  const state = running();
  fixture.get.mockImplementation((path: string) => Promise.resolve({ data: path.includes("hosted-runtime/model") ? { model: "synthetic-model", label: "Synthetic model", source: "default" } : { ...state, run: { ...state.run, skippedRanges: [{ from: "2026-10-17T00:00:00Z", to: "2026-10-18T00:00:00Z", messages: 15 }] } } }));
  const view = mount();
  expect(await view.findByText("Current cloud agent model: Synthetic model")).toBeTruthy();
  expect(view.getByText(/15 messages.*not analyzed after 3 failed attempts/)).toBeTruthy();
});
test("stale derived results are hidden when a source changes", async () => {
  const state = running(); fixture.get.mockResolvedValue({ data: { ...state, run: { ...state.run, status: "stale", report: null } } });
  const view = mount(); expect(await view.findByText(/A source message changed or was deleted/)).toBeTruthy();
  expect(view.queryByRole("progressbar")).toBeNull();
});
test("model explanations, reasons and draft suggestions stay literal text", async () => {
  const state = running();
  const payload = '<img src=x onerror="alert(1)"> [x](javascript:alert(1)) <a href="javascript:alert(1)">click</a>';
  const explanation = `Explanation: ${payload}`;
  const reason = `Reason: ${payload}`;
  const suggestion = `--- shared practice draft\n+++ proposed\n+ ${payload}`;
  fixture.get.mockResolvedValue({ data: { ...state, run: { ...state.run, status: "partial", report: { status: "incomplete", reason, gaps: [], patterns: [{ kind: "successful_practice", explanation, evidence: [], counterevidence: [], evidenceLevel: "conversation_only", intent: "unknown", suggestion }] } } } });
  const view = mount();
  expect((await view.findByText(explanation)).textContent).toBe(explanation);
  expect(view.getByText(reason).textContent).toBe(reason);
  expect(view.getByText((_, node) => node?.textContent === suggestion).textContent).toBe(suggestion);
  expect(view.container.querySelector('img, a, script, [onerror]')).toBeNull();
  expect(view.queryByRole("link")).toBeNull();
});

test("an empty input is no material, distinct from a read with no supported findings", async () => {
  const state = running();
  fixture.get.mockResolvedValue({ data: { ...state, run: { ...state.run, status: "ready", fetchedMessages: 0, report: { status: "complete", gaps: [], patterns: [] } } } });
  const view = mount();
  expect(await view.findByText("No material in this window")).toBeTruthy();
  expect(view.getByText(/No messages were read in this window; nothing was analyzed/)).toBeTruthy();
  expect(view.queryByText("Analysis complete")).toBeNull();
  expect(view.queryByText(/No supported pattern was returned/)).toBeNull();
});

test("old snapshot coverage explains zero input and an admin can restart from a chosen date", async () => {
  const state = running();
  fixture.get.mockResolvedValue({ data: { ...state, coverage: { totalMessages: 23010, windowMessages: 0, latestAt: "2026-10-10T06:17:00Z", earliestAt: "2026-02-28T00:00:00Z", from: "2026-10-11T00:00:00Z", to: "2026-10-18T00:00:00Z", checkedAt: "2026-10-18T00:00:00Z" } } });
  const view = mount();
  expect(await view.findByText(/23,010 messages total; 0 in the analysis range/)).toBeTruthy();
  expect(view.getByText(/Messages exist, but they are outside this range/)).toBeTruthy();
  fireEvent.change(view.getByLabelText("Analyze messages since (UTC)"), { target: { value: "2026-09-01" } });
  fireEvent.click(view.getByRole("button", { name: "Apply changes and restart" }));
  await waitFor(() => expect(fixture.put).toHaveBeenCalled());
  expect(fixture.put.mock.calls[0][1]).toMatchObject({ enabled: true, historyFrom: "2026-09-01T00:00:00.000Z" });
  expect(fixture.enabled).not.toHaveBeenCalledWith(false);
});


test("a new empty batch retains cumulative progress and previous findings", async () => {
  const state = running();
  fixture.get.mockResolvedValue({ data: { ...state, progress: { readMessages: 500, completedBatches: 2, scannedThroughAt: null }, run: { ...state.run, status: "queued", fetchedMessages: 0, report: { status: "incomplete", gaps: ["partial_scan"], patterns: [{ kind: "successful_practice", explanation: "Earlier accepted synthetic finding", evidence: [], counterevidence: [], evidenceLevel: "conversation_only", intent: "unknown" }] } }, pagination: { page: 1, pageCount: 1, total: 1, pageSize: 5 } } });
  const view = mount();
  expect(await view.findByText("Earlier accepted synthetic finding")).toBeTruthy();
  expect(view.getByText("Read 500 messages · 2 batches accepted")).toBeTruthy();
  expect(view.queryByText("No material in this window")).toBeNull();
});


test("empty historical range offers a real restart and does not count empty polls as progress", async () => {
  const state = running();
  fixture.get.mockResolvedValue({ data: { ...state,
    historyFrom: "2026-10-11T00:00:00Z",
    progress: { readMessages: 0, completedBatches: 7, scannedThroughAt: null },
    coverage: { totalMessages: 23010, windowMessages: 0, latestAt: "2026-10-10T06:17:00Z", earliestAt: "2026-02-28T13:42:00Z", from: "2026-10-11T00:00:00Z", to: "2026-10-18T00:00:00Z", checkedAt: "2026-10-18T00:00:00Z" },
    run: { ...state.run, status: "ready", fetchedMessages: 0, report: { status: "complete", gaps: [], patterns: [] } },
  } });
  const view = mount();
  const restart = await view.findByRole("button", { name: "Analyze the newest source day from 2026-10-10" });
  expect(view.getByText(/23,010 messages across all history/)).toBeTruthy();
  expect(view.queryByText(/7 batches accepted/)).toBeNull();
  expect(view.queryByText("No material in this window")).toBeNull();
  expect(view.queryByRole("navigation", { name: "Analysis result pages" })).toBeNull();
  expect(fixture.put).not.toHaveBeenCalled();
  fireEvent.click(restart);
  await waitFor(() => expect(fixture.put).toHaveBeenCalledWith("/raftbench", {
    enabled: true, channelIds: ["c1"], expectedRevision: 1, historyFrom: "2026-10-10T00:00:00.000Z",
  }, expect.objectContaining({ headers: { "X-Server-Id": "s1" } })));
});
