import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "./helpers/domSetup";
import { createElement } from "react";
import { Popover } from "@botiverse/raft-ui";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { TestIntlProvider } from "./helpers/intl";
import ServerSwitcherMenu from "../src/components/ui/ServerSwitcherMenu";
import { useServerStore } from "../src/store/serverStore";
import type { Server } from "../src/store/serverStore";
import { getChannelUnreadIndicatorState, hasUnmutedUnread, shouldShowActivityMutedIcon } from "../src/utils/channelUnreadIndicator";
import {
  hasOtherServerLoudUnread,
  parseServerUnreadSummaryRows,
} from "../src/utils/serverUnreadSummary";

const repoRoot = resolve(import.meta.dirname, "..");
const read = (path: string) => {
  const text = readFileSync(resolve(repoRoot, path), "utf8");
  if (!text.startsWith("// @ts-nocheck\n") && !text.includes("function stryNS_")) return text;
  return execFileSync("git", ["show", `HEAD:packages/web/${path}`], {
    cwd: repoRoot,
    encoding: "utf8",
  });
};

const currentServer: Server = {
  id: "server-alpha",
  name: "Alpha",
  avatarUrl: null,
  slug: "alpha",
  ownerId: "user-1",
  onboardingAgentId: null,
  hideHumansFromMembers: false,
  plan: "pro",
  planDowngradedAt: null,
  role: "owner",
  createdAt: "2026-05-14T00:00:00.000Z",
};

const targetServer: Server = {
  ...currentServer,
  id: "server-beta",
  name: "Beta",
  slug: "beta",
};
type JoinCommunityServer = ReturnType<typeof useServerStore.getState>["joinCommunityServer"];

function renderMenu({
  onClose = () => {},
  testId,
  navigationMode,
  unreadCounts = {},
  joinCommunityServer = async () => currentServer,
}: {
  onClose?: () => void;
  testId?: string;
  navigationMode?: "restore-surface" | "replace-with-home";
  unreadCounts?: Record<string, {
    unreadCount: number;
    serverPushMuted?: boolean;
    activityUnreadCount?: number;
  }>;
  joinCommunityServer?: JoinCommunityServer;
} = {}) {
  useServerStore.setState({
    current: currentServer,
    servers: [currentServer, targetServer],
    members: [],
    loading: false,
    updateServerOrder: async () => {},
    joinCommunityServer,
  } as never);
  return render(
    createElement(
      MemoryRouter,
      { initialEntries: ["/s/alpha"] },
      createElement(
        TestIntlProvider,
        null,
        openSwitcher({ onClose, testId, navigationMode, serverUnreadCounts: unreadCounts }),
        createElement(LocationProbe),
      ),
    ),
  );
}

// The switcher is the content of the caller's raft-ui Popover; an open one
// closes through `onClose` as the callers wire it.
function openSwitcher(props: Omit<Parameters<typeof ServerSwitcherMenu>[0], "onClose"> & { onClose: () => void }) {
  return createElement(
    Popover,
    { open: true, onOpenChange: (open: boolean) => { if (!open) props.onClose(); } },
    createElement(ServerSwitcherMenu, props),
  );
}

function LocationProbe() {
  const location = useLocation();
  return createElement("output", { "data-testid": "location-probe" }, location.pathname + location.search);
}

function setBrowserLanguages(languages: string[]) {
  Object.defineProperty(window.navigator, "languages", {
    configurable: true,
    value: languages,
  });
  Object.defineProperty(window.navigator, "language", {
    configurable: true,
    value: languages[0] ?? "en-US",
  });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  setBrowserLanguages(["en-US"]);
  useServerStore.setState({ current: null, servers: [], members: [] } as never);
});

// `ServerSwitcherMenu` is the single primitive for the "switch server"
// list behind every trigger (rail, top bar, phone pill), so they cannot drift
// on details like "the current row hides its own unread badge".

test("ServerSwitcherMenu primitive exists and exports the expected shape", async () => {
  let closes = 0;
  const { container } = renderMenu({ onClose: () => { closes += 1; } });

  const menu = screen.getByTestId("server-switcher-menu");
  // A raft-ui Popover: the list is portaled out of the trigger's column (so
  // opening it never moves the page), declares itself a dismiss layer, and is
  // never taller than the space it has — the workspace list scrolls inside it
  // while the footer actions stay outside the scroller, always reachable.
  assert.equal(menu.getAttribute("data-slot"), "popover-content");
  assert.equal(container.contains(menu), false, "the menu is portaled, not inline under its trigger");
  assert.equal(menu.getAttribute("data-dismiss-layer"), "");
  assert.match(menu.className, /max-h-\(--available-height\)/);
  assert.doesNotMatch(menu.className, /\babsolute\b|top-full|left-full/, "no hand placement");
  const list = within(menu).getByRole("link", { name: /Alpha/ }).closest(".overflow-y-auto");
  assert.ok(list, "the workspace list is the scroller");
  assert.equal(list.contains(within(menu).getByRole("button", { name: "Switch or Create Server" })), false);

  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => assert.equal(closes, 1, "Escape closes the menu"));
  fireEvent.pointerDown(document.body);
  fireEvent.mouseDown(document.body);
  fireEvent.click(document.body);
  await waitFor(() => assert.ok(closes >= 2, "an outside press closes the menu"));
});

test("current server row hides its own unread badge (stdrc decision C)", () => {
  renderMenu({
    unreadCounts: {
      "server-alpha": { unreadCount: 7, activityUnreadCount: 7 },
      "server-beta": { unreadCount: 3, activityUnreadCount: 3 },
    },
  });

  const alpha = screen.getByRole("link", { name: /Alpha/ });
  const beta = screen.getByRole("link", { name: /Beta/ });
  assert.equal(within(alpha).queryByText("7"), null, "current server's own unread badge stays hidden");
  assert.ok(within(beta).getByText("3"), "other servers still show their unread count");
});

test("server switcher unread count is loud unless the server is muted", () => {
  renderMenu({
    unreadCounts: {
      "server-beta": { unreadCount: 5, activityUnreadCount: 5 },
    },
  });
  // Raft Design System › Badge: unread is the pink count sticker (raft-ui's
  // accent badge owns the 20px pink + ink edge); the switcher only places it.
  const loud = within(screen.getByRole("link", { name: /Beta/ })).getByText("5");
  assert.equal(loud.getAttribute("data-slot"), "badge");
  assert.equal(loud.getAttribute("data-variant"), "accent");
  assert.doesNotMatch(loud.className, /text-white/);
  assert.doesNotMatch(loud.className, /text-foreground-hint/);
  cleanup();

  renderMenu({
    unreadCounts: {
      "server-beta": { unreadCount: 5, serverPushMuted: true, activityUnreadCount: 5 },
    },
  });
  // A muted workspace keeps its number as the gray mono count (rf-count), never
  // the pink badge.
  const quiet = within(screen.getByRole("link", { name: /Beta/ })).getByText("5");
  assert.notEqual(quiet.getAttribute("data-slot"), "badge");
  assert.match(quiet.className, /font-mono text-mono-meta text-foreground-hint/);
  assert.doesNotMatch(quiet.className, /text-white/);
});

test("muted servers keep numeric counts but do not light cross-server attention dots", () => {
  const summaries = parseServerUnreadSummaryRows([
    { serverId: "server-alpha", unreadCount: 10, serverPushMuted: false, activityUnreadCount: 10 },
    { serverId: "server-beta", unreadCount: 6, serverPushMuted: true, activityUnreadCount: 6 },
    { serverId: "server-gamma", unreadCount: 4, serverPushMuted: false, activityUnreadCount: 4 },
  ]);

  assert.equal(summaries["server-beta"].serverPushMuted, true);
  assert.equal(
    hasOtherServerLoudUnread(
      [{ id: "server-alpha" }, { id: "server-beta" }],
      { id: "server-alpha" },
      summaries,
    ),
    false,
    "muted unread on another server stays numeric-only, not a cross-server attention dot",
  );
  assert.equal(
    hasOtherServerLoudUnread(
      [{ id: "server-alpha" }, { id: "server-gamma" }],
      { id: "server-alpha" },
      summaries,
    ),
    true,
    "unmuted unread on another server still lights cross-server attention",
  );
});

test("Activity counts are independent of server notification mute state", () => {
  const leftRail = read("src/components/layout/LeftRail.tsx");
  const sidebar = read("src/components/layout/Sidebar.tsx");
  const parser = read("src/utils/serverUnreadSummary.ts");

  assert.match(parser, /serverPushMuted: entry\.serverPushMuted === true/);
  assert.match(parser, /activityUnreadCount/);
  assert.match(leftRail, /hasOtherServerActivityUnread\(servers, server, serverUnreadCounts\)/);
  assert.match(sidebar, /hasOtherServerActivityUnread\(servers, server, serverUnreadCounts\)/);
});

test("muted joined channels still show quiet numeric unread counts", () => {
  assert.deepEqual(
    getChannelUnreadIndicatorState({ unread: 3, joined: true, showMutedIcon: false }),
    { showLoudUnreadBadge: true, showQuietUnreadCount: false, showQuietNewDot: false },
  );
  assert.deepEqual(
    getChannelUnreadIndicatorState({ unread: 3, joined: true, showMutedIcon: true }),
    { showLoudUnreadBadge: false, showQuietUnreadCount: true, showQuietNewDot: false },
  );
  assert.deepEqual(
    getChannelUnreadIndicatorState({ unread: 3, joined: false, showMutedIcon: false }),
    { showLoudUnreadBadge: false, showQuietUnreadCount: true, showQuietNewDot: false },
  );
  assert.deepEqual(
    getChannelUnreadIndicatorState({ unread: 0, joined: true, showMutedIcon: true }),
    { showLoudUnreadBadge: false, showQuietUnreadCount: false, showQuietNewDot: false },
  );
  // hasNew (non-joined public channel with messages past the cursor, no count):
  // a quiet dot on a non-joined row only; a count, when present, wins.
  assert.deepEqual(
    getChannelUnreadIndicatorState({ unread: 0, joined: false, showMutedIcon: false, hasNew: true }),
    { showLoudUnreadBadge: false, showQuietUnreadCount: false, showQuietNewDot: true },
  );
  assert.deepEqual(
    getChannelUnreadIndicatorState({ unread: 0, joined: true, showMutedIcon: false, hasNew: true }),
    { showLoudUnreadBadge: false, showQuietUnreadCount: false, showQuietNewDot: false },
  );
  assert.deepEqual(
    getChannelUnreadIndicatorState({ unread: 2, joined: false, showMutedIcon: false, hasNew: true }),
    { showLoudUnreadBadge: false, showQuietUnreadCount: true, showQuietNewDot: false },
  );
  assert.equal(shouldShowActivityMutedIcon({ activityMuted: true, joined: true }), true);
  assert.equal(shouldShowActivityMutedIcon({ activityMuted: true, joined: false }), false);
  assert.equal(shouldShowActivityMutedIcon({ activityMuted: false, joined: true }), false);
});

test("sidebar section attention ignores muted unread and preserves ordinary and mixed unread", () => {
  const ordinary = { id: "ordinary", activityMuted: false };
  const mutedOne = { id: "muted-one", activityMuted: true };
  const mutedTwo = { id: "muted-two", activityMuted: true };

  assert.equal(
    hasUnmutedUnread({ ordinary: 2 }, [ordinary]),
    true,
    "ordinary unread must light its section",
  );
  assert.equal(
    hasUnmutedUnread({ "muted-one": 2, "muted-two": 1 }, [mutedOne, mutedTwo]),
    false,
    "a section whose unread chats are all muted must stay quiet",
  );
  assert.equal(
    hasUnmutedUnread({ ordinary: 1, "muted-one": 3 }, [mutedOne, ordinary]),
    true,
    "one unmuted unread chat must still light a mixed section",
  );
});

test("server switcher primitive renders a sortable handle for every server row", () => {
  renderMenu();

  assert.ok(screen.getByRole("button", { name: "Reorder Alpha" }));
  assert.ok(screen.getByRole("button", { name: "Reorder Beta" }));
});

test("server switcher primitive honors desktop and mobile navigation modes", () => {
  localStorage.setItem("slock:serverSurface:v1:beta", "/s/beta/tasks");
  const { rerender } = renderMenu({ testId: "desktop-server-switcher-menu" });
  assert.ok(screen.getByTestId("desktop-server-switcher-menu"));
  assert.equal(screen.getByRole("link", { name: /Beta/ }).getAttribute("href"), "/s/beta/tasks");
  assert.ok(screen.getByText("Switch or Create Server"));

  rerender(
    createElement(
      MemoryRouter,
      { initialEntries: ["/s/alpha"] },
      createElement(
        TestIntlProvider,
        null,
        openSwitcher({
          onClose: () => {},
          testId: "mobile-server-switcher-menu",
          navigationMode: "replace-with-home",
          serverUnreadCounts: {},
        }),
      ),
    ),
  );
  assert.ok(screen.getByTestId("mobile-server-switcher-menu"));
  assert.equal(
    screen.getByRole("link", { name: /Beta/ }).getAttribute("href"),
    "/s/beta",
    "mobile server switches must land at the selected server Home and replace the previous server entry",
  );
});

test("server switcher primitive renders the shared footer actions", () => {
  renderMenu();

  assert.ok(screen.getByRole("button", { name: "Join Community" }));
  assert.equal(screen.queryByRole("button", { name: "Join Chinese Community" }), null);
  assert.ok(screen.getByRole("button", { name: "Switch or Create Server" }));
});

test("Chinese browser language does not add the QR-page action to the server switcher", async () => {
  setBrowserLanguages(["zh-CN", "en-US"]);
  const joinCalls: Array<{ slug?: string }> = [];
  let closes = 0;
  renderMenu({
    onClose: () => { closes += 1; },
    joinCommunityServer: async (options = {}) => {
      joinCalls.push(options);
      return currentServer;
    },
  });

  assert.equal(screen.queryByRole("button", { name: "Join Chinese Community" }), null);
  fireEvent.click(screen.getByRole("button", { name: "Join Community" }));

  await waitFor(() => {
    assert.equal(joinCalls.length, 1);
  });
  assert.equal(closes, 1);
  assert.equal(joinCalls[0]?.slug, "community");
});

test("a switcher row lights only on hover or keyboard focus, not on the focus a mouse open moves in", () => {
  // The popover focuses its first row when it opens. With `focus-within`, a
  // mouse-opened switcher showed that row yellow as if hovered, while the
  // current workspace (checked) sat elsewhere; blurring the window cleared it.
  const source = readFileSync(resolve(import.meta.dirname, "../src/components/ui/ServerSwitcherMenu.tsx"), "utf8");
  const row = source.match(/className="group\/server-row [^"]*"/)?.[0] ?? "";
  assert.ok(row, "the server row class is found");
  assert.match(row, /has-\[:focus-visible\]:bg-brand-soft/);
  assert.doesNotMatch(row, /focus-within:bg-/);
});
