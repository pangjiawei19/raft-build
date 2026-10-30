import { ContextMenuSeparator } from "@botiverse/raft-ui";

/**
 * Canonical divider between groups of context-menu items. Raft Design System
 * › Menu: one hairline (`rf-menu__sep`) between groups, the same line for
 * every group boundary; raft-ui's separator recipe draws it, so spacing
 * between items stays with item padding, not divider margins.
 *
 * Centralized so context menus (Sidebar channel / DM / agent menus today,
 * future surfaces) don't re-roll their own divider literal. stdrc 2026-05-24
 * audit follow-up.
 */
export default function ContextMenuDivider() {
  return <ContextMenuSeparator />;
}
