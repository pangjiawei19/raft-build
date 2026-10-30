/** task #364 S2 — production ThreadsInbox consumes the receiver bundle. */
import assert from "node:assert/strict";
import { test as nodeTest } from "vitest";
import "./helpers/domSetup";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import api from "../src/api/client";
import ThreadsInbox from "../src/components/thread/ThreadsInbox";
import { TestIntlProvider } from "./helpers/intl";
import { useAgentStore } from "../src/store/agentStore";
import { useAuthStore } from "../src/store/authStore";
import { useChannelStore } from "../src/store/channelStore";
import {
  observeActivityBootstrap,
  resetActivityRuntimeForTests,
  setActivityGateForTests,
} from "../src/store/activityPanel/runtime";
import { decrementInboxGroupCounts, useInboxStore } from "../src/store/inboxStore";
import type { InboxItem } from "../src/store/inboxStore";
import { useSavedStore } from "../src/store/savedStore";
import { useSearchContentStore } from "../src/store/searchContentStore";
import { useServerStore } from "../src/store/serverStore";
import { resetServerFeatureFlagsForTests } from "../src/store/serverFeatureFlags";
import { triggerServerReset } from "../src/store/serverResetRegistry";
import { useMessageStore } from "../src/store/messageStore";
import { useTaskStore } from "../src/store/taskStore";
import { useThreadStore } from "../src/store/threadStore";

type TestFn = () => void | Promise<void>;
const test = (name: string, fn: TestFn) =>
  nodeTest(name,  fn);

const originalGet = api.get;
const originalPost = api.post;
const originalLoadInbox = useInboxStore.getState().loadInbox;
const originalMarkDone = useInboxStore.getState().markDone;
const originalSaveMessage = useSavedStore.getState().saveMessage;
const originalUnsaveMessage = useSavedStore.getState().unsaveMessage;
let serverSequence = 0;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function channelItem(label: string, overrides: Partial<Extract<InboxItem, { kind: "channel" | "dm" }>> = {}): Extract<InboxItem, { kind: "channel" | "dm" }> {
  return {
    kind: "channel",
    channelId: `channel-${label}`,
    channelName: `${label} channel`,
    channelType: "channel",
    lastMessageId: `message-${label}`,
    latestActivitySeq: "41",
    firstUnreadMessageId: `message-${label}`,
    firstMentionMessageId: null,
    lastMessageAt: "2026-08-01T00:00:00.000Z",
    lastMessagePreview: `${label} preview`,
    lastMessageSenderType: "user",
    lastMessageSenderId: `sender-${label}`,
    lastMessageSenderName: `${label} sender`,
    unreadCount: 17,
    hasMention: false,
    ...overrides,
  };
}

function threadItem(label: string, overrides: Partial<Extract<InboxItem, { kind: "thread" }>> = {}): Extract<InboxItem, { kind: "thread" }> {
  return {
    kind: "thread",
    threadChannelId: `thread-${label}`,
    parentMessageId: `parent-${label}`,
    parentChannelId: `parent-channel-${label}`,
    parentChannelName: `${label} parent`,
    parentChannelType: "channel",
    parentMessagePreview: `${label} thread parent`,
    parentMessageSenderType: "user",
    parentMessageSenderId: `parent-sender-${label}`,
    latestActivityPreview: `${label} thread reply`,
    latestActivitySenderType: "user",
    latestActivitySenderId: `sender-${label}`,
    latestActivityMessageId: `message-${label}`,
    latestActivitySeq: "41",
    firstUnreadMessageId: `message-${label}`,
    firstMentionMessageId: null,
    lastActivityAt: "2026-08-01T00:00:00.000Z",
    lastReplyAt: "2026-08-01T00:00:00.000Z",
    replyCount: 2,
    unreadCount: 3,
    hasMention: false,
    taskNumber: null,
    taskStatus: null,
    taskClaimedByName: null,
    ...overrides,
  };
}

function coreRow(label: string) {
  return {
    rowId: `row-${label}`,
    rowVersion: "50",
    latestActivitySeq: "9007199254740993",
    lastActivityAt: "2026-08-03T00:00:00.000Z",
    unreadCount: 6,
    hasMention: false,
    firstUnreadMessageId: `first-${label}`,
    firstMentionMessageId: null,
    maxReadSeq: "48",
    readStateVersion: "49",
    type: "channel",
    channelId: `channel-${label}`,
    channelName: `${label} channel`,
    channelKind: "private",
    lastMessageId: `message-${label}`,
    lastMessagePreview: `${label} preview`,
    lastMessageSenderKind: "agent",
    lastMessageSenderId: `sender-${label}`,
    lastMessageSenderName: `${label} sender`,
  };
}

function activitySnapshot(
  requestId: string,
  label: string,
  serverId: string,
  principalId = "user-current",
) {
  return {
    type: "snapshot",
    requestId,
    scope: { serverId, principalId, filter: "all", windowId: "main" },
    epoch: "1",
    watermark: "9007199254740995",
    activityVersion: "77",
    window: {
      rows: [coreRow(label)],
      tombstones: [],
      nextCursor: null,
      hasMore: false,
      complete: true,
      totalCount: 1,
      totalUnreadCount: 6,
    },
  };
}

function setDesktopViewport() {
  window.matchMedia = ((query: string) => ({
    matches: Number(query.match(/min-width:\s*(\d+)px/)?.[1] ?? 0) <= 1280,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

function seedStores(label: string, options: { receipts?: boolean | "preserve"; legacyHasMore?: boolean } = {}) {
  serverSequence += 1;
  const serverId = `server-${serverSequence}`;
  const legacy = channelItem(label);
  useAuthStore.setState({
    user: {
      id: "user-current",
      name: "current",
      displayName: "Current",
      email: "current@example.com",
    } as never,
    loading: false,
    initialized: true,
  });
  useServerStore.setState({
    current: { id: serverId, name: "S2", slug: `s2-${serverSequence}`, role: "owner" } as never,
    members: [],
  });
  useChannelStore.setState({ channels: [], dmChannels: [] });
  useAgentStore.setState({ agents: [], agentActivities: {} });
  useSearchContentStore.setState({ slot: null });
  useSavedStore.setState({
    saved: [],
    savedIds: new Set(),
    loading: false,
    hasMore: false,
    total: 0,
    resultTotal: 0,
    query: "",
    channelId: null,
    sortDirection: "desc",
  });
  useThreadStore.setState({
    openParentChannelId: null,
    openParentMessageId: null,
    openThreadChannelId: null,
    focusedThreadChannelId: null,
    taskUpdatesByMessageId: {},
  });
  useTaskStore.setState({
    tasks: [],
    serverTasks: [],
    taskMetadataByMessageId: {},
    taskMessageIdByTaskId: {},
  });
  const generation = `window-${label}`;
  useInboxStore.setState({
    items: [legacy],
    ...(options.receipts === "preserve" ? {} : {
      acceptedWindowGeneration: options.receipts === false ? "" : generation,
      unfollowedWindowGeneration: options.receipts === false ? null : generation,
    }),
    unfollowedItems: [],
    unfollowedLoading: false,
    unfollowedLoaded: true,
    groups: [{
      channelId: legacy.channelId,
      channelName: `Legacy ${label} group`,
      channelType: "joint",
      count: 40,
      lastActivityAt: "2026-07-01T00:00:00.000Z",
    }],
    filter: "all",
    channelFilterId: null,
    sortDirection: "desc",
    searchQuery: "",
    loading: false,
    loadingMore: false,
    loaded: true,
    hasMore: options.legacyHasMore ?? true,
    totalCount: 40,
    allCount: 40,
    totalUnreadCount: 17,
    activeUnreadCount: 17,
    focusedItemKey: null,
    pendingFocusKind: null,
    loadInbox: originalLoadInbox,
  });
  return { serverId, legacy };
}

async function seedCore(
  gate: "on" | "shadow",
  label: string,
  serverId: string,
  principalId = "user-current",
) {
  setActivityGateForTests(gate);
  api.get = (async (url: string, config?: { params?: { requestId?: string } }) => {
    if (url === "/channels/activity/snapshot") {
      return { data: activitySnapshot(config?.params?.requestId ?? "missing", label, serverId, principalId) };
    }
    throw new Error(`Unexpected GET ${url}`);
  }) as typeof api.get;
  await observeActivityBootstrap();
}

function renderInbox(options: {
  post?: typeof api.post;
  locale?: "en" | "zh-cn";
} = {}) {
  const slug = useServerStore.getState().current?.slug ?? "s2";
  api.post = (async (...args: Parameters<typeof api.post>) => {
    const [url] = args;
    if (url === "/feature-flags/evaluate") {
      return { data: { evaluations: [] } };
    }
    if (url === "/channels/saved/check") {
      return { data: { savedIds: [] } };
    }
    if (options.post) return options.post(...args);
    throw new Error(`Unexpected POST ${url}`);
  }) as typeof api.post;
  return render(
    <TestIntlProvider locale={options.locale ?? "en"}>
      <MemoryRouter initialEntries={[`/s/${slug}/activity`]}>
        <ThreadsInbox />
      </MemoryRouter>
    </TestIntlProvider>,
  );
}

afterEach(() => {
  cleanup();
  api.get = originalGet;
  api.post = originalPost;
  useInboxStore.setState({ loadInbox: originalLoadInbox, markDone: originalMarkDone });
  useSavedStore.setState({
    saveMessage: originalSaveMessage,
    unsaveMessage: originalUnsaveMessage,
  });
  useMessageStore.getState().setCurrentUserId(null);
  resetServerFeatureFlagsForTests();
  resetActivityRuntimeForTests();
  triggerServerReset();
  window.localStorage.clear();
});

test("ThreadsInbox visibly consumes core rows/count and core pagination from the SAME bundle", async () => {
  setDesktopViewport();
  resetServerFeatureFlagsForTests();
  const { serverId, legacy } = seedStores("legacy-sentinel", { legacyHasMore: true });
  await seedCore("on", "core-sentinel", serverId);
  let paginationCalls = 0;
  useInboxStore.setState({
    loadInbox: async () => {
      paginationCalls += 1;
    },
  });

  renderInbox();
  await waitFor(() => assert.ok(screen.getByText("core-sentinel preview")));

  assert.equal(screen.queryByText(legacy.lastMessagePreview), null, "legacy row must not splice beside core");
  assert.ok(
    screen.getByText("1 active · 6 unread"),
    "core totals are visible through the legacy Inbox chrome",
  );
  assert.equal(screen.queryByText("40 active · 17 unread"), null, "legacy totals cannot survive a core row switch");

  const scroll = screen.getByTestId("inbox-scroll");
  Object.defineProperties(scroll, {
    scrollHeight: { configurable: true, value: 100 },
    scrollTop: { configurable: true, value: 90 },
    clientHeight: { configurable: true, value: 10 },
  });
  fireEvent.scroll(scroll);
  assert.equal(
    paginationCalls,
    0,
    "legacy hasMore=true/cursor must not page after the same core bundle supplied hasMore=false/cursor=null",
  );
});

test("the legacy surface visibly consumes BOTH core totals from the same receiver bundle", async () => {
  setDesktopViewport();
  resetServerFeatureFlagsForTests();
  const { serverId } = seedStores("legacy-totals", { legacyHasMore: true });
  await seedCore("on", "core-totals", serverId);

  renderInbox();
  await waitFor(() => assert.ok(screen.getByText("core-totals preview")));
  assert.ok(
    screen.getByText("1 active · 6 unread"),
    "totalCount and totalUnreadCount must both come from the same Core bundle",
  );
  assert.equal(screen.queryByText("40 active · 17 unread"), null);
});

test("decrementing another Activity group preserves an existing zero-count facet identity", () => {
  const retainedGroup = {
    channelId: "channel-retained-zero",
    channelName: "Retained Zero Channel",
    channelType: "channel" as const,
    count: 0,
  };
  const removedItem = channelItem("removed-group");

  assert.deepEqual(
    decrementInboxGroupCounts([
      retainedGroup,
      {
        channelId: removedItem.channelId,
        channelName: removedItem.channelName,
        channelType: removedItem.channelType,
        count: 1,
      },
    ], [removedItem]),
    [retainedGroup],
  );
});

test("decrementing the selected Activity group to zero preserves its clearable identity", () => {
  const selectedItem = channelItem("selected-last-row");

  assert.deepEqual(
    decrementInboxGroupCounts([{
      channelId: selectedItem.channelId,
      channelName: selectedItem.channelName,
      channelType: selectedItem.channelType,
      count: 1,
    }], [selectedItem], selectedItem.channelId),
    [{
      channelId: selectedItem.channelId,
      channelName: selectedItem.channelName,
      channelType: selectedItem.channelType,
      count: 0,
    }],
  );
});

test("Activity done actions stay quiet until their row is active, focused, or hovered", async () => {
  setDesktopViewport();
  resetServerFeatureFlagsForTests();
  seedStores("save-action-visibility", { legacyHasMore: false });
  setActivityGateForTests("off");
  const inactiveItem = channelItem("save-hidden");
  const activeItem = threadItem("save-active");
  useInboxStore.setState({
    items: [inactiveItem, activeItem],
    groups: [{
      channelId: inactiveItem.channelId,
      channelName: inactiveItem.channelName,
      channelType: inactiveItem.channelType,
      count: 2,
      lastActivityAt: inactiveItem.lastMessageAt,
    }],
    totalCount: 2,
    totalUnreadCount: inactiveItem.unreadCount + activeItem.unreadCount,
  });
  useSearchContentStore.setState({ slot: { kind: "thread", id: activeItem.threadChannelId } });
  const keyboardDoneCalls: string[] = [];
  useInboxStore.setState({
    markDone: async (item) => {
      keyboardDoneCalls.push(item.kind === "thread" ? item.latestActivityMessageId : item.lastMessageId);
    },
  });
  renderInbox();

  const rows = screen.getAllByTestId("inbox-row");
  const inactiveContent = within(rows[0]).getByTestId("conversation-card-content");
  const inactiveActions = within(rows[0]).getByTestId("conversation-card-actions");
  const inactiveTimestamp = within(rows[0]).getByTestId("conversation-card-timestamp");
  assert.match(inactiveContent.className, /(?:^|\s)w-full(?:\s|$)/);
  assert.match(inactiveActions.className, /(?:^|\s)absolute(?:\s|$)/);
  assert.match(inactiveActions.className, /(?:^|\s)right-3(?:\s|$)/);
  assert.match(inactiveActions.className, /(?:^|\s)top-3(?:\s|$)/);
  assert.doesNotMatch(inactiveActions.className, /(?:^|\s)shrink-0(?:\s|$)/);
  assert.match(inactiveTimestamp.className, /(?:^|\s)group-hover:opacity-0(?:\s|$)/);
  assert.match(inactiveTimestamp.className, /(?:^|\s)group-focus-within:opacity-0(?:\s|$)/);
  assert.equal(within(rows[0]).queryByTestId("inbox-row-save"), null);

  const inactiveDone = within(rows[0]).getByTestId("inbox-row-done");
  assert.match(inactiveDone.className, /(?:^|\s)pointer-events-none(?:\s|$)/);
  assert.match(inactiveDone.className, /(?:^|\s)group-hover:pointer-events-auto(?:\s|$)/);
  fireEvent.keyDown(inactiveDone, { key: "Enter" });
  fireEvent.keyDown(inactiveDone, { key: " " });
  assert.deepEqual(keyboardDoneCalls, [inactiveItem.lastMessageId, inactiveItem.lastMessageId]);
  // Keyboard Done must not bubble into the row's open activation (which opens
  // after a 220ms single-click window).
  await new Promise((resolve) => setTimeout(resolve, 260));
  assert.deepEqual(useSearchContentStore.getState().slot, { kind: "thread", id: activeItem.threadChannelId });

  const activeDone = within(rows[1]).getByTestId("inbox-row-done");
  const activeTimestamp = within(rows[1]).getByTestId("conversation-card-timestamp");
  assert.equal(rows[1].getAttribute("data-active"), "true");
  assert.match(activeDone.className, /(?:^|\s)pointer-events-auto(?:\s|$)/);
  assert.match(activeDone.className, /(?:^|\s)opacity-100(?:\s|$)/);
  assert.match(activeTimestamp.className, /(?:^|\s)opacity-0(?:\s|$)/);
  assert.equal(within(rows[1]).queryByTestId("inbox-row-save"), null);
});

test("Activity thread task badges consume canonical task-domain metadata instead of the retired cache", async () => {
  setDesktopViewport();
  resetServerFeatureFlagsForTests();
  seedStores("task-domain-badge", { legacyHasMore: false });
  setActivityGateForTests("off");
  const item = threadItem("task-domain-badge", {
    taskNumber: 34,
    taskStatus: "todo",
    taskClaimedByName: null,
  });
  useInboxStore.setState({
    items: [item],
    groups: [{
      channelId: item.parentChannelId,
      channelName: item.parentChannelName,
      channelType: item.parentChannelType,
      count: 1,
      lastActivityAt: item.lastActivityAt,
    }],
    totalCount: 1,
    totalUnreadCount: item.unreadCount,
  });
  useTaskStore.setState({
    taskMetadataByMessageId: {
      [item.parentMessageId]: {
        messageId: item.parentMessageId,
        taskNumber: 55,
        status: "done",
        claimedByName: "Cody",
      },
    },
  });
  assert.deepEqual(useThreadStore.getState().taskUpdatesByMessageId, {});

  renderInbox();

  const badge = await screen.findByTestId("conversation-card-task-badge");
  assert.match(badge.textContent ?? "", /#55/);
  assert.match(badge.textContent ?? "", /@Cody/);
});

test("Activity keeps the segmented toolbar and ignores a stale store channel filter", async () => {
  setDesktopViewport();
  resetServerFeatureFlagsForTests();
  const { serverId } = seedStores("flag-off", { legacyHasMore: false });
  useInboxStore.setState({ channelFilterId: "channel-hidden-filter" });
  await seedCore("on", "flag-off-core", serverId);

  renderInbox();
  await waitFor(() => assert.ok(screen.getByText("flag-off-core preview")));

  assert.ok(
    screen.getByTestId("inbox-filter-all"),
    "Activity keeps the segmented toolbar",
  );
});

for (const gate of ["off", "shadow"] as const) {
  test(`ThreadsInbox gate ${gate.toUpperCase()} stays wholly legacy-visible even with a core-shaped sentinel`, async () => {
    setDesktopViewport();
    resetServerFeatureFlagsForTests();
    const { serverId, legacy } = seedStores(`${gate}-legacy`, { legacyHasMore: false });
    if (gate === "shadow") await seedCore("shadow", `${gate}-core`, serverId);
    else setActivityGateForTests("off");

    renderInbox();
    await waitFor(() => assert.ok(screen.getByText(legacy.lastMessagePreview)));
    assert.equal(screen.queryByText(`${gate}-core preview`), null);
    assert.ok(screen.getByText("40 active · 17 unread"));
  });
}

test("a real server reset clears old receipts before a NEW scope's core sentinel can be visible", async () => {
  setDesktopViewport();
  resetServerFeatureFlagsForTests();
  const first = seedStores("old-scope");
  await seedCore("on", "old-core", first.serverId);
  renderInbox();
  await waitFor(() => assert.ok(screen.getByText("old-core preview")));

  let second!: ReturnType<typeof seedStores>;
  await act(async () => {
    triggerServerReset();
    // Preserve whatever receipt state the REAL reset left behind. If its
    // invalidation is deleted, the old equal pair survives and wrongly
    // authorises the new scope's otherwise healthy Core window.
    second = seedStores("new-scope", { receipts: "preserve", legacyHasMore: false });
    await seedCore("on", "new-core", second.serverId);
  });

  await waitFor(() => assert.ok(screen.getByText(second.legacy.lastMessagePreview)));
  assert.equal(
    screen.queryByText("new-core preview"),
    null,
    "new Core authority cannot pair with receipts that belonged to the old server",
  );
  assert.equal(useInboxStore.getState().acceptedWindowGeneration, "");
  assert.equal(useInboxStore.getState().unfollowedWindowGeneration, null);
});

test("principal switch cannot re-authorize the old Core scope while new receipts beat the new bootstrap", async () => {
  setDesktopViewport();
  resetServerFeatureFlagsForTests();
  useMessageStore.getState().setCurrentUserId("principal-a");
  const first = seedStores("principal-a-legacy");
  await seedCore("on", "principal-a-core", first.serverId, "principal-a");
  renderInbox();
  await waitFor(() => assert.ok(screen.getByText("principal-a-core preview")));

  // Issue one more A bootstrap and hold its response across the principal
  // transition. No newer bootstrap exists yet, so generation/principal
  // invalidation — not issuance ordering — must reject this late response.
  const lateA = deferred<{ data: ReturnType<typeof activitySnapshot> }>();
  const lateAStarted = deferred<string>();
  api.get = (async (url: string, config?: { params?: { requestId?: string } }) => {
    if (url !== "/channels/activity/snapshot") throw new Error(`Unexpected GET ${url}`);
    lateAStarted.resolve(config?.params?.requestId ?? "missing");
    return lateA.promise;
  }) as typeof api.get;
  const lateABootstrap = observeActivityBootstrap();
  const lateARequestId = await lateAStarted.promise;

  const principalBLegacy = channelItem("principal-b-legacy");
  await act(async () => {
    useMessageStore.getState().setCurrentUserId("principal-b");
    useAuthStore.setState((state) => ({
      user: state.user ? { ...state.user, id: "principal-b" } : state.user,
    }));
    // Model B's main and loaded-empty unfollowed responses settling before B's
    // Core snapshot. The equal receipts are healthy for B, but must never pair
    // with A's still-bound Core scope.
    useInboxStore.setState({
      items: [principalBLegacy],
      acceptedWindowGeneration: "principal-b-window",
      unfollowedItems: [],
      unfollowedLoading: false,
      unfollowedLoaded: true,
      unfollowedWindowGeneration: "principal-b-window",
      groups: [{
        channelId: principalBLegacy.channelId,
        channelName: "Principal B legacy group",
        channelType: "joint",
        count: 40,
        lastActivityAt: "2026-07-01T00:00:00.000Z",
      }],
      hasMore: false,
      totalCount: 40,
    allCount: 40,
      totalUnreadCount: 17,
      activeUnreadCount: 17,
      loaded: true,
      loading: false,
      loadingMore: false,
    });
  });

  await waitFor(() => assert.ok(screen.getByText(principalBLegacy.lastMessagePreview)));
  assert.equal(
    screen.queryByText("principal-a-core preview"),
    null,
    "B receipts must not re-authorize A's previously bound Core scope",
  );

  await act(async () => {
    lateA.resolve({
      data: activitySnapshot(lateARequestId, "principal-a-late", first.serverId, "principal-a"),
    });
    await lateABootstrap;
  });
  assert.ok(screen.getByText(principalBLegacy.lastMessagePreview));
  assert.equal(
    screen.queryByText("principal-a-late preview"),
    null,
    "an A bootstrap accepted after the switch must remain impossible",
  );

  api.get = (async (url: string, config?: { params?: { requestId?: string } }) => {
    if (url === "/channels/activity/snapshot") {
      return {
        data: activitySnapshot(
          config?.params?.requestId ?? "missing",
          "principal-b-core",
          first.serverId,
          "principal-b",
        ),
      };
    }
    throw new Error(`Unexpected GET ${url}`);
  }) as typeof api.get;
  await act(async () => {
    await observeActivityBootstrap();
  });

  await waitFor(() => assert.ok(screen.getByText("principal-b-core preview")));
  assert.equal(screen.queryByText(principalBLegacy.lastMessagePreview), null);
});

test("the All count keeps its unfiltered total through unread, mentions, source and search changes", async () => {
  seedStores("stable-all", { legacyHasMore: false });
  setActivityGateForTests("off");
  let globalTotal = 2324;
  api.get = (async (url: string, config?: { params?: Record<string, unknown> }) => {
    if (url !== "/channels/inbox") return { data: { items: [], total: 0 } };
    const params = config?.params ?? {};
    const unfiltered = params.filter === "all" && !params.channelId && !params.q;
    return { data: {
      items: [], groups: [{ channelId: "channel-only", channelName: "Only", channelType: "channel", count: 1, lastActivityAt: "2026-08-01T00:00:00.000Z" }], hasMore: false,
      totalCount: unfiltered ? globalTotal : 1, totalUnreadCount: 1,
    } };
  }) as typeof api.get;
  await act(async () => { await originalLoadInbox({ reset: true }); });
  assert.equal(useInboxStore.getState().allCount, 2324);
  for (const filter of ["unread", "mentions", "all"] as const) {
    await act(async () => { useInboxStore.getState().setFilter(filter); });
    await waitFor(() => assert.equal(useInboxStore.getState().loaded, true));
    assert.equal(useInboxStore.getState().allCount, 2324);
  }
  await act(async () => { useInboxStore.getState().setChannelFilterId("channel-only"); });
  await waitFor(() => assert.equal(useInboxStore.getState().loaded, true));
  assert.equal(useInboxStore.getState().totalCount, 1);
  assert.equal(useInboxStore.getState().allCount, 2324);
  await act(async () => { useInboxStore.getState().setSearchQuery("needle"); });
  await waitFor(() => assert.equal(useInboxStore.getState().loaded, true));
  assert.equal(useInboxStore.getState().allCount, 2324);
  globalTotal = 2325;
  await act(async () => { await originalLoadInbox({ reset: true }); });
  assert.equal(useInboxStore.getState().allCount, 2325, "refresh updates the true total rather than freezing it");
});

test("a filtered first load obtains All independently and server reset discards it", async () => {
  seedStores("first-unread", { legacyHasMore: false });
  setActivityGateForTests("off");
  useInboxStore.setState({ filter: "unread", allCount: null });
  api.get = (async (_url: string, config?: { params?: Record<string, unknown> }) => ({ data: {
    items: [], groups: [], hasMore: false,
    totalCount: config?.params?.filter === "all" ? 99 : 1,
    totalUnreadCount: 1,
  } })) as typeof api.get;
  await originalLoadInbox({ reset: true });
  assert.equal(useInboxStore.getState().allCount, 99);
  assert.equal(useInboxStore.getState().totalCount, 1);
  api.get = (async () => ({ data: { items: [], groups: [], totalCount: 0, totalUnreadCount: 0, hasMore: false } })) as typeof api.get;
  await originalLoadInbox({ reset: true });
  assert.equal(useInboxStore.getState().allCount, 0, "an authoritative zero replaces the previous count");
  triggerServerReset();
  assert.equal(useInboxStore.getState().allCount, null);
});

test("a late All count cannot cross a server reset and a failed count read cannot become a filtered total", async () => {
  seedStores("count-race", { legacyHasMore: false });
  setActivityGateForTests("off");
  useInboxStore.setState({ filter: "unread", allCount: 99 });
  const lateCount = deferred<{ data: { totalCount: number } }>();
  api.get = (async (_url: string, config?: { params?: Record<string, unknown> }) => {
    if (config?.params?.filter === "all") return lateCount.promise;
    return { data: { items: [], groups: [], hasMore: false, totalCount: 1, totalUnreadCount: 1 } };
  }) as typeof api.get;
  const oldLoad = originalLoadInbox({ reset: true });
  triggerServerReset();
  lateCount.resolve({ data: { totalCount: 9999 } });
  await oldLoad;
  assert.equal(useInboxStore.getState().allCount, null);

  seedStores("count-failure", { legacyHasMore: false });
  useInboxStore.setState({ filter: "unread", allCount: 99 });
  api.get = (async (_url: string, config?: { params?: Record<string, unknown> }) => {
    if (config?.params?.filter === "all") throw new Error("summary unavailable");
    return { data: { items: [], groups: [], hasMore: false, totalCount: 1, totalUnreadCount: 1 } };
  }) as typeof api.get;
  await originalLoadInbox({ reset: true });
  assert.equal(useInboxStore.getState().totalCount, 1);
  assert.equal(useInboxStore.getState().allCount, 99);
});

test("search keystrokes reuse the known All count while explicit refreshes reconcile it", async () => {
  seedStores("search-count-cache", { legacyHasMore: false });
  setActivityGateForTests("off");
  useInboxStore.setState({ allCount: 2324, searchQuery: "start" });
  const requests: Record<string, unknown>[] = [];
  api.get = (async (url: string, config?: { params?: Record<string, unknown> }) => {
    if (url !== "/channels/inbox") return { data: { items: [], total: 0 } };
    const params = config?.params ?? {};
    requests.push(params);
    return { data: { items: [], groups: [], hasMore: false,
      totalCount: params.limit === 1 ? 2325 : 1, totalUnreadCount: 0 } };
  }) as typeof api.get;
  await act(async () => {
    for (const value of ["n", "ne", "new"]) useInboxStore.getState().setSearchQuery(value);
  });
  assert.deepEqual(requests.map((params) => params.q), ["n", "ne", "new"]);
  assert.equal(useInboxStore.getState().allCount, 2324);
  for (const background of [false, true]) {
    requests.length = 0;
    await act(async () => { await useInboxStore.getState().refreshInbox({ background }); });
    assert.equal(requests.filter((params) => params.limit === 1 && params.filter === "all").length, 1);
    assert.equal(useInboxStore.getState().allCount, 2325);
  }
});

test("first search without a known All count requests one summary", async () => {
  seedStores("search-count-unknown", { legacyHasMore: false });
  setActivityGateForTests("off");
  useInboxStore.setState({ allCount: null });
  const requests: Record<string, unknown>[] = [];
  api.get = (async (_url: string, config?: { params?: Record<string, unknown> }) => {
    const params = config?.params ?? {};
    requests.push(params);
    return { data: { items: [], groups: [], hasMore: false,
      totalCount: params.limit === 1 ? 99 : 1, totalUnreadCount: 0 } };
  }) as typeof api.get;
  await act(async () => { useInboxStore.getState().setSearchQuery("first"); });
  assert.equal(requests.filter((params) => params.limit === 1 && params.filter === "all").length, 1);
  assert.equal(requests.filter((params) => params.q === "first").length, 1);
  assert.equal(useInboxStore.getState().allCount, 99);
});
