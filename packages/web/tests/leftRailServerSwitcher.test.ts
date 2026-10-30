import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getDesktopServerBootstrapTarget,
  getServerSwitcherTarget,
  openServerSwitcherAuxClickTarget,
} from "../src/utils/serverSwitcherNavigation";

const repoRoot = resolve(import.meta.dirname, "..");

test("server switcher rows expose remembered targets for new-tab actions", () => {
  const primitive = readFileSync(
    resolve(repoRoot, "src/components/ui/ServerSwitcherMenu.tsx"),
    "utf8",
  );

  assert.match(
    primitive,
    /navigationMode === "replace-with-home"[\s\S]*?`\/s\/\$\{s\.slug\}`[\s\S]*?: getServerSwitcherTarget\(s\.slug\)/,
  );
  assert.match(primitive, /<a\s+href=\{targetHref\}/);
  assert.match(primitive, /event\.metaKey \|\| event\.ctrlKey \|\| event\.shiftKey \|\| event\.altKey/);
  assert.match(primitive, /event\.preventDefault\(\);\s*onSelect\(server, targetHref\);/);
  assert.match(primitive, /onAuxClick=\{\(event\) => onAuxSelect\(event, server, targetHref\)\}/);
  assert.match(
    primitive,
    /openServerSwitcherAuxClickTarget\(event, selected\.id, selected\.slug, \{ targetHref \}\);/,
  );
  assert.match(
    primitive,
    /navigate\(targetHref, navigationMode === "replace-with-home" \? \{ replace: true \} : undefined\)/,
  );

  const calls: Array<[string, "_blank", "noopener,noreferrer"]> = [];
  let prevented = 0;
  let stopped = 0;
  const readSurface = (slug: string) => slug === "ops" ? "/s/ops/tasks?view=mine" : null;
  const openNewTab = (...args: [string, "_blank", "noopener,noreferrer"]) => {
    calls.push(args);
  };

  assert.equal(getServerSwitcherTarget("ops", readSurface), "/s/ops/tasks?view=mine");
  assert.equal(getServerSwitcherTarget("new-server", readSurface), "/s/new-server");

  const ignored = openServerSwitcherAuxClickTarget(
    {
      button: 0,
      preventDefault: () => { prevented += 1; },
      stopPropagation: () => { stopped += 1; },
    },
    "550e8400-e29b-41d4-a716-446655440000",
    "ops",
    { readSurface, openNewTab },
  );
  assert.equal(ignored, false);
  assert.deepEqual(calls, []);
  assert.equal(prevented, 0);
  assert.equal(stopped, 0);

  const opened = openServerSwitcherAuxClickTarget(
    {
      button: 1,
      preventDefault: () => { prevented += 1; },
      stopPropagation: () => { stopped += 1; },
    },
    "550e8400-e29b-41d4-a716-446655440000",
    "ops",
    { readSurface, openNewTab },
  );
  assert.equal(opened, true);
  assert.deepEqual(calls, [["/s/ops/tasks?view=mine", "_blank", "noopener,noreferrer"]]);
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
});

test("native bootstrap query selects only the exact canonical server identity", () => {
  const servers = [
    { id: "550e8400-e29b-41d4-a716-446655440000", slug: "alpha" },
    { id: "550e8400-e29b-41d4-a716-446655440001", slug: "beta" },
  ];
  const readSurface = (slug: string) => slug === "beta" ? "/s/beta/tasks" : null;
  assert.equal(
    getDesktopServerBootstrapTarget(
      "?raftDesktopServerId=550e8400-e29b-41d4-a716-446655440001",
      servers,
      readSurface,
    ),
    "/s/beta/tasks",
  );
  assert.equal(
    getDesktopServerBootstrapTarget(
      "?raftDesktopServerId=550e8400-e29b-41d4-a716-446655440099",
      servers,
      readSurface,
    ),
    null,
  );
  assert.equal(
    getDesktopServerBootstrapTarget("?serverSlug=beta", servers, readSurface),
    null,
  );
});

test("desktop server switcher keeps long server lists inside the viewport", () => {
  // Every trigger opens the one primitive as raft-ui Popover content: the
  // popover places it against the trigger (or the rail head), keeps it on
  // screen and caps it at the space it has; the primitive's list is the
  // scroll region, so its footer stays reachable however many servers there
  // are. No caller positions or sizes the menu's height by hand.
  const leftRail = readFileSync(
    resolve(repoRoot, "src/components/layout/LeftRail.tsx"),
    "utf8",
  );
  const primitive = readFileSync(
    resolve(repoRoot, "src/components/ui/ServerSwitcherMenu.tsx"),
    "utf8",
  );

  assert.match(leftRail, /testId="desktop-server-switcher-menu"/);
  assert.match(leftRail, /<PopoverTrigger[\s\S]*?<AppRailItem/);
  assert.doesNotMatch(leftRail, /left-full|max-h-\[calc\(100dvh/);
  assert.match(primitive, /<PopoverContent[\s\S]*?collisionPadding=\{8\}[\s\S]*?className=\{`flex flex-col p-1\.5/);
  assert.doesNotMatch(primitive, /PopoverPopup|ResizeObserver|getBoundingClientRect|addEventListener\("mousedown"/);
  assert.doesNotMatch(primitive, /card-brutal/);
  assert.match(primitive, /min-h-0 flex-1 overflow-y-auto overscroll-contain/);
});

test("server switcher navigation preserves desktop restore while mobile replaces with Home", () => {
  // Post-extraction: server switch routing lives in the primitive. Desktop
  // keeps remembered-surface behavior while the mobile callsite selects Home
  // + REPLACE through navigationMode. Assert the split at the source of truth.
  const primitive = readFileSync(
    resolve(repoRoot, "src/components/ui/ServerSwitcherMenu.tsx"),
    "utf8",
  );

  assert.match(
    primitive,
    /navigationMode === "replace-with-home"[\s\S]*?`\/s\/\$\{s\.slug\}`[\s\S]*?: getServerSwitcherTarget\(s\.slug\)/,
  );
  assert.match(primitive, /href=\{targetHref\}/);
  assert.match(
    primitive,
    /navigate\(targetHref, navigationMode === "replace-with-home" \? \{ replace: true \} : undefined\)/,
  );
  // The URL must be the source of truth — no direct setCurrentServer(s)
  // call wrapped around the navigation. ServerResolver flips `current`
  // after the route lands.
  assert.doesNotMatch(
    primitive,
    /setCurrentServer\(s\);\s*navigate\(`\/s\/\$\{s\.slug\}`\);/,
  );
});

test("rail tabs hover to opaque white, not translucent gray", () => {
  const source = readFileSync(
    resolve(repoRoot, "src/components/layout/LeftRail.tsx"),
    "utf8",
  );

  assert.match(source, /<AppRailItem[\s\S]*className=\{`size-10 /);
  assert.match(source, /AppRailItem/);
  assert.doesNotMatch(source, /hover:bg-white\/70/);
});

test("chat rail tab shows an icon-anchored unread dot only while inactive", () => {
  const source = readFileSync(
    resolve(repoRoot, "src/components/layout/LeftRail.tsx"),
    "utf8",
  );
  const sidebar = readFileSync(
    resolve(repoRoot, "src/components/layout/Sidebar.tsx"),
    "utf8",
  );

  // Keep this source contract compatible with Stryker's callback
  // instrumentation; the runtime render tooth below owns subscription behavior.
  assert.match(source, /activityUnreadCount/);
  assert.match(source, /currentServerActivityCount/);
  assert.match(source, /hasCurrentServerActivityUnread\(\{/);
  assert.match(source, /hasAcceptedActivityWindow/);
  assert.match(source, /summaryUnreadCount: currentServerActivityCount/);
  // Chat attention is narrowed to joined channels and DMs; public discovery
  // rows keep gray row-level unread without lighting the global pink dot.
  assert.match(source, /selectChatAttentionChannelIds\(s\.channels, s\.dmChannels\)/);
  assert.match(source, /hasChatAttentionUnread\(chatAttentionChannelIds, s\.unreadCounts\)/);
  assert.match(source, /hasChatUnread = hasLocalChatUnread/);
  // Rail labels resolve through the layout i18n catalog; pin the ids. showDot
  // uses staging's refactored selectors (`hasChatUnread` / `hasActiveInboxUnread`).
  assert.match(source, /id: "layout\.leftRail\.tabChat"[\s\S]*?showDot=\{hasChatUnread\}/);
  assert.match(source, /id: "layout\.leftRail\.tabActivity"[\s\S]*?showDot=\{hasActivityUnread\}/);
  assert.doesNotMatch(source, /id: "layout\.leftRail\.tabActivity"[\s\S]*?showDot=\{inboxTotalUnreadCount > 0\}/);
  assert.match(sidebar, /activityUnreadCount/);
  assert.match(sidebar, /activityUnreadCount > 0/);
  assert.doesNotMatch(sidebar, /inboxTotalUnreadCount/);
  assert.match(source, /dotInactiveOnly/);
  assert.match(source, /<AppRailItemIcon className="relative">/);
  assert.match(source, /<AppRailItemAttention title=\{dotTooltip \?\? label\} \/>/);
  assert.match(source, /const dotVisible = Boolean\(showDot && \(!dotInactiveOnly \|\| !active\)\)/);
  assert.match(source, /dotVisible \?/);
  // Rail-tab attention dots go through raft-ui's AppRailItemAttention, the
  // rail's shared composite (indicator + sr-only title), so size, place and
  // colour track the rail recipe. Don't drop back to an inline span.
  assert.doesNotMatch(source, /<span[^>]*rounded-full[^>]*bg-(?:palette-pink|brutal-pink|attention|accent)/);
});
