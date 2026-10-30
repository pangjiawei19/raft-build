import assert from "node:assert/strict";
import "./helpers/domSetup";
import { createElement } from "react";
import { createIntl } from "react-intl";
import { cleanup, fireEvent, render as rtlRender, screen } from "@testing-library/react";
import AgentProfileOverflowMenu from "../src/components/agent/AgentProfileOverflowMenu";
import { stopHostedTurnWithFeedback } from "../src/components/agent/stopHostedTurn";
import { setToastManager } from "../src/components/toastBridge";
import { mergedMessages } from "../src/i18n/messages";
import { TestIntlProvider } from "./helpers/intl";

// A hosted agent's one runtime command: stop the running turn (the agent stays).

const render: typeof rtlRender = (ui, options) => rtlRender(ui, { wrapper: TestIntlProvider, ...options });

afterEach(() => {
  cleanup();
  setToastManager(null);
});

test("a hosted agent's profile offers only 'Stop current turn', inline and in the menu", async () => {
  const calls: string[] = [];
  render(createElement(AgentProfileOverflowMenu, {
    canMessageAgent: true,
    canControlAgentRuntime: false,
    isOnline: true,
    messageLabel: "Messages",
    onMessage: () => calls.push("message"),
    onStartStop: () => calls.push("start-stop"),
    onRestartReset: () => calls.push("restart"),
    onStopHostedTurn: () => calls.push("stop-turn"),
    responsive: true,
  }));
  assert.equal(screen.getByTestId("agent-profile-inline-stop-hosted-turn").getAttribute("aria-label"), "Stop current turn");
  assert.ok(screen.queryByTestId("agent-profile-inline-start-stop") === null);
  assert.ok(screen.queryByTestId("agent-profile-inline-restart-reset") === null);

  fireEvent.click(screen.getByTestId("agent-profile-overflow-trigger"));
  await screen.findByTestId("agent-profile-overflow-menu");
  assert.deepEqual(screen.getAllByRole("menuitem").map((item) => item.textContent), ["Messages", "Stop current turn"]);
  fireEvent.click(screen.getByTestId("agent-profile-overflow-stop-hosted-turn"));
  fireEvent.click(screen.getByTestId("agent-profile-inline-stop-hosted-turn"));
  assert.deepEqual(calls, ["stop-turn", "stop-turn"], "stops at once, no confirmation");
});

test("without the command (a viewer who may not control it) nothing runtime-related is offered", () => {
  render(createElement(AgentProfileOverflowMenu, {
    canMessageAgent: false,
    canControlAgentRuntime: false,
    isOnline: true,
    messageLabel: "Messages",
    onMessage: () => undefined,
    onStartStop: () => undefined,
    onRestartReset: () => undefined,
  }));
  assert.ok(screen.queryByTestId("agent-profile-overflow-trigger") === null);
});

test("the stop says what happened in one toast; a failure offers Retry, which stops again", async () => {
  const intl = createIntl({ locale: "en", defaultLocale: "en", messages: mergedMessages("en") });
  const toasts: Array<{ title: string; type?: string; actionProps?: { children: string; onClick: () => void } }> = [];
  setToastManager({ add: (toast) => { toasts.push(toast); } });
  const results: Array<"interrupted" | "not_running" | Error> = ["interrupted", new Error("503"), "not_running"];
  let calls = 0;
  const stop = async () => {
    calls += 1;
    const next = results.shift()!;
    if (next instanceof Error) throw next;
    return next;
  };

  await stopHostedTurnWithFeedback(stop, intl.formatMessage);
  assert.deepEqual(toasts.map((t) => [t.title, t.type]), [["Stopped the current turn.", "success"]]);

  await stopHostedTurnWithFeedback(stop, intl.formatMessage);
  const failed = toasts.at(-1)!;
  assert.deepEqual([failed.title, failed.type, failed.actionProps?.children], ["Couldn't stop the current turn.", "error", "Retry"]);
  failed.actionProps!.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 3);
  assert.equal(toasts.at(-1)!.title, "Nothing was running.");
});
