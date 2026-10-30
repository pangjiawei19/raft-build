import { memo, useCallback } from "react";
import { useIntl } from "react-intl";
import { SidebarItem, SidebarItemContent, SidebarItemSubtitle, SidebarItemTitle } from "@botiverse/raft-ui";
import type { ServerMember } from "../../store/serverStore";
import Tooltip from "../ui/Tooltip";
import AvatarSlot from "../ui/AvatarSlot";
import { sidebarItemClass } from "./Sidebar";
import type { SidebarCtxKind, SidebarLongPress } from "./Sidebar";

// Members-tab human row; same stable-callback contract as <MemberAgentRow>.
// Stryker disable all: member-row interaction glue is browser-smoke verified.
export const MemberHumanRow = memo(function MemberHumanRow({
  human,
  isSelf,
  selected,
  menuOpen,
  onSelect,
  onOpenDm,
  onContextMenu,
  makeLongPress,
}: {
  human: ServerMember;
  isSelf: boolean;
  selected: boolean;
  menuOpen: boolean;
  onSelect: (userId: string, clickCount: number) => void;
  onOpenDm: (userId: string) => Promise<void>;
  onContextMenu: (e: React.MouseEvent, type: SidebarCtxKind, id: string) => void;
  makeLongPress: (type: SidebarCtxKind, id: string) => SidebarLongPress;
}) {
  const { formatMessage } = useIntl();
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => onSelect(human.userId, event.detail),
    [human.userId, onSelect],
  );
  const handleDoubleClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void onOpenDm(human.userId);
  }, [human.userId, onOpenDm]);
  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => onContextMenu(event, "member-human", human.userId),
    [human.userId, onContextMenu],
  );
  return (
    <Tooltip content={isSelf ? formatMessage({ id: "layout.sidebar.youTitle" }) : `${human.displayName || human.name}`}>
    <SidebarItem
      type="button"
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      data-slot="sidebar-item"
      active={selected}
      {...makeLongPress("member-human", human.userId)}
      className={sidebarItemClass(selected, menuOpen)}
    >
      <AvatarSlot context="sidebar-list" type="human" humanAvatarUrl={human.avatarUrl} gravatarHash={human.gravatarHash} />
      {/* raft-ui's row content, as every sidebar row: one line, an ellipsis. */}
      <SidebarItemContent>
        <SidebarItemTitle>
          {human.displayName || human.name}
          {isSelf && <span className="ml-1 font-normal text-foreground-hint group-data-active/sidebar-item:text-sticker-ink">{formatMessage({ id: "layout.sidebar.youSuffix" })}</span>}
        </SidebarItemTitle>
        {/* Only Guest is labeled: it is the rare role whose access differs.
            DS `rf-tag`: a neutral machine label — hairline inset edge, mono, ink-2. */}
        {human.role === "guest" && (
          <span className="inline-flex h-5 shrink-0 self-center items-center rounded-chip px-1.5 font-mono text-mono-meta font-normal text-foreground-muted ring-1 ring-inset ring-line-hairline group-data-active/sidebar-item:text-sticker-ink group-data-active/sidebar-item:ring-sticker-ink">
            {formatMessage({ id: "layout.sidebar.guestLabel" })}
          </span>
        )}
        {human.description && (
          <SidebarItemSubtitle data-sidebar-row-description="">{human.description}</SidebarItemSubtitle>
        )}
      </SidebarItemContent>
    </SidebarItem>
    </Tooltip>
  );
});
// Stryker restore all
