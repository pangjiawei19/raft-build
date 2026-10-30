import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

test("agent detail diagnostic text cannot squeeze identity or actions", () => {
  const source = read("src/components/agent/AgentDetailPanel.tsx");

  assert.match(source, /<div className="flex min-w-0 items-center gap-1\.5">/);
  assert.match(source, /const activityText = showDetail\s*\?\s*formatActivityText\(\s*formatMessage,\s*displayState\.activity,\s*displayState\.activityDetail,\s*displayState\.activityDetailKind,\s*\)\s*:\s*formatActivityText\(formatMessage, displayState\.activity, ""\);/);
  // The live activity rides the DS presence chip; its text is a truncating lane
  // inside a chip capped at the row width.
  assert.match(source, /<Badge appearance="soft" variant=\{PRESENCE_CHIP_VARIANT\[displayState\.activity\]\} className="max-w-full">\s*<StatusDot activity=\{displayState\.activity\} className="shrink-0" \/>\s*<Tooltip content=\{activityText\}><span className="min-w-0 truncate">/);
  // The description lives only in the Profile tab body; the top bar never repeats it.
  assert.doesNotMatch(source, /subtitle=\{[^}]*agent\.description/);
  assert.match(source, /const headerTitle = agent\.displayName \|\| agent\.name;/);
  assert.match(source, /const titleClickProps = useMemo\(\(\) => \(\{ title: headerTitle \}\), \[headerTitle\]\);/);
  assert.match(source, /titleClickProps=\{titleClickProps\}/);
  assert.match(source, /titleSuffix=\{\s*isDeleted \? \(/);
  // The start error is a raft-ui PanelNotice strip; its text takes the width
  // left and truncates.
  assert.match(source, /<Tooltip content=\{startError\}><PanelNoticeContent render=\{<span \/>\} className="truncate">/);
  assert.match(source, /const hasRuntimeError = activityState\?\.activity === "error" \|\| Boolean\(agent\.lastRuntimeError\);/);
  // task #735: the error text deliberately gained a lookup-reason arm in front of
  // the catalog/fallback chain (only a confirmed miss keeps the install copy);
  // this pin tracks the new shape — update it consciously, never silently.
  assert.match(source, /const activityErrorText = startLookupDisplay && startLookupDisplay !== "confirmed_missing"\s*\?\s*formatMessage\(\s*\{ id: RUNTIME_LOOKUP_DISPLAY_MESSAGE_ID\[startLookupDisplay\] \},\s*\{ runtimeName: getRuntimeDisplayName\(agent\.runtime\) \},\s*\)\s*:\s*runtimeErrorKind\s*\?\s*formatMessage\(\{ id: RUNTIME_ERROR_LABEL_ID\[runtimeErrorKind\] \}\)\s*:\s*hasRuntimeError\s*\?\s*formatActivityText\(formatMessage, "error", rawRuntimeError\)\s*:\s*formatMessage\(\{ id: "activity\.status\.agentErrorFallback" \}\)/);
  assert.match(source, /const diagnosticErrorMessage = hasRuntimeError && canViewPrivateAgentSurfaces/);
  // The runtime error is a raft-ui PanelNotice strip: the text takes the width
  // left (clamped to two lines) and the actions keep theirs (shrink-0).
  assert.match(source, /<Tooltip content=\{canViewPrivateAgentSurfaces \? activityErrorText : activityFallbackErrorText\}><PanelNoticeContent render=\{<span \/>\} className="line-clamp-2 break-words">/);
  assert.match(source, /\{canViewPrivateAgentSurfaces && \(\s*<PanelNoticeActions>/);
  // Header identity: the name row holds only the name (and its edit pencil); live
  // activity has its own line under the handle, so it can never squeeze the name.
  assert.match(source, /<div className="min-w-0 flex-1 pt-1">\s*<div className="flex min-w-0 items-center gap-2">\s*<AgentHeaderName\s+agent=\{agent\}\s+onEdit=\{canManageAgent && !agent\.deletedAt \? editDisplayName : undefined\}\s*\/>\s*<\/div>/);
  assert.match(source, /const editDisplayName = useCallback\(\(\) => setEditField\("displayName"\), \[\]\);/);
  // #737 (cindyz/gzj): the identity name renders through PanelTitle — one spec
  // source with the header title; update this pin consciously if it moves again.
  assert.match(source, /<PanelTitle className="min-w-0">\{agent\.displayName \|\| agent\.name\}<\/PanelTitle>/);
  // Under the handle: the identity tags (agent tag + runtime chip) wrap on their
  // own row, then live activity gets its own line, so neither squeezes the name.
  assert.match(source, /title=\{`@\$\{agent\.name\}`\}>@\{agent\.name\}<\/div>[\s\S]*?<div className="mt-2 flex min-w-0 flex-wrap items-center gap-1\.5">[\s\S]*?\{\/\* Live activity has its own line under the handle, so it never squeezes the name\. \*\/\}\s*\{!agent\.deletedAt && \(\s*<div className="mt-1\.5 min-w-0">\s*<AgentStatusBadge agentId=\{agent\.id\}/);
  // The body handle carries the shared machine-text face (PROFILE_HANDLE_FONT_CLASS).
  assert.match(source, /className=\{`truncate text-mono-meta \$\{PROFILE_HANDLE_FONT_CLASS\} text-foreground-hint`\}/);
  assert.match(source, /title=\{`@\$\{agent\.name\}`\}>@\{agent\.name\}<\/div>/);
});

test("activity log status rows contain long error details inside a shrinkable lane", () => {
  const source = read("src/components/agent/AgentActivityLog.tsx");

  // DS Timeline (activity-log variant): pixel | shrinkable body | time. The body
  // column is minmax(0,1fr), so long error details wrap inside it.
  assert.match(source, /grid-cols-\[9px_minmax\(0,1fr\)_auto\]/);
  assert.match(source, /<div className="min-w-0">\{children\}<\/div>/);
  // The shrinkable lane is the resilience invariant: the secondary detail
  // stays wrapped in `ml-1.5 break-words` inside the min-w-0 body. Inner
  // content routes through <RefText> (activity ref linkification, task #266).
  assert.match(
    source,
    /<span className="ml-1\.5 break-words text-foreground-hint">\s*<RefText text=\{secondary\} \/>\s*<\/span>/,
  );
});

test("adjacent identity headers keep names shrinkable and status/action affordances fixed", () => {
  const chatPanel = read("src/components/message/ChatPanel.tsx");
  const machinePanel = [
    read("src/components/machine/MachineDetailPanel.tsx"),
    read("src/components/machine/CommandCopyRoot.tsx"),
    read("src/components/machine/WorkspaceDeleteButton.tsx"),
    read("src/components/machine/BulkResetOptionCard.tsx"),
    read("src/components/machine/MachineAgentRow.tsx"),
  ].join("\n");
  const humanPanel = [
    read("src/components/member/HumanDetailPanel.tsx"),
    read("src/components/member/CreatedAgentRow.tsx"),
  ].join("\n");

  // task #743: the activity text starts at zero width and grows only up to its
  // content (flex-1 max-w-fit), so it yields before the name without the
  // name sharing a proportional shrink — and the status dot stays in the row.
  // Raft DS: the status text is machine text (Space Mono 12/16, ink-3).
  assert.match(chatPanel, /<Tooltip content=\{activityText\}>\s*<span\s+className="min-w-0 flex-1 max-w-fit truncate font-mono text-mono-meta text-foreground-hint"\s*>/);
  // #737 follow-up (cindyz/gzj 2026-10-10): DM titles use PanelTitle like the
  // channel / thread / profile headers — the same name must read the same in
  // every surface. Update this pin consciously if the markup moves again.
  assert.match(chatPanel, /<Tooltip content=\{displayName\}><PanelTitle render=\{<span className="min-w-0 (?:flex-1 )?truncate" \/>\}>\{displayName\}<\/PanelTitle><\/Tooltip>/);
  assert.match(chatPanel, /title=\{isRegularChannel \? channel\.name : undefined\}/);
  // Raft DS › Panel: the channel subtitle first says who is working here, then
  // the description (still rendered through ChannelDescription); with nobody
  // working and no description the subtitle line collapses.
  assert.match(
    chatPanel,
    /const channelSubtitle = isRegularChannel\s*\?\s*<ChannelHeaderSubtitle agentIdKey=\{channelAgentIdKey\} description=\{channel\.description \|\| null\} \/>\s*:\s*undefined;/,
  );
  assert.match(chatPanel, /const descriptionNode = description \? <ChannelDescription description=\{description\} \/> : null;/);
  assert.match(chatPanel, /subtitle=\{channelSubtitle\}/);
  assert.match(chatPanel, /subtitleClassName="empty:hidden"/);

  // The computer profile name renders through PanelTitle (the recipe owns the
  // Raft DS headline type); the column stays shrinkable. The hostname is
  // machine text (Space Mono 12/16, ink-3) and truncates.
  assert.match(machinePanel, /<PanelTitle className="min-w-0">\{machine\.name\}<\/PanelTitle>/);
  assert.match(machinePanel, /<div className="truncate font-mono text-mono-meta text-foreground-hint">\{machine\.hostname\}<\/div>/);
  assert.match(machinePanel, /<Tooltip content=\{activityText\}><span\s+className="hidden max-w-\[min\(32rem,42vw\)\] truncate align-middle font-mono text-mono-meta text-foreground-hint sm:inline-block"\s*>/);

  // #737: human profile name renders through PanelTitle (same spec source as the
  // header title); update consciously.
  const humanNameHeaderIdx = humanPanel.search(
    /<PanelTitle className="min-w-0">\{human\.displayName \|\| human\.name\}<\/PanelTitle>/,
  );
  assert.ok(humanNameHeaderIdx >= 0, "human profile shrinkable name header anchor not found");
  // The departure marker is a status chip that never shrinks beside the handle.
  assert.match(humanPanel, /<Badge appearance="soft" variant="muted" className="shrink-0">\s*\{departureLabelText\}/);
});

test("channel descriptions collapse with the compact fixed-height panel header", () => {
  const description = read("src/components/channel/ChannelDescription.tsx");
  const globalCss = read("src/index.css");

  assert.match(
    globalCss,
    /@media \(max-height: 600px\) \{\s*\[data-slot="app-shell-root"\] \{\s*--shell-header-height:\s*48px;/,
  );
  assert.match(
    description,
    /line-clamp-2[^"\n]*\[@media\(max-height:600px\)\]:line-clamp-1/,
  );
});

test("short windows keep the tab icon: it carries the selected sticker", () => {
  const mainLayout = read("src/components/layout/MainLayout.tsx");
  // task #93 / #707 hid tab icons below 600px height while a Brutal item kept
  // its label and its yellow cell. Raft DS › TabBar marks the selected tab by
  // the sticker around its icon, so the icon must stay at every height.
  assert.match(mainLayout, /<MobileNavItem[\s\S]*?<tab\.icon \/>[\s\S]*?<MobileNavLabel>/);
  assert.doesNotMatch(mainLayout, /<tab\.icon className="[^"]*max-height:600px[^"]*:hidden/);
});
