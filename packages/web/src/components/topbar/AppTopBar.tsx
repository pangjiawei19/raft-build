// The app's top bar at desktop width, the same bar as the desktop app's. One
// row, three regions: the workspace (current name, quick-switch avatars) on
// the left, the search field in the centre, and a trailing region on the right. The two side regions are both flex-1, so the
// search field stays centred whatever they hold, and centred on the WINDOW even
// when a host shell reserves space at one edge (see EDGE_BALANCE below).
//
// The web renders it bare. The desktop shell passes its own extras through the
// slots (history controls, update pill) and marks the row as the window's title
// bar; nothing desktop-specific lives here.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useIntl } from "react-intl";
import { ChevronDown, Search } from "lucide-react";
import { Button, Popover, PopoverTrigger, SearchTrigger, SearchTriggerLabel, SearchTriggerShortcut } from "@botiverse/raft-ui";
import { useServerStore } from "../../store/serverStore";
import { useRailMode } from "../../hooks/useSidebarTab";
import { trackNavEntrySelected } from "../../analytics/navigation";
import { getGlobalSearchShortcutLabel } from "../../utils/keyboardShortcuts";
import AvatarSlot from "../ui/AvatarSlot";
import { PublicPageGlobe } from "../server/PublicPageGlobe";
import ServerSwitcherMenu from "../ui/ServerSwitcherMenu";
import AttentionDot from "../ui/AttentionDot";
import { DESKTOP_SEARCH_ANCHOR_VARS } from "../search/searchOverlayAnchor";
import { WorkspaceStrip } from "./WorkspaceStrip";
import { WORKSPACE_UNREAD_BADGE_OFFSET } from "./WorkspaceStripButton";
import { NAME_CHEVRON_PX, useStripLayout } from "./useStripLayout";
import { stripCapacity, stripItems } from "./workspaceStripLayout";

// raft-ui Button renders children inside <span data-slot="button-content">,
// which has no min-width constraint; these utilities reach that slot so the
// workspace name truncates with the width it is given instead of overflowing.
// Only the name clips: the avatar's unread dot hangs off its corner, and a
// container holding a sticker never clips (DS › Patterns).
const SHRINKING_IDENTITY_BUTTON =
  "min-w-0 shrink justify-start gap-2 [&>[data-slot=button-content]]:min-w-0 [&>[data-slot=button-content]]:max-w-full";

// A host shell reserves window-chrome space at the bar's edges with padding (the
// desktop: 82px for the macOS traffic lights on the left, the Windows caption
// buttons on the right) and publishes the same amounts as
// --raft-titlebar-inset-start / --raft-titlebar-inset-end. Padding on one side
// only would push the search field off the window's centre by half of it, and
// the search overlay, which is centred on the window, would no longer line up.
// So the region facing the narrower edge gives up the difference as a margin
// next to the search field: both edges then end the same distance from the
// field. The web sets neither variable, so both margins are 0 there.
//
// Each side's total is the shell's inset plus the region's own horizontal
// padding (the flex-1 regions are equal border boxes, so their padding counts
// on both of its sides). On the web both regions are px-2 (16px); in title-bar
// mode the right region is pl-3 pr-3 (24px) and the left has none, the
// reserved corner already spacing it.
function edgeBalance(titleBar: boolean) {
  const start = `(var(--raft-titlebar-inset-start, 0px) + ${titleBar ? "0px" : "16px"})`;
  const end = `(var(--raft-titlebar-inset-end, 0px) + ${titleBar ? "24px" : "16px"})`;
  return {
    leading: { marginRight: `max(0px, calc(${end} - ${start}))` },
    trailing: { marginLeft: `max(0px, calc(${start} - ${end}))` },
  };
}
const EDGE_BALANCE = { web: edgeBalance(false), titleBar: edgeBalance(true) };

// Raft Design System: the bar is part of the frame (yellow in light, the
// neutral dark frame in dark), with the rail under it and a seam below.
// It is a 48px strip (the desktop app's title bar row) whose controls fill
// it: 36px frame items (raft-ui Button `on-frame`, and the 36px SearchTrigger),
// 6px off its top and bottom edges (the rail's gap between items), and the
// rail's 8px side inset, so the workspace button lines up with the rail
// buttons under it.
const BAR_FRAME =
  "relative flex h-12 w-full shrink-0 items-center border-b border-line-seam bg-layer-frame text-foreground-on-frame";


export interface AppTopBarProps {
  /** Rendered at the end of the left region, next to the search field. */
  leadingEnd?: ReactNode;
  /** Rendered in the right region. */
  trailing?: ReactNode;
  /** Desktop shell: the row is the window's title bar (drag region, insets). */
  titleBar?: boolean;
  /** Desktop shell: the modifier of its "switch to workspace N" shortcut, for the strip's tooltips. */
  workspaceShortcutModifier?: string | null;
}

export function AppTopBar({ leadingEnd, trailing, titleBar = false, workspaceShortcutModifier = null }: AppTopBarProps) {
  const { formatMessage } = useIntl();
  const server = useServerStore((s) => s.current);
  const servers = useServerStore((s) => s.servers);
  const serverUnreadCounts = useServerStore((s) => s.serverUnreadCounts);
  const { currentMode, selectRailMode } = useRailMode();
  const [serverMenuOpen, setServerMenuOpen] = useState(false);
  const workspaceNameRef = useRef<HTMLDivElement>(null);
  const serverNames = useMemo(() => servers.map((s) => s.name ?? ""), [servers]);
  const { free: stripFree, slotPx: nameSlotPx } = useStripLayout(workspaceNameRef, serverNames);
  const stripCount = stripCapacity(stripFree, servers.length);
  const stripShown = stripCount > 0;
  const nameSlotStyle = useMemo(() => (stripShown ? { minWidth: nameSlotPx } : undefined), [stripShown, nameSlotPx]);
  // Another workspace has unread activity but no avatar in the strip to carry
  // the dot (strip collapsed, or that workspace is beyond what fits): the
  // current workspace's avatar carries it — in the strip when it shows, else
  // on the name button — as a raft-ui AvatarBadge, never a free-floating dot.
  const shownIds = new Set(stripItems(servers, server?.id ?? null, stripCount).items.map((s) => s.id));
  const hiddenWorkspaceUnread = servers.some((s) =>
    s.id !== server?.id && !shownIds.has(s.id) && (serverUnreadCounts[s.id]?.activityUnreadCount ?? 0) > 0);

  // Publish the search field's geometry so the search overlay opens from it:
  // its top edge on the field's top edge (searchOverlayAnchor.ts).
  const searchFieldRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const field = searchFieldRef.current;
    if (!field) return;
    const root = document.documentElement;
    const px = (n: number) => `${Number(n.toFixed(3))}px`;
    const publish = () => {
      const rect = field.getBoundingClientRect();
      root.style.setProperty(DESKTOP_SEARCH_ANCHOR_VARS.top, px(rect.top));
      root.style.setProperty(DESKTOP_SEARCH_ANCHOR_VARS.width, px(rect.width));
    };
    publish();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
    observer?.observe(field);
    window.addEventListener("resize", publish);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", publish);
      root.style.removeProperty(DESKTOP_SEARCH_ANCHOR_VARS.top);
      root.style.removeProperty(DESKTOP_SEARCH_ANCHOR_VARS.width);
    };
  }, []);

  // The same entry the rail's Search tab used: the overlay over the current
  // view, or a plain re-entry when the full search page is already open.
  const openSearch = useCallback(() => {
    trackNavEntrySelected("search", "top_bar", currentMode === "search");
    selectRailMode("search");
  }, [currentMode, selectRailMode]);
  const closeServerMenu = useCallback(() => setServerMenuOpen(false), []);

  const serverName = server?.name ?? "";
  const serverInitial = serverName.slice(0, 1).toUpperCase() || "R";

  const edges = titleBar ? EDGE_BALANCE.titleBar : EDGE_BALANCE.web;

  return (
    <div {...(titleBar ? { "data-raft-titlebar": "" } : {})} data-testid="app-top-bar" className={BAR_FRAME}>
      {/* Web: the same 8px side padding as the right region, so the two flex-1
          regions are equal and the search field is centred on the window. */}
      <div className={`flex min-w-0 flex-1 items-center ${titleBar ? "" : "px-2"}`} style={edges.leading}>
        <div
          ref={workspaceNameRef}
          className="flex min-w-0 w-fit shrink"
          // Reserve the longest name's width while the strip shows, so the
          // strip's position never depends on which workspace is current.
          style={nameSlotStyle}
        >
          {/* The switcher is a raft-ui Popover: it opens 8px under the
              button, in a portal kept on screen. The button is raft-ui's
              on-frame Button (DS `rf-topbar__ws`): 36 tall, 15/20 700, 10px
              each side, frame-pressed on hover, press and while open. */}
          <Popover open={serverMenuOpen} onOpenChange={setServerMenuOpen}>
            <PopoverTrigger
              render={(
                <Button
                  variant="on-frame"
                  size="md"
                  aria-label={hiddenWorkspaceUnread ? formatMessage({ id: "ui.workspaceStrip.currentWithOtherUnread" }, { name: serverName }) : serverName}
                  data-testid="desktop-workspace-trigger"
                  className={SHRINKING_IDENTITY_BUTTON}
                />
              )}
            >
              {stripShown ? null : <AvatarSlot context="creator-link" type="server" serverAvatarUrl={server?.avatarUrl} serverInitial={serverInitial} className="shrink-0" badge={hiddenWorkspaceUnread ? <AttentionDot aria-hidden data-testid="app-top-bar-workspace-unread" /> : undefined} badgeOffset={WORKSPACE_UNREAD_BADGE_OFFSET} />}
              {serverName ? <span data-workspace-name className={`min-w-0 ${stripShown ? "max-w-[120px]" : "max-w-[160px]"} truncate`}>{serverName}</span> : null}
              <PublicPageGlobe live={server?.publicPageLive === true} />
              {stripShown ? <ChevronDown size={NAME_CHEVRON_PX} aria-hidden data-workspace-chevron className="size-4 shrink-0 text-foreground-on-frame-muted" /> : null}
            </PopoverTrigger>
            <ServerSwitcherMenu
              onClose={closeServerMenu}
              serverUnreadCounts={serverUnreadCounts}
              testId="desktop-server-switcher-menu"
              className="w-64"
            />
          </Popover>
        </div>
        <WorkspaceStrip freePx={stripFree} shortcutModifier={workspaceShortcutModifier} otherUnread={hiddenWorkspaceUnread} />
        {/* The left region's last item: the strip fills up to it and no further. */}
        <div data-topbar-leading-end className={`ml-auto flex shrink-0 items-center gap-0.5 pl-2 ${titleBar ? "pr-2" : ""}`}>
          {leadingEnd}
        </div>
      </div>

      {/* Raft DS › top bar search (`rf-topbar__search`): raft-ui SearchTrigger,
          a button drawn as the field (36 tall, the 1.5px ink line, an 18px
          glyph, the placeholder in ink-3). It opens search rather than taking
          input itself. Its width follows the window (32vw) and never
          animates: the strip measures the side regions on every resize. */}
      <SearchTrigger
        ref={searchFieldRef}
        onClick={openSearch}
        data-testid="app-top-bar-search"
      >
        <Search aria-hidden />
        <SearchTriggerLabel>{formatMessage({ id: "layout.leftRail.tabSearch" })}</SearchTriggerLabel>
        <SearchTriggerShortcut>{getGlobalSearchShortcutLabel(undefined, formatMessage)}</SearchTriggerShortcut>
      </SearchTrigger>

      <div className={`flex min-w-0 flex-1 items-center justify-end gap-1 ${titleBar ? "pl-3 pr-3" : "px-2"}`} style={edges.trailing}>
        {trailing}
      </div>
    </div>
  );
}
