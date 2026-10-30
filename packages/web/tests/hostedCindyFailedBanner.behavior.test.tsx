import "./helpers/domSetup";

import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import HostedCindyFailedBanner from "../src/components/agent/HostedCindyFailedBanner";
import api from "../src/api/client";
import { useAgentStore } from "../src/store/agentStore";
import type { Agent } from "../src/store/agentStore";
import { useMachineStore } from "../src/store/machineStore";
import { useServerStore } from "../src/store/serverStore";
import { TestIntlProvider } from "./helpers/intl";

/**
 * A hosted Cindy that could not start (#raft-antiproton:8008c6f0): her DM says so once the
 * server reports her setup as failed, and offers the computer path (the onboarding Create
 * Cindy dialog, whose create converts her in place).
 */

const originalGet = api.get;
const originalPost = api.post;

const CINDY = {
  id: "cindy-1", name: "Cindy", displayName: "Cindy", runtime: "external", external: true, machineId: null,
} as unknown as Agent;

function seed(onboardingAgentId: string | null, onboardingSetup: "usable" | "failed" | null) {
  useServerStore.setState({
    current: {
      id: "server-1", name: "Launch", slug: "launch", avatarUrl: null, ownerId: "owner-1", onboardingAgentId,
      hideHumansFromMembers: false, plan: "free", planDowngradedAt: null, role: "owner", createdAt: "2026-10-14T00:00:00.000Z",
    },
  } as never);
  useMachineStore.setState({ machines: [] } as never);
  const gets: string[] = [];
  api.get = (async (url: string) => {
    gets.push(url);
    if (url === `/agents/${CINDY.id}/hosted-runtime`) return { data: { hostedRuntime: { state: "failed" }, onboardingSetup } } as never;
    return { data: {} } as never;
  }) as typeof api.get;
  return { gets };
}

function renderBanner(agent: Agent = CINDY) {
  render(
    <TestIntlProvider locale="en">
      <MemoryRouter initialEntries={["/s/launch"]}>
        <HostedCindyFailedBanner agent={agent} />
      </MemoryRouter>
    </TestIntlProvider>,
  );
}

afterEach(() => {
  cleanup();
  api.get = originalGet;
  api.post = originalPost;
  useAgentStore.setState(useAgentStore.getInitialState(), true);
  useMachineStore.setState(useMachineStore.getInitialState(), true);
  useServerStore.setState(useServerStore.getInitialState(), true);
});

test("a failed hosted Cindy's DM shows the banner, and its button opens the onboarding Create Cindy dialog", async () => {
  seed(CINDY.id, "failed");
  renderBanner();
  const banner = await screen.findByTestId("hosted-cindy-failed-banner");
  assert.match(banner.textContent ?? "", /couldn't start in the cloud/);
  fireEvent.click(screen.getByRole("button", { name: "Connect a computer" }));
  assert.ok(await screen.findByTestId("create-cindy-screen-c"), "the onboarding Create Cindy screen, which connects a computer first when there is none");
});

test("no banner while she is usable (still within the server's timeout and retry)", async () => {
  const { gets } = seed(CINDY.id, "usable");
  renderBanner();
  await waitFor(() => assert.ok(gets.includes(`/agents/${CINDY.id}/hosted-runtime`)));
  assert.ok(screen.queryByTestId("hosted-cindy-failed-banner") === null);
});

test("no banner and no status read for an agent that is not the server's hosted Cindy", async () => {
  const { gets } = seed("someone-else", "failed");
  renderBanner();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(screen.queryByTestId("hosted-cindy-failed-banner") === null);
  assert.deepEqual(gets, []);
});

test("creating an agent that comes back with an existing id replaces it instead of listing it twice", async () => {
  seed(CINDY.id, "failed");
  useAgentStore.setState({ agents: [CINDY] } as never);
  api.post = (async () => ({ data: { ...CINDY, runtime: "codex", external: false, machineId: "machine-1", status: "inactive" } })) as typeof api.post;
  await useAgentStore.getState().createAgent("Cindy", { onboarding: true, runtime: "codex" } as never);
  const agents = useAgentStore.getState().agents;
  assert.equal(agents.length, 1);
  assert.equal(agents[0]!.runtime, "codex");
});
