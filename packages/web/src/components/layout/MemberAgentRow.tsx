import { memo, useCallback } from "react";
import { SidebarItem, SidebarItemContent, SidebarItemSubtitle, SidebarItemTitle } from "@botiverse/raft-ui";
import { isExternalAgentRuntime } from "@botiverse/raft-shared";
import type { Agent } from "../../store/agentStore";
import AvatarSlot from "../ui/AvatarSlot";
import { SIDEBAR_ROW_TRAILING_CLASS, SidebarAgentActivityBadge, SidebarAgentMeta, sidebarItemClass } from "./Sidebar";
import type { SidebarCtxKind, SidebarLongPress } from "./Sidebar";

// Members-tab agent entity row. Builds its own handlers from stable parent
// callbacks so the Sidebar does not hand each row new closures per render.
// Stryker disable all: member-row interaction glue is contract-pinned and browser-smoke verified.
export interface MemberAgentRowProps {
  agent: Agent;
  selected: boolean;
  menuOpen: boolean;
  onSelect: (agentId: string, clickCount: number) => void;
  onOpenDm: (agentId: string) => Promise<void>;
  onContextMenu: (e: React.MouseEvent, type: SidebarCtxKind, id: string) => void;
  makeLongPress: (type: SidebarCtxKind, id: string) => SidebarLongPress;
}

export const MemberAgentRow = memo(function MemberAgentRow({
  agent,
  selected,
  menuOpen,
  onSelect,
  onOpenDm,
  onContextMenu,
  makeLongPress,
}: MemberAgentRowProps) {
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => onSelect(agent.id, event.detail),
    [agent.id, onSelect],
  );
  const handleDoubleClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void onOpenDm(agent.id);
  }, [agent.id, onOpenDm]);
  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => onContextMenu(event, "member-agent", agent.id),
    [agent.id, onContextMenu],
  );
  return (
    <SidebarItem
      data-agent-id={agent.id}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      data-slot="sidebar-item"
      active={selected}
      {...makeLongPress("member-agent", agent.id)}
      className={sidebarItemClass(selected, menuOpen)}
    >
      <AvatarSlot
        context="sidebar-list"
        type="agent"
        agentAvatarUrl={agent.avatarUrl}
        badge={<SidebarAgentActivityBadge agentId={agent.id} />}
      />
      {/* raft-ui's row content, as every sidebar row: one line, an ellipsis. */}
      <SidebarItemContent>
        <SidebarItemTitle>{agent.displayName || agent.name}</SidebarItemTitle>
        {agent.description && (
          <SidebarItemSubtitle data-sidebar-row-description="">{agent.description}</SidebarItemSubtitle>
        )}
      </SidebarItemContent>
      {/* Runtime in mono, or what it is doing while it works (DS `rf-srow__meta`). */}
      <span className={SIDEBAR_ROW_TRAILING_CLASS}>
        <SidebarAgentMeta
          agentId={agent.id}
          runtime={agent.runtime}
          external={agent.external === true || isExternalAgentRuntime(agent.runtime)}
        />
      </span>
    </SidebarItem>
  );
});
// Stryker restore all
