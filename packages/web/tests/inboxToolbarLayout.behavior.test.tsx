import assert from "node:assert/strict";
import { test as nodeTest } from "vitest";
import "./helpers/domSetup";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import api from "../src/api/client";
import MessageSearchPage from "../src/components/search/MessageSearchPage";
import TasksPanel from "../src/components/task/TasksPanel";
import ThreadsInbox from "../src/components/thread/ThreadsInbox";
import PanelHeader from "../src/components/ui/PanelHeader";
import { TestIntlProvider } from "./helpers/intl";
import {
  resetActivityRuntimeForTests,
  setActivityGateForTests,
} from "../src/store/activityPanel/runtime";
import { useAgentStore } from "../src/store/agentStore";
import { useAuthStore } from "../src/store/authStore";
import { useChannelStore } from "../src/store/channelStore";
import { useInboxStore } from "../src/store/inboxStore";
import type { InboxGroupCount, InboxItem } from "../src/store/inboxStore";
import { useMessageStore } from "../src/store/messageStore";
import { useSavedStore } from "../src/store/savedStore";
import { useSearchContentStore } from "../src/store/searchContentStore";
import { resetServerFeatureFlagsForTests } from "../src/store/serverFeatureFlags";
import { triggerServerReset } from "../src/store/serverResetRegistry";
import { useServerStore } from "../src/store/serverStore";
import { useTaskStore } from "../src/store/taskStore";
import { useThreadStore } from "../src/store/threadStore";

type TestFn = () => void | Promise<void>;
const test = (name: string, fn: TestFn) =>
  nodeTest(name,  fn);

if (typeof window.matchMedia !== "function") {
  stubDesktopViewport();
}

globalThis.ResizeObserver = globalThis.ResizeObserver ?? class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as typeof ResizeObserver;

const originalGet = api.get;
const originalPost = api.post;

function stubDesktopViewport() {
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

function channelItem(label: string): Extract<InboxItem, { kind: "channel" | "dm" }> {
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
  };
}

function seedActivityStores(label: string) {
  const serverId = `server-${label}`;
  const item = channelItem(label);
  const dmGroup: InboxGroupCount = {
    channelId: `dm-${label}`,
    channelName: `${label} dm`,
    channelType: "dm",
    count: 3,
    lastActivityAt: "2026-08-01T00:00:00.000Z",
  };
  const channelGroup: InboxGroupCount = {
    channelId: item.channelId,
    channelName: item.channelName,
    channelType: "channel",
    count: 40,
    lastActivityAt: item.lastMessageAt,
  };
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
    current: { id: serverId, name: "Layout", slug: `layout-${label}`, role: "owner" } as never,
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
  useInboxStore.setState({
    items: [item],
    acceptedWindowGeneration: `window-${label}`,
    unfollowedWindowGeneration: `window-${label}`,
    unfollowedItems: [],
    unfollowedLoading: false,
    unfollowedLoaded: true,
    groups: [dmGroup, channelGroup],
    filter: "all",
    channelFilterId: null,
    sortDirection: "desc",
    searchQuery: "",
    loading: false,
    loadingMore: false,
    loaded: true,
    hasMore: false,
    totalCount: 43,
    totalUnreadCount: 17,
    activeUnreadCount: 17,
    focusedItemKey: null,
    pendingFocusKind: null,
  });
  return { serverId, item, dmGroup, channelGroup };
}

function renderInbox() {
  const slug = useServerStore.getState().current?.slug ?? "layout";
  api.get = (async (url: string) => {
    if (url === "/channels/inbox") {
      const state = useInboxStore.getState();
      return {
        data: {
          items: state.items,
          groups: state.groups,
          hasMore: false,
          totalCount: state.totalCount,
          totalUnreadCount: state.totalUnreadCount,
          activeUnreadCount: state.activeUnreadCount,
        },
      };
    }
    throw new Error(`Unexpected GET ${url}`);
  }) as typeof api.get;
  api.post = (async (url: string) => {
    if (url === "/feature-flags/evaluate") {
      return { data: { evaluations: [] } };
    }
    if (url === "/channels/saved/check") {
      return { data: { savedIds: [] } };
    }
    throw new Error(`Unexpected POST ${url}`);
  }) as typeof api.post;
  return render(
    <TestIntlProvider locale="en">
      <MemoryRouter initialEntries={[`/s/${slug}/activity`]}>
        <ThreadsInbox />
      </MemoryRouter>
    </TestIntlProvider>,
  );
}

function closestWithSlot(element: Element, slot: string): HTMLElement {
  const match = element.closest(`[data-slot="${slot}"]`);
  assert.ok(match instanceof HTMLElement, `expected an ancestor with data-slot="${slot}"`);
  return match;
}

/** The unprefixed (desktop) inline padding token an element ends up with: `px-N` or `p-N`. */
function desktopInlinePadding(element: Element): string | undefined {
  return [...element.classList].filter((c) => /^px?-/.test(c)).map((c) => c.replace(/^px?-/, "")).at(-1);
}

afterEach(() => {
  cleanup();
  api.get = originalGet;
  api.post = originalPost;
  useMessageStore.getState().setCurrentUserId(null);
  resetServerFeatureFlagsForTests();
  resetActivityRuntimeForTests();
  triggerServerReset();
  window.localStorage.clear();
});

test("inbox toolbar keeps the fixed-height rail shared with the scroll body", () => {
  stubDesktopViewport();
  resetServerFeatureFlagsForTests();
  seedActivityStores("toolbar-rail");
  setActivityGateForTests("off");

  renderInbox();

  const toolbar = screen.getByTestId("inbox-toolbar");
  assert.ok(toolbar.classList.contains("px-4"));
  assert.ok(toolbar.classList.contains("h-[54px]"));
  assert.ok(!toolbar.classList.contains("min-h-[88px]"));

  const scroll = screen.getByTestId("inbox-scroll");
  // Raft DS Inbox: rows are full-bleed list rows (hover and selection reach the
  // panel edge), so the 16px rail shared with the toolbar's px-4 lives on each
  // row instead of on the scroll body.
  assert.ok(!scroll.classList.contains("p-4"));
  const rows = scroll.querySelectorAll<HTMLElement>('[data-testid="inbox-row"]');
  assert.ok(rows.length > 0, "the seeded Activity row must render inside the scroll body");
  for (const row of rows) assert.ok(row.classList.contains("px-4"), "every Activity row must sit on the 16px rail");
  // scrollbar-quiet is half of the visible-affordance contract: overlay keeps
  // the gutter from being reserved, quiet keeps the thumb subtle-but-visible.
  // The retired source regex pinned both; dropping either must stay RED.
  assert.ok(scroll.classList.contains("scrollbar-quiet"));
  assert.ok(scroll.classList.contains("overflow-y-overlay"));
  assert.ok(!scroll.classList.contains("scrollbar-none"));

  const header = screen.getByTestId("inbox-header");
  assert.equal(header.getAttribute("data-slot"), "panel-header");
  assert.ok(header.classList.contains("gap-3"));
  // Raft panel head: the title starts on the 20px rail (pl-5); the trailing
  // side is pr-3 because the actions' own offset lands the last glyph on 20px.
  assert.ok(header.classList.contains("pl-5"));
  assert.ok(header.classList.contains("pr-3"));
});

test("PanelHeader renders the canonical main-panel horizontal padding", () => {
  render(
    <TestIntlProvider locale="en">
      <PanelHeader title="Computers" containerProps={{ "data-testid": "panel-header" }} />
    </TestIntlProvider>,
  );

  const header = screen.getByTestId("panel-header");
  for (const className of ["flex", "items-center", "gap-3"]) {
    assert.ok(header.classList.contains(className), `PanelHeader header row must carry ${className}`);
  }
  for (const className of header.classList) {
    assert.ok(
      !className.startsWith("sm:"),
      `PanelHeader header row must not shrink at narrow breakpoints; found ${className}`,
    );
  }
});

test("MessageSearchPage filter toolbar shares the horizontal rail with its results", async () => {
  stubDesktopViewport();
  useAuthStore.setState({
    user: { id: "user-current", name: "current", displayName: "Current", email: "current@example.com" } as never,
    loading: false,
    initialized: true,
  });
  useServerStore.setState({
    current: { id: "server-search", name: "Search", slug: "search-layout", role: "owner" } as never,
    members: [],
  });
  useChannelStore.setState({ channels: [], dmChannels: [] });
  useAgentStore.setState({ agents: [], agentActivities: {} });
  useSearchContentStore.setState({ slot: null });
  useThreadStore.setState({
    openParentChannelId: null,
    openParentMessageId: null,
    openThreadChannelId: null,
  });
  window.localStorage.setItem("slock_access_token", "token");
  api.get = (async (url: string) => {
    if (url === "/messages/search") {
      return {
        data: {
          hasMore: false,
          results: [{
            id: "message-rail",
            channelId: "channel-rail",
            channelName: "rail",
            channelType: "channel",
            channelArchivedAt: null,
            senderId: "user-current",
            senderType: "user",
            senderName: "Current",
            content: "rail alignment hit",
            snippet: "rail alignment hit",
            createdAt: "2026-08-01T00:00:00.000Z",
          }],
        },
      };
    }
    throw new Error(`Unexpected GET ${url}`);
  }) as typeof api.get;

  render(
    <TestIntlProvider locale="en">
      <MemoryRouter initialEntries={["/s/search-layout/search?q=rail"]}>
        <MessageSearchPage />
      </MemoryRouter>
    </TestIntlProvider>,
  );

  const toolbar = screen.getByRole("combobox", { name: "From" }).closest('[data-slot="search-shell-filters"]') as HTMLElement;
  assert.ok(toolbar, "expected to find [data-slot='search-shell-filters']");
  assert.ok(toolbar.classList.contains("px-4"));
  assert.ok(toolbar.classList.contains("py-3"));
  assert.ok(!toolbar.classList.contains("px-5"));

  let result: HTMLElement | undefined;
  await waitFor(() => {
    result = Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("rail alignment hit"));
    assert.ok(result, "the search hit must render inside the results rail");
  });
  const rail = result?.closest("div.p-4");
  assert.ok(rail instanceof HTMLElement, "search results must live inside the 16px content rail");
  // The Raft redraw dropped the page's own `p-4` wrapper: raft-ui's results
  // area is the rail itself, directly after the toolbar (it used to be the
  // wrapper's parent). Boolean form: node:assert diffing two live elements
  // crashes the worker on failure.
  assert.ok(
    rail === toolbar.nextElementSibling || rail.parentElement === toolbar.nextElementSibling,
    "the results rail follows the filter toolbar",
  );
});

test("TasksPanel filter toolbar shares the horizontal rail with its header and task content", () => {
  stubDesktopViewport();
  useTaskStore.setState({
    tasks: [],
    serverTasks: [],
    serverLoading: false,
    loadServerTasks: async () => undefined,
    loadActiveTaskSummaries: async () => undefined,
    registerServerTasksConsumer: () => undefined,
    unregisterServerTasksConsumer: () => undefined,
  } as never);

  render(
    <MemoryRouter>
      <TestIntlProvider locale="en">
        <TasksPanel />
      </TestIntlProvider>
    </MemoryRouter>,
  );

  // Raft tasks panel: the head, the filter toolbar and the task content sit on
  // one rail, 20px on desktop and 16px on a phone (raft-ui's tasks-panel
  // toolbar and viewport recipes both carry `px-5 max-md:px-4`).
  const toolbar = closestWithSlot(screen.getByRole("button", { name: /Channel/ }), "tasks-panel-toolbar");
  assert.ok(toolbar.classList.contains("px-5"));
  assert.ok(toolbar.classList.contains("max-md:px-4"));
  assert.ok(toolbar.classList.contains("py-3"));

  // The head is raft-ui's section head (white on desktop, the frame on a
  // phone); its content starts on the same 20 / 16 rail.
  const headerRow = screen.getByRole("heading", { name: "Tasks" }).closest('[data-slot="panel-section-header"]') as HTMLElement;
  assert.ok(headerRow);
  assert.ok(headerRow.classList.contains("pl-5"));
  assert.ok(headerRow.classList.contains("max-md:pl-4"));

  const viewport = document.querySelector<HTMLElement>("[data-task-virtual-scroll]");
  assert.ok(viewport, "the task content viewport must render");
  assert.equal(
    desktopInlinePadding(viewport),
    desktopInlinePadding(toolbar),
    `task content must start on the toolbar's desktop rail; viewport class: ${viewport.className}`,
  );
  assert.ok(viewport.classList.contains("max-md:px-4"));
});
