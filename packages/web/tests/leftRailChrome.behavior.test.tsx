import assert from "node:assert/strict";
import "./helpers/domSetup";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import api from "../src/api/client";
import { LeftRail } from "../src/components/layout/LeftRail";
import { TestIntlProvider } from "./helpers/intl";
import { ThemeProvider } from "@botiverse/raft-ui";
import { useServerStore } from "../src/store/serverStore";

// Teeth for task #750/#751 (artin's rail chrome reports, #proj-uiux 2026-08-02):
//   #750 — the server-switcher attention dot painted UNDER the avatar image:
//          AvatarImageWithFallback gives its img `relative z-[1]`; a z-auto
//          positioned dot always loses to an explicit stack level regardless
//          of DOM order. The dot must carry an explicit level above it.
//   #751 — the rail's bottom Settings button sat flush to the edge; the rail
//          column now keeps bottom padding.
// Both teeth pin the exact stacking/spacing relationships at DOM level (RED
// if the marker classes are removed); the pixel-level proof is the browser
// verification attached to the PR.

// raft-ui's ThemeProvider reads the system colour-scheme through
// matchMedia, which jsdom does not implement. Same stub shape the other
// provider-backed suites use (see aboutFeedback.behavior.test.tsx).
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
const originalMatchMedia =
  typeof window.matchMedia === "function" ? window.matchMedia : matchMediaStub(false);
window.matchMedia = originalMatchMedia;

const originalApiGet = api.get;
const originalServerState = useServerStore.getState();

afterEach(() => {
  cleanup();
  api.get = originalApiGet;
  window.matchMedia = originalMatchMedia;
  useServerStore.setState(originalServerState, true);
});

function seedServers() {
  useServerStore.setState({
    ...originalServerState,
    current: {
      id: "server-1",
      name: "Botiverse",
      slug: "botiverse",
      avatarUrl: "https://cdn.example.com/botiverse-avatar.png",
    } as never,
    servers: [
      { id: "server-1", name: "Botiverse", slug: "botiverse" },
      { id: "server-2", name: "Other", slug: "other" },
    ] as never,
  });
  api.get = ((url: string) => {
    if (url === "/servers/unread-summary") {
      return Promise.resolve({
        data: [{ serverId: "server-2", unreadCount: 3, serverPushMuted: false, activityUnreadCount: 3 }],
      });
    }
    return new Promise(() => {});
  }) as typeof api.get;
}

function renderRail() {
  return render(
    <MemoryRouter initialEntries={["/s/botiverse/channel/general"]}>
      <TestIntlProvider>
        <LeftRail />
      </TestIntlProvider>
    </MemoryRouter>,
  );
}

test("#750: the server-switcher attention dot outranks the avatar image's explicit z-[1]", async () => {
  seedServers();
  const { container } = renderRail();
  // Simulate App's single boot-entry fetch (LeftRail itself no longer fetches
  // on mount) so the summary lands and the dot appears.
  void useServerStore.getState().loadServerUnreadSummary();
  const switcher = container.querySelector<HTMLButtonElement>('button[aria-label*="Botiverse"]');
  assert.ok(switcher, "server switcher button renders");

  const avatar = switcher.querySelector<HTMLImageElement>('img[src="https://cdn.example.com/botiverse-avatar.png"]');
  assert.ok(avatar, "avatar image renders");
  assert.match(avatar.className, /z-\[1\]/, "the avatar image keeps its explicit stack level (the element the dot must beat)");

  await waitFor(() => {
    const found = switcher.querySelector<HTMLSpanElement>('[data-slot="app-rail-item-indicator"]');
    assert.ok(found, "attention dot appears once the unread summary lands");
    return found;
  });
  assert.match(
    switcher.querySelector('[data-slot="app-rail-item-indicator"]')?.parentElement?.className ?? "",
    /\[&_\[data-slot=app-rail-item-indicator\]\]:z-\[2\]/,
    "the indicator's parent must establish an explicit level ABOVE z-[1] — a z-auto positioned element paints under the image regardless of DOM order",
  );
});

test("#751: the rail column keeps bottom padding so the Settings button is not flush to the edge", () => {
  seedServers();
  const { container } = renderRail();
  const rail = container.querySelector<HTMLDivElement>('[data-testid="workspace-left-rail"]');
  assert.ok(rail, "left rail renders");
  // raft-ui's rail footer (notifications, help, settings) owns the bottom
  // inset, so the root no longer adds one of its own.
  const footer = rail.querySelector<HTMLElement>('[data-slot="app-rail-footer"]');
  assert.ok(footer, "rail footer renders");
  assert.match(footer.className, /(?:^|\s)pb-\d/, "rail footer keeps bottom padding for the trailing Settings button");
});

// Teeth for cindyz's public-server-page pass (#proj-frontend, "public server的页面
// 几乎没有做elegant mode适配"). The public branch of LeftRail used to hand-roll
// its rail from brutal-only utilities, so it rendered one identical yellow
// strip (64px, 2px black border) whatever the theme. It now runs raft-ui's
// AppRail* slots like the signed-in rail, on semantic layers, so light and dark
// differ only through tokens. jsdom has no CSS cascade, so the tooth is the
// className itself. Pixel proof is on the PR.

function renderPublicRail(mode: "light" | "dark" = "light") {
  return render(
    <MemoryRouter initialEntries={["/s/open-team"]}>
      <TestIntlProvider>
        {/* syncDom=false: an isolated island must not mutate the app root. */}
        <ThemeProvider mode={mode} syncDom={false}>
          <LeftRail
            side="left"
            publicProjection={{
              server: { id: "s1", name: "Open Team", slug: "open-team", avatarUrl: null },
              authenticated: false,
              showHelp: true,
              activeMode: "chat",
              onSelectMode: () => {},
              onSelectSettingsTab: () => {},
              onAnonymousServerSelection: () => {},
            }}
          />
        </ThemeProvider>
      </TestIntlProvider>
    </MemoryRouter>,
  );
}

function publicRail(mode: "light" | "dark" = "light") {
  const { container } = renderPublicRail(mode);
  const rail = container.querySelector<HTMLDivElement>('[data-public-server-rail="true"]');
  assert.ok(rail, `public rail renders in ${mode} mode`);
  return rail;
}

test("the public rail takes raft-ui's AppRail chrome instead of one hardcoded brutal strip", () => {
  seedServers();
  const light = publicRail("light").className;
  cleanup();
  const dark = publicRail("dark").className;

  assert.equal(light, dark, "one recipe in both modes: the semantic layers carry the light/dark difference");
  assert.match(light, /(?:^|\s)bg-layer-frame(?:\s|$)/, "the rail sits on the frame layer, like the signed-in rail");
  assert.match(light, /(?:^|\s)border-line-seam(?:\s|$)/, "the rail edge is the DS seam");
  assert.doesNotMatch(light, /border-black/, "no hard black rail border — the old hand-built strip");
  assert.doesNotMatch(light, /bg-palette-yellow|(?:^|\s)bg-brand(?:\s|$)/, "no hardcoded brand yellow fill");
  assert.doesNotMatch(light, /(?:^|\s)w-16(?:\s|$)/, "the rail width comes from the shell, not a fixed 64px");
});

test("the public rail is composed from rui AppRail* slots", () => {
  seedServers();
  const rail = publicRail();
  assert.deepEqual(
    [...rail.children].map((child) => child.getAttribute("data-slot")),
    ["app-rail-header", "app-rail-nav", "app-rail-footer"],
    "header/nav/footer must be the rui slots — the bespoke divs are where the brutal-only chrome lived",
  );
});

test("the public rail header takes its height from the shell, not from an override of its own", () => {
  seedServers();
  const { container } = renderPublicRail();
  const header = container.querySelector<HTMLDivElement>('[data-slot="app-rail-header"]');
  assert.ok(header, "public rail header renders");
  // The public page now mounts the rui AppShellRoot, which sets
  // --shell-header-height for every header row at once. A height pinned here
  // would let the rail drift from the other columns again.
  assert.doesNotMatch(
    header.className,
    /h-panel-header/,
    "the rail header must not carry the pre-shell height pin",
  );
});

test("the public rail's logo and tabs render through AppRailItem", () => {
  seedServers();
  const { container } = renderPublicRail();
  for (const testId of ["public-server-switcher-trigger", "left-rail-tab-chat", "left-rail-settings"]) {
    const button = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
    assert.ok(button, `${testId} renders`);
    assert.ok(
      button.querySelector('[data-slot="app-rail-item-icon"]'),
      `${testId} must render through AppRailItem so its hover/selected states follow the theme`,
    );
  }
});

test("the public rail's server avatar is the standard rail item", () => {
  seedServers();
  const { container } = renderPublicRail();
  const trigger = container.querySelector<HTMLButtonElement>('[data-testid="public-server-switcher-trigger"]');
  assert.ok(trigger, "server avatar renders");
  assert.ok(
    trigger.querySelector('[data-slot="app-rail-item-icon"]') !== null,
    "the avatar renders through AppRailItem, like the signed-in rail",
  );
  assert.doesNotMatch(trigger.className, /\bbg-black\b/, "the public-only black block is gone");
});
