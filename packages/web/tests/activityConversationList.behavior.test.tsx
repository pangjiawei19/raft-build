import "./helpers/domSetup";

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import api from "../src/api/client";
import ThreadsInbox from "../src/components/thread/ThreadsInbox";
import { isSidebarPinnedInboxItem } from "../src/components/thread/inboxPinnedConversation";
import { useAgentStore } from "../src/store/agentStore";
import { useAuthStore } from "../src/store/authStore";
import { useChannelStore } from "../src/store/channelStore";
import { useInboxStore } from "../src/store/inboxStore";
import type { InboxItem } from "../src/store/inboxStore";
import {
  ACTIVITY_CONVERSATION_LIST_FLAG_KEY,
  resetServerFeatureFlagsForTests,
  setServerFeatureFlagForTests,
} from "../src/store/serverFeatureFlags";
import { triggerServerReset } from "../src/store/serverResetRegistry";
import { useServerStore } from "../src/store/serverStore";
import { TestIntlProvider } from "./helpers/intl";

const SERVER_ID = "server-1";
const originalGet = api.get.bind(api);

function channelItem(id: string, overrides: Partial<Extract<InboxItem, { kind: "channel" | "dm" }>> = {}): Extract<InboxItem, { kind: "channel" | "dm" }> {
  return {
    kind: "channel",
    channelId: id,
    channelName: id,
    channelType: "channel",
    lastMessageId: `message-${id}`,
    latestActivitySeq: "1",
    firstUnreadMessageId: `message-${id}`,
    firstMentionMessageId: null,
    lastMessageAt: "2026-05-10T00:00:00.000Z",
    lastMessagePreview: `${id} preview`,
    lastMessageSenderType: "user",
    lastMessageSenderId: "user-1",
    lastMessageSenderName: "alice",
    unreadCount: 2,
    hasMention: false,
    ...overrides,
  };
}

function renderInbox(items: InboxItem[], { listLayout, pinned = [], mutedChannelIds = [], agents = [], members = [] }: {
  listLayout: boolean;
  pinned?: { kind: "channel" | "agent" | "human"; id: string }[];
  mutedChannelIds?: string[];
  agents?: { id: string; name: string; displayName: string | null; avatarUrl: string | null }[];
  members?: { userId: string; name: string; displayName: string | null; avatarUrl: string | null; gravatarHash: string }[];
}) {
  triggerServerReset();
  resetServerFeatureFlagsForTests();
  window.matchMedia = ((query: string) => ({
    matches: /min-width:\s*768px/.test(query),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  const sidebarOrder = useServerStore.getState().sidebarOrder;
  useServerStore.setState({
    current: { id: SERVER_ID, slug: "acme" },
    serverEpoch: 1,
    members,
    sidebarOrder: { ...sidebarOrder, pinned },
  } as never);
  setServerFeatureFlagForTests(SERVER_ID, ACTIVITY_CONVERSATION_LIST_FLAG_KEY, listLayout);
  useAuthStore.setState({ user: { id: "me" } } as never);
  useChannelStore.setState({
    channels: items
      .filter((item) => item.kind === "channel")
      .map((item) => ({ id: item.channelId, name: item.channelId, activityMuted: mutedChannelIds.includes(item.channelId) })),
    dmChannels: [],
    channelActivity: {},
  } as never);
  useAgentStore.setState({ agents } as never);
  useInboxStore.setState({
    items,
    groups: [],
    filter: "all",
    channelFilterId: null,
    loading: false,
    loadingMore: false,
    hasMore: false,
    totalCount: items.length,
    totalUnreadCount: items.reduce((sum, item) => sum + item.unreadCount, 0),
    activeUnreadCount: items.reduce((sum, item) => sum + item.unreadCount, 0),
    scrollTop: 0,
    focusedItemKey: null,
  });
  api.get = (async (url: string) => {
    if (url === "/channels/inbox") {
      return { data: { items: useInboxStore.getState().items, hasMore: false, totalCount: items.length, totalUnreadCount: 0 } };
    }
    return { data: {} };
  }) as typeof api.get;
  return render(
    <MemoryRouter initialEntries={["/s/acme/activity"]}>
      <TestIntlProvider>
        <ThreadsInbox />
      </TestIntlProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  api.get = originalGet;
  resetServerFeatureFlagsForTests();
});

test("flag off keeps the existing card rows", () => {
  renderInbox([channelItem("general")], { listLayout: false });
  const row = screen.getByTestId("inbox-row");
  assert.equal(row.getAttribute("data-layout"), null);
  assert.ok(screen.queryByTestId("conversation-card-avatar") === null);
});

test("conversation list: avatar row with one-line preview, unread count and the @ sticker", () => {
  renderInbox([channelItem("general", { hasMention: true, firstMentionMessageId: "message-general" })], { listLayout: true });
  const row = screen.getByTestId("inbox-row");
  assert.equal(row.getAttribute("data-layout"), "list");
  assert.equal(within(row).getByTestId("conversation-card-avatar").getAttribute("data-kind"), "channel");
  assert.equal(within(row).getByTestId("conversation-card-new-badge").textContent, "2");
  const mention = within(row).getByTestId("inbox-mention-badge");
  assert.equal(mention.getAttribute("aria-label"), "Mentioned you");
  assert.equal(within(row).getByTestId("conversation-card-body").contains(mention), false);
  assert.doesNotMatch(within(row).getByTestId("conversation-card-body").textContent ?? "", /Mentioned you/);
  assert.match(within(row).getByTestId("conversation-card-body").textContent ?? "", /alice: general preview/);
});

test("conversation list: the sender's avatar sits before their name, only in the list layout", () => {
  const agentItem = channelItem("agents", { lastMessageSenderType: "agent", lastMessageSenderId: "agent-1", lastMessageSenderName: "Tenny" });
  const agents = [{ id: "agent-1", name: "tenny", displayName: "Tenny", avatarUrl: null }];
  renderInbox([agentItem], { listLayout: true, agents });
  const avatar = within(screen.getByTestId("conversation-card-body")).getByTestId("conversation-card-sender-avatar");
  assert.ok(avatar.querySelector("[data-avatar-context='sidebar-list']"));
  assert.match(screen.getByTestId("conversation-card-body").textContent ?? "", /Tenny: agents preview/);
  cleanup();

  renderInbox([agentItem], { listLayout: false, agents });
  assert.ok(screen.queryByTestId("conversation-card-sender-avatar") === null);
});

test("conversation list: a human sender's avatar comes from the member list", () => {
  const members = [{ userId: "user-1", name: "alice", displayName: null, avatarUrl: "https://example.test/alice.png", gravatarHash: "" }];
  renderInbox([channelItem("humans")], { listLayout: true, members });
  const human = screen.getByTestId("conversation-card-sender-avatar");
  assert.ok(human.querySelector("[data-avatar-context='sidebar-list']"));
  assert.ok(human.querySelector("[data-avatar-type='human']"));
});

test("conversation list: a sender the stores do not know yet keeps a placeholder face", () => {
  renderInbox([channelItem("unknown")], { listLayout: true });
  assert.ok(screen.getByTestId("conversation-card-sender-avatar").querySelector("[data-avatar-type='human']"));
});

test("conversation list: system and DM rows get no sender avatar", () => {
  renderInbox([channelItem("sys", { lastMessageSenderId: "system", lastMessageSenderName: "System" })], { listLayout: true });
  assert.ok(screen.queryByTestId("conversation-card-sender-avatar") === null);
  cleanup();

  // A DM row already leads with the peer's face.
  renderInbox([channelItem("dm-1", { kind: "dm", channelType: "dm" })], { listLayout: true });
  assert.equal(screen.getByTestId("conversation-card-avatar").getAttribute("data-kind"), "dm");
  assert.ok(screen.queryByTestId("conversation-card-sender-avatar") === null);
});

test("conversation list: a muted conversation shows the muted icon instead of the count", () => {
  renderInbox([channelItem("quiet")], { listLayout: true, mutedChannelIds: ["quiet"] });
  const row = screen.getByTestId("inbox-row");
  assert.ok(within(row).getByTestId("conversation-card-muted"));
  assert.ok(within(row).queryByTestId("conversation-card-new-badge") === null);
});

test("conversation list: sidebar-pinned conversations come first under Pinned", () => {
  renderInbox(
    [channelItem("newest"), channelItem("pinned-one", { lastMessageAt: "2026-05-09T00:00:00.000Z" })],
    { listLayout: true, pinned: [{ kind: "channel", id: "pinned-one" }] },
  );
  const rows = screen.getAllByTestId("inbox-row");
  assert.match(rows[0].textContent ?? "", /pinned-one/);
  assert.match(rows[1].textContent ?? "", /newest/);
  const sections = screen.getAllByTestId("activity-list-section").map((section) => section.textContent);
  assert.deepEqual(sections, ["Pinned", "All conversations"]);
});

test("conversation list: no Pinned section when nothing loaded is pinned", () => {
  renderInbox([channelItem("general")], { listLayout: true, pinned: [{ kind: "channel", id: "elsewhere" }] });
  assert.equal(screen.queryAllByTestId("activity-list-section").length, 0);
});

test("pinned lookup: channels by id, DMs by peer, threads never", () => {
  const pinned = [
    { kind: "channel" as const, id: "general" },
    { kind: "agent" as const, id: "agent-1" },
    { kind: "human" as const, id: "user-9" },
  ];
  const dmChannels = [
    { id: "dm-agent", peerId: "agent-1", peerType: "agent" as const },
    { id: "dm-human", peerId: "user-9", peerType: "user" as const },
    { id: "dm-other", peerId: "user-2", peerType: "user" as const },
  ];
  assert.equal(isSidebarPinnedInboxItem(channelItem("general"), pinned, dmChannels), true);
  assert.equal(isSidebarPinnedInboxItem(channelItem("random"), pinned, dmChannels), false);
  assert.equal(isSidebarPinnedInboxItem(channelItem("dm-agent", { kind: "dm", channelType: "dm" }), pinned, dmChannels), true);
  assert.equal(isSidebarPinnedInboxItem(channelItem("dm-human", { kind: "dm", channelType: "dm" }), pinned, dmChannels), true);
  assert.equal(isSidebarPinnedInboxItem(channelItem("dm-other", { kind: "dm", channelType: "dm" }), pinned, dmChannels), false);
  const thread = {
    kind: "thread",
    parentChannelId: "general",
  } as unknown as InboxItem;
  assert.equal(isSidebarPinnedInboxItem(thread, pinned, dmChannels), false);
});
