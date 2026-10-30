import "./helpers/domSetup";

import assert from "node:assert/strict";
import { cleanup, render } from "@testing-library/react";
import AgentActivityDot from "../src/components/agent/AgentActivityDot";
import StatusDot from "../src/components/ui/StatusDot";
import { TestIntlProvider } from "./helpers/intl";
import { useAgentStore } from "../src/store/agentStore";

afterEach(() => {
  cleanup();
  useAgentStore.setState({ agents: [], agentActivities: {} } as never);
});

// The pixel is raft-ui `Status`: its presence light is the `data-presence` it
// publishes (the colour comes from raft-ui's one presence map).
const presenceOf = (el: Element | null | undefined) => el?.getAttribute("data-presence") ?? null;

test("StatusDot external prop forces the external presence light regardless of activity", () => {
  const external = render(<StatusDot activity="online" external />);
  assert.equal(
    presenceOf(external.container.firstElementChild),
    "external",
    "external=true must produce the external (cyan) presence light, ignoring activity",
  );
  cleanup();

  const managed = render(<StatusDot activity="online" />);
  assert.equal(
    presenceOf(managed.container.firstElementChild),
    "online",
    "managed online remains the online light so the external override is not vacuous",
  );
});

test("StatusDot is the DS presence pixel: square, ink-edged, static", () => {
  const el = render(<StatusDot activity="working" />).container.firstElementChild;
  assert.equal(el?.getAttribute("data-slot"), "status", "the pixel is raft-ui Status");
  assert.equal(presenceOf(el), "busy", "working maps onto the busy light");
  const dot = el?.className ?? "";
  assert.match(dot, /rounded-\[2px\] border-\[1\.5px\] border-sticker-ink/);
  assert.doesNotMatch(dot, /rounded-full|animate-/);
  cleanup();
  const offline = render(<StatusDot />).container.firstElementChild;
  assert.equal(presenceOf(offline), "offline", "no activity and no tone falls back to the offline stone light");
});

test("AgentActivityDot passes external agent identity through to StatusDot", () => {
  useAgentStore.setState({
    agents: [
      {
        id: "agent-external",
        name: "ext",
        displayName: "External",
        status: "active",
        avatarUrl: null,
        external: true,
        runtime: "external",
      },
      {
        id: "agent-managed",
        name: "local",
        displayName: "Local",
        status: "active",
        avatarUrl: null,
        external: false,
        runtime: "builtin",
      },
    ],
    agentActivities: {},
  } as never);

  const external = render(
    <TestIntlProvider>
      <AgentActivityDot agentId="agent-external" />
    </TestIntlProvider>,
  );
  assert.equal(
    presenceOf(external.container.firstElementChild),
    "external",
    "external agents must render the neutral cyan status dot",
  );
  cleanup();

  const managed = render(
    <TestIntlProvider>
      <AgentActivityDot agentId="agent-managed" />
    </TestIntlProvider>,
  );
  assert.equal(
    presenceOf(managed.container.firstElementChild),
    "online",
    "managed online agents still use the lime liveness dot",
  );
});
