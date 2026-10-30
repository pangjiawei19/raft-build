import "./helpers/domSetup";

import assert from "node:assert/strict";
import { cleanup, fireEvent, render as rtlRender, screen } from "@testing-library/react";
import SetupSessionFooter from "../src/components/onboarding/SetupSessionFooter";
import { useServerStore } from "../src/store/serverStore";
import { TestIntlProvider } from "./helpers/intl";

const render: typeof rtlRender = (ui, options) =>
  rtlRender(ui, { wrapper: TestIntlProvider, ...options });

const originalClearCurrent = useServerStore.getState().clearCurrent;

function seedServer(role: "owner") {
  useServerStore.setState({
    current: { id: "server-1", name: "Acme", slug: "acme", role } as never,
    members: [],
  });
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/");
  useServerStore.setState({ clearCurrent: originalClearCurrent, current: null, members: [] });
});

test("setup escape link navigates to the Choose server page without logging out", () => {
  let clearCurrentCalls = 0;
  useServerStore.setState({
    clearCurrent: () => {
      clearCurrentCalls += 1;
    },
  });

  window.history.replaceState({}, "", "/s/test/setup");
  render(<SetupSessionFooter />);

  fireEvent.click(screen.getByTestId("setup-switch-server"));
  assert.equal(clearCurrentCalls, 1);
  assert.equal(window.location.pathname, "/servers");
  assert.equal(screen.queryByTestId("setup-log-out"), null);
});

test("setup escape link is disabled with the owning setup action", () => {
  render(<SetupSessionFooter disabled />);

  assert.equal((screen.getByTestId("setup-switch-server") as HTMLButtonElement).disabled, true);
  assert.equal(screen.queryByTestId("setup-start-over"), null);
});

// task #246 (replaces task #141's in-modal Delete): the footer opens the
// server's own settings, where Delete already lives. The setup gate stays down
// on settings routes (serverSetupSettingsEscape.behavior.test.tsx).
test("the setup footer opens server settings instead of deleting in place", () => {
  seedServer("owner");
  window.history.replaceState({}, "", "/s/acme");
  render(<SetupSessionFooter showServerSettings />);

  assert.ok(screen.queryByTestId("setup-delete-server") === null);
  fireEvent.click(screen.getByTestId("setup-server-settings"));
  assert.equal(window.location.pathname, "/s/acme/settings/server");
});

test("the settings link is disabled with the owning setup action", () => {
  seedServer("owner");
  render(<SetupSessionFooter disabled showServerSettings />);
  assert.equal((screen.getByTestId("setup-server-settings") as HTMLButtonElement).disabled, true);
});

test("steps after the server works (survey, handoff) offer no settings link", () => {
  seedServer("owner");
  render(<SetupSessionFooter />);
  assert.ok(screen.getByTestId("setup-switch-server"));
  assert.ok(screen.queryByTestId("setup-server-settings") === null);
});
