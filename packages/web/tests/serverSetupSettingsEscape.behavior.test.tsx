import assert from "node:assert/strict";
import "./helpers/domSetup";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import api from "../src/api/client";
import ServerSetupProjectionGate, { isServerSettingsPath } from "../src/components/onboarding/ServerSetupProjectionGate";
import { useServerSetupRevision } from "../src/components/onboarding/serverSetupProjection";
import { useMachineStore } from "../src/store/machineStore";
import { TestIntlProvider } from "./helpers/intl";

/**
 * Task #246: the setup footer links to server settings so an owner can delete a
 * half-built server there. That only works if the blocking modal stays down on
 * settings, and only stays safe if it still blocks everywhere else.
 */

const BLOCKING_PROJECTION = {
  surface: "computer_runtime",
  phase: "in_progress",
  currentStep: "computer_runtime",
  blocksChat: true,
  allowedExits: ["defer", "return_to_server"],
  sideEffectState: { transitions: "enabled", completion: "disabled" },
  gateReason: "runtime_checking",
  computerStatus: "online",
  runtimeStatus: "checking",
  postSetup: { surveyPending: false, handoffPending: false },
};

const originalGet = api.get.bind(api);
let projectionReads = 0;

beforeEach(() => {
  useServerSetupRevision.setState({ revision: 0 });
  projectionReads = 0;
  api.get = (async (url: string) => {
    if (!url.includes("/setup-projection")) return { data: [] };
    projectionReads += 1;
    return { data: BLOCKING_PROJECTION };
  }) as typeof api.get;
});

afterEach(() => {
  api.get = originalGet as typeof api.get;
  cleanup();
  useMachineStore.setState(useMachineStore.getInitialState(), true);
});

function renderGateAt(path: string) {
  return render(
    <TestIntlProvider>
      <MemoryRouter initialEntries={[path]}>
        <ServerSetupProjectionGate serverId="server-1" serverSlug="acme" />
      </MemoryRouter>
    </TestIntlProvider>,
  );
}

test("the blocking setup modal is up on a normal server route", async () => {
  renderGateAt("/s/acme/channel/all");
  await waitFor(() => assert.ok(screen.getByRole("heading", { name: "Connect a computer" })));
});

test("the same blocking setup stays down on server settings, after the projection has loaded", async () => {
  renderGateAt("/s/acme/settings/server");
  await waitFor(() => assert.ok(projectionReads >= 1, "the gate did read the blocking projection"));
  // Let the resolved projection render before asserting absence.
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(screen.queryByRole("heading", { name: "Connect a computer" }) === null, "setup modal must not cover settings");
});

test("only this server's settings routes count as the escape", () => {
  assert.equal(isServerSettingsPath("/s/acme/settings", "acme"), true);
  assert.equal(isServerSettingsPath("/s/acme/settings/server", "acme"), true);
  assert.equal(isServerSettingsPath("/s/acme/settingsx", "acme"), false);
  assert.equal(isServerSettingsPath("/s/other/settings/server", "acme"), false);
  assert.equal(isServerSettingsPath("/s/acme/tasks", "acme"), false);
});
