import assert from "node:assert/strict";
import "./helpers/domSetup";
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { ANTIPROTON_HOSTED_RUNTIME_FEATURE_FLAG_KEY } from "@botiverse/raft-shared";
import type { AgentHostedRuntimeSummary } from "@botiverse/raft-shared";

import api from "../src/api/client";
import { describeHostedRuntime, HostedRuntimeStatus } from "../src/components/agent/HostedRuntimeStatus";
import { hostedModelPickerShown, initialHostedModel } from "../src/components/agent/HostedModelChoice";
import { useAgentRuntimeProvider } from "../src/hooks/useAgentRuntimeProvider";
import { setServerFeatureFlagForTests } from "../src/store/serverFeatureFlags";
import { en as enMessages } from "../src/i18n/messages/en";
import { zhCn as zhMessages } from "../src/i18n/messages/zh-cn";
import { useServerStore } from "../src/store/serverStore";
import { TestIntlProvider } from "./helpers/intl";

const en = enMessages as Record<string, string>;
const zh = zhMessages as Record<string, string>;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useServerStore.setState({ current: null, servers: [], members: [] } as never);
});

function summary(overrides: Partial<AgentHostedRuntimeSummary>): AgentHostedRuntimeSummary {
  return {
    provider: "antiproton",
    state: "active",
    providerAgentId: "raft_agent",
    syncPending: false,
    push: { registered: true, error: null },
    lastError: null,
    attemptCount: 0,
    nextAttemptAt: null,
    activatedAt: "2026-09-28T00:00:00.000Z",
    retryNeedsModel: false,
    ...overrides,
  };
}

test("hosted runtime states map to labels, polling and retry availability", () => {
  assert.deepEqual(describeHostedRuntime(summary({ state: "provisioning", lastError: null })), {
    labelId: "agent.detail.hostedRuntime.state.provisioning", inProgress: true, canRetry: false,
  });
  assert.equal(describeHostedRuntime(summary({ state: "active" })).inProgress, false);
  assert.equal(describeHostedRuntime(summary({ state: "active", syncPending: true })).labelId, "agent.detail.hostedRuntime.state.syncing");
  assert.equal(describeHostedRuntime(summary({ state: "failed" })).canRetry, true);
  assert.equal(describeHostedRuntime(summary({ state: "deleting" })).canRetry, false);
  for (const id of Object.keys(en).filter((key) => key.startsWith("agent.detail.hostedRuntime.") || key.startsWith("agent.create.hostedRuntime.") || key.startsWith("agent.create.hostedModel."))) {
    assert.ok(zh[id], `${id} has a zh-cn translation`);
  }
});

test("a failed provisioning shows the provider error and retries", async () => {
  let retried = 0;
  render(
    <TestIntlProvider>
      <HostedRuntimeStatus
        summary={summary({
          state: "failed",
          providerAgentId: null,
          push: null,
          lastError: { code: "idempotency_conflict", message: "edits go through PATCH", httpStatus: 409, at: "2026-09-28T00:00:00.000Z" },
        })}
        onRetry={async () => { retried += 1; }}
      />
    </TestIntlProvider>,
  );
  assert.ok(screen.queryByText(en["agent.detail.hostedRuntime.state.failed"]) !== null);
  assert.equal(screen.getByTestId("hosted-runtime-free").textContent, "Free for a limited time");
  assert.match(screen.getByTestId("agent-hosted-runtime-error").textContent ?? "", /idempotency_conflict.*edits go through PATCH/);
  fireEvent.click(screen.getByRole("button", { name: en["agent.detail.hostedRuntime.retry"] }));
  await waitFor(() => assert.equal(retried, 1));
});

test("Run on antiproton is offered only when the server flag is on and the deployment reports it available", async () => {
  useServerStore.setState({ current: { id: "server-1", role: "admin" }, members: [] } as never);
  const get = vi.spyOn(api, "get").mockImplementation(async () => ({ data: { kind: "antiproton", available: true } }) as never);

  setServerFeatureFlagForTests("server-1", ANTIPROTON_HOSTED_RUNTIME_FEATURE_FLAG_KEY, false);
  const off = renderHook(() => useAgentRuntimeProvider("antiproton"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(off.result.current.available, false);
  assert.equal(get.mock.calls.length, 0, "no probe while the flag is off");
  off.unmount();

  setServerFeatureFlagForTests("server-1", ANTIPROTON_HOSTED_RUNTIME_FEATURE_FLAG_KEY, true);
  const on = renderHook(() => useAgentRuntimeProvider("antiproton"));
  await waitFor(() => assert.equal(on.result.current.available, true));
  assert.equal(get.mock.calls[0]?.[0], "/agent-runtime-providers/antiproton");
  on.unmount();

  get.mockImplementation(async () => ({ data: { kind: "antiproton", available: false } }) as never);
  const unconfigured = renderHook(() => useAgentRuntimeProvider("antiproton"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(unconfigured.result.current.available, false, "flag on but deployment not configured");
});

const MODELS = {
  models: [
    { id: "deepseek-flash", label: "DeepSeek Flash", provider: "deepseek" },
    { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", provider: "cloudflare" },
  ],
  default: "deepseek-flash",
  defaultLabel: "DeepSeek Flash",
  locked: false,
};

test("a new hosted agent starts on the provider's default (DeepSeek Flash); the picker shows unless the server may not pick", () => {
  assert.equal(initialHostedModel(MODELS), null);
  assert.equal(initialHostedModel({ ...MODELS, locked: true }), null);
  assert.equal(hostedModelPickerShown(MODELS), true, "older servers send no `picker`");
  assert.equal(hostedModelPickerShown({ ...MODELS, picker: true }), true);
  assert.equal(hostedModelPickerShown({ ...MODELS, picker: false }), false);
});

test("after the provider refused the model, Retry names the model it will use and sends it", async () => {
  vi.spyOn(api, "get").mockImplementation(async () => ({ data: MODELS }) as never);
  const retries: unknown[] = [];
  render(
    <TestIntlProvider>
      <HostedRuntimeStatus
        summary={summary({
          state: "failed",
          providerAgentId: null,
          push: null,
          retryNeedsModel: true,
          lastError: { code: "unknown_model", message: "gpt-5.6-luna is not offered", httpStatus: 422, at: "2026-10-13T00:00:00.000Z" },
        })}
        onRetry={async (options) => { retries.push(options); }}
      />
    </TestIntlProvider>,
  );
  assert.ok(screen.getByText(en["agent.detail.hostedRuntime.retryNeedsModel"]));
  // Never a silent default: the button says which model the retry uses.
  const retry = await screen.findByRole("button", { name: "Retry with Default (DeepSeek Flash)" });
  fireEvent.click(retry);
  await waitFor(() => assert.deepEqual(retries, [{ model: null }]));

  const box = screen.getByTestId("agent-hosted-runtime-retry-model-select");
  fireEvent.focus(box);
  fireEvent.keyDown(box, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: "GPT-5.6 Luna" }));
  fireEvent.click(await screen.findByRole("button", { name: "Retry with GPT-5.6 Luna" }));
  await waitFor(() => assert.deepEqual(retries, [{ model: null }, { model: "gpt-5.6-luna" }]));
});

test("any other refusal keeps the plain Retry without a model", async () => {
  const get = vi.spyOn(api, "get");
  const retries: unknown[] = [];
  render(
    <TestIntlProvider>
      <HostedRuntimeStatus
        summary={summary({
          state: "failed",
          lastError: { code: "agent_id_taken", message: "taken", httpStatus: 409, at: "2026-10-13T00:00:00.000Z" },
        })}
        onRetry={async (options) => { retries.push(options); }}
      />
    </TestIntlProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: en["agent.detail.hostedRuntime.retry"] }));
  await waitFor(() => assert.deepEqual(retries, [undefined]));
  assert.equal(get.mock.calls.length, 0, "no model list is fetched");
});
