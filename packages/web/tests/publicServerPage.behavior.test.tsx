import "./helpers/domSetup";

import assert from "node:assert/strict";
import type { ReactElement } from "react";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import api from "../src/api/client";
import { AppShell } from "../src/App";
import PublicServerPage from "../src/pages/PublicServerPage";
import { useAuthStore } from "../src/store/authStore";
import { useServerStore } from "../src/store/serverStore";
import { useTranslationStore } from "../src/store/translationStore";
import { renderWithIntl, TestIntlProvider } from "./helpers/intl";
import { render } from "@testing-library/react";
import { recordPublicVisit, setLandingPageForTest, setPublicVisitFetchForTest } from "../src/analytics/publicVisits";
import {
  publicVisitorId,
  readPublicVisitorConsent,
  resetPublicVisitorConsentForTest,
  setPublicVisitorConsent,
} from "../src/analytics/publicVisitorConsent";

const intersectionObservers: TestIntersectionObserver[] = [];
class TestIntersectionObserver {
  readonly root: Element | Document | null;
  readonly rootMargin = "0px";
  readonly thresholds = [0];
  readonly targets = new Set<Element>();
  constructor(private readonly callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.root = options?.root ?? null;
    intersectionObservers.push(this);
  }
  observe(target: Element) { this.targets.add(target); }
  unobserve(target: Element) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); }
  takeRecords() { return []; }
  trigger(target: Element) {
    this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}
globalThis.IntersectionObserver = TestIntersectionObserver as unknown as typeof IntersectionObserver;
globalThis.ResizeObserver = globalThis.ResizeObserver ?? class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as typeof ResizeObserver;

const originalGet = api.get;
const originalPost = api.post;
const renderPublicPage = (page: ReactElement) => renderWithIntl(<MemoryRouter>{page}</MemoryRouter>);
const signedInVisitor = {
  id: "visitor-1",
  email: "visitor@example.test",
  gravatarHash: "",
  name: "visitor",
  displayName: "Visitor",
  description: null,
  avatarUrl: null,
  emailVerified: true,
  profileSetupCompletedAt: "2026-09-10T00:00:00.000Z",
  signupSurveyCompletedAt: "2026-09-10T00:00:00.000Z",
  preferredLanguage: null,
  displayLanguage: "en",
  preferredTimezone: null,
  autoTranslationEnabled: false,
  preferredTranslationMode: "off",
  preferredTranslationDisplay: "translated",
  preferredTimeFormat: null,
  preferredMessageBodyFontSize: null,
  referralSource: null,
  referralSourceOther: null,
  referralSourceSkippedAt: null,
};

afterEach(() => {
  cleanup();
  api.get = originalGet;
  api.post = originalPost;
  useAuthStore.setState(useAuthStore.getInitialState(), true);
  useServerStore.setState(useServerStore.getInitialState(), true);
  useTranslationStore.setState(useTranslationStore.getInitialState(), true);
  intersectionObservers.length = 0;
  resetPublicVisitorConsentForTest();
});

test("a signed-in nonmember stays on the public DTO and joins only after explicit Guest confirmation", async () => {
  const reads: string[] = [];
  api.get = (async (url: string) => {
    reads.push(url);
    if (url === "/public/servers/open-team") return { data: {
      server: { id: "server-1", name: "Open Team", slug: "open-team", avatarUrl: null, translationEnabled: true },
      channels: [],
      canJoinAsGuest: true,
    } };
    throw new Error(`unexpected read ${url}`);
  }) as typeof api.get;
  const writes: Array<{ url: string; body: unknown }> = [];
  api.post = (async (url: string, body: unknown) => {
    writes.push({ url, body });
    return { data: { serverId: "server-1", role: "guest", joined: true } };
  }) as typeof api.post;
  let joined = 0;
  useAuthStore.setState({ user: signedInVisitor });

  renderPublicPage(
    <PublicServerPage
      slug="open-team"
      authenticated
      onSignIn={() => assert.fail("signed-in page must not offer sign-in")}
      onRegister={() => assert.fail("signed-in page must not offer registration")}
      onUnavailable={() => assert.fail("public server must be available")}
      onJoined={() => { joined += 1; }}
    />,
  );

  assert.ok(await screen.findByTestId("public-server-page"));
  assert.match(screen.getByTestId("public-server-bottom-action").textContent ?? "", /Join Open Team as a Guest to be part of the discussion/);
  assert.match(screen.getByTestId("public-server-bottom-action-copy").className, /(?:^|\s)text-callout(?:\s|$)/);
  assert.equal(writes.length, 0, "rendering with a session must not create membership");
  assert.ok(screen.queryByRole("button", { name: "Sign in" }) === null);
  assert.ok(screen.getByRole("button", { name: "Help" }), "an authenticated nonmember keeps the Help rail entry");
  fireEvent.click(screen.getByRole("button", { name: "Help" }));
  assert.ok(screen.getByTestId("left-rail-help-menu"), "authenticated public mode reuses the standard Help & Resources popover");
  assert.ok(screen.queryByTestId("public-server-help-surface") === null, "Help must not replace the server surface with a full page");
  fireEvent.click(screen.getByRole("button", { name: "Help" }));
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  assert.ok(screen.getByTestId("settings-sidebar-list"), "public settings must reuse the AppShell settings sidebar list");
  assert.ok(screen.getByTestId("workspace-settings-nav-account"));
  assert.ok(screen.getByTestId("workspace-settings-nav-language-region"));
  assert.ok(screen.getByTestId("workspace-settings-nav-appearance"));
  assert.ok(screen.queryByTestId("workspace-settings-nav-notifications") === null);
  assert.ok(screen.getByTestId("workspace-settings-nav-about"));
  assert.ok(screen.getByTestId("workspace-settings-nav-documentation"));
  assert.ok(screen.getByTestId("workspace-settings-nav-feedback"));
  assert.ok(screen.getByTestId("workspace-settings-nav-release-notes"));
  fireEvent.click(screen.getByRole("button", { name: "Chat" }));

  fireEvent.click(screen.getByRole("button", { name: "Join as Guest" }));
  assert.equal(writes.length, 0, "opening confirmation must not create membership");
  const dialog = screen.getByRole("dialog");
  assert.match(dialog.textContent ?? "", /keep reading without joining/);
  fireEvent.click(within(dialog).getByRole("button", { name: "Join as Guest" }));
  await waitFor(() => assert.equal(writes.length, 1));
  assert.deepEqual(writes, [{
    url: "/public/servers/open-team/join-as-guest",
    body: { agreementId: null },
  }]);
  assert.deepEqual(
    reads,
    ["/public/servers/open-team", "/product-feedback/tickets", "/auth/providers", "/auth/identities"],
    "an authenticated nonmember may load personal Account settings but must never start server-member data requests",
  );
  assert.equal(joined, 1);
});

test("a failed local transition after durable join does not claim the join failed or resubmit it", async () => {
  api.get = (async () => ({ data: {
    server: { id: "server-1", name: "Open Team", slug: "open-team", avatarUrl: null },
    channels: [],
    canJoinAsGuest: true,
  } })) as typeof api.get;
  let writes = 0;
  api.post = (async () => {
    writes += 1;
    return { data: { serverId: "server-1", role: "guest", joined: true } };
  }) as typeof api.post;

  renderPublicPage(
    <PublicServerPage
      slug="open-team"
      authenticated
      onSignIn={() => {}}
      onRegister={() => {}}
      onUnavailable={() => {}}
      onJoined={() => { throw new Error("server-list refresh failed"); }}
    />,
  );

  assert.ok(await screen.findByTestId("public-server-page"));
  fireEvent.click(screen.getByRole("button", { name: "Join as Guest" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Join as Guest" }));
  assert.ok(await screen.findByText("You joined this server. Refresh the page to open it."));
  assert.ok(screen.queryByText("Failed to join this public server") === null);
  assert.equal(writes, 1, "a committed join must not be retried because navigation failed");
});

test("a signed-in nonmember sees no Join action when the owner left public admission off", async () => {
  api.get = (async () => ({ data: {
    server: { id: "server-1", name: "Open Team", slug: "open-team", avatarUrl: null },
    channels: [],
    canJoinAsGuest: false,
  } })) as typeof api.get;
  api.post = (async () => assert.fail("hidden join action must not write")) as typeof api.post;
  renderPublicPage(
    <PublicServerPage
      slug="open-team"
      authenticated
      onSignIn={() => {}}
      onRegister={() => {}}
      onUnavailable={() => {}}
    />,
  );
  assert.ok(await screen.findByTestId("public-server-page"));
  assert.ok(screen.queryByRole("button", { name: "Join as Guest" }) === null);
});

test("logged-out public page shows only the read surface and its sign-in banner", async () => {
  const reads: string[] = [];
  api.get = (async (url: string) => {
    reads.push(url);
    if (url === "/public/servers/open-team") {
      return {
        data: {
          server: { id: "server-1", name: "Open Team", slug: "open-team", avatarUrl: null },
          channels: [
            { id: "channel-1", name: "announcements", description: "What is happening" },
            { id: "channel-2", name: "questions", description: null },
          ],
          canJoinAsGuest: true,
        },
      };
    }
    if (url.endsWith("/channel-1/messages")) {
      return { data: { messages: [{
        id: "message-1",
        senderType: "user",
        sender: { displayName: "Cindy", avatarUrl: null, description: "Designer" },
        messageType: "chat",
        content: "Welcome, everyone",
        createdAt: "2026-09-08T08:00:00.000Z",
      }] } };
    }
    if (url.endsWith("/channel-2/messages")) return { data: { messages: [] } };
    throw new Error(`unexpected read ${url}`);
  }) as typeof api.get;
  let signIns = 0;
  let registrations = 0;

  renderPublicPage(
    <PublicServerPage
      slug="open-team"
      onSignIn={() => { signIns += 1; }}
      onRegister={() => { registrations += 1; }}
      onUnavailable={() => assert.fail("public server must be available")}
    />,
  );

  assert.ok(await screen.findByTestId("public-server-page"));
  await screen.findByText("Welcome, everyone");
  const bottomAction = screen.getByTestId("public-server-bottom-action");
  // task #116: the banner is not the chat column's last child, where it was
  // squeezed into the middle column. task #123 (Cindy): it is the last ROW of
  // the columns grid, starting at the channel column's right edge, so it spans
  // chat + thread and no longer runs under the channel list. jsdom has no
  // layout; where the row starts and ends is measured in a real browser
  // (e2e public-server-parity). Identity is
  // compared in the boolean form on purpose: `assert.equal(el, other)` hands a
  // live DOM node to node:assert and its failure kills the worker with no
  // message (task #627) — which is exactly what this assertion did when the
  // structure changed under it.
  assert.ok(
    screen.getByTestId("public-server-columns").lastElementChild === bottomAction,
    "the read-only action must be the final row of the columns grid",
  );
  assert.ok(
    !screen.getByTestId("public-server-channel-sidebar-root").contains(bottomAction),
    "the read-only action must not live inside the channel list column",
  );
  assert.ok(
    !screen.getByTestId("public-server-channel-panel").contains(bottomAction),
    "the read-only action must no longer live inside the chat column",
  );
  assert.ok(
    screen.getByTestId("public-server-columns").contains(screen.getByTestId("public-server-channel-panel")),
    "the columns row must still hold the chat column",
  );
  assert.ok(bottomAction.classList.contains("w-full"));
  assert.ok(bottomAction.classList.contains("!items-center"));
  assert.ok(bottomAction.classList.contains("!px-5"));
  assert.match(screen.getByTestId("public-server-bottom-action-copy").className, /(?:^|\s)text-callout(?:\s|$)/);
  assert.ok(screen.getByTestId("public-server-app-shell"));
  assert.ok(screen.getByTestId("workspace-left-rail"));
  // Same rui shell as the signed-in layout: the root is what gives every header
  // row its per-theme height, so each column has to sit in a shell slot under it.
  const shellRoot = screen.getByTestId("public-server-page");
  assert.equal(shellRoot.getAttribute("data-slot"), "app-shell-root", "the page root is the rui shell root");
  assert.ok(
    screen.getByTestId("workspace-left-rail").closest('[data-slot="app-shell-rail-slot"]'),
    "the rail sits in the shell's rail slot",
  );
  const channelSidebar = screen.getByTestId("public-server-channel-sidebar");
  assert.equal(channelSidebar.getAttribute("data-slot"), "app-shell-sidebar-slot", "the channel column is the shell's sidebar slot");
  assert.equal(channelSidebar.tagName, "NAV", "the channel column stays a navigation landmark");
  assert.ok(channelSidebar.classList.contains("flex"), "the channel column stays visible on phones, where the slot hides by default");
  assert.equal(
    screen.getByTestId("public-server-channel-panel").getAttribute("data-slot"),
    "app-shell-main-slot",
    "the message column is the shell's main slot",
  );
  fireEvent.click(screen.getByTestId("public-server-switcher-trigger"));
  const notice = screen.getByTestId("public-server-selection-notice");
  assert.ok(notice.matches('[data-slot="banner"]'), "anonymous server selection notice rides the info banner primitive");
  assert.ok(!notice.classList.contains("!bg-palette-yellow"), "removed opaque override must not return");
  assert.ok(screen.getByTestId("public-server-channel-sidebar"));
  assert.ok(screen.getByTestId("public-server-channel-header"));
  assert.ok(screen.getByTestId("public-server-message-timeline"));
  assert.ok(screen.queryByRole("button", { name: "Help" }) === null, "anonymous public mode must not render Help");
  assert.ok(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  assert.ok(screen.getByTestId("settings-sidebar-list"), "public settings must reuse the AppShell settings sidebar list");
  // task #116: the banner tells a visitor they are read-only, which is just as
  // true on settings — where it did not render at all before. It comes for free
  // from living outside the chat/settings fork, but "for free" is exactly the
  // kind of thing that silently stops being true, so assert it.
  assert.ok(
    screen.queryByTestId("public-server-bottom-action") !== null,
    "the visitor banner must render on the settings surface too",
  );
  assert.ok(
    screen.getByTestId("public-server-columns").lastElementChild
      === screen.getByTestId("public-server-bottom-action"),
    "on settings it must still be the final row of the columns grid",
  );
  assert.ok(screen.getByTestId("workspace-settings-nav-about"));
  assert.ok(screen.getByTestId("workspace-settings-nav-documentation"));
  assert.ok(screen.getByTestId("workspace-settings-nav-appearance"), "anonymous settings always expose Appearance");
  assert.ok(screen.queryByTestId("workspace-settings-nav-account") === null);
  assert.ok(screen.getByText("Personal"), "Appearance keeps the anonymous Personal group non-empty");
  assert.ok(screen.queryByText("Workspace") === null, "anonymous settings must not render an empty Workspace group");
  assert.ok(screen.queryByTestId("settings-about-workspace") === null, "anonymous About must not render member workspace details");
  assert.ok(screen.getByRole("link", { name: "Documentation" }));
  fireEvent.click(screen.getByTestId("workspace-settings-nav-appearance"));
  assert.ok(screen.getByText("Theme"));
  assert.ok(screen.queryByText("Message font size") === null, "anonymous Appearance is theme-only");
  fireEvent.click(screen.getByRole("button", { name: "Chat" }));
  assert.match(screen.getByTestId("public-server-page").textContent ?? "", /Sign in to join Open Team and be part of the discussion/);
  assert.ok(screen.queryByRole("textbox") === null, "read-only page must not render a composer");

  // The channel column is built from the same rui Sidebar parts as the
  // signed-in Sidebar: one SidebarRoot, one SidebarItem per channel, and the
  // open channel marked through the item's own `data-active`.
  const channelColumn = screen.getByTestId("public-server-channel-sidebar");
  assert.ok(channelColumn.querySelector('[data-slot="sidebar-root"]'), "the channel column renders a rui SidebarRoot");
  const channelRows = [...channelColumn.querySelectorAll<HTMLElement>("[data-public-channel-id]")];
  assert.ok(channelRows.length >= 2, "every public channel gets a row");
  for (const row of channelRows) {
    assert.equal(row.getAttribute("data-slot"), "sidebar-item", "channel rows are rui SidebarItems");
  }
  const activeRowIds = () => channelRows.filter((row) => row.hasAttribute("data-active")).map((row) => row.getAttribute("data-public-channel-id"));
  assert.deepEqual(activeRowIds(), [channelRows[0]!.getAttribute("data-public-channel-id")], "only the open channel is marked active");

  fireEvent.click(screen.getByRole("button", { name: /questions/ }));
  await waitFor(() => assert.ok(reads.includes("/public/servers/open-team/channels/channel-2/messages")));
  assert.deepEqual(activeRowIds(), ["channel-2"], "selecting a channel moves the active mark to its row");
  const emptyMessages = await screen.findByText("No messages have been posted here yet.");
  assert.ok(
    emptyMessages.closest('[data-slot="empty-state"]'),
    "an empty public channel uses the shared EmptyState, like the signed-in chat panel",
  );

  const currentBottomAction = screen.getByTestId("public-server-bottom-action");
  fireEvent.click(within(currentBottomAction).getByRole("button", { name: "Sign in" }));
  fireEvent.click(within(currentBottomAction).getByRole("button", { name: "Create account" }));
  assert.equal(signIns, 1);
  assert.equal(registrations, 1);
  // About's desktop download section asks which platforms the Latest
  // desktop-beta release offers. That route is public by design (the /download
  // page is anonymous) and carries no member data, so it is not a leak.
  const PUBLIC_NON_SERVER_READS = new Set(["/desktop-download/platforms"]);
  assert.deepEqual(
    reads.filter((path) => !PUBLIC_NON_SERVER_READS.has(path)),
    [
      "/public/servers/open-team",
      "/public/servers/open-team/channels/channel-1/messages",
      "/public/servers/open-team/channels/channel-2/messages",
    ],
    "an anonymous visitor must use only the public read API and never start member-data requests",
  );
});

test("a logged-out view-only server invites account creation without implying it can be joined", async () => {
  api.get = (async (url: string) => {
    if (url === "/public/servers/archive") return { data: {
      server: { id: "server-2", name: "Archive", slug: "archive", avatarUrl: null },
      channels: [],
      canJoinAsGuest: false,
    } };
    throw new Error(`unexpected read ${url}`);
  }) as typeof api.get;
  let signIns = 0;
  let registrations = 0;

  renderPublicPage(<PublicServerPage
    slug="archive"
    onSignIn={() => { signIns += 1; }}
    onRegister={() => { registrations += 1; }}
    onUnavailable={() => assert.fail("view-only server must remain readable")}
  />);

  const banner = await screen.findByTestId("public-server-bottom-action");
  assert.match(banner.textContent ?? "", /Archive is view only. Create a Raft account to build a server of your own/);
  assert.ok(within(banner).queryByRole("button", { name: "Join as Guest" }) === null);
  fireEvent.click(within(banner).getByRole("button", { name: "Create account" }));
  fireEvent.click(within(banner).getByRole("button", { name: "Sign in" }));
  assert.equal(registrations, 1);
  assert.equal(signIns, 1);
});

test("a signed-in view-only server explains the write boundary without offering an action", async () => {
  api.get = (async (url: string) => {
    if (url === "/public/servers/archive") return { data: {
      server: { id: "server-2", name: "Archive", slug: "archive", avatarUrl: null },
      channels: [],
      canJoinAsGuest: false,
    } };
    throw new Error(`unexpected read ${url}`);
  }) as typeof api.get;

  renderPublicPage(<PublicServerPage
    slug="archive"
    authenticated
    onSignIn={() => assert.fail("signed-in visitor must not be offered sign-in")}
    onRegister={() => assert.fail("signed-in visitor must not be offered registration")}
    onUnavailable={() => assert.fail("view-only server must remain readable")}
  />);

  const banner = await screen.findByTestId("public-server-bottom-action");
  assert.match(banner.textContent ?? "", /Archive is view only. You can read its public channels, but can't send messages here/);
  assert.ok(within(banner).queryByRole("button") === null, "signed-in view-only mode has no misleading action");
});

test("public read reuses canonical message/thread display, server avatar, and icon-text actions", async () => {
  api.get = (async (url: string) => {
    if (url === "/public/servers/open-team") return { data: {
      server: { id: "server-1", name: "Open Team", slug: "open-team", avatarUrl: "https://cdn.example.test/open-team.png" },
      channels: [{ id: "channel-1", name: "announcements", description: null }],
      canJoinAsGuest: false,
    } };
    if (url.endsWith("/channels/channel-1/messages")) return { data: { messages: [{
      id: "parent-1",
      senderType: "user",
      sender: { displayName: "Cindy", handle: "cindyz", avatarUrl: "/api/avatars/users/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp", description: "Designer" },
      messageType: "chat",
      content: "> quoted line\n\n**bold line**",
      createdAt: "2026-09-08T08:00:00.000Z",
      threadId: "thread-1",
      replyCount: 1,
    }] } };
    if (url.includes("/threads/thread-1/messages?")) return { data: { messages: [{
      id: "reply-1",
      senderType: "agent",
      sender: { displayName: "Helper", avatarUrl: null, description: "Agent helper" },
      messageType: "chat",
      content: "- threaded item",
      createdAt: "2026-09-08T08:01:00.000Z",
      threadId: null,
      replyCount: 0,
    }] } };
    throw new Error(`unexpected read ${url}`);
  }) as typeof api.get;

  renderPublicPage(<PublicServerPage slug="open-team" onSignIn={() => {}} onRegister={() => {}} onUnavailable={() => {}} />);

  const page = await screen.findByTestId("public-server-page");
  assert.equal(page.querySelectorAll('img[src="https://cdn.example.test/open-team.png"]').length, 1, "server avatar is visible in the app rail without duplicating it beside the server name");
  assert.ok(await screen.findByText("quoted line"));
  assert.ok(screen.getByText("Designer"), "the public participant description is rendered by the canonical message row");
  assert.equal(page.querySelectorAll('img[src="/api/avatars/users/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp"]').length, 1);
  const publicSenderAvatar = page.querySelector<HTMLButtonElement>('button[data-avatar-kind="human"]');
  assert.ok(publicSenderAvatar, "public sender avatar remains the hover-card trigger");
  fireEvent.mouseEnter(publicSenderAvatar);
  assert.ok(await screen.findByText("@cindyz"), "the public hover card shows the sender handle");
  assert.ok(screen.queryByText("Profile unavailable") === null, "a public sender projection is a real public profile, not an unavailable one");
  assert.equal(screen.getByText("quoted line").closest("blockquote") !== null, true);
  assert.equal(screen.getByText("bold line").tagName, "STRONG");
  const signIn = screen.getByRole("button", { name: "Sign in" });
  // The button is RUI's now, so the icon-to-label spacing comes from RUI's own
  // recipe rather than from a shape class this app used to add.
  assert.equal(signIn.getAttribute("data-slot"), "button", "the sign-in action stays a RUI button");

  fireEvent.click(screen.getByTestId("message-thread-replies-badge"));
  assert.ok(await screen.findByTestId("public-server-thread-panel"));
  // task #116: on phones the thread panel is `absolute inset-0` and used to
  // cover the banner. It is now scoped to the columns row, which sits above the
  // banner rather than over it, so an open thread no longer hides the visitor
  // status line (Bernard's ruling; revisit if it proves visually intrusive).
  assert.ok(
    screen.getByTestId("public-server-columns").contains(screen.getByTestId("public-server-thread-panel")),
    "the thread panel must be scoped to the columns row",
  );
  assert.equal(
    screen.getByTestId("public-server-thread-panel").getAttribute("data-slot"),
    "app-shell-panel-slot",
    "the thread column is the shell's panel slot",
  );
  assert.ok(
    !screen.getByTestId("public-server-thread-panel").contains(screen.getByTestId("public-server-bottom-action")),
    "the thread panel must not contain the banner",
  );
  assert.ok(await screen.findByTestId("read-only-thread-panel"));
  assert.ok(await screen.findByText("threaded item"));
  assert.equal(screen.getByText("threaded item").closest("li") !== null, true);
  assert.ok(screen.queryByRole("textbox") === null, "public thread mode must not mount a composer");
  assert.ok(screen.queryByTestId("thread-overflow-menu") === null, "public thread mode must not mount write/follow actions");
});

test("a public message shows the same inline reply preview a member sees, and it opens the thread", async () => {
  // Cindy, #wg-rbac task #123: the public page showed a bare "N replies" chip
  // where a member sees the newest replies inline. The public DTO now carries
  // them (display name and avatar only, no sender id).
  api.get = (async (url: string) => {
    if (url === "/public/servers/open-team") return { data: {
      server: { id: "server-1", name: "Open Team", slug: "open-team", avatarUrl: null },
      channels: [{ id: "channel-1", name: "announcements", description: null }],
      canJoinAsGuest: false,
    } };
    if (url.endsWith("/channels/channel-1/messages")) return { data: { messages: [{
      id: "parent-1",
      senderType: "user",
      sender: { displayName: "Cindy", avatarUrl: null, description: null },
      messageType: "chat",
      content: "Parent message",
      createdAt: "2026-09-08T08:00:00.000Z",
      threadId: "thread-1",
      replyCount: 2,
      lastReplyAt: "2026-09-08T08:02:00.000Z",
      latestReplies: [
        { messageId: "reply-1", seq: 11, preview: "First reply preview", senderType: "agent", senderName: "Helper", senderAvatarUrl: null, createdAt: "2026-09-08T08:01:00.000Z" },
        { messageId: "reply-2", seq: 12, preview: "Second reply preview", senderType: "user", senderName: "Dana", senderAvatarUrl: null, createdAt: "2026-09-08T08:02:00.000Z" },
      ],
    }, {
      id: "plain-1",
      senderType: "user",
      sender: { displayName: "Cindy", avatarUrl: null, description: null },
      messageType: "chat",
      content: "Older-server shaped parent",
      createdAt: "2026-09-08T08:03:00.000Z",
      threadId: "thread-2",
      replyCount: 4,
    }] } };
    if (url.includes("/threads/thread-1/messages?")) return { data: { messages: [] } };
    throw new Error(`unexpected read ${url}`);
  }) as typeof api.get;

  renderPublicPage(<PublicServerPage slug="open-team" onSignIn={() => {}} onRegister={() => {}} onUnavailable={() => {}} />);

  await screen.findByText("Parent message");
  const inlinePreviews = () => [...document.querySelectorAll<HTMLElement>('[data-message-affordance="inline-thread-replies"]')];
  await waitFor(() => assert.equal(inlinePreviews().length, 1));
  const preview = inlinePreviews()[0]!;
  assert.match(preview.textContent ?? "", /Helper/);
  assert.match(preview.textContent ?? "", /First reply preview/);
  assert.match(preview.textContent ?? "", /Dana/);
  assert.match(preview.textContent ?? "", /Second reply preview/);
  // The preview replaces the count chip for that message; a response without
  // the new field (an older server) keeps the chip for its message.
  assert.equal(preview.querySelectorAll("[data-inline-thread-reply-row]").length, 2);
  assert.equal(screen.getAllByTestId("message-thread-replies-badge").length, 1);
  assert.match(screen.getByTestId("message-thread-replies-badge").textContent ?? "", /4/);

  fireEvent.click(preview);
  assert.ok(await screen.findByTestId("public-server-thread-panel"), "the inline preview opens the read-only thread");
});

test("a non-public slug falls back to the existing sign-in surface without exposing existence", async () => {
  api.get = (async () => {
    throw { response: { status: 404 } };
  }) as typeof api.get;
  let unavailable = 0;

  renderPublicPage(
    <PublicServerPage
      slug="not-public"
      onSignIn={() => {}}
      onRegister={() => {}}
      onUnavailable={() => { unavailable += 1; }}
    />,
  );

  await waitFor(() => assert.equal(unavailable, 1));
  assert.ok(screen.queryByText(/not public/i) === null);
});

test("AppShell routes a signed-out /s/:slug visit to the public page before login", async () => {
  useAuthStore.setState({
    user: null,
    accessToken: null,
    refreshToken: null,
    initialized: true,
    restoreState: "signed_out",
    loadUser: async () => {},
  } as never);
  useServerStore.setState({ loading: false, loadServers: async () => {} } as never);
  api.get = (async (url: string) => {
    if (url === "/public/servers/open-team") {
      return {
        data: {
          server: { id: "server-1", name: "Open Team", slug: "open-team", avatarUrl: null },
          channels: [],
        },
      };
    }
    throw new Error(`unexpected read ${url}`);
  }) as typeof api.get;

  render(
    <TestIntlProvider locale="en">
      <MemoryRouter initialEntries={["/s/open-team"]}>
        <AppShell />
      </MemoryRouter>
    </TestIntlProvider>,
  );

  assert.ok(await screen.findByTestId("public-server-page"));
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => assert.ok(screen.queryByTestId("public-server-page") === null));
  assert.ok(screen.getByRole("heading", { name: "Sign In" }));

  act(() => {
    useAuthStore.setState({
      user: signedInVisitor,
      accessToken: "token",
      refreshToken: "refresh",
      initialized: true,
      restoreState: "authenticated",
    } as never);
  });
  assert.ok(await screen.findByTestId("public-server-page"));
  assert.match(screen.getByTestId("public-server-bottom-action").textContent ?? "", /Open Team is view only. You can read its public channels, but can't send messages here/);
});

test("AppShell opens a signed-out /s/:slug/channel/:id link on the public page with that channel selected", async () => {
  useAuthStore.setState({
    user: null,
    accessToken: null,
    refreshToken: null,
    initialized: true,
    restoreState: "signed_out",
    loadUser: async () => {},
  } as never);
  useServerStore.setState({ loading: false, loadServers: async () => {} } as never);
  const reads: string[] = [];
  api.get = (async (url: string) => {
    reads.push(url);
    if (url === "/public/servers/open-team") {
      return {
        data: {
          server: { id: "server-1", name: "Open Team", slug: "open-team", avatarUrl: null },
          channels: [
            { id: "channel-general", name: "general", description: null },
            { id: "channel-help", name: "help", description: null },
          ],
          canJoinAsGuest: false,
        },
      };
    }
    if (url.startsWith("/public/servers/open-team/channels/")) return { data: { messages: [] } };
    throw new Error(`unexpected read ${url}`);
  }) as typeof api.get;

  render(
    <TestIntlProvider locale="en">
      <MemoryRouter initialEntries={["/s/open-team/channel/channel-help"]}>
        <AppShell />
      </MemoryRouter>
    </TestIntlProvider>,
  );

  assert.ok(await screen.findByTestId("public-server-page"));
  assert.ok(screen.queryByRole("heading", { name: "Sign In" }) === null);
  await waitFor(() => assert.ok(reads.includes("/public/servers/open-team/channels/channel-help/messages")));
  assert.ok(!reads.includes("/public/servers/open-team/channels/channel-general/messages"));
});

test("AppShell routes a signed-in nonmember /s/:slug visit to the same public read surface", async () => {
  useAuthStore.setState({
    user: signedInVisitor,
    accessToken: "token",
    refreshToken: "refresh",
    initialized: true,
    restoreState: "authenticated",
    loadUser: async () => {},
  } as never);
  useServerStore.setState({ servers: [], loading: false, loadServers: async () => {} } as never);
  api.get = (async (url: string) => {
    if (url === "/public/servers/open-team") return { data: {
      server: { id: "server-1", name: "Open Team", slug: "open-team", avatarUrl: null },
      channels: [],
      canJoinAsGuest: false,
    } };
    throw new Error(`unexpected read ${url}`);
  }) as typeof api.get;

  render(
    <TestIntlProvider locale="en">
      <MemoryRouter initialEntries={["/s/open-team"]}>
        <AppShell />
      </MemoryRouter>
    </TestIntlProvider>,
  );

  assert.ok(await screen.findByTestId("public-server-page"));
  assert.match(screen.getByTestId("public-server-bottom-action").textContent ?? "", /Open Team is view only. You can read its public channels, but can't send messages here/);
  assert.ok(screen.queryByRole("heading", { name: "Sign In" }) === null);
});

test("an older-page response cannot bleed into a channel selected while it was in flight", async () => {
  const page = Array.from({ length: 50 }, (_, index) => ({
    id: `message-${index + 51}`,
    senderType: "user" as const,
    sender: { displayName: "First sender", avatarUrl: null, description: null },
    messageType: "chat" as const,
    content: `first-${index + 51}`,
    createdAt: "2026-09-08T08:00:00.000Z",
  }));
  let resolveOlder!: (value: { data: { messages: typeof page } }) => void;
  api.get = ((url: string) => {
    if (url === "/public/servers/race") return Promise.resolve({ data: {
      server: { id: "server-1", name: "Race", slug: "race", avatarUrl: null },
      channels: [
        { id: "channel-1", name: "first", description: null },
        { id: "channel-2", name: "second", description: null },
      ],
    } });
    if (url.endsWith("/channel-1/messages")) return Promise.resolve({ data: { messages: page } });
    if (url.includes("/channel-1/messages?beforeMessageId=")) {
      return new Promise((resolve) => { resolveOlder = resolve; });
    }
    if (url.endsWith("/channel-2/messages")) return Promise.resolve({ data: { messages: [{
      ...page[0]!, id: "second-message", sender: { displayName: "Second sender", avatarUrl: null, description: null }, content: "second-channel-only",
    }] } });
    throw new Error(`unexpected read ${url}`);
  }) as typeof api.get;

  renderPublicPage(
    <PublicServerPage slug="race" onSignIn={() => {}} onRegister={() => {}} onUnavailable={() => {}} />,
  );
  // Older pages load when the shared timeline's top sentinel comes into view;
  // there is no "load older" button any more.
  const scroller = await screen.findByTestId("public-server-message-timeline");
  await waitFor(() => assert.ok(screen.getByText("first-100")));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const observer = intersectionObservers.find((candidate) => candidate.root === scroller && candidate.targets.size === 2);
  assert.ok(observer, "the main list uses the shared timeline, which owns a top pagination sentinel");
  const topSentinel = [...observer.targets][0];
  assert.ok(topSentinel);
  await act(async () => { observer.trigger(topSentinel); });
  await waitFor(() => assert.equal(typeof resolveOlder, "function", "the older page was requested"));
  assert.ok(screen.queryByRole("button", { name: "Load older messages" }) === null);
  fireEvent.click(screen.getByRole("button", { name: "second" }));
  assert.ok(await screen.findByText("second-channel-only"));

  await act(async () => {
    resolveOlder({ data: { messages: [{ ...page[0]!, id: "stale", content: "stale-first-channel" }] } });
  });
  assert.ok(screen.queryByText("stale-first-channel") === null);
  assert.ok(screen.getByText("second-channel-only"));
});

test("a late thread response cannot replace the newer thread selection", async () => {
  const parent = (id: string, threadId: string, content: string) => ({
    id,
    senderType: "user" as const,
    sender: { displayName: "Cindy", avatarUrl: null, description: "Designer" },
    messageType: "chat" as const,
    content,
    createdAt: "2026-09-08T08:00:00.000Z",
    threadId,
    replyCount: 1,
  });
  let resolveFirst!: (value: { data: { messages: Array<ReturnType<typeof parent>> } }) => void;
  let resolveSecond!: (value: { data: { messages: Array<ReturnType<typeof parent>> } }) => void;
  api.get = ((url: string) => {
    if (url === "/public/servers/open-team") return Promise.resolve({ data: {
      server: { id: "server-1", name: "Open Team", slug: "open-team", avatarUrl: null },
      channels: [{ id: "channel-1", name: "announcements", description: null }],
    } });
    if (url.endsWith("/channels/channel-1/messages")) return Promise.resolve({ data: { messages: [
      parent("parent-1", "thread-1", "first parent"),
      parent("parent-2", "thread-2", "second parent"),
    ] } });
    if (url.includes("/threads/thread-1/messages?")) return new Promise((resolve) => { resolveFirst = resolve; });
    if (url.includes("/threads/thread-2/messages?")) return new Promise((resolve) => { resolveSecond = resolve; });
    throw new Error(`unexpected read ${url}`);
  }) as typeof api.get;

  renderPublicPage(<PublicServerPage slug="open-team" onSignIn={() => {}} onRegister={() => {}} onUnavailable={() => {}} />);
  const badges = await screen.findAllByTestId("message-thread-replies-badge");
  fireEvent.click(badges[0]!);
  fireEvent.click(badges[1]!);

  await act(async () => {
    resolveSecond({ data: { messages: [parent("reply-2", "thread-2", "newer thread reply")] } });
  });
  assert.ok(await screen.findByText("newer thread reply"));
  await act(async () => {
    resolveFirst({ data: { messages: [parent("reply-1", "thread-1", "stale thread reply")] } });
  });
  assert.ok(screen.queryByText("stale thread reply") === null);
  assert.ok(screen.getByText("newer thread reply"));
});

test("a public thread can page backward beyond its initial 50 replies", async () => {
  const reply = (id: string, content: string) => ({
    id,
    senderType: "agent" as const,
    sender: { displayName: "Helper", avatarUrl: null, description: "Agent helper" },
    messageType: "chat" as const,
    content,
    createdAt: "2026-09-08T08:01:00.000Z",
    threadId: null,
    replyCount: 0,
  });
  const initialReplies = Array.from({ length: 50 }, (_, index) => reply(`reply-${index + 51}`, `reply ${index + 51}`));
  const reads: string[] = [];
  api.get = (async (url: string) => {
    reads.push(url);
    if (url === "/public/servers/open-team") return { data: {
      server: { id: "server-1", name: "Open Team", slug: "open-team", avatarUrl: null },
      channels: [{ id: "channel-1", name: "announcements", description: null }],
    } };
    if (url.endsWith("/channels/channel-1/messages")) return { data: { messages: [{
      ...reply("parent-1", "parent"), senderType: "user", threadId: "thread-1", replyCount: 51,
    }] } };
    if (url.endsWith("/threads/thread-1/messages?limit=50")) return { data: { messages: initialReplies } };
    if (url.includes("/threads/thread-1/messages?limit=50&beforeMessageId=reply-51")) {
      return { data: { messages: [reply("reply-1", "oldest reply")] } };
    }
    throw new Error(`unexpected read ${url}`);
  }) as typeof api.get;

  renderPublicPage(<PublicServerPage slug="open-team" onSignIn={() => {}} onRegister={() => {}} onUnavailable={() => {}} />);
  fireEvent.click(await screen.findByTestId("message-thread-replies-badge"));
  const scroller = await screen.findByTestId("thread-message-scroller");
  await waitFor(() => assert.ok(screen.getByText("reply 51")));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const observer = intersectionObservers.find((candidate) => candidate.root === scroller && candidate.targets.size === 2);
  assert.ok(observer, "the canonical timeline owns a top pagination sentinel");
  const topSentinel = [...observer.targets][0];
  assert.ok(topSentinel);
  await act(async () => { observer.trigger(topSentinel); });

  assert.ok(await screen.findByText("oldest reply"));
  assert.ok(reads.some((url) => url.includes("beforeMessageId=reply-51")));
});

test("public server columns can be dragged to a new width, and the width is remembered", async () => {
  // Regression for cindyz 2026-09-18: the sidebar / thread dividers on the public page were plain borders because
  // this page never used the shared useResizablePanel hook the signed-in shell uses. Asserting the handle EXISTS is
  // not enough — that passes if the element is kept and the hook removed — so this drags it and checks the width.
  api.get = (async (url: string) => {
    if (url === "/public/servers/open-team") {
      return {
        data: {
          server: { id: "server-1", name: "Open Team", slug: "open-team", avatarUrl: null },
          channels: [{ id: "channel-1", name: "announcements", description: null }],
          canJoinAsGuest: true,
        },
      };
    }
    if (url.endsWith("/channel-1/messages")) return { data: { messages: [] } };
    throw new Error(`unexpected read ${url}`);
  }) as typeof api.get;

  // jsdom implements neither matchMedia nor pointer capture; the page guards the former, and the hook calls the
  // latter on drag start. Both are environment gaps, not behaviour under test.
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: true, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  const originalSetPointerCapture = Element.prototype.setPointerCapture;
  Element.prototype.setPointerCapture = function setPointerCapture() {};
  localStorage.removeItem("slock:publicServer:channelSidebarWidth");

  try {
    renderPublicPage(
      <PublicServerPage
        slug="open-team"
        onSignIn={() => {}}
        onRegister={() => {}}
        onUnavailable={() => assert.fail("public server must be available")}
      />,
    );

    const sidebar = await screen.findByTestId("public-server-channel-sidebar");
    assert.equal(sidebar.style.width, "240px", "starts at the default width");

    const handle = screen.getByTestId("public-server-channel-sidebar-resize-handle");
    // Separate acts on purpose: the hook persists the width it last RENDERED, so the move must flush before the
    // release. A real browser delivers pointermove and pointerup in different ticks; batching them into one act
    // would only test React's batching, and would have stored the pre-drag width.
    await act(async () => { fireEvent.pointerDown(handle, { clientX: 240, pointerId: 1 }); });
    await act(async () => { fireEvent.pointerMove(handle, { clientX: 300, pointerId: 1 }); });
    await act(async () => { fireEvent.pointerUp(handle, { clientX: 300, pointerId: 1 }); });

    assert.equal(sidebar.style.width, "300px", "dragging right widens the sidebar");
    assert.equal(localStorage.getItem("slock:publicServer:channelSidebarWidth"), "300",
      "the new width is remembered for the next visit");

    // The column itself must NOT be the scroll container. jsdom has no layout, so this cannot be caught by
    // measuring: it is asserted structurally because a real browser CLIPS an absolutely positioned handle that
    // straddles the edge of an `overflow` box, and the divider then renders but cannot be grabbed at all. That is
    // exactly how this shipped the first time — the drag test below passed while the real page did nothing.
    assert.ok(!/overflow-/.test(sidebar.className),
      `the column must not scroll or it clips the handle; className was "${sidebar.className}"`);
    assert.ok(sidebar.querySelector('[class*="overflow-y-auto"]'),
      "the scroll belongs to an inner wrapper");
  } finally {
    window.matchMedia = originalMatchMedia;
    Element.prototype.setPointerCapture = originalSetPointerCapture;
    localStorage.removeItem("slock:publicServer:channelSidebarWidth");
  }
});

test("the thread panel widens when dragged LEFT, and the width is remembered", async () => {
  // @Bugen's review of PR #7983: the thread panel is the only column passing `direction: "left"` to the resize hook,
  // and that argument had never been executed by any test — if it were wrong (or dropped), nothing would have gone
  // red. The assertion that matters here is therefore the SIGN: dragging left must make this column WIDER.
  api.get = (async (url: string) => {
    if (url === "/public/servers/open-team") {
      return { data: {
        server: { id: "server-1", name: "Open Team", slug: "open-team", avatarUrl: null },
        channels: [{ id: "channel-1", name: "announcements", description: null }],
        canJoinAsGuest: false,
      } };
    }
    if (url.endsWith("/channels/channel-1/messages")) {
      return { data: { messages: [{
        id: "parent-1", senderType: "user", sender: { displayName: "Cindy", avatarUrl: null, description: "Designer" },
        messageType: "chat", content: "parent", createdAt: "2026-09-08T08:00:00.000Z",
        threadId: "thread-1", replyCount: 1,
      }] } };
    }
    if (url.includes("/threads/thread-1/messages?")) {
      return { data: { messages: [{
        id: "reply-1", senderType: "agent", sender: { displayName: "Helper", avatarUrl: null, description: "Agent" },
        messageType: "chat", content: "threaded reply", createdAt: "2026-09-08T08:01:00.000Z",
        threadId: null, replyCount: 0,
      }] } };
    }
    throw new Error(`unexpected read ${url}`);
  }) as typeof api.get;

  const originalMatchMedia = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: true, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  const originalSetPointerCapture = Element.prototype.setPointerCapture;
  Element.prototype.setPointerCapture = function setPointerCapture() {};
  localStorage.removeItem("slock:publicServer:threadPanelWidth");

  try {
    renderPublicPage(<PublicServerPage slug="open-team" onSignIn={() => {}} onRegister={() => {}} onUnavailable={() => {}} />);
    assert.ok(await screen.findByText("parent"));
    fireEvent.click(screen.getByTestId("message-thread-replies-badge"));
    const panel = await screen.findByTestId("public-server-thread-panel");
    assert.equal(panel.style.width, "400px", "starts at the shared default width");

    const handle = screen.getByTestId("public-server-thread-panel-resize-handle");
    // Moving the pointer LEFT (decreasing clientX) must INCREASE the width — the whole point of direction: "left".
    await act(async () => { fireEvent.pointerDown(handle, { clientX: 1000, pointerId: 1 }); });
    await act(async () => { fireEvent.pointerMove(handle, { clientX: 940, pointerId: 1 }); });
    await act(async () => { fireEvent.pointerUp(handle, { clientX: 940, pointerId: 1 }); });

    assert.equal(panel.style.width, "460px", "dragging left widens the thread panel (direction: \"left\")");
    assert.equal(localStorage.getItem("slock:publicServer:threadPanelWidth"), "460",
      "the new width is remembered under the thread panel's own key");
  } finally {
    window.matchMedia = originalMatchMedia;
    Element.prototype.setPointerCapture = originalSetPointerCapture;
    localStorage.removeItem("slock:publicServer:threadPanelWidth");
  }
});

test("the thread panel drag starts from the MEASURED width, not the stored one", async () => {
  // @Bugen, review of PR #8076: `getDragStartWidth` is the part that makes this column behave like the signed-in one
  // when CSS has clamped the rendered width — and it had no coverage, because jsdom reports
  // getBoundingClientRect().width as 0, so the callback returns undefined and the hook silently falls back to the
  // stored width. Every previous assertion passed through that fallback. Here the measured width is stubbed to differ
  // from the stored width, so the two paths give different answers and only the measured one matches.
  api.get = (async (url: string) => {
    if (url === "/public/servers/open-team") {
      return { data: {
        server: { id: "server-1", name: "Open Team", slug: "open-team", avatarUrl: null },
        channels: [{ id: "channel-1", name: "announcements", description: null }],
        canJoinAsGuest: false,
      } };
    }
    if (url.endsWith("/channels/channel-1/messages")) {
      return { data: { messages: [{
        id: "parent-1", senderType: "user", sender: { displayName: "Cindy", avatarUrl: null, description: "Designer" },
        messageType: "chat", content: "parent", createdAt: "2026-09-08T08:00:00.000Z",
        threadId: "thread-1", replyCount: 1,
      }] } };
    }
    if (url.includes("/threads/thread-1/messages?")) {
      return { data: { messages: [{
        id: "reply-1", senderType: "agent", sender: { displayName: "Helper", avatarUrl: null, description: "Agent" },
        messageType: "chat", content: "threaded reply", createdAt: "2026-09-08T08:01:00.000Z",
        threadId: null, replyCount: 0,
      }] } };
    }
    throw new Error(`unexpected read ${url}`);
  }) as typeof api.get;

  const originalMatchMedia = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: true, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  const originalSetPointerCapture = Element.prototype.setPointerCapture;
  Element.prototype.setPointerCapture = function setPointerCapture() {};
  localStorage.setItem("slock:publicServer:threadPanelWidth", "400");

  try {
    renderPublicPage(<PublicServerPage slug="open-team" onSignIn={() => {}} onRegister={() => {}} onUnavailable={() => {}} />);
    assert.ok(await screen.findByText("parent"));
    fireEvent.click(screen.getByTestId("message-thread-replies-badge"));
    const panel = await screen.findByTestId("public-server-thread-panel");
    assert.equal(panel.style.width, "400px", "stored width is the starting point on screen");

    // Render as if CSS had it at 500 while the persisted value is still 400.
    Object.defineProperty(panel, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ width: 500, height: 600, top: 0, left: 0, right: 500, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }),
    });

    const handle = screen.getByTestId("public-server-thread-panel-resize-handle");
    await act(async () => { fireEvent.pointerDown(handle, { clientX: 1000, pointerId: 1 }); });
    await act(async () => { fireEvent.pointerMove(handle, { clientX: 950, pointerId: 1 }); });
    await act(async () => { fireEvent.pointerUp(handle, { clientX: 950, pointerId: 1 }); });

    // measured 500 + 50 dragged left = 550. Falling back to the stored 400 would give 450.
    assert.equal(panel.style.width, "550px",
      "the drag must start from the measured width (500), not the persisted width (400)");
  } finally {
    window.matchMedia = originalMatchMedia;
    Element.prototype.setPointerCapture = originalSetPointerCapture;
    localStorage.removeItem("slock:publicServer:threadPanelWidth");
  }
});

test("visit counts: one view per shown page and one open per channel the visitor picks, never per request", async () => {
  const visits: Array<{ url: string; body: { event: string; channel_id?: string } }> = [];
  setPublicVisitFetchForTest(async (url, init) => {
    visits.push({ url, body: JSON.parse(String(init?.body)) });
  });
  api.get = (async (url: string) => {
    if (url === "/public/servers/open-team") {
      return { data: {
        server: { id: "server-1", name: "Open Team", slug: "open-team", avatarUrl: null },
        channels: [
          { id: "channel-1", name: "announcements", description: null },
          { id: "channel-2", name: "questions", description: null },
        ],
        canJoinAsGuest: false,
      } };
    }
    if (url.includes("/channels/")) return { data: { messages: [] } };
    throw new Error(`unexpected read ${url}`);
  }) as typeof api.get;
  try {
    renderPublicPage(
      <PublicServerPage
        slug="open-team"
        onSignIn={() => {}}
        onRegister={() => {}}
        onUnavailable={() => assert.fail("public server must be available")}
      />,
    );
    await screen.findByTestId("public-server-page");
    await waitFor(() => assert.equal(visits.length, 1));
    assert.match(visits[0].url, /\/public-visits\/open-team$/);
    assert.equal(visits[0].body.event, "public_page_viewed", "the default channel is part of the view, not an open");

    fireEvent.click(screen.getByRole("button", { name: /questions/ }));
    await waitFor(() => assert.equal(visits.length, 2));
    assert.deepEqual(
      { event: visits[1].body.event, channel: visits[1].body.channel_id },
      { event: "public_page_channel_opened", channel: "channel-2" },
    );
    // Nothing is claimed by the client beyond the event itself.
    for (const visit of visits) assert.deepEqual(Object.keys(visit.body).filter((key) => key !== "uuid" && key !== "channel_id"), ["event"]);
  } finally {
    setPublicVisitFetchForTest(null);
  }
});

// Thread opens (cindyz, 2026-10-15, via Tenny).
test("visit counts: a thread the visitor opens counts once with its channel, and a failed load does not", async () => {
  const visits: Array<Record<string, string>> = [];
  setPublicVisitFetchForTest(async (_url, init) => {
    visits.push(JSON.parse(String(init?.body)));
  });
  const parent = (id: string, threadId: string) => ({
    id,
    senderType: "user" as const,
    sender: { displayName: "Cindy", avatarUrl: null, description: null },
    messageType: "chat" as const,
    content: `parent ${id}`,
    createdAt: "2026-09-08T08:00:00.000Z",
    threadId,
    replyCount: 1,
  });
  api.get = (async (url: string) => {
    if (url === "/public/servers/open-team") return { data: {
      server: { id: "server-1", name: "Open Team", slug: "open-team", avatarUrl: null },
      channels: [{ id: "channel-1", name: "announcements", description: null }],
      canJoinAsGuest: false,
    } };
    if (url.endsWith("/channels/channel-1/messages")) return { data: { messages: [parent("parent-1", "thread-1"), parent("parent-2", "thread-2")] } };
    if (url.includes("/threads/thread-1/messages?")) return { data: { messages: [] } };
    if (url.includes("/threads/thread-2/messages?")) throw Object.assign(new Error("gone"), { response: { status: 404, data: {} } });
    throw new Error(`unexpected read ${url}`);
  }) as typeof api.get;
  try {
    renderPublicPage(<PublicServerPage slug="open-team" onSignIn={() => {}} onRegister={() => {}} onUnavailable={() => {}} />);
    const badges = await screen.findAllByTestId("message-thread-replies-badge");
    await waitFor(() => assert.equal(visits.length, 1));
    fireEvent.click(badges[1]!);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    fireEvent.click(badges[0]!);
    await waitFor(() => assert.equal(visits.length, 2));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const withoutUuid = visits.map(({ uuid: _uuid, ...rest }) => rest);
    assert.deepEqual(withoutUuid, [
      { event: "public_page_viewed" },
      { event: "public_page_thread_opened", channel_id: "channel-1", thread_channel_id: "thread-1" },
    ]);
  } finally {
    setPublicVisitFetchForTest(null);
  }
});

// Where visits come from (cindyz, 2026-10-14).
test("visit sources: only the view the tab opened on carries its referring host and utm values", async () => {
  const bodies: Array<Record<string, string>> = [];
  setPublicVisitFetchForTest(async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
  });
  setLandingPageForTest({
    pathname: "/s/open-team/channel/channel-2",
    search: "?utm_source=Newsletter&utm_medium=email&utm_campaign=Spring%20Sale&ref=someone",
    referrer: "https://www.google.com/search?q=raft+open+team",
  });
  try {
    recordPublicVisit("other-team", "public_page_viewed");
    recordPublicVisit("open-team", "public_page_viewed");
    recordPublicVisit("open-team", "public_page_channel_opened", "channel-2");
    recordPublicVisit("open-team", "public_page_viewed");
    await waitFor(() => assert.equal(bodies.length, 4));
    const withoutUuid = bodies.map(({ uuid: _uuid, ...rest }) => rest);
    assert.deepEqual(withoutUuid, [
      { event: "public_page_viewed", entry: "in_app" },
      // The full referring URL and the free-text campaign never leave the page.
      { event: "public_page_viewed", entry: "landing", referrer_domain: "google.com", utm_source: "newsletter", utm_medium: "email" },
      { event: "public_page_channel_opened", channel_id: "channel-2" },
      { event: "public_page_viewed", entry: "in_app" },
    ]);
  } finally {
    setLandingPageForTest(null);
    setPublicVisitFetchForTest(null);
  }
});

// Visitor id after cookie consent (cindyz / Tenny, 2026-10-14). The banner
// that records the choice is a separate PR; these cover what the choice does.
test("visitor id: sent with logged-out visits only after Accept, never after Decline or from a signed-in view", async () => {
  const bodies: Array<Record<string, string>> = [];
  setPublicVisitFetchForTest(async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
  });
  try {
    recordPublicVisit("open-team", "public_page_viewed");
    setPublicVisitorConsent("accepted");
    const id = publicVisitorId();
    assert.match(id ?? "", /^[0-9a-f-]{36}$/);
    recordPublicVisit("open-team", "public_page_channel_opened", "channel-2");
    localStorage.setItem("slock_access_token", "token");
    recordPublicVisit("open-team", "public_page_viewed");
    localStorage.removeItem("slock_access_token");
    setPublicVisitorConsent("declined");
    recordPublicVisit("open-team", "public_page_viewed");
    await waitFor(() => assert.equal(bodies.length, 4));
    assert.deepEqual(bodies.map((body) => body.anonymous_id), [undefined, id, undefined, undefined]);
    assert.equal(localStorage.getItem("raft_public_visitor_consent")?.includes(id ?? "-"), false, "Decline deletes the id");
  } finally {
    localStorage.removeItem("slock_access_token");
    setPublicVisitFetchForTest(null);
  }
});

test("visitor id: withdrawing deletes it even when storage refuses the new choice", () => {
  setPublicVisitorConsent("accepted");
  assert.ok(publicVisitorId());
  const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("quota", "QuotaExceededError");
  });
  try {
    setPublicVisitorConsent("declined");
  } finally {
    setItem.mockRestore();
  }
  assert.equal(publicVisitorId(), null, "no id survives a failed withdrawal");
  assert.equal(readPublicVisitorConsent(), null, "undecided again, so the banner asks again");
});

test("visitor id: the choice and its id expire after 13 months, then the visitor is asked again", () => {
  const decidedAt = Date.parse("2026-01-01T00:00:00Z");
  setPublicVisitorConsent("accepted", decidedAt);
  assert.ok(publicVisitorId(decidedAt + 394 * 86_400_000));
  assert.equal(publicVisitorId(decidedAt + 395 * 86_400_000), null);
  assert.equal(readPublicVisitorConsent(decidedAt + 395 * 86_400_000), null);
  assert.equal(localStorage.getItem("raft_public_visitor_consent"), null, "the expired id is deleted, not just ignored");
});

// Cookie consent (cindyz / Tenny, 2026-10-14): a logged-out visitor is asked
// only where the server would keep the id; nothing is stored or sent before
// "Accept", and "Decline" keeps visits counted without any id.
test("cookie consent: nothing is sent before Accept, the id rides along after it, and Cookie settings can withdraw it", async () => {
  const visits: Array<Record<string, string>> = [];
  setPublicVisitFetchForTest(async (_url, init) => {
    visits.push(JSON.parse(String(init?.body)));
  });
  api.get = (async (url: string) => {
    if (url === "/public/servers/open-team") {
      return { data: {
        server: { id: "server-1", name: "Open Team", slug: "open-team", avatarUrl: null },
        channels: [
          { id: "channel-1", name: "announcements", description: null },
          { id: "channel-2", name: "questions", description: null },
        ],
        canJoinAsGuest: false,
        visitorIdMode: "ask",
      } };
    }
    if (url.includes("/channels/")) return { data: { messages: [] } };
    throw new Error(`unexpected read ${url}`);
  }) as typeof api.get;
  try {
    renderPublicPage(
      <PublicServerPage slug="open-team" onSignIn={() => {}} onRegister={() => {}} onUnavailable={() => assert.fail("public server must be available")} />,
    );
    assert.ok(await screen.findByTestId("public-cookie-consent"));
    // Undecided: the consent takes the join banner's slot (cindyz, 2026-10-15),
    // in the layout, not floating over the conversation (John, #9870).
    const slot = screen.getByTestId("public-server-bottom-slot");
    const consentBar = within(slot).getByTestId("public-cookie-consent");
    assert.ok(screen.queryByTestId("public-server-bottom-action") === null, "the join banner is covered until the visitor chooses");
    assert.doesNotMatch(consentBar.className, /(?:^|\s)fixed(?:\s|$)/);
    assert.doesNotMatch(slot.className, /(?:^|\s)fixed(?:\s|$)/);
    assert.equal(screen.getByTestId("public-cookie-consent-privacy").getAttribute("href"), "https://raft.build/privacy");
    // Accept and Reject carry the same weight (CNIL: refusing as easy as accepting).
    assert.equal(
      screen.getByTestId("public-cookie-consent-accept").className,
      screen.getByTestId("public-cookie-consent-decline").className,
    );
    await waitFor(() => assert.equal(visits.length, 1));
    assert.equal(visits[0].anonymous_id, undefined, "undecided: no id");

    fireEvent.click(screen.getByTestId("public-cookie-consent-accept"));
    assert.ok(screen.queryByTestId("public-cookie-consent") === null);
    assert.ok(screen.getByTestId("public-server-bottom-action"), "choosing brings the join banner back");
    const id = publicVisitorId();
    assert.match(id ?? "", /^[0-9a-f-]{36}$/);
    fireEvent.click(screen.getByRole("button", { name: /questions/ }));
    await waitFor(() => assert.equal(visits.length, 2));
    assert.equal(visits[1].anonymous_id, id);

    // Withdraw from Cookie settings: the id is deleted and stops being sent.
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByTestId("public-server-cookie-settings"));
    fireEvent.click(await screen.findByTestId("public-cookie-consent-decline"));
    assert.equal(readPublicVisitorConsent(), "declined");
    assert.equal(publicVisitorId(), null);
    assert.equal(localStorage.getItem("raft_public_visitor_consent")?.includes(id ?? "-"), false);
    recordPublicVisit("open-team", "public_page_viewed");
    await waitFor(() => assert.equal(visits.length, 3));
    assert.equal(visits[2].anonymous_id, undefined);
  } finally {
    setPublicVisitFetchForTest(null);
  }
});

test("cookie consent: no banner where the server keeps no id or for a signed-in visitor, and a signed-in view never sends one", async () => {
  const bodies: Array<Record<string, string>> = [];
  setPublicVisitFetchForTest(async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
  });
  let visitorIdMode: "ask" | undefined;
  api.get = (async (url: string) => {
    if (url === "/public/servers/open-team") return { data: {
      server: { id: "server-1", name: "Open Team", slug: "open-team", avatarUrl: null },
      channels: [],
      canJoinAsGuest: false,
      visitorIdMode,
    } };
    throw new Error(`unexpected read ${url}`);
  }) as typeof api.get;
  try {
    const first = renderPublicPage(<PublicServerPage slug="open-team" onSignIn={() => {}} onRegister={() => {}} onUnavailable={() => {}} />);
    await screen.findByTestId("public-server-page");
    assert.ok(screen.queryByTestId("public-cookie-consent") === null, "flag off: never asked");
    first.unmount();

    visitorIdMode = "ask";
    useAuthStore.setState({ user: signedInVisitor });
    renderPublicPage(<PublicServerPage slug="open-team" authenticated onSignIn={() => {}} onRegister={() => {}} onUnavailable={() => {}} />);
    await screen.findByTestId("public-server-page");
    assert.ok(screen.queryByTestId("public-cookie-consent") === null, "signed in: never asked");

    setPublicVisitorConsent("accepted");
    localStorage.setItem("slock_access_token", "token");
    bodies.length = 0;
    recordPublicVisit("open-team", "public_page_viewed");
    await waitFor(() => assert.equal(bodies.length, 1));
    assert.equal(bodies[0].anonymous_id, undefined, "a signed-in view is linked only by joining");
  } finally {
    localStorage.removeItem("slock_access_token");
    setPublicVisitFetchForTest(null);
  }
});

// By country (cindyz, 2026-10-15): where the law does not require asking
// first, the id is on by default with an opt-out; where it does, an id that was
// only on by default is dropped and the visitor is asked.
test("cookie consent: on by default where no ask is required, with Cookie settings to turn it off; asked again in an ask region", async () => {
  const visits: Array<Record<string, string>> = [];
  setPublicVisitFetchForTest(async (_url, init) => {
    visits.push(JSON.parse(String(init?.body)));
  });
  let visitorIdMode: "ask" | "default_on" = "default_on";
  api.get = (async (url: string) => {
    if (url === "/public/servers/open-team") return { data: {
      server: { id: "server-1", name: "Open Team", slug: "open-team", avatarUrl: null },
      channels: [],
      canJoinAsGuest: false,
      visitorIdMode,
    } };
    throw new Error(`unexpected read ${url}`);
  }) as typeof api.get;
  try {
    const first = renderPublicPage(<PublicServerPage slug="open-team" onSignIn={() => {}} onRegister={() => {}} onUnavailable={() => {}} />);
    await screen.findByTestId("public-server-page");
    await waitFor(() => assert.equal(visits.length, 1));
    assert.ok(screen.queryByTestId("public-cookie-consent") === null, "not asked where the law does not require it");
    assert.ok(screen.getByTestId("public-server-bottom-action"), "the join banner stays");
    assert.equal(readPublicVisitorConsent(), "default");
    const id = publicVisitorId();
    assert.match(id ?? "", /^[0-9a-f-]{36}$/);
    assert.equal(visits[0].anonymous_id, id, "the first view already carries the default id");

    // Cookie settings opens the same banner, from the channel column on phones
    // (no rail there, John) as from the rail's settings menu; Reject turns the id off.
    // Shown exactly where the rail is hidden: no width without an entry (John, #9872).
    assert.match(screen.getByTestId("workspace-left-rail").className, /(?:^|\s)hidden(?:\s|$)/);
    assert.match(screen.getByTestId("workspace-left-rail").className, /(?:^|\s)md:flex(?:\s|$)/);
    assert.match(screen.getByTestId("public-server-cookie-settings-phone-slot").className, /(?:^|\s)md:hidden(?:\s|$)/);
    fireEvent.click(screen.getByTestId("public-server-cookie-settings-phone"));
    fireEvent.click(await screen.findByTestId("public-cookie-consent-decline"));
    assert.equal(readPublicVisitorConsent(), "declined");
    assert.equal(publicVisitorId(), null);
    first.unmount();

    // Turned off, then the page reloads in the same default_on region: still off, no new id (Tenny).
    visits.length = 0;
    const second = renderPublicPage(<PublicServerPage slug="open-team" onSignIn={() => {}} onRegister={() => {}} onUnavailable={() => {}} />);
    await waitFor(() => assert.equal(visits.length, 1));
    assert.equal(readPublicVisitorConsent(), "declined");
    assert.equal(visits[0].anonymous_id, undefined);
    second.unmount();

    // A default id met in an ask region: dropped before the first view, and the visitor is asked.
    resetPublicVisitorConsentForTest();
    visitorIdMode = "default_on";
    const third = renderPublicPage(<PublicServerPage slug="open-team" onSignIn={() => {}} onRegister={() => {}} onUnavailable={() => {}} />);
    await waitFor(() => assert.equal(readPublicVisitorConsent(), "default"));
    third.unmount();
    visitorIdMode = "ask";
    visits.length = 0;
    renderPublicPage(<PublicServerPage slug="open-team" onSignIn={() => {}} onRegister={() => {}} onUnavailable={() => {}} />);
    assert.ok(await screen.findByTestId("public-cookie-consent"));
    await waitFor(() => assert.equal(visits.length, 1));
    assert.equal(visits[0].anonymous_id, undefined, "no id is sent before the visitor answers");
    assert.equal(publicVisitorId(), null);
  } finally {
    setPublicVisitFetchForTest(null);
  }
});

// Tenny, 2026-10-15: with Global Privacy Control the server says default_off:
// no banner, no id, and an id that was only on by default is dropped.
test("cookie consent: default_off (Global Privacy Control) keeps the id off without asking, and Cookie settings can still opt in", async () => {
  const visits: Array<Record<string, string>> = [];
  setPublicVisitFetchForTest(async (_url, init) => {
    visits.push(JSON.parse(String(init?.body)));
  });
  let visitorIdMode: "default_on" | "default_off" = "default_on";
  api.get = (async (url: string) => {
    if (url === "/public/servers/open-team") return { data: {
      server: { id: "server-1", name: "Open Team", slug: "open-team", avatarUrl: null },
      channels: [],
      canJoinAsGuest: false,
      visitorIdMode,
    } };
    throw new Error(`unexpected read ${url}`);
  }) as typeof api.get;
  try {
    const first = renderPublicPage(<PublicServerPage slug="open-team" onSignIn={() => {}} onRegister={() => {}} onUnavailable={() => {}} />);
    await waitFor(() => assert.equal(readPublicVisitorConsent(), "default"));
    first.unmount();

    visitorIdMode = "default_off";
    visits.length = 0;
    renderPublicPage(<PublicServerPage slug="open-team" onSignIn={() => {}} onRegister={() => {}} onUnavailable={() => {}} />);
    await waitFor(() => assert.equal(visits.length, 1));
    assert.equal(visits[0].anonymous_id, undefined, "the default id is dropped before the first view");
    assert.equal(readPublicVisitorConsent(), null);
    assert.ok(screen.queryByTestId("public-cookie-consent") === null, "not asked");
    assert.ok(screen.getByTestId("public-server-bottom-action"));

    fireEvent.click(screen.getByTestId("public-server-cookie-settings-phone"));
    fireEvent.click(await screen.findByTestId("public-cookie-consent-accept"));
    assert.equal(readPublicVisitorConsent(), "accepted");
    assert.match(publicVisitorId() ?? "", /^[0-9a-f-]{36}$/);
  } finally {
    setPublicVisitFetchForTest(null);
  }
});
