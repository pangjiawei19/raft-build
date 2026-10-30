import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

test("theme sweep keeps confirmation and drawer copy on semantic tokens", () => {
  const confirm = source("src/components/ConfirmDialog.tsx");
  const channel = source("src/components/channel/EditChannelDialog.tsx");
  const overflow = source("src/components/ui/OverflowSheet.tsx");
  const channelOverflow = source("src/components/channel/ChannelOverflowMenu.tsx");
  const markdown = source("src/components/markdown/MarkdownContent.tsx");

  assert.match(confirm, /data-slot="confirm-dialog-content"/);
  assert.match(confirm, /text-foreground-muted/);
  assert.doesNotMatch(confirm, /text-black\/75/);
  // Raft DS Sheet: the channel-settings drawer leaves its surface to raft-ui's
  // drawer recipe and writes its copy in ink tokens — no theme-scoped brutal
  // chrome, no yellow header wash.
  for (const drawer of [channel]) {
    assert.doesNotMatch(drawer, /theme-brutal:/);
    assert.doesNotMatch(drawer, /bg-palette-yellow|text-black/);
    assert.match(drawer, /<DrawerTitle id="channel-settings-title"/);
    // Its sections are raft-ui FormSections (the DS sheet section heading).
    assert.match(drawer, /<FormSection\b/);
    assert.doesNotMatch(drawer, /SECTION_HEADING_CLASS/);
    assert.match(drawer, /text-foreground-hint/);
  }
  // The shared overflow drawer shell is the same DS drawer: raft-ui owns the
  // surface, the head is white paper with a seam (yellow stays on the frame),
  // and the copy is ink tokens.
  assert.doesNotMatch(overflow, /theme-brutal:/);
  assert.doesNotMatch(overflow, /bg-palette-yellow|text-black/);
  assert.match(overflow, /<DrawerHeader\b/);
  assert.match(overflow, /text-foreground-hint/);
  assert.match(channelOverflow, /<Badge[\s\S]{0,240}?data-testid="channel-overflow-visibility-badge"/);
  assert.doesNotMatch(channelOverflow, /bg-palette-lime/);
  // DS drawer section heading (13/18 700 ink-2) with its count line in ink-3.
  assert.match(channelOverflow, /<SectionEyebrow\s+tone="muted"[^>]*data-testid="channel-overflow-members-heading"/);
  assert.match(channelOverflow, /text-foreground-hint[^<]*[\s\S]*?membersSummary/);
  // The add tile is the DS empty identity: a dashed square with a plus.
  assert.match(channelOverflow, /border-dashed[^\n]*\n\s+data-testid="channel-overflow-members-add-tile"[\s\S]*?<Plus /);
  // DS quote: a 2px seam bar and ink-2 text, no italic.
  assert.match(markdown, /"border-l-2 border-line-seam pl-2\.5 text-foreground-muted"/);
  assert.doesNotMatch(markdown, /border-black\/40 pl-3 italic text-black\/70"/);
});

test("theme sweep keeps account, notification and billing actions semantic", () => {
  const settings = source("src/components/settings/SettingsPanel.tsx");
  // The plan/billing body moved to its own file (task #709 one-component-per-file).
  const planSection = source("src/components/settings/PlanSectionContent.tsx");
  // Raft DS: the profile form's Save is the pink primary (disabled until the
  // form is dirty); status labels are soft chips with a fixed meaning, never
  // ALL CAPS; the seat meter is the raft-ui Progress, cyan, orange near the cap.
  assert.match(settings, /disabled=\{!profileDirty \|\| saving\}\s*size="sm"\s*variant="accent"[\s\S]*?settings\.account\.saveProfile/);
  assert.match(settings, /<Badge variant="success" appearance="soft"/);
  assert.match(settings, /<Badge appearance="soft" variant=\{statusTone\}>\s*\{statusLabel\}/);
  assert.doesNotMatch(settings, /<Badge[^>]*\buppercase\b/);
  assert.doesNotMatch(settings, /inline-flex shrink-0 border-2 border-line-strong bg-fill-muted/);
  assert.match(settings, /variant="outline"[\s\S]*settings\.notifications\.enabling/);
  assert.match(planSection, /variant="outline"[\s\S]*billing\.seeAllFeaturesAndComparePlans/);
  assert.match(planSection, /variant=\{seatUsageNearLimit \? "warning" : "information"\}/);
});

test("theme sweep keeps mobile links, billing summary, and search entity badges on RUI recipes", () => {
  const settings = source("src/components/settings/SettingsPanel.tsx");
  // The billing summary card lives in PlanSectionContent since task #709.
  const planSection = source("src/components/settings/PlanSectionContent.tsx");
  const search = source("src/components/search/MessageSearchPage.tsx");
  // The search result rows live in their own files since task #709.
  const searchRows = [
    source("src/components/search/EntityResultRow.tsx"),
    source("src/components/search/MessageHitRow.tsx"),
    source("src/components/search/SearchHomeEntityRow.tsx"),
  ];

  assert.match(settings, /render=\{\([\s\S]*mobileDownloadUrl\("android"\)[\s\S]*data-testid="mobile-download-android"/);
  assert.match(settings, /render=\{\([\s\S]*mobileDownloadUrl\("ios"\)[\s\S]*data-testid="mobile-download-ios"/);
  // The summary is a plain DS card (surface + hairline), not a form option.
  assert.match(planSection, /<Card\s+data-testid="billing-summary-card"/);
  assert.doesNotMatch(settings, /data-testid="mobile-download-(?:android|ios)"[\s\S]*btn-brutal-sm/);
  for (const searchSource of [search, ...searchRows]) {
    assert.doesNotMatch(searchSource, /ARCHIVED_CHANNEL_BADGE_CLASS/);
    assert.doesNotMatch(searchSource, /variant="muted" appearance="outline"/);
  }
});

test("theme sweep keeps task status and profile resize readable", () => {
  const status = source("src/components/task/StatusBadge.tsx");
  const tasks = source("src/components/task/TasksPanel.tsx");
  const statusUi = source("src/components/task/taskStatusUi.ts");
  const profile = source("src/components/profile/ProfilePanel.tsx");
  const agent = source("src/components/agent/AgentDetailPanel.tsx");
  // Task status appearance is raft-ui's single source now: StatusBadge renders
  // rui's TaskStatusBadge, and slock's taskStatusUi no longer holds any colour
  // (the old per-theme classes moved into raft-ui's task-status tokens).
  assert.match(status, /TaskStatusBadge/);
  assert.doesNotMatch(statusUi, /bg-(?:palette|brutal)-|dark:bg-.*-soft/);
  assert.match(tasks, /<TaskSectionBadge status=\{ruiStatus\}/);
  assert.match(tasks, /variant="outline"[\s\S]*task\.board\.newTask/);
  assert.match(profile, /flex: "0 0 auto"/);
  // Raft DS: the profile's secondary actions are ink-outline buttons, ink text.
  assert.match(agent, /variant="outline"[\s\S]*text-foreground\b/);
  assert.doesNotMatch(agent, /theme-brutal:|text-foreground-strong/);
});

test("theme sweep keeps feedback, agent channel rows, and dark sidebar active readable", () => {
  const indexCss = source("src/index.css");
  const sidebar = source("src/components/layout/Sidebar.tsx");
  const feedback = source("src/components/settings/AboutFeedbackDialog.tsx");
  const agent = source("src/components/agent/AgentDetailPanel.tsx");

  // The feedback SDK still takes a style prop; every feedback host passes the
  // one shared constant, and no family constant survives on the app side.
  const feedbackSdkTheme = source("src/feedback/feedbackSdkTheme.ts");
  assert.match(feedbackSdkTheme, /export const FEEDBACK_SDK_THEME = "raft" as string as FeedbackTheme;/);
  assert.doesNotMatch(feedbackSdkTheme, /FEEDBACK_THEME_FAMILY/);
  assert.match(feedback, /import \{ FEEDBACK_SDK_THEME \} from "\.\.\/\.\.\/feedback\/feedbackSdkTheme";/);
  assert.match(feedback, /theme=\{FEEDBACK_SDK_THEME\}/);
  assert.match(source("src/feedback/standalone/main.tsx"), /theme=\{FEEDBACK_SDK_THEME\}/);
  assert.doesNotMatch(feedback, /useThemeFamily/);
  // One family (raft): the profile hero needs no per-theme min-height.
  assert.doesNotMatch(agent, /theme-brutal:min-h-/);
  assert.match(sidebar, /SidebarRoot/);
  assert.match(sidebar, /active=\{selected\}/);
  assert.doesNotMatch(indexCss, /Legacy composition bridge/);
});

test("theme sweep closes the remaining dialog and fallback contrast leaks", () => {
  const members = [
    source("src/components/agent/ChannelMembers.tsx"),
    source("src/components/agent/MemberRoleActions.tsx"),
  ].join("\n");
  const avatar = source("src/components/ui/AvatarSlot.tsx");
  const stableField = source("src/components/agent/StableField.tsx");
  const reset = source("src/components/agent/ResetAgentDialog.tsx");
  const create = source("src/components/agent/CreateAgentDialog.tsx");
  const formField = source("src/components/ui/FormField.tsx");

  // The member search field is raft-ui's InputGroup (DS Search: the card
  // surface inside the ink line, on semantic tokens), so dark mode follows.
  for (const memberSource of [members]) {
    assert.match(memberSource, /<InputGroup>\s*<InputGroupAddon align="inline-start">\s*<Search aria-hidden="true" \/>/);
  }
  assert.doesNotMatch(source("src/index.css"), /\.input-member-search/);
  // Raft DS: Confirm-add is the screen's one pink primary, through the Button
  // variant, not a className override.
  assert.match(members, /variant="primary"\s*className="w-full"\s*data-testid="add-member-confirm"/);
  // Selected chips are neutral; a failed one turns orange-soft (a problem).
  assert.match(members, /appearance="soft"\s*variant=\{failedNow \? "warning" : "default"\}/);
  assert.match(members, /data-member-failure="true"/);
  assert.match(members, /aria-describedby=\{failedKeys\.has\(key\) \?/);
  // Add Member is rendered as a full-height page inside the overflow drawer.
  // Its surfaces stay on Raft DS semantic layers (card list, paper header with a
  // seam, paper page), so no white/yellow/black leaks into dark mode.
  assert.match(members, /<Card\s+\/\/ Column: the candidates scroll/);
  assert.doesNotMatch(members, /rounded-container border border-line-hairline bg-layer-card/);
  // The page head is raft-ui's PanelHeader (paper with a seam under it).
  assert.match(members, /<PanelHeader>/);
  assert.match(members, /flex-col bg-layer-canvas text-foreground`/);
  assert.doesNotMatch(members, /theme-brutal:|bg-palette-yellow|text-foreground-strong/);
  // A workspace tile is the DS ink square with yellow initials, in both modes.
  assert.match(avatar, /bg-sticker-ink text-brand/);
  assert.doesNotMatch(avatar, /theme-brutal:/);
  assert.match(stableField, /LabelAsterisk className="ml-1" \/>/);
  assert.doesNotMatch(stableField, /theme-brutal:/);
  // `bg-info-soft` used to be pinned here because the reset mode picker tinted
  // its SELECTED option, and that tint had to be a semantic token rather than a
  // brutal colour. Task #660 (@Artea) replaced the three hand-rolled <button>s
  // with rui's RadioGroup, so there is no tint left to leak -- the guard is
  // re-anchored to the mechanism that makes a tint unnecessary, not dropped.
  // Re-introducing a hand-rolled picker turns this red again.
  assert.match(reset, /<RadioGroup\b/);
  assert.doesNotMatch(reset, /bg-(?:info|warning|danger)-soft/);
  assert.doesNotMatch(reset, /border-2 p-4/);
  // Raft DS Dialog: restart and session reset interrupt but recover (orange
  // `warning`); a full reset loses the workspace (red `danger`). Each variant is
  // correct by itself — no per-call colour override (@Artea, task #660).
  assert.match(reset, /const confirmVariant = mode === "full" \? "danger" : "warning";/);
  assert.doesNotMatch(reset, /confirmClassName=/, "no per-call colour override on the confirm button");
  assert.match(create, /max-w-\[calc\(100vw-1rem\)\][\s\S]*?md:max-w-\[960px\]/);
  assert.match(formField, /LabelAsterisk/);
  assert.doesNotMatch(formField, /text-palette-pink/);
});

test("dark elegant sidebar selector is bound to real product rows", () => {
  const sidebar = source("src/components/layout/Sidebar.tsx");
  assert.match(sidebar, /data-slot="sidebar-item"/);
  assert.match(sidebar, /active=\{selected\}/);
  assert.match(sidebar, /selected=\{isAgentSelected\(agent\.id\)\}/);
  assert.match(sidebar, /selected=\{isHumanSelected\(human\.userId\)\}/);
  assert.match(sidebar, /active=\{selected\}/);
});

test("profile and member surfaces preserve layout while using theme-aware chrome", () => {
  const profile = source("src/components/agent/AgentDetailPanel.tsx");
  const resize = source("src/components/profile/ProfilePanel.tsx");
  const members = source("src/components/channel/ChannelMemberList.tsx");
  const nestedMembers = [
    source("src/components/agent/ChannelMembers.tsx"),
    source("src/components/agent/MemberRoleActions.tsx"),
  ].join("\n");

  // The agent tab row's overflow (scroll, wheel, edge fade, selected tab in
  // view) is raft-ui's TabsList now; the panel adds no scroll classes.
  assert.doesNotMatch(profile, /overflow-x-auto overflow-y-hidden scrollbar-none/);
  // The hero avatar is its own trigger: no control frame around the sticker
  // (the named group scopes its AvatarEditVeil).
  assert.match(profile, /const PROFILE_AVATAR_BUTTON_CLASS = "group\/avatar-edit relative shrink-0 rounded-sticker outline-none focus-visible:shadow-focus";/);
  // The divider moved off the resize handle onto the pane box (task #683); its
  // theme-aware colours are pinned in panelSplitDividerTheme.contract.test.ts.
  assert.match(resize, /const RESIZE_HANDLE_CLASS_NAME = "[^"]*cursor-col-resize[^"]*"/);
  assert.doesNotMatch(resize, /cursor-col-resize[^"]*border-l/);
  // DS ListRow member rows: ink title, ink-3 role line, pressed-overlay hover,
  // and no theme-scoped brutal chrome left behind.
  assert.match(members, /text-foreground\b/);
  assert.match(members, /text-foreground-hint/);
  assert.match(members, /hover:bg-fill-pressed/);
  assert.doesNotMatch(members, /theme-brutal:/);
  assert.match(nestedMembers, /AvatarSlot[\s\S]*badge=\{/);
});

test("message and task projections do not leak light-only black-on-white chrome", () => {
  const task = source("src/components/task/TaskCard.tsx");
  const taskHead = source("src/components/task/TaskModalHead.tsx");

  assert.match(task, /TaskCard/);
  assert.match(taskHead, /text-foreground-muted/);
  assert.doesNotMatch(taskHead, /text-black\/70/);
});

test("sidebar mute marker is non-wrapping and avatar status uses the badge primitive", () => {
  const sidebar = source("src/components/layout/Sidebar.tsx");
  assert.match(sidebar, /data-sidebar-avatar-badge="true"/);
  assert.match(sidebar, /SidebarItemMetaIcon\s+className="shrink-0"/);
  assert.doesNotMatch(sidebar, /data-sidebar-avatar-badge-shell/);
});

test("manual translation remains wired to the shared context menu action", () => {
  const message = source("src/components/message/MessageItem.tsx");
  assert.match(message, /showManualTranslationAction/);
  assert.match(message, /data-testid=\{`message-translate-menu-item-\$\{message\.id\}`\}/);
  assert.match(message, /onClick=\{handleManualTranslate\}/);
});

test("dark elegant popovers and accent submits keep readable foregrounds", () => {
  const switcher = source("src/components/ui/ServerSwitcherMenu.tsx");
  const composer = source("src/components/message/MessageInput.tsx");
  const autocompleteOptionRow = source("src/components/message/AutocompleteOptionRow.tsx");
  const createAgent = source("src/components/agent/CreateAgentDialog.tsx");
  const createTask = source("src/components/task/CreateTaskDialog.tsx");

  // The workspace list reads in ink tokens on the popover in both modes.
  assert.match(switcher, /text-callout font-medium text-foreground/);
  assert.match(switcher, /font-mono text-mono-meta font-normal text-foreground-hint/);
  assert.doesNotMatch(switcher, /theme-brutal:|text-black/);
  assert.match(composer, /ComposerSuggestionList[\s\S]*?data-testid="mention-autocomplete-popover"[\s\S]*?AutocompleteOptionRow/);
  // The option rows are extracted (task #709 react-perf): the row component owns
  // the ComposerSuggestionOption element and the per-item select closure, and
  // lives in its own file.
  assert.match(autocompleteOptionRow, /function AutocompleteOptionRow[\s\S]*?ComposerSuggestionOption/);
  assert.match(composer, /ComposerSuggestionList[\s\S]*?data-testid="mention-autocomplete-popover"[\s\S]*?ComposerSuggestionTitle/);
  assert.match(composer, /ComposerSuggestionTitle className="max-w-\[12rem\] flex-\[0_1_auto\]"/);
  assert.doesNotMatch(composer, /ComposerSuggestionTitle className="[^"]*(?:min-w-\[7\.5rem\]|flex-\[1_1_12rem\])/);
  assert.match(composer, /ComposerSuggestionList[\s\S]*?data-testid="mention-autocomplete-popover"[\s\S]*?ComposerSuggestionMeta/);
  assert.match(composer, /ComposerSuggestionList[\s\S]*?data-testid="mention-autocomplete-popover"[\s\S]*?ComposerSuggestionAside/);
  assert.match(composer, /ComposerSuggestionMeta variant="code" className="max-w-\[7rem\] truncate"/);
  assert.match(composer, /ComposerSuggestionList[\s\S]*?data-testid="channel-autocomplete-popover"[\s\S]*?ComposerSuggestionTitle/);
  assert.match(composer, /data-testid="channel-autocomplete-popover"[\s\S]*?ComposerSuggestionMeta>{ch\.description}/);
  // The raft Banner draws its own warning wash in both modes; no dark: overrides.
  assert.doesNotMatch(createAgent, /dark:(?:bg-warning-soft|!?text-warning-strong)/);
  // rui accent buttons own their text colour; a dark-mode override here put
  // near-black text on the soft pink Elegant Dark fill (task #733).
  assert.doesNotMatch(createAgent, /text-foreground-inverse/);
  assert.match(createTask, /<Button[\s\S]*?variant="accent"/);
});

test("page-level consumers expose the RUI semantic ladder in every major surface", () => {
  const indexCss = source("src/index.css");
  const roots = [
    source("src/components/layout/MainLayout.tsx"),
    source("src/components/layout/LeftRail.tsx"),
    source("src/components/layout/Sidebar.tsx"),
    source("src/components/message/ChatPanel.tsx"),
    source("src/components/message/ThreadPanel.tsx"),
    source("src/components/message/ChannelFilesPanel.tsx"),
    source("src/components/search/MessageSearchPage.tsx"),
    source("src/components/thread/ThreadsInbox.tsx"),
    source("src/components/task/TasksPanel.tsx"),
    source("src/components/settings/SettingsPanel.tsx"),
  ];

  assert.match(indexCss, /@import "@botiverse\/raft-ui\/styles\.css"/);
  assert.doesNotMatch(indexCss, /Legacy composition bridge/);

  assert.match(roots[1], /AppRailRoot/);
  assert.match(roots[2], /Sidebar/);
  assert.match(roots[3], /ConversationPanelRoot/);
  assert.match(roots[4], /ThreadPanelRoot/);
  assert.match(roots[5], /FilesPanel/);
  assert.match(roots[6], /MessageSearchPage/);
  assert.match(roots[7], /ActivityInboxPanel/);
  assert.match(roots[8], /TasksPanelRoot/);
  assert.match(roots[9], /Panel/);
  assert.match(roots[0], /AppShellRoot/);
});

test("Activity shell draws its dividers as DS seams, with no per-route override", () => {
  const mainLayout = source("src/components/layout/MainLayout.tsx");
  const leftRail = source("src/components/layout/LeftRail.tsx");
  const threadsInbox = source("src/components/thread/ThreadsInbox.tsx");

  // One family: the rail's edge and the master/detail divider are the same
  // 1px seam on every route, so the old brutal thin-divider switch is gone.
  assert.doesNotMatch(leftRail, /thinDivider|theme-brutal:/);
  assert.doesNotMatch(mainLayout, /thinDivider=/);
  // Raft DS: one seam between two regions. The Activity column sits beside
  // the rail (or the sidebar), whose own seam is the line, so its panel is
  // inset and draws no seam of its own (two 1px seams side by side read as
  // 2px).
  assert.match(threadsInbox, /<ActivityInboxPanel edge="inset">/);
  assert.match(mainLayout, /const masterDetailShellClassName = searchMasterDetail\s*\?\s*"flex flex-col border-r border-line-seam"/);
});

test("tooltips preserve the shared content and arrow palette", () => {
  const tooltip = source("src/components/ui/Tooltip.tsx");
  // contentProps still flows through the single shared content element.
  assert.match(tooltip, /<TooltipContent \{\.\.\.contentProps\}[^>]*>\{content\}<\/TooltipContent>/);
  // An open bubble must never swallow hover/clicks aimed at what it covers
  // (header action rows, sidebar rows). Inert content moved upstream
  // (RUI 0.5.13 / rui #289), so the wrapper must stay a pure pass-through;
  // the web-side guard is the portal-layer rule pinned below:
  assert.doesNotMatch(tooltip, /pointer-events-none/, "the wrapper must not re-add overrides RUI already ships");
  assert.match(
    source("src/index.css"),
    /\[data-slot="tooltip-portal"\][\s\S]{0,120}?pointer-events:\s*none/,
    "the tooltip portal/positioner layer must stay pointer-events-none",
  );
  for (const path of [
    "layout/LeftRail", "layout/NotificationTrigger", "agent/AgentProfileOverflowMenu",
    "window/ThreadWindowRoute", "task/LegacyTaskPanel", "message/attachmentTooltip",
    "agent/AgentMcpTab", "agent/McpServerListItem",
  ]) {
    const caller = source(`src/components/${path}.tsx`);
    assert.doesNotMatch(caller, /contentProps=\{\{[^}]*className: "[^"]*(?:bg-white|bg-layer-canvas)/,
      `${path} must not replace only the content background while leaving the arrow on another recipe`);
  }
  assert.doesNotMatch(source("src/components/mermaid/mermaid.css"), /\.r-mermaid-tooltip\s*\{[^}]*background:/);
});

test("thread footer reserves the available row width for its composer", () => {
  assert.match(source("src/components/message/ThreadPanel.tsx"), /<ThreadPanelFooter[\s\S]*?<div className=\{`\$\{threadChromeLayerClassName\} min-w-0 w-full flex-1`\}/);
  assert.match(source("src/components/message/MessageInput.tsx"), /<ComposerRoot[\s\S]*?min-w-0 w-full/);
});


test("Saved navigation delegates inactive and active chrome to the same SidebarItem as channels", () => {
  const sidebar = source("src/components/layout/Sidebar.tsx");
  // Desktop: the yellow "you are here" row while /saved is open. Phone: a
  // ListRow entry that is never yellow (the phone has no "you are here" in lists).
  assert.match(sidebar, /\{\/\* Saved[\s\S]*?<SidebarItem[\s\S]*?active=\{!mobileInline && location\.pathname\.endsWith\("\/saved"\)\}[\s\S]*?sidebarItemClass[\s\S]*?data-testid="sidebar-saved-entry"/);
});

test("Members Graph navigation keeps its icon and label in the shared row primitive", () => {
  const sidebar = source("src/components/layout/Sidebar.tsx");
  assert.match(
    sidebar,
    /<SidebarItem[\s\S]*?active=\{location\.pathname === `\$\{pathBase\}\/members\/graph`\}[\s\S]*?<SidebarItemIcon><GitBranch \/><\/SidebarItemIcon>[\s\S]*?layout\.sidebar\.graph[\s\S]*?<\/SidebarItem>/,
  );
});

test("auth and onboarding surfaces ride the RUI recipes instead of hardcoded brutal chrome", () => {
  const shell = source("src/components/brand/AuthBrandShell.tsx");
  const onboardingShell = source("src/components/auth/OnboardingCreateShell.tsx");
  const login = source("src/components/auth/LoginPage.tsx");
  const register = source("src/components/auth/RegisterPage.tsx");
  const selector = [
    source("src/components/auth/ServerSelector.tsx"),
    source("src/components/auth/ServerOptionCard.tsx"),
  ].join("\n");
  const openGuide = source("src/components/auth/OpenInBrowserSignInGuide.tsx");

  // The shell keeps the brand bar but the surfaces themselves ride layer tokens.
  assert.match(shell, /AUTH_BRAND_SHELL_CLASS =[\s\S]*?bg-layer-canvas/);
  // The brand bar is the DS frame (yellow in light, neutral in dark).
  assert.match(shell, /AUTH_BRAND_TOP_BAR_CLASS =[\s\S]*?bg-layer-frame/);
  assert.doesNotMatch(shell, /bg-white font-display/);
  assert.match(onboardingShell, /bg-layer-canvas/);

  // Credential fields are the RUI Input primitive (theme owns border/radius/
  // invalid treatment); a raw input with brutal classes here is the regression.
  assert.match(login, /<Input[\s\S]*?id="login-email"/);
  assert.match(register, /<Input/);
  assert.doesNotMatch(login, /border-2 border-black p-2 text-base shadow-brutal-sm/);
  assert.doesNotMatch(register, /border-2 border-black p-2 text-base shadow-brutal-sm/);

  // Server rows are raft-ui ListRows in a ListRowGroup (DS ListRow in an inset
  // list): the whole row is the button, and the part lays the pressed wash on
  // hover and press; not the static form-choice `option` card, which has no
  // hover, and no hand-rolled press wash.
  assert.match(selector, /<ListRowGroup\b[\s\S]*?server-selector-list/);
  assert.match(selector, /<ListRow\b[\s\S]*?server-selector-option/);
  assert.doesNotMatch(selector, /press-overlay/);
  assert.doesNotMatch(selector, /variant="option"/);
  assert.doesNotMatch(selector, /border-2 border-black bg-white p-3 text-left font-bold shadow-brutal-sm/);
  assert.doesNotMatch(selector, /className="input-brutal/);

  // The first-server intro copy rides the surface tokens; the old hardcoded
  // `text-black*` values rendered black-on-dark in Elegant Dark (task #686).
  // Raft DS: Space Mono step label, a display title, an ink-2 paragraph.
  assert.match(selector, /className="font-mono text-mono-meta text-foreground-hint"/);
  assert.match(selector, /className="mt-2 text-title text-foreground sm:text-display"/);
  assert.match(selector, /className="mt-3 text-subhead text-foreground-muted"/);
  assert.doesNotMatch(selector, /text-black|uppercase|tracking-\[/);

  // The embedded-browser guide's link keeps an accessible name even though the
  // RUI Button renders the label into its content slot.
  assert.match(openGuide, /render=\{<a[^>]*aria-label=/);
});
