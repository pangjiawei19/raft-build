import assert from "node:assert/strict";
import { act } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import api from "../src/api/client";
import Sidebar, { AgentDmRow } from "../src/components/layout/Sidebar";
import { MemberAgentRow } from "../src/components/layout/MemberAgentRow";
import { TestIntlProvider } from "./helpers/intl";
import type { Agent } from "../src/store/agentStore";
import { useAgentStore } from "../src/store/agentStore";
import { useAppearanceStore } from "../src/store/appearanceStore";
import { useAuthStore } from "../src/store/authStore";
import type { Channel } from "../src/store/channelStore";
import { useChannelStore } from "../src/store/channelStore";
import { useLiveAgentActivityStore } from "../src/store/liveAgentActivityStore";
import { useMachineStore } from "../src/store/machineStore";
import { useMessageStore } from "../src/store/messageStore";
import { useServerStore } from "../src/store/serverStore";

/**
 * Raft Design System › Sidebar rows (`rf-srow__meta`): an agent row's right
 * side is its runtime in mono, or — while it works — what it is doing
 * (`rf-srow__meta--live`); an unread count takes its place (one badge per
 * row). The meta is visual only, so the row's accessible name stays the
 * agent's name. The Chat head carries who is working; nothing sits under the list.
 */

const originalApiGet = api.get;

afterEach(() => {
  api.get = originalApiGet;
  cleanup();
  useMessageStore.setState({ unreadCounts: {}, drafts: {} });
  useAgentStore.setState({ agents: [], agentActivities: {} });
  useLiveAgentActivityStore.setState({ items: [] });
  useChannelStore.setState({ channels: [], dmChannels: [], channelActivity: {}, loading: true });
  useMachineStore.setState({ machines: [], loading: true });
  useServerStore.setState({ current: null, servers: [], members: [] });
  useAuthStore.setState({ user: null });
});

const noop = () => {};
const noopAsync = async () => {};
const longPress = () => ({}) as never;
const CHAT_ROOT_ENTRIES = ["/s/server"];

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    name: "wug",
    displayName: "Wug",
    avatarUrl: null,
    description: null,
    status: "active",
    model: "gpt",
    runtime: "codex",
    serverRole: null,
    reasoningEffort: null,
    executionMode: "cloud",
    envVars: null,
    machineId: null,
    creatorType: null,
    creatorId: null,
    creator: null,
    createdAgents: [],
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function dm(): Channel {
  return {
    id: "dm-1",
    name: "Agent DM",
    description: null,
    type: "dm",
    createdAt: "2026-01-01T00:00:00.000Z",
    peerType: "agent",
    peerId: "agent-1",
    peerName: "wug",
    peerDisplayName: "Wug",
    peerAvatarUrl: null,
  };
}

function renderDmRow(rowAgent: Agent = agent()) {
  useAgentStore.setState({ agents: [rowAgent] });
  return render(
    <TestIntlProvider>
      <AgentDmRow
        agent={rowAgent}
        dmId="dm-1"
        dm={dm()}
        selected={false}
        menuOpen={false}
        onSelect={noop}
        onContextMenu={noop}
        makeLongPress={longPress}
      />
    </TestIntlProvider>,
  );
}

test("an idle agent row shows its runtime in mono, hidden from the accessible name", () => {
  renderDmRow();

  const runtime = screen.getByTestId("sidebar-agent-runtime");
  assert.equal(runtime.textContent, "Codex CLI");
  assert.match(runtime.className, /(?:^|\s)font-mono(?:\s|$)/);
  assert.equal(runtime.getAttribute("aria-hidden"), "true");
  assert.ok(screen.queryByTestId("sidebar-agent-live-meta") === null);
  assert.ok(screen.getByRole("button", { name: "Wug" }), "the runtime never joins the row's name");
});

test("a working agent row swaps its runtime for what it is doing, and back when it stops", () => {
  renderDmRow();

  act(() => {
    useAgentStore.setState({
      agentActivities: {
        "agent-1": { activity: "working", activityDetail: "Editing Flow.tsx", detailKind: "none" },
      },
    } as never);
  });
  const live = screen.getByTestId("sidebar-agent-live-meta");
  assert.equal(live.textContent, "Editing Flow.tsx");
  assert.match(live.className, /(?:^|\s)font-sans(?:\s|$)/);
  assert.match(live.className, /(?:^|\s)truncate(?:\s|$)/);
  assert.equal(live.getAttribute("aria-hidden"), "true");
  assert.ok(screen.queryByTestId("sidebar-agent-runtime") === null);

  act(() => {
    useAgentStore.setState({
      agentActivities: { "agent-1": { activity: "online", activityDetail: "", detailKind: "none" } },
    } as never);
  });
  assert.ok(screen.queryByTestId("sidebar-agent-live-meta") === null);
  assert.equal(screen.getByTestId("sidebar-agent-runtime").textContent, "Codex CLI");
});

test("unread replaces the agent meta: one badge per row", () => {
  useMessageStore.setState({ unreadCounts: { "dm-1": 3 }, drafts: {} });
  renderDmRow();

  assert.ok(screen.getByText("3"));
  assert.ok(screen.queryByTestId("sidebar-agent-runtime") === null);
  assert.ok(screen.queryByTestId("sidebar-agent-live-meta") === null);
});

test("an external agent keeps its runtime label even with a stale working activity", () => {
  useAgentStore.setState({
    agentActivities: { "agent-1": { activity: "working", activityDetail: "Old work", detailKind: "none" } },
  } as never);
  renderDmRow(agent({ runtime: "external", external: true } as Partial<Agent>));

  assert.ok(screen.queryByTestId("sidebar-agent-live-meta") === null);
  assert.ok(screen.getByTestId("sidebar-agent-runtime"));
});

test("Members agent rows use the same meta and keep the agent name as the accessible name", () => {
  const rowAgent = agent({ runtime: "claude" });
  useAgentStore.setState({ agents: [rowAgent] });
  render(
    <TestIntlProvider>
      <MemberAgentRow
        agent={rowAgent}
        selected={false}
        menuOpen={false}
        onSelect={noop}
        onOpenDm={noopAsync}
        onContextMenu={noop}
        makeLongPress={longPress}
      />
    </TestIntlProvider>,
  );

  const row = screen.getByRole("button", { name: "Wug" });
  assert.equal(within(row).getByTestId("sidebar-agent-runtime").textContent, "Claude Code");
});

function seedDesktopSidebar() {
  api.get = (async () => ({ data: [] })) as typeof api.get;
  useAuthStore.setState({ user: { id: "user-1", name: "owner", displayName: "Owner" } } as never);
  useServerStore.setState({
    current: { id: "server-1", name: "Server", slug: "server", role: "owner" },
    servers: [],
    members: [],
    sidebarOrder: {
      channelOrder: [],
      agentOrder: [],
      dmOrder: [],
      channelSortMode: "manual",
      jointChannelSortMode: "manual",
      dmSortMode: "manual",
      pinnedSortMode: "manual",
      pinnedChannelIds: [],
      pinnedAgentIds: [],
      pinnedOrder: [],
      hiddenDmIds: [],
      channelPanelTabOrder: [],
      agentPanelTabOrder: [],
      customSections: [],
      sectionOrder: ["system:pinned", "system:joint", "system:channels", "system:dms"],
      sectionPlacements: [],
      sectionsVersion: 0,
      pinnedVersion: 0,
    },
  } as never);
  useChannelStore.setState({ channels: [], dmChannels: [], channelActivity: {}, loading: false } as never);
  useAgentStore.setState({ agents: [], loading: false } as never);
  useMachineStore.setState({ machines: [], loading: false } as never);
}

test("the desktop Chat head carries who is working; nothing is stacked under the list", () => {
  seedDesktopSidebar();
  useAppearanceStore.setState({ showLiveAgentActivityBar: true });
  useLiveAgentActivityStore.setState({
    items: [{
      id: "live-1",
      kind: "activity",
      agentId: "agent-1",
      agentName: "Wug",
      agentAvatarUrl: null,
      text: "Editing Flow.tsx",
      context: null,
      activity: "working",
      createdAt: Date.now(),
    }],
  } as never);

  render(
    <MemoryRouter initialEntries={CHAT_ROOT_ENTRIES}>
      <TestIntlProvider>
        <Sidebar />
      </TestIntlProvider>
    </MemoryRouter>,
  );

  const root = screen.getByTestId("sidebar-root");
  const head = root.firstElementChild as HTMLElement;
  assert.ok(head.textContent?.includes("Chat"), "the head names the rail mode");
  assert.ok(within(head).getByTestId("working-now-summary"), "who is working sits in the Chat head");
  assert.equal(root.lastElementChild?.contains(screen.getByTestId("sidebar-scroll-surface")), true);
});
