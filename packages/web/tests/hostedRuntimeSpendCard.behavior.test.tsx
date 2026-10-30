import assert from "node:assert/strict";
import "./helpers/domSetup";
import { cleanup, render, screen } from "@testing-library/react";
import type { HostedRuntimeSpendView } from "@botiverse/raft-shared";
import api from "../src/api/client";
import { HOSTED_RUNTIME_SPEND_PATH, HostedRuntimeSpendCard } from "../src/components/settings/HostedRuntimeSpendCard";
import { TestIntlProvider } from "./helpers/intl";

const originalGet = api.get;

afterEach(() => {
  cleanup();
  api.get = originalGet;
});

const SPEND: HostedRuntimeSpendView = {
  currency: "USD",
  estimated: true,
  today: { day: "2026-10-13", spentUsd: 1.84, limitUsd: 5, exempt: false, platformLimitReached: false, refusing: false, resetsAt: "2026-10-14T00:00:00.000Z" },
  from: "2026-09-14T00:00:00.000Z",
  to: "2026-10-14T00:00:00.000Z",
  bucket: "day",
  totalUsd: 1.8402542,
  periods: [
    { start: "2026-10-13T00:00:00.000Z", totalUsd: 1.84, unpriced: ["tool.call js.run calls"] },
    { start: "2026-10-12T00:00:00.000Z", totalUsd: 0.0002542, unpriced: [] },
  ],
  agents: [
    { agentId: "agent-1", name: "Builder", totalUsd: 1.5 },
    { agentId: null, name: null, totalUsd: 0.34 },
  ],
};

function mockGet(answer: HostedRuntimeSpendView | { status: number }) {
  const calls: string[] = [];
  api.get = (async (url: string) => {
    calls.push(url);
    if ("status" in answer) throw { response: { status: answer.status } };
    return { data: answer };
  }) as typeof api.get;
  return calls;
}

function renderCard() {
  return render(<TestIntlProvider locale="en"><HostedRuntimeSpendCard /></TestIntlProvider>);
}

test("shows today against the limit, the last 30 days by UTC day and spend by agent, marked estimated", async () => {
  const calls = mockGet(SPEND);
  renderCard();
  const today = await screen.findByTestId("hosted-runtime-spend-today");
  assert.equal(calls[0], HOSTED_RUNTIME_SPEND_PATH);
  assert.equal(today.textContent, "$1.84 of the $5.00 daily limit");
  assert.equal(screen.getByTestId("hosted-runtime-spend-total").textContent, "$1.84");
  const days = screen.getByTestId("hosted-runtime-spend-days").textContent ?? "";
  assert.match(days, /Oct 13\$1\.84/);
  assert.match(days, /Oct 12under \$0\.01/, "a fraction of a cent never reads $0.00");
  const agents = screen.getByTestId("hosted-runtime-spend-agents").textContent ?? "";
  assert.match(agents, /Builder\$1\.50/);
  assert.match(agents, /Deleted agents\$0\.34/);
  const card = screen.getByTestId("hosted-runtime-spend").textContent ?? "";
  assert.match(card, /has no price and is not included/);
  assert.match(card, /Estimated, in USD/);
  assert.ok(screen.queryByTestId("hosted-runtime-spend-refusing") === null);
});

test("a refusing server says so; no limit reads as such", async () => {
  mockGet({ ...SPEND, today: { ...SPEND.today, limitUsd: null, exempt: true, refusing: true, platformLimitReached: true } });
  renderCard();
  const refusing = await screen.findByTestId("hosted-runtime-spend-refusing");
  assert.match(refusing.textContent ?? "", /platform's daily limit has been reached/);
  assert.equal(screen.getByTestId("hosted-runtime-spend-today").textContent, "$1.84, no daily limit");
});

test("hidden when the server has no hosted runtime or the viewer may not see it", async () => {
  for (const status of [403, 404]) {
    const calls = mockGet({ status });
    const { container } = renderCard();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls.length, 1);
    assert.ok(container.querySelector("[data-testid=hosted-runtime-spend]") === null, String(status));
    cleanup();
  }
});

test("a provider failure shows a warning", async () => {
  mockGet({ status: 502 });
  renderCard();
  await screen.findByText("Failed to load cloud agent spend");
});
