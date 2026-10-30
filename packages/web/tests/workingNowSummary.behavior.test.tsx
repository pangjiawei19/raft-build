import assert from "node:assert/strict";
import "./helpers/domSetup";
import { act } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import WorkingNowSummary, {
  useClearLiveAgentActivityOnServerChange,
} from "../src/components/layout/WorkingNowSummary";
import {
  SHOW_LIVE_AGENT_ACTIVITY_BAR_STORAGE_KEY,
  useAppearanceStore,
} from "../src/store/appearanceStore";
import { useLiveAgentActivityStore } from "../src/store/liveAgentActivityStore";
import type { LiveAgentActivityItem } from "../src/utils/liveAgentActivity";
import { TestIntlProvider } from "./helpers/intl";

afterEach(() => {
  cleanup();
  useLiveAgentActivityStore.setState({ items: [] });
  useAppearanceStore.setState({ showLiveAgentActivityBar: true } as never);
  localStorage.removeItem(SHOW_LIVE_AGENT_ACTIVITY_BAR_STORAGE_KEY);
});

function working(agentId: string, agentName: string, text: string): LiveAgentActivityItem {
  return {
    id: `activity-${agentId}`,
    kind: "activity",
    agentId,
    agentName,
    agentAvatarUrl: null,
    text,
    context: null,
    activity: "working",
    createdAt: Date.now(),
    startedAt: Date.now(),
    idleSince: null,
  };
}

function renderSummary(variant?: "count" | "full") {
  return render(
    <MemoryRouter>
      <TestIntlProvider>
        <WorkingNowSummary variant={variant} />
      </TestIntlProvider>
    </MemoryRouter>,
  );
}

test("nobody working: the summary takes no space", () => {
  const view = renderSummary();
  assert.equal(view.container.innerHTML, "");
});

test("the summary shows up to three faces and the number of working agents", () => {
  useLiveAgentActivityStore.setState({
    items: [
      working("a1", "Wug", "Drafting launch notes"),
      working("a2", "Bugen", "Editing Flow.tsx"),
      working("a3", "Martin", "Reviewing #26"),
      working("a4", "Box", "Running tests"),
    ],
  });
  renderSummary();
  const trigger = screen.getByTestId("working-now-summary");
  assert.equal(trigger.getAttribute("aria-label"), "4 agents working");
  assert.match(trigger.textContent ?? "", /4/);
  assert.equal(trigger.querySelectorAll("img, svg, canvas").length > 0 || trigger.children.length > 0, true);
  // The faces are raft-ui identity stickers (DS xs, 19), never a hand-drawn frame.
  const faces = within(trigger).getByTestId("working-faces");
  assert.equal(faces.getAttribute("aria-hidden"), "true");
  const avatars = faces.querySelectorAll('[data-slot="avatar"]');
  assert.equal(avatars.length, 3, "at most three faces");
  for (const avatar of avatars) {
    assert.equal(avatar.getAttribute("data-avatar-context"), "face-stack");
    assert.equal(avatar.getAttribute("data-size"), "xs");
  }
});

test("each Working now row is a raft-ui avatar whose badge is the agent's presence light", () => {
  useLiveAgentActivityStore.setState({
    items: [
      working("a1", "Wug", "Drafting launch notes"),
      { ...working("a2", "Bugen", "Editing Flow.tsx"), activity: "error" },
    ],
  });
  renderSummary();
  fireEvent.click(screen.getByTestId("working-now-summary"));
  const rows = screen.getByTestId("working-now-list").querySelectorAll("li");
  assert.equal(rows.length, 2);
  const lights = [...rows].map((row) => {
    const avatar = row.querySelector('[data-slot="avatar"]');
    assert.ok(avatar);
    assert.equal(avatar.getAttribute("data-avatar-context"), "compact-row");
    const badge = avatar.querySelector('[data-slot="avatar-badge"]');
    assert.ok(badge, "the status light sits in raft-ui's AvatarBadge corner");
    // raft-ui AvatarBadge `presence`: its own default dot, coloured from
    // raft-ui's one presence map.
    assert.equal(badge.childElementCount, 0, "the badge's own dot, no hand-made light inside it");
    return badge.className;
  });
  assert.match(lights[0], /\[--status-color:var\(--presence-busy\)\]/, "working is the busy light");
  assert.match(lights[1], /\[--status-color:var\(--presence-error\)\]/, "an error is the error light");
});

test("the full variant says how many agents are working", () => {
  useLiveAgentActivityStore.setState({ items: [working("a1", "Wug", "Drafting launch notes")] });
  renderSummary("full");
  assert.match(screen.getByTestId("working-now-summary").textContent ?? "", /1 agent working/);
});

test("opening the summary lists each working agent and what it is doing", () => {
  useLiveAgentActivityStore.setState({
    items: [working("a1", "Wug", "Drafting launch notes"), working("a2", "Bugen", "Editing Flow.tsx")],
  });
  renderSummary();
  fireEvent.click(screen.getByTestId("working-now-summary"));
  const list = screen.getByTestId("working-now-list");
  assert.match(list.textContent ?? "", /Working now/);
  assert.match(list.textContent ?? "", /Wug/);
  assert.match(list.textContent ?? "", /Drafting launch notes/);
  assert.match(list.textContent ?? "", /Bugen/);
  assert.match(list.textContent ?? "", /Editing Flow\.tsx/);
});

test("the Appearance preference hides the summary without discarding activity", () => {
  useLiveAgentActivityStore.setState({ items: [working("a1", "Runner", "Thinking…")] });
  renderSummary();
  assert.ok(screen.getByTestId("working-now-summary"));

  act(() => {
    useAppearanceStore.getState().setShowLiveAgentActivityBar(false);
  });

  assert.ok(screen.queryByTestId("working-now-summary") === null);
  assert.equal(localStorage.getItem(SHOW_LIVE_AGENT_ACTIVITY_BAR_STORAGE_KEY), "false");
  assert.equal(useLiveAgentActivityStore.getState().items.length, 1);
});

function ServerActivityBoundary({ serverId }: { serverId: string }) {
  useClearLiveAgentActivityOnServerChange(serverId);
  return null;
}

test("changing servers synchronously clears live activity from the previous server", () => {
  const view = render(<ServerActivityBoundary serverId="server-a" />);
  useLiveAgentActivityStore.setState({ items: [working("a1", "Runner", "Old server work")] });

  view.rerender(<ServerActivityBoundary serverId="server-b" />);
  assert.deepEqual(useLiveAgentActivityStore.getState().items, []);
});
