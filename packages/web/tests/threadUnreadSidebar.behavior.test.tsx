import assert from "node:assert/strict";
import { test } from "vitest";
import "./helpers/domSetup";
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TestIntlProvider } from "./helpers/intl";
import Sidebar from "../src/components/layout/Sidebar";
import { ThreadUnreadJumpPill } from "../src/components/message/ThreadUnreadJumpPill";
import { useAgentStore } from "../src/store/agentStore";
import { useAuthStore } from "../src/store/authStore";
import type { Channel } from "../src/store/channelStore";
import { useChannelStore } from "../src/store/channelStore";
import { useInboxStore } from "../src/store/inboxStore";
import { useMachineStore } from "../src/store/machineStore";
import { useMessageStore } from "../src/store/messageStore";
import { useServerStore } from "../src/store/serverStore";
import { useThreadStore } from "../src/store/threadStore";
import type { FollowedThread } from "../src/store/threadStore";
import { useUIStore } from "../src/store/uiStore";
import {
  resetServerFeatureFlagsForTests,
  setServerFeatureFlagForTests,
  THREAD_UNREAD_BADGE_FLAG_KEY,
} from "../src/store/serverFeatureFlags";

const SERVER_ID = "server-sidebar-mute";
const originalFollowed = useThreadStore.getState().followedThreads;

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetServerFeatureFlagsForTests();
  useThreadStore.setState({ followedThreads: originalFollowed });
});

function makeSidebarOrder() {
  return {
    channelOrder: [],
    agentOrder: [],
    dmOrder: [],
    channelSortMode: "manual" as const,
    jointChannelSortMode: "manual" as const,
    dmSortMode: "manual" as const,
    pinnedSortMode: "manual" as const,
    pinned: [],
    pinnedChannelIds: [],
    pinnedAgentIds: [],
    pinnedOrder: [],
    hiddenDmIds: [],
    channelPanelTabOrder: [],
    agentPanelTabOrder: [],
    pinnedVersion: 0,
  };
}

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: "channel-activity-mute",
    serverId: "server-activity-mute",
    name: "activity-mute",
    description: null,
    type: "channel",
    createdAt: "2026-06-28T00:00:00.000Z",
    joined: true,
    activityMuteSupported: true,
    ...overrides,
  };
}

function renderSidebar(
  channelOrChannels: Channel | Channel[],
  options: { pinnedChannelIds?: string[]; mobileInline?: boolean } = {},
) {
  const channels = Array.isArray(channelOrChannels) ? channelOrChannels : [channelOrChannels];
  const selectedChannel = channels[channels.length - 1]!;
  useAuthStore.setState({
    user: {
      id: "user-sidebar-mute",
      email: "sidebar-mute@example.com",
      gravatarHash: "",
      name: "sidebar-mute-user",
      displayName: null,
      description: null,
      avatarUrl: null,
      emailVerified: true,
      preferredLanguage: null,
      preferredTimezone: null,
      autoTranslationEnabled: false,
      preferredTranslationDisplay: "translated",
      preferredTimeFormat: null,
      preferredMessageBodyFontSize: null,
      referralSource: null,
      referralSourceOther: null,
      referralSourceSkippedAt: null,
    },
  });
  const server = {
    id: "server-sidebar-mute",
    name: "Sidebar Mute Server",
    avatarUrl: null,
    slug: "sidebar-mute-server",
    ownerId: "user-sidebar-mute",
    onboardingAgentId: null,
    hideHumansFromMembers: false,
    plan: "free",
    planDowngradedAt: null,
    role: "owner" as const,
    createdAt: "2026-07-10T00:00:00.000Z",
  };
  const sidebarOrder = makeSidebarOrder();
  sidebarOrder.pinned = (options.pinnedChannelIds ?? []).map((id) => ({ kind: "channel" as const, id }));
  sidebarOrder.pinnedChannelIds = options.pinnedChannelIds ?? [];
  sidebarOrder.pinnedOrder = options.pinnedChannelIds ?? [];
  useServerStore.setState({
    current: server,
    servers: [server],
    members: [],
    sidebarOrder,
  });
  useChannelStore.setState({
    channels,
    dmChannels: [],
    channelActivity: Object.fromEntries(channels.map((channel) => [channel.id, null])),
    loading: false,
  });
  useMessageStore.setState({
    unreadCounts: {},
    mentionFlags: {},
    drafts: {},
    clearUnread: () => {},
    markRead: async () => {},
    markUnread: async () => {},
  });
  useAgentStore.setState({ agents: [], loading: false });
  useMachineStore.setState({ machines: [], loading: false });
  useInboxStore.setState({ totalCount: 0, totalUnreadCount: 0, loadInbox: async () => {} });
  useUIStore.setState({ sidebarOpen: true });

  return render(
    <MemoryRouter initialEntries={[`/s/${server.slug}/channel/${selectedChannel.id}`]}>
      <TestIntlProvider>
        <Sidebar mobileInline={options.mobileInline} />
      </TestIntlProvider>
    </MemoryRouter>,
  );
}

function followed(
  threadChannelId: string,
  parentChannelId: string,
  unreadCount: number,
  extra: Partial<FollowedThread> = {},
): FollowedThread {
  return {
    threadChannelId,
    parentMessageId: `parent-${threadChannelId}`,
    parentChannelId,
    unreadCount,
    lastReplyAt: null,
    firstUnreadMessageId: unreadCount > 0 ? `first-${threadChannelId}` : null,
    ...extra,
  } as FollowedThread;
}

function seed(flag: boolean) {
  setServerFeatureFlagForTests(SERVER_ID, THREAD_UNREAD_BADGE_FLAG_KEY, flag);
  const loud = makeChannel({ id: "ch-loud", name: "loud", joined: true });
  const threadsOnly = makeChannel({ id: "ch-threads", name: "threads-only", joined: true });
  const muted = makeChannel({ id: "ch-muted", name: "muted", joined: true, activityMuted: true });
  const view = renderSidebar([loud, threadsOnly, muted]);
  act(() => {
    useMessageStore.setState({ unreadCounts: { "ch-loud": 5, "ch-muted": 12 } });
    useThreadStore.setState({
      followedThreads: [
        followed("t1", "ch-loud", 2),
        followed("t2", "ch-threads", 1, { hasMention: true }),
        followed("t3", "ch-threads", 3),
        followed("t4", "ch-muted", 1),
        followed("t5", "ch-muted", 2),
        followed("t6", "ch-loud", 0),
      ],
    });
  });
  const row = (id: string) => {
    const el = document.querySelector(`[data-sidebar-channel-id="${id}"]`);
    assert.ok(el);
    return el as HTMLElement;
  };
  return { view, row };
}

test("flag on: the channel badge adds a thread segment counting unread followed threads", () => {
  const { row } = seed(true);

  const loudThreads = within(row("ch-loud")).getByTestId("sidebar-thread-unread");
  assert.equal(loudThreads.textContent, "1 thread with new replies");
  assert.ok(loudThreads.closest('[data-slot="sidebar-item-count"]'));
  assert.ok(within(row("ch-loud")).getByText("loud").className.includes("font-bold"));

  // Only thread unread: badge is loud, title bold, and the thread @ lights the marker.
  const threadsOnly = row("ch-threads");
  assert.equal(within(threadsOnly).getByTestId("sidebar-thread-unread").textContent, "2 threads with new replies");
  // Bold is the row's raft-ui SidebarItem tone.
  assert.equal(within(threadsOnly).getByText("threads-only").closest('[data-slot="sidebar-item"]')?.getAttribute("data-tone"), "unread");
  assert.ok(within(threadsOnly).getByTestId("sidebar-mention-marker"));

  // Muted: same segments as quiet text, never the loud badge.
  const muted = row("ch-muted");
  const mutedThreads = within(muted).getByTestId("sidebar-thread-unread");
  assert.ok(mutedThreads.closest('[data-slot="sidebar-item-count"]') === null);
  assert.ok(mutedThreads.parentElement?.textContent?.startsWith("12"));
});

test("flag off: rows are exactly the plain unread count", () => {
  const { row } = seed(false);

  assert.ok(document.querySelector('[data-testid="sidebar-thread-unread"]') === null);
  assert.equal(within(row("ch-loud")).getByText("5").textContent, "5");
  assert.ok(within(row("ch-threads")).queryByTestId("sidebar-mention-marker") === null);
  assert.equal(within(row("ch-threads")).getByText("threads-only").closest('[data-slot="sidebar-item"]')?.getAttribute("data-tone"), null);
  assert.equal(within(row("ch-muted")).getByText("12").textContent, "12");
});

type Placement = "above" | "visible" | "below";

// jsdom has no layout: a stand-in IntersectionObserver reports each observed
// parent row at the placement the test sets for it.
function installPlacements(placementByParentId: Record<string, Placement>) {
  const original = globalThis.IntersectionObserver;
  class FakeIntersectionObserver {
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe(target: Element) {
      const id = (target as HTMLElement).dataset.timelineMessageId ?? "";
      const placement = placementByParentId[id] ?? "visible";
      const rootBounds = { top: 100, bottom: 500 } as DOMRectReadOnly;
      const boundingClientRect = (placement === "above" ? { top: 0, bottom: 50 } : placement === "below" ? { top: 600, bottom: 650 } : { top: 200, bottom: 250 }) as DOMRectReadOnly;
      queueMicrotask(() => this.callback([{ target, isIntersecting: placement === "visible", rootBounds, boundingClientRect } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver));
    }
    disconnect() {}
    unobserve() {}
    takeRecords() { return []; }
  }
  globalThis.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver;
  return () => { globalThis.IntersectionObserver = original; };
}

const LOADED = { oldestAt: "2026-10-14T00:00:00Z", newestAt: "2026-10-14T23:00:00Z", hasNewer: false };

function renderPill(
  threads: FollowedThread[],
  onJumpToMessage: (messageId: string) => void,
  { flag = true, bottomButton, renderedParentIds = threads.map((t) => t.parentMessageId), loadedRange = LOADED }: {
    flag?: boolean;
    bottomButton?: ReactNode;
    renderedParentIds?: string[];
    loadedRange?: typeof LOADED;
  } = {},
) {
  setServerFeatureFlagForTests(SERVER_ID, THREAD_UNREAD_BADGE_FLAG_KEY, flag);
  useServerStore.setState({ current: { id: SERVER_ID, slug: "sidebar-mute-server" } as never });
  useThreadStore.setState({ followedThreads: threads });
  const Wrapper = ({ children }: { children: ReactNode }) => <TestIntlProvider>{children}</TestIntlProvider>;
  return render(
    <div>
      {renderedParentIds.map((id) => <div key={id} data-timeline-message-id={id} />)}
      <ThreadUnreadJumpPill channelId="ch-1" onJumpToMessage={onJumpToMessage} bottomButton={bottomButton} loadedRange={loadedRange} renderKey="k" />
    </div>,
    { wrapper: Wrapper },
  );
}

const flush = () => act(async () => { await Promise.resolve(); });

const at = (hour: number) => `2026-10-14T${String(hour).padStart(2, "0")}:00:00Z`;

test("jump pill: with threads below, only the bottom pill shows and goes to the nearest one below", async () => {
  const restore = installPlacements({ "parent-top": "above", "parent-mid": "visible", "parent-low": "below", "parent-lower": "below" });
  try {
    const jumped: string[] = [];
    renderPill([
      followed("top", "ch-1", 1, { parentMessageCreatedAt: at(8) }),
      followed("mid", "ch-1", 2, { parentMessageCreatedAt: at(10) }),
      followed("low", "ch-1", 1, { parentMessageCreatedAt: at(12) }),
      followed("lower", "ch-1", 1, { parentMessageCreatedAt: at(14) }),
      followed("elsewhere", "ch-2", 1, { parentMessageCreatedAt: at(9) }),
    ], (id) => jumped.push(id), { bottomButton: <button type="button">Back to bottom</button> });
    await flush();

    const pills = screen.getAllByTestId("thread-unread-jump-pill");
    // Count = every unread thread of the channel.
    assert.deepEqual(pills.map((pill) => [pill.dataset.placement, pill.textContent]), [
      ["bottom", "Next unread thread (4)"],
    ]);
    assert.equal(pills[0]!.previousElementSibling?.textContent, "Back to bottom");
    fireEvent.click(screen.getByText("Next unread thread (4)"));
    assert.deepEqual(jumped, ["parent-low"]);
  } finally {
    restore();
  }
});

test("jump pill: with threads only above, the top pill goes to the earliest one", async () => {
  const restore = installPlacements({ "parent-a": "above", "parent-b": "above", "parent-c": "visible" });
  try {
    const jumped: string[] = [];
    renderPill([
      followed("a", "ch-1", 1, { parentMessageCreatedAt: at(6) }),
      followed("b", "ch-1", 1, { parentMessageCreatedAt: at(7) }),
      followed("c", "ch-1", 1, { parentMessageCreatedAt: at(15) }),
    ], (id) => jumped.push(id));
    await flush();
    const pills = screen.getAllByTestId("thread-unread-jump-pill");
    assert.deepEqual(pills.map((pill) => [pill.dataset.placement, pill.textContent]), [
      ["top", "Earliest unread thread (3)"],
    ]);
    fireEvent.click(screen.getByText("Earliest unread thread (3)"));
    assert.deepEqual(jumped, ["parent-a"]);
  } finally {
    restore();
  }
});

test("jump pill: with every unread parent on screen there is no pill", async () => {
  const restore = installPlacements({});
  try {
    renderPill([followed("only", "ch-1", 3, { parentMessageCreatedAt: at(9) })], () => {}, {
      bottomButton: <button type="button">Back to bottom</button>,
    });
    await flush();
    assert.ok(screen.queryByTestId("thread-unread-jump-pill") === null);
    assert.ok(within(screen.getByTestId("chat-bottom-controls")).getByText("Back to bottom"));
  } finally {
    restore();
  }
});

test("jump pill: a parent that is not loaded counts above, or below when reading history with newer messages", async () => {
  const restore = installPlacements({});
  try {
    const { unmount } = renderPill([followed("old", "ch-1", 1, { parentMessageCreatedAt: "2026-10-13T08:00:00Z" })], () => {}, {
      renderedParentIds: [],
    });
    await flush();
    assert.equal(screen.getByTestId("thread-unread-jump-pill").dataset.placement, "top");
    unmount();

    renderPill([followed("new", "ch-1", 1, { parentMessageCreatedAt: "2026-10-15T08:00:00Z" })], () => {}, {
      renderedParentIds: [], loadedRange: { ...LOADED, hasNewer: true },
    });
    await flush();
    assert.equal(screen.getByTestId("thread-unread-jump-pill").dataset.placement, "bottom");
  } finally {
    restore();
  }
});

test("jump pill: dismiss hides them until the unread thread count changes", async () => {
  const restore = installPlacements({ "parent-x": "above", "parent-y": "above", "parent-z": "above" });
  try {
    renderPill([followed("x", "ch-1", 1, { parentMessageCreatedAt: at(5) }), followed("y", "ch-1", 1, { parentMessageCreatedAt: at(6) })], () => {}, {
      renderedParentIds: ["parent-x", "parent-y", "parent-z"],
    });
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    assert.ok(screen.queryByTestId("thread-unread-jump-pill") === null);
    act(() => {
      useThreadStore.setState({
        followedThreads: [...useThreadStore.getState().followedThreads, followed("z", "ch-1", 1, { parentMessageCreatedAt: at(7) })],
      });
    });
    await flush();
    assert.ok(screen.getByText("Earliest unread thread (3)"));
  } finally {
    restore();
  }
});

test("jump pill: render nothing when the flag is off, but keep the back-to-bottom button", async () => {
  const restore = installPlacements({ "parent-q": "above" });
  try {
    renderPill([followed("q", "ch-1", 1)], () => {}, { flag: false, bottomButton: <button type="button">Back to bottom</button> });
    await flush();
    assert.ok(screen.queryByTestId("thread-unread-jump-pill") === null);
    assert.ok(within(screen.getByTestId("chat-bottom-controls")).getByText("Back to bottom"));
  } finally {
    restore();
  }
});
