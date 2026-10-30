import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { clearClockTimeout, setClockTimeout } from "@botiverse/raft-shared";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type {
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router-dom";
import { Check, GripVertical, Plus, UserPlus } from "lucide-react";
import { Badge, PopoverContent } from "@botiverse/raft-ui";
import type { PopoverContentProps } from "@botiverse/raft-ui";
import Banner from "./Banner";
import Tooltip from "./Tooltip";
import { useServerStore } from "../../store/serverStore";
import { useServerPermissions } from "../../hooks/useServerPermissions";
import InviteHumanDialog from "../member/InviteHumanDialog";
import type { CommunityServerSlug, Server } from "../../store/serverStore";
import { serverPersistence } from "../../store/serverPersistenceRegistry";
import { useJoinCommunityFlow } from "../../hooks/useJoinCommunityFlow";
import {
  DEFAULT_COMMUNITY_SERVER_SLUG,
  hasJoinedCommunity,
} from "../../utils/communityServers";
import {
  getServerSwitcherTarget,
  openServerSwitcherAuxClickTarget,
  openServerSwitcherDesktopTarget,
} from "../../utils/serverSwitcherNavigation";
import type { ServerUnreadSummary } from "../../utils/serverUnreadSummary";
import AvatarSlot from "./AvatarSlot";
import ContextMenuDivider from "./ContextMenuDivider";
import { requestHostedOnboardingServerSwitch } from "../../embed/hostBridge";
import { dismissLayerProps } from "./dismissLayer";

/**
 * The workspace switcher: the joined workspaces, Join Community, Switch or
 * Create Server and Invite People. One list for every trigger — the desktop
 * rail's workspace block, the web top bar's workspace button and the phone
 * Home pill.
 *
 * It is the content of a raft-ui Popover. Render it inside the caller's
 * `<Popover open onOpenChange>` next to its `<PopoverTrigger>`: the popover
 * owns the trigger toggle, outside presses and Escape, and puts the list in a
 * portal placed against the trigger (or `anchor`), kept on screen and never
 * taller than the space it has, so the list scrolls inside and the footer
 * stays reachable. Opening it never moves the page.
 *
 * Rules:
 *  - The current workspace's row hides its own unread count: you are already
 *    there.
 *  - Selecting another workspace navigates to its last remembered surface,
 *    falling back to `/s/${slug}`; ServerResolver flips `current` once the
 *    route lands. The URL is the source of truth, the store is not updated
 *    directly.
 *
 * Raft Design System › Select (the workspace list): every workspace is the
 * ink tile with yellow initials (AvatarSlot `type="server"`); the workspace
 * you are in carries a trailing ink check and bold name; another
 * workspace's unread is the pink count badge (a muted one the gray mono
 * count); rows are 8px-radius menu items with the yellow-soft highlight.
 */
export interface ServerSwitcherMenuProps
  extends Pick<PopoverContentProps, "anchor" | "side" | "align" | "sideOffset" | "alignOffset"> {
  /** Closes the menu (the caller's Popover state) once an action in it is done. */
  onClose: () => void;
  /** Width classes for the menu. */
  className?: string;
  /** Server unread counts keyed by server id. Fetched at the callsite. */
  serverUnreadCounts: Record<string, ServerUnreadSummary>;
  /** Test id on the outer card. Defaults to `server-switcher-menu`. */
  testId?: string;
  /**
   * Desktop restores the last surface visited in the selected server. Mobile
   * treats a server switch as a root-context change instead: replace the old
   * server entry with the selected server's Home so a later channel Back
   * cannot cross into the previous server.
   */
  navigationMode?: "restore-surface" | "replace-with-home";
}

function SortableServerRow({
  server,
  currentServerId,
  unreadSummary,
  targetHref,
  onSelect,
  onAuxSelect,
}: {
  server: Server;
  currentServerId: string | null;
  unreadSummary?: ServerUnreadSummary;
  targetHref: string;
  onSelect: (server: Server, targetHref: string) => void;
  onAuxSelect: (event: ReactMouseEvent, server: Server, targetHref: string) => void;
}) {
  const intl = useIntl();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: server.id });
  const verticalTransform = transform ? { ...transform, x: 0 } : null;
  const style = {
    transform: CSS.Transform.toString(verticalTransform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  const isCurrent = server.id === currentServerId;
  const initial = (server.name || "S").trim().charAt(0).toUpperCase() || "S";
  // Activity's server summary is the cross-surface authority. An absent field
  // is unknown, so do not substitute the broader legacy sidebar count.
  const unread = unreadSummary?.activityUnreadCount;
  const isMuted = unreadSummary?.serverPushMuted === true;

  // The yellow-soft highlight follows the pointer or KEYBOARD focus only. The
  // popover moves focus into its first row when it opens, so `focus-within`
  // lit that row after every mouse open, as if it were hovered.
  return (
    <div
      ref={setNodeRef}
      style={style}
      onAuxClick={(event) => onAuxSelect(event, server, targetHref)}
      className="group/server-row relative flex h-12 w-full items-stretch rounded-control text-callout font-medium text-foreground transition-colors hover:bg-brand-soft has-[:focus-visible]:bg-brand-soft"
    >
      <a
        href={targetHref}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            if (openServerSwitcherDesktopTarget(server.id)) event.preventDefault();
            return;
          }
          event.preventDefault();
          onSelect(server, targetHref);
        }}
        className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-control py-0 pl-2.5 pr-1 text-left outline-none ${
          isCurrent ? "font-bold" : ""
        }`}
      >
        <AvatarSlot context="list-row" type="server" serverAvatarUrl={server.avatarUrl} serverInitial={initial} />
        <div className="min-w-0 flex-1 text-left">
          <div className="truncate">{server.name}</div>
          <div className="truncate font-mono text-mono-meta font-normal text-foreground-hint">/{server.slug}</div>
        </div>
        {isCurrent ? <Check size={16} className="shrink-0 text-foreground" aria-hidden="true" /> : null}
        {!isCurrent && unread !== undefined && unread > 0 && (
          isMuted ? (
            <Tooltip content={intl.formatMessage({ id: "ui.serverSwitcher.notificationsMuted" })}>
              <span
                className="ml-auto shrink-0 font-mono text-mono-meta text-foreground-hint"
              >
                {unread > 99 ? "99+" : unread}
              </span>
            </Tooltip>
          ) : (
            <Badge variant="accent" className="ml-auto shrink-0 justify-center">
              {unread > 99 ? "99+" : unread}
            </Badge>
          )
        )}
      </a>
      <button
        type="button"
        aria-label={intl.formatMessage({ id: "ui.serverSwitcher.reorderServer" }, { name: server.name })}
        {...attributes}
        {...listeners}
        className="flex w-6 shrink-0 touch-none cursor-grab items-center justify-center rounded-control text-foreground-hint outline-none group-hover/server-row:text-foreground-muted focus-visible:shadow-focus active:cursor-grabbing"
      >
        <GripVertical size={14} />
      </button>
    </div>
  );
}

// The footer actions are DS menu items: 36 tall, 14/20 500 ink, a 16px ink-2
// icon, the yellow-soft highlight on hover and keyboard focus.
const SWITCHER_ACTION_CLASS = "flex min-h-9 w-full items-center justify-start gap-2.5 rounded-control px-2.5 py-1.5 [@media(max-height:600px)]:min-h-8 [@media(max-height:600px)]:py-1 text-left text-callout font-medium text-foreground outline-none transition-colors hover:bg-brand-soft focus-visible:bg-brand-soft [&>svg]:text-foreground-muted";

function handleAuxSelectServer(event: ReactMouseEvent, selected: Server, targetHref: string) {
  openServerSwitcherAuxClickTarget(event, selected.id, selected.slug, { targetHref });
}

export default function ServerSwitcherMenu({
  onClose,
  className,
  serverUnreadCounts,
  testId = "server-switcher-menu",
  navigationMode = "restore-surface",
  anchor,
  side = "bottom",
  align = "start",
  sideOffset = 8,
  alignOffset = 0,
}: ServerSwitcherMenuProps) {
  const intl = useIntl();
  const navigate = useNavigate();
  const server = useServerStore((s) => s.current);
  const servers = useServerStore((s) => s.servers);
  const updateServerOrder = useServerStore((s) => s.updateServerOrder);
  const [hostedSwitchPending, setHostedSwitchPending] = useState(false);
  const [hostedSwitchError, setHostedSwitchError] = useState("");
  const [showInviteHuman, setShowInviteHuman] = useState(false);
  const { capabilities } = useServerPermissions();
  const hostedSwitchTimeoutRef = useRef<ReturnType<typeof setClockTimeout> | null>(null);
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 500, tolerance: 10 } }),
  );
  const communityJoinFlow = useJoinCommunityFlow({
    onJoined: () => {
      onClose();
    },
    onError: (_error, _slug, message) => {
      onClose();
      // Surfacing via alert matches the other low-frequency
      // sidebar failure modes until we have a shared toast system.
      // eslint-disable-next-line no-alert
      alert(message);
    },
  });

  useEffect(() => () => {
    if (hostedSwitchTimeoutRef.current !== null) clearClockTimeout(hostedSwitchTimeoutRef.current);
  }, []);

  const handleSelectServer = useCallback((selected: Server, targetHref: string) => {
    const isCurrent = selected.id === server?.id;
    if (!isCurrent) {
      const outcome = requestHostedOnboardingServerSwitch(selected.id);
      if (outcome === "sent") {
        setHostedSwitchError("");
        setHostedSwitchPending(true);
        hostedSwitchTimeoutRef.current = setClockTimeout(() => {
          hostedSwitchTimeoutRef.current = null;
          setHostedSwitchPending(false);
          setHostedSwitchError(intl.formatMessage({ id: "pages.serverSelector.switchFailed" }));
        }, 5000);
        return;
      }
      if (outcome === "failed") {
        setHostedSwitchError(intl.formatMessage({ id: "pages.serverSelector.switchFailed" }));
        return;
      }
      // Let the URL be the source of truth; ServerResolver will switch the
      // current server after the route changes.
      navigate(targetHref, navigationMode === "replace-with-home" ? { replace: true } : undefined);
    }
    onClose();
  }, [intl, navigate, navigationMode, onClose, server?.id]);

  const handleServerDragEnd = useCallback(({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const oldIndex = servers.findIndex((candidate) => candidate.id === activeId);
    const newIndex = servers.findIndex((candidate) => candidate.id === overId);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(servers, oldIndex, newIndex).map((candidate) => candidate.id);
    void updateServerOrder(reordered);
  }, [servers, updateServerOrder]);

  const sortableServerIds = useMemo(() => servers.map((candidate) => candidate.id), [servers]);
  const closeInviteDialog = useCallback(() => setShowInviteHuman(false), []);

  const joinOptions: Array<
    { kind: "community-server"; slug: CommunityServerSlug; label: string }
  > = [];
  if (!hasJoinedCommunity(servers, DEFAULT_COMMUNITY_SERVER_SLUG)) {
    joinOptions.push({ kind: "community-server", slug: DEFAULT_COMMUNITY_SERVER_SLUG, label: intl.formatMessage({ id: "ui.serverSwitcher.joinCommunity" }) });
  }

  const handleJoinCommunity = async (slug: CommunityServerSlug) => {
    await communityJoinFlow.joinCommunity(slug);
  };

  // The dialogs sit beside the popup, not in it: they outlive the menu, which
  // closes as soon as one of them opens.
  return (
    <>
    <PopoverContent
      anchor={anchor}
      side={side}
      align={align}
      sideOffset={sideOffset}
      alignOffset={alignOffset}
      collisionPadding={8}
      data-testid={testId}
      {...dismissLayerProps}
      className={`flex flex-col p-1.5 ${className ?? ""}`}
    >
      {hostedSwitchError ? (
        <Banner intent="warning" density="sm" className="m-1 mb-1.5 shrink-0">
          {hostedSwitchError}
        </Banner>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleServerDragEnd}>
          <SortableContext items={sortableServerIds} strategy={verticalListSortingStrategy}>
            {servers.map((s) => (
              <div key={s.id} aria-disabled={hostedSwitchPending || undefined} className={hostedSwitchPending ? "pointer-events-none opacity-60" : ""}>
                <SortableServerRow
                  server={s}
                  currentServerId={server?.id ?? null}
                  unreadSummary={serverUnreadCounts[s.id]}
                  targetHref={navigationMode === "replace-with-home"
                    ? `/s/${s.slug}`
                    : getServerSwitcherTarget(s.slug)}
                  onSelect={handleSelectServer}
                  onAuxSelect={handleAuxSelectServer}
                />
              </div>
            ))}
          </SortableContext>
        </DndContext>
      </div>

      <ContextMenuDivider />

      {/* Community actions sit above Switch or Create Server. */}
      {joinOptions.map((option) => (
        <button
          key={option.slug}
          onClick={() => void handleJoinCommunity(option.slug)}
          className={SWITCHER_ACTION_CLASS}
        >
          <Plus size={16} />
          <span className="min-w-0 flex-1 text-left">{option.label}</span>
        </button>
      ))}

      <button
        onClick={() => {
          onClose();
          serverPersistence.clearLastServerSlug();
          navigate("/");
        }}
        className={SWITCHER_ACTION_CLASS}
      >
        <Plus size={16} />
        <span className="min-w-0 flex-1 text-left">{intl.formatMessage({ id: "ui.serverSwitcher.switchOrCreate" })}</span>
      </button>

      {/* "Invite people" sits right under "Switch or create server" so inviting
          teammates is one click from the workspace menu instead of buried in
          Settings → Administration. Gated by the same capability the Settings
          invites section uses; opens the shared InviteHumanDialog. */}
      {capabilities.inviteMembers ? (
        <button
          data-testid="server-switcher-invite"
          onClick={() => {
            onClose();
            setShowInviteHuman(true);
          }}
          className={SWITCHER_ACTION_CLASS}
        >
          <UserPlus size={16} />
          <span className="min-w-0 flex-1 text-left">{intl.formatMessage({ id: "layout.sidebar.inviteHuman" })}</span>
        </button>
      ) : null}
    </PopoverContent>
    {communityJoinFlow.agreementDialog}
    {showInviteHuman ? <InviteHumanDialog onClose={closeInviteDialog} /> : null}
    </>
  );
}
