import assert from "node:assert/strict";
import "./helpers/domSetup";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import api from "../src/api/client";
import { AppTopBar } from "../src/components/topbar/AppTopBar";
import { LeftRail } from "../src/components/layout/LeftRail";
import { TopBarGlobalActions } from "../src/components/topbar/TopBarGlobalActions";
import { ShellTopBar } from "../src/components/topbar/ShellTopBar";
import { TopBarHostContext } from "../src/components/topbar/topBarHostContext";
import type { TopBarHost } from "../src/components/topbar/topBarHostContext";
import { shouldShowTopBar } from "../src/components/topbar/topBarVisibility";
import { TestIntlProvider } from "./helpers/intl";
import { useServerStore } from "../src/store/serverStore";
import { useLiveAgentActivityStore } from "../src/store/liveAgentActivityStore";

// Task #753 (WAWQAQ 2026-10-13): the web gets the desktop app's top bar. The
// bar owns the workspace switcher and the search entry, so the rail gives both
// up. Pixel facts (search field centred, overlay hanging off the field, strip
// drag) are browser-verified on the PR; jsdom has no layout, so these teeth
// cover what the bar DOES: where a click goes, what the rail still renders,
// and where another workspace's unread dot lands.

function matchMediaStub(matches: boolean): typeof window.matchMedia {
  return ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
const originalMatchMedia = typeof window.matchMedia === "function" ? window.matchMedia : matchMediaStub(false);

// jsdom has no ResizeObserver; the switcher menu sizes itself with one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
const hadResizeObserver = typeof globalThis.ResizeObserver !== "undefined";
if (!hadResizeObserver) globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

const originalApiGet = api.get;
const originalServerState = useServerStore.getState();

afterEach(() => {
  cleanup();
  api.get = originalApiGet;
  window.matchMedia = originalMatchMedia;
  useServerStore.setState(originalServerState, true);
  document.documentElement.removeAttribute("style");
});

function seedServers(unreadServerId: string | null = null) {
  useServerStore.setState({
    ...originalServerState,
    current: { id: "server-1", name: "Botiverse", slug: "botiverse" } as never,
    servers: [
      { id: "server-1", name: "Botiverse", slug: "botiverse" },
      { id: "server-2", name: "Other", slug: "other" },
    ] as never,
    serverUnreadCounts: unreadServerId
      ? { [unreadServerId]: { unreadCount: 3, serverPushMuted: false, activityUnreadCount: 3 } }
      : {},
  });
  api.get = (() => new Promise(() => {})) as typeof api.get;
}

let seenLocation: ReturnType<typeof useLocation> | null = null;
function LocationProbe() {
  seenLocation = useLocation();
  return null;
}

function renderBar(props: Parameters<typeof AppTopBar>[0] = {}, entry = "/s/botiverse/channel/general?msg=1") {
  seenLocation = null;
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <TestIntlProvider>
        <AppTopBar {...props} />
        <LocationProbe />
      </TestIntlProvider>
    </MemoryRouter>,
  );
}

test("the search field opens search as an overlay over the view you were on", () => {
  // Desktop width: the overlay is on, so the entry carries the view to float over.
  window.matchMedia = matchMediaStub(true);
  seedServers();
  const { getByTestId } = renderBar();
  fireEvent.click(getByTestId("app-top-bar-search"));
  assert.equal(seenLocation?.pathname, "/s/botiverse/search");
  const state = seenLocation?.state as { backgroundLocation?: { pathname: string; search: string }; searchFrom?: string };
  assert.deepEqual(state.backgroundLocation, { pathname: "/s/botiverse/channel/general", search: "?msg=1" });
  assert.equal(state.searchFrom, "/s/botiverse/channel/general?msg=1");
});

test("clicking the search field on the full search page does not stack an overlay on it", () => {
  window.matchMedia = matchMediaStub(true);
  seedServers();
  const { getByTestId } = renderBar({}, "/s/botiverse/search?q=hello");
  fireEvent.click(getByTestId("app-top-bar-search"));
  assert.equal(seenLocation?.pathname, "/s/botiverse/search");
  const state = seenLocation?.state as { backgroundLocation?: unknown };
  assert.equal(state.backgroundLocation, undefined, "the search page is never its own overlay background");
});

test("the workspace name opens the server switcher menu listing every workspace", () => {
  seedServers();
  const { getByTestId, queryByTestId } = renderBar();
  assert.ok(queryByTestId("desktop-server-switcher-menu") === null, "menu starts closed");
  const trigger = getByTestId("desktop-workspace-trigger");
  assert.equal(trigger.textContent?.includes("Botiverse"), true, "the trigger names the current workspace");
  fireEvent.click(trigger);
  const menu = getByTestId("desktop-server-switcher-menu");
  assert.equal(menu.textContent?.includes("Other"), true, "the other workspace is offered");
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
});

test("another workspace's unread shows on the name button when no strip avatar can carry it", () => {
  // jsdom measures every width as 0, so the strip is collapsed: exactly the
  // narrow-window case where the dot has nowhere else to go.
  seedServers("server-2");
  const { queryByTestId, getByTestId } = renderBar();
  assert.ok(queryByTestId("desktop-workspace-strip") === null, "strip is collapsed");
  assert.ok(queryByTestId("app-top-bar-workspace-unread") !== null, "the unread dot is on the name button");
  // It is the avatar's raft-ui badge, not a free-floating dot beside the slot.
  const badge = getByTestId("app-top-bar-workspace-unread").closest('[data-slot="avatar-badge"]');
  assert.ok(badge !== null, "the dot is mounted through raft-ui AvatarBadge");
  assert.ok(getByTestId("desktop-workspace-trigger").contains(badge), "on the name button's own avatar");
  // The dot hangs off the avatar's corner, so nothing between it and the
  // button (the button included) may clip; only the name truncates.
  const trigger = getByTestId("desktop-workspace-trigger");
  for (let node = badge!.parentElement; node; node = node.parentElement) {
    assert.doesNotMatch(node.className.toString(), /(^|\s)(\[[^\]]*\]:)?overflow-(hidden|clip)(\s|$)/, `${node.getAttribute("data-slot") ?? node.tagName} must not clip the dot`);
    if (node === trigger) break;
  }
  // The dot is decorative (aria-hidden), so the button's name has to say it.
  assert.match(getByTestId("desktop-workspace-trigger").getAttribute("aria-label") ?? "", /Botiverse.*unread/i);
});

test("the current workspace's own unread never lights the cross-workspace dot", () => {
  seedServers("server-1");
  const { queryByTestId, getByTestId } = renderBar();
  assert.ok(queryByTestId("app-top-bar-workspace-unread") === null);
  assert.equal(getByTestId("desktop-workspace-trigger").getAttribute("aria-label"), "Botiverse");
});

test("the bar publishes the search field's position for the overlay and clears it on unmount", async () => {
  seedServers();
  const { unmount } = renderBar();
  const root = document.documentElement;
  await waitFor(() => assert.notEqual(root.style.getPropertyValue("--desktop-search-anchor-top"), ""));
  assert.notEqual(root.style.getPropertyValue("--desktop-search-anchor-width"), "");
  unmount();
  assert.equal(root.style.getPropertyValue("--desktop-search-anchor-top"), "", "a stale anchor would misplace the overlay after the bar is gone");
  assert.equal(root.style.getPropertyValue("--desktop-search-anchor-width"), "");
});

test("the web bar is not a window title bar; the desktop shell opts in and fills the slots", () => {
  seedServers();
  const web = renderBar();
  assert.equal(web.getByTestId("app-top-bar").hasAttribute("data-raft-titlebar"), false);
  web.unmount();
  const desktop = renderBar({
    titleBar: true,
    leadingEnd: <span data-testid="slot-leading-end" />,
    trailing: <span data-testid="slot-trailing" />,
  });
  assert.equal(desktop.getByTestId("app-top-bar").hasAttribute("data-raft-titlebar"), true);
  assert.ok(desktop.getByTestId("slot-leading-end").closest("[data-topbar-leading-end]") !== null, "history controls sit where the strip stops");
  assert.ok(desktop.queryByTestId("slot-trailing") !== null);
});

function renderRail(topBar: boolean) {
  return render(
    <MemoryRouter initialEntries={["/s/botiverse/channel/general"]}>
      <TestIntlProvider>
        <LeftRail topBar={topBar} />
      </TestIntlProvider>
    </MemoryRouter>,
  );
}

test("with the top bar, the rail drops its server switcher, Search tab and Bell, and keeps Help above Settings", () => {
  seedServers();
  const withBar = renderRail(true);
  assert.ok(withBar.queryByTestId("left-rail-tab-search") === null, "search has one entry: the bar");
  assert.ok(withBar.container.querySelector('button[aria-label*="Botiverse"]') === null, "the switcher has one entry: the bar");
  assert.ok(withBar.queryByTestId("notification-trigger-rail") === null, "the Bell moved to the bar's right region");
  for (const id of ["left-rail-tab-chat", "left-rail-tab-activity", "left-rail-tab-tasks", "left-rail-help", "left-rail-settings"]) {
    assert.ok(withBar.queryByTestId(id) !== null, `${id} stays on the rail`);
  }
  // cindyz 2026-10-14: Help sits right above Settings at the rail's foot.
  const help = withBar.getByTestId("left-rail-help");
  const settings = withBar.getByTestId("left-rail-settings");
  assert.ok((help.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0, "Help comes before Settings");
  withBar.unmount();

  const withoutBar = renderRail(false);
  assert.ok(withoutBar.queryByTestId("left-rail-tab-search") !== null, "without the bar the rail keeps Search");
  assert.ok(withoutBar.queryByTestId("notification-trigger-rail") !== null, "without the bar the rail keeps the Bell");
  assert.ok(withoutBar.queryByTestId("left-rail-help") !== null, "without the bar the rail keeps Help");
  assert.ok(withoutBar.container.querySelector('button[aria-label*="Botiverse"]') !== null, "without the bar the rail keeps the switcher");
});

test("the bar's right region carries the Bell the rail gave up, and no Help", () => {
  seedServers();
  const { getByTestId } = render(
    <MemoryRouter initialEntries={["/s/botiverse/channel/general"]}>
      <TestIntlProvider>
        <AppTopBar trailing={<TopBarGlobalActions />} />
      </TestIntlProvider>
    </MemoryRouter>,
  );
  const bar = getByTestId("app-top-bar");
  assert.ok(bar.contains(getByTestId("notification-trigger-top-bar")), "Bell is in the bar");
  assert.equal(bar.querySelectorAll("[data-testid=top-bar-help]").length, 0, "Help stays on the rail");
});

test("the bar is the frame: on-frame ink over the frame colour, a white search field, who is working beside the Bell", () => {
  seedServers();
  useLiveAgentActivityStore.setState({
    items: [{
      id: "activity-a1",
      kind: "activity",
      agentId: "a1",
      agentName: "Wug",
      agentAvatarUrl: null,
      text: "Drafting launch notes",
      context: null,
      activity: "working",
      createdAt: Date.now(),
    }],
  });
  try {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={["/s/botiverse/channel/general"]}>
        <TestIntlProvider>
          <AppTopBar trailing={<TopBarGlobalActions />} />
        </TestIntlProvider>
      </MemoryRouter>,
    );
    const bar = getByTestId("app-top-bar");
    // Raft Design System: the bar extends the yellow frame the rail sits in.
    assert.match(bar.className, /\bbg-layer-frame\b/);
    assert.match(bar.className, /\btext-foreground-on-frame\b/);
    // With the bar, the sidebar drops its head, so the working summary moves here.
    const summary = getByTestId("working-now-summary");
    assert.ok(bar.contains(summary), "who is working sits in the bar");
    assert.ok(
      summary.compareDocumentPosition(getByTestId("notification-trigger-top-bar")) & Node.DOCUMENT_POSITION_FOLLOWING,
      "the summary comes before the Bell",
    );
    assert.match(getByTestId("notification-trigger-top-bar").className, /text-foreground-on-frame/, "the Bell is a frame item");
  } finally {
    useLiveAgentActivityStore.setState({ items: [] });
  }
});

// A host shell (the desktop app) takes part in the bar through
// TopBarHostContext instead of drawing a bar of its own.
function renderShellBar(host: TopBarHost | null) {
  return render(
    <MemoryRouter initialEntries={["/s/botiverse/channel/general"]}>
      <TestIntlProvider>
        <TopBarHostContext value={host}>
          <ShellTopBar />
        </TopBarHostContext>
      </TestIntlProvider>
    </MemoryRouter>,
  );
}

test("without a host the shell's bar is the plain web bar: the Bell, no title-bar marker", () => {
  seedServers();
  const { getByTestId } = renderShellBar(null);
  const bar = getByTestId("app-top-bar");
  assert.equal(bar.hasAttribute("data-raft-titlebar"), false);
  assert.ok(bar.contains(getByTestId("notification-trigger-top-bar")));
  assert.equal(bar.querySelector("[data-topbar-leading-end]")?.childElementCount, 0, "nothing next to the search field");
});

test("a host's history controls, update pill and title-bar flag land in the web bar, next to the web's own actions", () => {
  seedServers();
  const { getByTestId } = renderShellBar({
    leadingEnd: <span data-testid="host-history" />,
    trailingStart: <span data-testid="host-update-pill" />,
    titleBar: true,
    workspaceShortcutModifier: "⌘",
  });
  const bar = getByTestId("app-top-bar");
  assert.equal(bar.hasAttribute("data-raft-titlebar"), true, "the shell's drag-region and inset rules key off this");
  assert.ok(getByTestId("host-history").closest("[data-topbar-leading-end]") !== null, "history controls sit beside the search field");
  const pill = getByTestId("host-update-pill");
  const bell = getByTestId("notification-trigger-top-bar");
  assert.ok(bar.contains(pill) && bar.contains(bell), "the host adds to the web's actions, it does not replace them");
  assert.ok((pill.compareDocumentPosition(bell) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0, "update pill comes before the Bell");
  assert.ok(pill.closest("[data-topbar-leading-end]") === null, "the pill is in the right region, not beside the search field");
});

test("the shell mounts the bar for a host at any width, and never doubles a shell that draws its own", () => {
  const web = { hosted: false, hostShell: false, electronShell: false };
  assert.equal(shouldShowTopBar({ ...web, desktopWidth: true }), true, "web, desktop width");
  assert.equal(shouldShowTopBar({ ...web, desktopWidth: false }), false, "web, phone width");
  assert.equal(shouldShowTopBar({ ...web, desktopWidth: true, electronShell: true }), false, "a desktop build without the host context keeps its own title bar");
  assert.equal(shouldShowTopBar({ ...web, desktopWidth: true, hostShell: true }), false, "the host-shell embed owns its chrome");
  assert.equal(shouldShowTopBar({ hosted: true, desktopWidth: true, hostShell: false, electronShell: true }), true, "a desktop build with the host context uses the web bar");
  assert.equal(shouldShowTopBar({ hosted: true, desktopWidth: false, hostShell: false, electronShell: true }), true, "the title bar and drag region survive a narrow window");
});

test("a host is told when the bar mounts and unmounts, so it can stand in a title bar of its own elsewhere", () => {
  seedServers();
  const calls: boolean[] = [];
  const view = renderShellBar({ titleBar: true, onBarMounted: (mounted) => calls.push(mounted) });
  assert.deepEqual(calls, [true]);
  view.unmount();
  assert.deepEqual(calls, [true, false]);
});
