import assert from "node:assert/strict";
import "./helpers/domSetup";
import { cleanup, render, screen } from "@testing-library/react";
import api from "../src/api/client";
import { AgentHostedRuntimeUsage } from "../src/components/agent/AgentHostedRuntimeUsage";
import type { HostedRuntimeUsageResponse, HostedRuntimeUsageRow } from "../src/components/agent/hostedRuntimeUsage";
import { TestIntlProvider } from "./helpers/intl";

const originalGet = api.get;

afterEach(() => {
  cleanup();
  api.get = originalGet;
});

function mockUsage(rows: HostedRuntimeUsageRow[]) {
  const calls: Array<{ url: string; params: unknown }> = [];
  const usage: HostedRuntimeUsageResponse = {
    raftAgentId: "agent-1", bucket: "1d", from: "2026-10-06T00:00:00.000Z", to: "2026-10-12T12:00:00.000Z",
    asOf: "2026-10-12T12:00:00.000Z", partial: false, rows,
  };
  api.get = (async (url: string, config?: { params?: unknown }) => {
    calls.push({ url, params: config?.params });
    return { data: usage };
  }) as typeof api.get;
  return calls;
}

const tokens = (day: string, quantity: number, cost?: number | null): HostedRuntimeUsageRow =>
  ({ at: `${day}T00:00:00.000Z`, resource: "model.tokens", dimensions: { model: "m1", kind: "input" }, unit: "tokens", quantity, ...(cost === undefined ? {} : { cost }) });

function renderUsage() {
  return render(<TestIntlProvider locale="en"><AgentHostedRuntimeUsage agentId="agent-1" /></TestIntlProvider>);
}

test("shows USD by UTC day with a total; tiny amounts and unpriced usage are labelled, never shown as $0", async () => {
  const calls = mockUsage([
    tokens("2026-10-11", 100, 1.5),
    tokens("2026-10-12", 10, 0.004),
    { at: "2026-10-12T00:00:00.000Z", resource: "tool.call", dimensions: { outcome: "succeeded" }, unit: "calls", quantity: 3, cost: null },
  ]);
  renderUsage();
  const cost = await screen.findByTestId("agent-hosted-runtime-cost");
  const text = cost.textContent ?? "";
  assert.match(text, /Oct 12under \$0\.01/);
  assert.match(text, /Oct 11\$1\.50/);
  assert.match(text, /Total\$1\.50/);
  assert.ok(text.indexOf("Oct 12") < text.indexOf("Oct 11"), "newest day first");
  assert.match(screen.getByTestId("agent-hosted-runtime-usage").textContent ?? "", /has no price and is not included/);
  const params = calls[0]!.params as { from: string; bucket: string };
  assert.equal(params.bucket, "1d");
  assert.match(params.from, /T00:00:00\.000Z$/, "the window starts at UTC midnight");
});

test("when all usage is unpriced the total reads Unpriced, never $0.00", async () => {
  mockUsage([
    { at: "2026-10-12T00:00:00.000Z", resource: "tool.call", dimensions: { outcome: "succeeded" }, unit: "calls", quantity: 3, cost: null },
    tokens("2026-10-12", 10, null),
  ]);
  renderUsage();
  const text = (await screen.findByTestId("agent-hosted-runtime-cost")).textContent ?? "";
  assert.match(text, /Oct 12Unpriced/);
  assert.match(text, /TotalUnpriced/);
  assert.doesNotMatch(text, /\$0\.00/);
});

test("no cost block when the provider sends no cost", async () => {
  mockUsage([tokens("2026-10-12", 10)]);
  renderUsage();
  await screen.findByText("Total tokens");
  assert.ok(screen.queryByTestId("agent-hosted-runtime-cost") === null);
});
