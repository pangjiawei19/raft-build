import { useCallback } from "react";
import { useIntl } from "react-intl";
import type { HTMLAttributes } from "react";
import { Button } from "@botiverse/raft-ui";
import type { AvatarBadgeOffset } from "@botiverse/raft-ui";
import AttentionDot from "../ui/AttentionDot";
import AvatarSlot from "../ui/AvatarSlot";
import AppTooltip from "../ui/Tooltip";
import { ON_FRAME_GHOST_BUTTON } from "./topBarClasses";
import type { Server } from "../../store/serverStore";

/** Unread dots on workspace avatars sit at the top-right corner (artin). */
export const WORKSPACE_UNREAD_BADGE_OFFSET: AvatarBadgeOffset = ["100%", 0];

export const workspaceInitial = (server: Server) => (server.name || "S").trim().charAt(0).toUpperCase() || "S";

/** One workspace avatar in the strip: the button, and its tooltip unless a drag is live. */
export function WorkspaceStripButton({ server, isCurrent, hasUnread = false, otherUnread = false, shortcut, hideTooltip, onPick, dragProps }: {
  server: Server;
  isCurrent: boolean;
  /** Unread activity there: the dot is decorative, so the label says it. */
  hasUnread?: boolean;
  /** On the current workspace only: another workspace with nowhere in the
   *  strip to show its own dot has unread (the rail's server cell used to
   *  carry this one). */
  otherUnread?: boolean;
  /** Shown in the tooltip where the host has such a shortcut (the desktop app's ⌘1…⌘9). */
  shortcut: string | null;
  hideTooltip: boolean;
  onPick: (server: Server) => void;
  /** dnd-kit's attributes and listeners when the avatar is sortable. */
  dragProps?: HTMLAttributes<HTMLButtonElement>;
}) {
  const { formatMessage } = useIntl();
  const handleClick = useCallback(() => onPick(server), [onPick, server]);
  const ownDot = hasUnread && !isCurrent;
  const currentDot = isCurrent && otherUnread;
  const label = ownDot
    ? formatMessage({ id: "ui.workspaceStrip.serverWithUnread" }, { name: server.name })
    : currentDot
      ? formatMessage({ id: "ui.workspaceStrip.currentWithOtherUnread" }, { name: server.name })
      : server.name;
  // The dot rides raft-ui's AvatarBadge (through AvatarSlot's badge slot): it
  // owns the corner, the size for the avatar's size and the stacking, so a
  // neighbouring avatar can no longer paint over it.
  const badge = ownDot || currentDot
    ? <AttentionDot aria-hidden data-testid={ownDot ? "workspace-strip-unread" : "app-top-bar-workspace-unread"} />
    : undefined;
  const button = (
    <Button
      variant="ghost"
      size="icon-sm"
      className={ON_FRAME_GHOST_BUTTON}
      aria-label={label}
      aria-current={isCurrent ? "true" : undefined}
      data-current={isCurrent ? "true" : undefined}
      onClick={handleClick}
      {...dragProps}
    >
      <AvatarSlot context="creator-link" type="server" serverAvatarUrl={server.avatarUrl} serverInitial={workspaceInitial(server)} badge={badge} badgeOffset={WORKSPACE_UNREAD_BADGE_OFFSET} />
    </Button>
  );
  if (hideTooltip) return button;
  return <AppTooltip content={`${server.name}${shortcut ? `  ${shortcut}` : ""}`}>{button}</AppTooltip>;
}
