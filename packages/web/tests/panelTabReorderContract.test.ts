import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const srcRoot = resolve(repoRoot, "src");
const strykerBackupSrc = () => {
  const tmp = resolve(repoRoot, ".stryker-tmp");
  if (!existsSync(tmp)) return null;
  const backup = readdirSync(tmp).find((entry) => entry.startsWith("backup-"));
  return backup ? resolve(tmp, backup, "src") : null;
};

function readSource(path: string): string {
  const backupSrc = strykerBackupSrc();
  const srcPath = path.replace(/^src\//, "");
  const backupPath = backupSrc ? resolve(backupSrc, srcPath) : null;
  return readFileSync(backupPath && existsSync(backupPath) ? backupPath : resolve(srcRoot, srcPath), "utf8");
}

test("top panel tabs use the shared reorderable tab bar", () => {
  const chatPanel = readSource("src/components/message/ChatPanel.tsx");
  const agentPanel = readSource("src/components/agent/AgentDetailPanel.tsx");
  const sidebar = readSource("src/components/layout/Sidebar.tsx");

  assert.match(chatPanel, /SortableTabsList[\s\S]*SortableTabsTab[\s\S]*Tabs[\s\S]*TabsLabel[\s\S]*useOrderedTabs[\s\S]*from "@botiverse\/raft-ui"/);
  assert.match(
    agentPanel,
    /import \{[^}]*\bSortableTabsList\b[^}]*\bSortableTabsTab\b[^}]*\bTabs\b[^}]*\bTabsLabel\b[^}]*\buseOrderedTabs\b[^}]*\} from "@botiverse\/raft-ui";/,
  );
  assert.doesNotMatch(chatPanel, /ReorderablePanelTabs/);
  assert.doesNotMatch(agentPanel, /ReorderablePanelTabs/);
  assert.match(sidebar, /verticalListSortingStrategy/);
  assert.match(sidebar, /useSortable\(\{ id, data \}\)/);
  assert.match(sidebar, /function SidebarDndContainer/);
  assert.match(sidebar, /<DragOverlay dropAnimation=\{null\}>/);
  assert.match(sidebar, /moveSidebarDndItem\(/);
  assert.match(sidebar, /export function getSidebarSortableItemTransform\([\s\S]*?return getSidebarDragItemTransform\(transform, allowHorizontalDrag\);/);
  assert.match(sidebar, /export function getSidebarDragItemTransform\(/);
  assert.match(sidebar, /if \(!transform \|\| allowHorizontalDrag\) return transform;/);
  assert.match(sidebar, /return \{ \.\.\.transform, x: 0 \};/);
  assert.match(sidebar, /transform: CSS\.Transform\.toString\(getSidebarDragItemTransform\(transform, true\)\)/);
  assert.match(sidebar, /<SortableSidebarItem key=\{itemId\} id=\{itemId\} containerId=\{containerId\}>/);

  assert.match(chatPanel, /useOrderedTabs\(chatPanelTabs, channelPanelTabOrder\)/);
  assert.match(chatPanel, /sidebarOrder\.channelPanelTabOrder/);
  assert.match(chatPanel, /updateSidebarOrder\(\{ channelPanelTabOrder: nextOrder \}\)/);
  // The actual panel/tab-list parent boundary is covered by the rendered
  // ChatPanel test; source order alone can preserve the wrong composition.
  assert.match(chatPanel, /<SortableTabsList<ChatPanelTab>/);
  // Raft DS tabs: the recipe owns the tab's height, its pointer cursor (DS
  // `.rf-tabs__item`; raft-ui's sortable tab sets it inline) and its 16px
  // icon, so the channel strip overrides none of them.
  assert.match(chatPanel, /<SortableTabsTab\s+key=\{tab\.id\}\s+value=\{tab\.id\}\s+data-testid=\{`panel-tab-\$\{tab\.id\}`\}\s*>\s*<Icon \/>/);

  assert.match(agentPanel, /useOrderedTabs\(visibleAgentTabItems, normalizedAgentPanelTabOrder\)/);
  assert.match(agentPanel, /sidebarOrder\.agentPanelTabOrder/);
  assert.match(agentPanel, /tab === "channels" \|\| tab === "dms" \? "chat" : tab/);
  assert.match(agentPanel, /updateSidebarOrder\(\{ agentPanelTabOrder: nextOrder \}\)/);
  assert.match(agentPanel, /<SortableTabsList<AgentTab>/);
  // Both tab bars take their chrome and their overflow behaviour (the row
  // scrolls itself, wheel included, fades at the hidden side, keeps the
  // selected tab in view) from raft-ui's ConversationPanelTabs / TabsList; the
  // agent panel adds no scroll classes, border or background of its own.
  assert.match(chatPanel, /<ConversationPanelTabs render=\{<Tabs<ChatPanelTab>/);
  assert.match(
    agentPanel,
    /<ConversationPanelTabs\s+render=\{<Tabs<AgentTab> value=\{activeTab\} onValueChange=\{setActiveTab\} \/>\}\s*>/,
  );
  assert.doesNotMatch(agentPanel, /overflow-x-auto overflow-y-hidden scrollbar-none/);
  assert.doesNotMatch(agentPanel, /theme-brutal:border-0 theme-brutal:bg-layer-canvas/);
  assert.doesNotMatch(agentPanel, /<Tabs<AgentTab>[^>]*className=/);
  // raft-ui's tab recipe draws the selected state itself; there is no separate
  // indicator or background part to mount any more.
  assert.doesNotMatch(agentPanel, /\bTabs(?:Indicator|Background)\b/);
  assert.doesNotMatch(chatPanel, /\bTabs(?:Indicator|Background)\b/);
  assert.doesNotMatch(agentPanel, /border-r-2 border-line-strong bg-layer-canvas/);
  // DS Tabs, the sticker version (the default): the recipe owns the 32px
  // item and its 44px hit area, so neither panel adds a height of its own.
  assert.match(agentPanel, /<SortableTabsTab\s+key=\{tab\.id\}\s+value=\{tab\.id\}\s+data-testid=\{`panel-tab-\$\{tab\.id\}`\}\s*>\s*<Icon \/>/);
  for (const source of [chatPanel, agentPanel]) {
    assert.doesNotMatch(source, /<SortableTabsTab[^>]*cursor-/, "the tab recipe owns the cursor");
  }
  assert.doesNotMatch(agentPanel, /<SortableTabsList<AgentTab>[^>]*variant=/);
  assert.doesNotMatch(chatPanel, /<SortableTabsList<ChatPanelTab>[^>]*variant=/);
  assert.doesNotMatch(agentPanel, /showMoreMenu/);
});

test("chat tabs default to ordered first; agent tabs default to stable profile", () => {
  const chatPanel = readSource("src/components/message/ChatPanel.tsx");
  const agentPanel = readSource("src/components/agent/AgentDetailPanel.tsx");

  assert.match(chatPanel, /const visibleTabs = useMemo\(/);
  assert.match(chatPanel, /const defaultTab = visibleTabs\[0\]\?\.id \?\? "chat";/);
  assert.match(chatPanel, /: defaultTab\s*\)\s*as ChatPanelTab/);
  assert.match(chatPanel, /if \(tab === defaultTab\) next\.delete\(CHAT_TAB_QUERY_PARAM\)/);

  assert.match(agentPanel, /const defaultAgentTab: AgentTab = visibleAgentTabs\.includes\("profile"\)\s*\?\s*"profile"\s*:\s*visibleAgentTabs\[0\] \?\? "profile";/);
  assert.match(agentPanel, /: defaultAgentTab;/);
  assert.match(agentPanel, /if \(tab === defaultAgentTab\) next\.delete\("agentTab"\)/);
});

test("agent detail tab reorder does not redefine the no-param active tab", () => {
  const agentPanel = readSource("src/components/agent/AgentDetailPanel.tsx");

  assert.match(agentPanel, /const orderedAgentTabs = useOrderedTabs\(visibleAgentTabItems, normalizedAgentPanelTabOrder\);/);
  assert.match(agentPanel, /const defaultAgentTab: AgentTab = visibleAgentTabs\.includes\("profile"\)/);
  assert.doesNotMatch(agentPanel, /const defaultAgentTab = orderedAgentTabs\[0\]/);
});

test("agent detail default tabs place Activity second after Profile", () => {
  const agentPanel = readSource("src/components/agent/AgentDetailPanel.tsx");

  assert.match(
    agentPanel,
    /const AGENT_TABS = \["profile", "activity", "chat", "reminders", "workspace", "integrations", "mcp"\] as const;/,
  );
  assert.match(
    agentPanel,
    /\{ id: "profile", icon: Bot, labelId: "agent\.detail\.tab\.profile" \},\n\s+\{ id: "activity", icon: Activity, labelId: "agent\.detail\.tab\.activity" \},/,
  );
  assert.match(agentPanel, /\{ id: "mcp", icon: Blocks, labelId: "agent\.detail\.tab\.mcp" \},/);
  assert.match(agentPanel, /if \(tab === "mcp"\) return canManageAgent;/);
  assert.match(agentPanel, /<AgentMcpTab agentId=\{agent\.id\} canManageServer=\{canManageServer\} \/>/);
});

test("the agent panel leaves keeping the selected tab in view to raft-ui's tab row", () => {
  const agentPanel = readSource("src/components/agent/AgentDetailPanel.tsx");

  assert.doesNotMatch(agentPanel, /scrollActiveTabIntoView|scroller\.scrollLeft/);
  assert.doesNotMatch(agentPanel, /activeTabButton\?\.scrollIntoView/);
});
