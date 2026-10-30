import { afterEach, expect, test, vi } from "vitest";
import api from "../src/api/client";
import { comparisonWindow, summarizeTaskPeriod } from "../src/raftbench/taskMetrics";
import { loadCostComparison } from "../src/raftbench/costMetrics";
import type { TaskFact } from "../src/raftbench/taskMetrics";
vi.mock("../src/api/client", () => ({ default: { get: vi.fn() } }));
afterEach(() => vi.clearAllMocks());
const now = "2026-10-18T12:35:00Z";
const fact = (id: string, completedAt: string, patch: Partial<TaskFact> = {}): TaskFact => ({ id, channelId: "c1", status: "done", owner: "agent", createdAt: "2026-10-10T00:00:00Z", completedAt, ...patch });
test("compares equal completed UTC windows, excludes today and uses completion cohorts rather than creation cohorts", () => {
  const w = comparisonWindow(now);
  expect(new Date(w.start).toISOString()).toBe("2026-10-11T00:00:00.000Z");
  expect(w.end - w.start).toBe(w.start - w.previousStart);
  const rows = [fact("old", "2026-10-11T00:00:00Z", { createdAt: "2026-09-01T00:00:00Z" }), fact("end", "2026-10-18T00:00:00Z"), fact("previous", "2026-10-10T23:59:59Z"), fact("reopened", "2026-10-12T00:00:00Z", { status: "in_progress" }), fact("invalid", "2026-10-11T01:00:00Z", { createdAt: "2026-10-12T00:00:00Z" })];
  const current = summarizeTaskPeriod(rows, w.start, w.end);
  expect(current.completed).toBe(2);
  expect(current.durationSamples).toBe(1);
  expect(current.meanHours).toBe(40 * 24);
  expect(summarizeTaskPeriod([], w.start, w.end).medianHours).toBeNull();
});
const spend = () => ({ currency: "USD", estimated: true, bucket: "day", from: "2026-10-04T00:00:00Z", to: "2026-10-18T00:00:00Z", periods: [{ start: "2026-10-10T00:00:00Z", totalUsd: 4, unpriced: [] }, { start: "2026-10-11T00:00:00Z", totalUsd: 7, unpriced: ["unknown-model"] }, { start: "2026-10-18T00:00:00Z", totalUsd: 99, unpriced: [] }] });
test("reuses billing with explicit server and cancellation; sums only aligned days, retaining price gaps", async () => {
  vi.mocked(api.get).mockResolvedValue({ data: spend() });
  const signal = new AbortController().signal;
  const result = await loadCostComparison("s1", now, signal);
  expect(result).toMatchObject({ currentUsd: 7, previousUsd: 4, unpriced: true, estimated: true });
  expect(api.get).toHaveBeenCalledWith("/billing/hosted-runtime-usage", { params: { from: "2026-10-04T00:00:00.000Z", to: "2026-10-18T00:00:00.000Z", bucket: "day" }, headers: { "X-Server-Id": "s1" }, signal });
});
test.each(["short-window", "duplicate-day", "bad-value", "currency"])("does not manufacture a cost trend from %s", async (kind) => {
  const data = spend();
  if (kind === "short-window") data.from = "2026-10-11T00:00:00Z";
  if (kind === "duplicate-day") data.periods.push(data.periods[0]);
  if (kind === "bad-value") data.periods[0].totalUsd = NaN;
  if (kind === "currency") data.currency = "EUR";
  vi.mocked(api.get).mockResolvedValue({ data });
  await expect(loadCostComparison("s1", now, new AbortController().signal)).rejects.toThrow();
});
