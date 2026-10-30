import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");

const avatarSlotSource = readFileSync(resolve(repoRoot, "src/components/ui/AvatarSlot.tsx"), "utf8");
const gravatarAvatarSource = readFileSync(resolve(repoRoot, "src/components/member/GravatarAvatar.tsx"), "utf8");
const settingsPanelSource = readFileSync(resolve(repoRoot, "src/components/settings/SettingsPanel.tsx"), "utf8");
const serverSwitcherSource = readFileSync(resolve(repoRoot, "src/components/ui/ServerSwitcherMenu.tsx"), "utf8");
const messageInputSource = readFileSync(resolve(repoRoot, "src/components/message/MessageInput.tsx"), "utf8");
const messageItemSource = readFileSync(resolve(repoRoot, "src/components/message/MessageItem.tsx"), "utf8");
const chatPanelSource = readFileSync(resolve(repoRoot, "src/components/message/ChatPanel.tsx"), "utf8");
const hoverToolbarSource = readFileSync(resolve(repoRoot, "src/components/message/MessageHoverToolbar.tsx"), "utf8");
const agentDetailSource = readFileSync(resolve(repoRoot, "src/components/agent/AgentDetailPanel.tsx"), "utf8");
const quotedMessageCardSource = readFileSync(resolve(repoRoot, "src/components/ui/cards/QuotedMessageCard.tsx"), "utf8");
const searchPageSource = readFileSync(resolve(repoRoot, "src/components/search/MessageSearchPage.tsx"), "utf8");
const paletteAuditSource = readFileSync(resolve(repoRoot, "src/pages/PaletteAuditPage.tsx"), "utf8");
const pixelAvatarSource = readFileSync(resolve(repoRoot, "src/components/agent/PixelAvatar.tsx"), "utf8");
const sidebarSource = readFileSync(resolve(repoRoot, "src/components/layout/Sidebar.tsx"), "utf8");
const channelMemberListSource = readFileSync(resolve(repoRoot, "src/components/channel/ChannelMemberList.tsx"), "utf8");

test("AvatarSlot uses RUI identity frames and real images fill the themed content", () => {
  assert.match(avatarSlotSource, /<Avatar\s/);
  assert.match(avatarSlotSource, /type=\{type === "agent" \? "agent" : "human"\}/);
  assert.match(avatarSlotSource, /<AvatarFallback className=\{`relative overflow-hidden [^\n]+\n\s*\{content\}\s*<\/AvatarFallback>/);
  assert.doesNotMatch(avatarSlotSource, /const baseClass|const humanBase/);

  // Fill invariant — real images must cover the bg edge-to-edge or the role
  // tint leaks around the image (the regression stdrc filed in #1873; this
  // test pins both sides so neither rule can silently drop again).
  assert.match(
    avatarSlotSource,
    /<AgentAvatar avatarUrl=\{agentAvatarUrl \?\? null\} \/>/,
    "AvatarSlot mounts the agent leaf with no size or fill override of its own",
  );
  assert.match(
    pixelAvatarSource,
    /className=\{`size-full shrink-0 \$\{className\}`\.trim\(\)\}/,
    "pixel agent avatars fill the full frame edge-to-edge so role bg never leaks",
  );
  assert.match(
    pixelAvatarSource,
    /className="size-full shrink-0 object-cover"/,
    "uploaded agent avatars fill the full frame edge-to-edge so role bg never leaks",
  );
  assert.doesNotMatch(
    pixelAvatarSource,
    /width: size|height: size/,
    "agent avatar leaves set no fixed inline box for callers to fight",
  );
  assert.match(
    gravatarAvatarSource,
    /gravatarLoaded\s*\?\s*"absolute inset-0 h-full w-full object-cover"/,
    "human Gravatar images should fill the full frame edge-to-edge so role bg never leaks",
  );
  assert.match(
    gravatarAvatarSource,
    /: "absolute inset-0 h-full w-full object-cover opacity-0 pointer-events-none"/,
    "pending human Gravatar probes should stay mounted and full-frame instead of display:none",
  );
});

test("the message row avatar opts out of the forced frame so the rui recipe owns size", () => {
  // The message row used the panel-header context, whose `!size-9 !border-2`
  // (!important) beat rui's own `messageItem.avatarSlot` recipe — the img
  // stayed 32 in a 36 frame, and narrow-elegant overflowed 4px because
  // `!size-9` also beat the `max-md` 32-slot/24-avatar tier. No context forces
  // a box now: each maps to a raft-ui size and the recipes own the rest.
  assert.match(avatarSlotSource, /"message-row": "md",/);
  assert.doesNotMatch(
    avatarSlotSource,
    /(?:^|[\s"'`])!(?:size|h|w|border|shadow)-/m,
    "AvatarSlot forces no !important box, edge or shadow onto raft-ui's Avatar",
  );
  assert.match(avatarSlotSource, /export type AvatarContext = keyof typeof CONTEXT_SIZE;/);
  assert.equal(
    (messageItemSource.match(/context="message-row"/g) ?? []).length,
    2,
    "both message sender avatar call sites use the message-row context",
  );
  assert.equal(
    (messageItemSource.match(/context="panel-header"/g) ?? []).length,
    0,
    "the message sender avatar must not force the panel-header frame again",
  );
});

test("the message list leaves the avatar's left edge to the rui recipe", () => {
  // raft-ui 0.5.36 owns the alignment: header icon and message avatar at 20
  // from the panel edge, title and message text at 68, in both themes
  // (cindyz, 2026-10-09). The two per-theme levers slock used to carry on its
  // message callsites fought that and put the Elegant avatar back at 36, so
  // they must not come back.
  assert.doesNotMatch(chatPanelSource, /\[data-theme=elegant\]_&\]:px-\[/, "no elegant padding lever on message rows");
  assert.doesNotMatch(chatPanelSource, /\[data-theme=brutal\]_&\]:mx-/, "no brutal margin lever on message rows");
});

test("the hover toolbar's placement belongs to the rui recipe", () => {
  // The Raft DS toolbar rides the row's top edge at the recipe's own inset
  // (rf-msgbar: -18px / right 12). The per-theme right-edge levers slock used
  // to carry fought that and must not come back; the call site keeps only the
  // hit-testing. The open picker shows the toolbar through the row's own
  // has-data-popup-open rule, so no opacity override fights the recipe.
  assert.match(hoverToolbarSource, /className="pointer-events-auto"/);
  assert.doesNotMatch(hoverToolbarSource, /opacity-100/);
  assert.doesNotMatch(hoverToolbarSource, /(?:^|[\s`"])(?:max-md:)?-?right-/);
  assert.doesNotMatch(hoverToolbarSource, /data-theme=brutal/);
});

test("known avatar surfaces do not reintroduce background-filled frames", () => {
  assert.doesNotMatch(
    settingsPanelSource,
    /bg-palette-lavender[\s\S]{0,160}<GravatarAvatar|<AgentAvatar avatarUrl="pixel:random:cindy-preview"/,
    "Settings account and Appearance preview avatars must not use hand-rolled background frames",
  );
  assert.match(
    settingsPanelSource,
    /<AvatarSlot context="profile-tile" type="human" humanAvatarUrl=\{user\?\.avatarUrl\} email=\{user\?\.email\} \/>/,
    "Settings account avatar should route through AvatarSlot",
  );
  assert.match(
    settingsPanelSource,
    /<AvatarSlot context="profile-tile" type="server" serverAvatarUrl=\{server\.avatarUrl\} serverInitial=\{serverInitial\}/,
    "Settings server profile avatar should route through AvatarSlot",
  );
  assert.match(
    serverSwitcherSource,
    /<AvatarSlot context="list-row" type="server" serverAvatarUrl=\{server\.avatarUrl\} serverInitial=\{initial\} \/>/,
    "Server switcher rows should route server avatars through the shared AvatarSlot list primitive",
  );
  assert.doesNotMatch(
    `${settingsPanelSource}\n${serverSwitcherSource}`,
    /server\.avatarUrl[\s\S]{0,120}<img|s\.avatarUrl[\s\S]{0,120}<img/,
    "server profile/switcher avatars must not use hand-rolled img frames",
  );
  assert.doesNotMatch(
    messageInputSource,
    /!bg-(?:palette|brutal)-(cyan|lavender)/,
    "muted mention avatars should not add role-colored background fills",
  );
  assert.doesNotMatch(
    `${messageItemSource}\n${agentDetailSource}`,
    /!bg-gray-300 grayscale/,
    "deactivated agent avatars should not add gray background fills",
  );
  assert.doesNotMatch(
    searchPageSource,
    /result\.type === "agentDm"[\s\S]*?bg-palette-cyan[\s\S]*?<Bot/,
    "search agent-DM fallbacks should use AvatarSlot instead of a cyan icon frame",
  );
  assert.doesNotMatch(
    paletteAuditSource,
    /avatar[\s\S]{0,200}bg-(?:palette|brutal)-(cyan|lavender)|bg-(?:palette|brutal)-(cyan|lavender)[\s\S]{0,200}avatar/,
    "palette avatar examples must document the no-fill AvatarSlot shape",
  );
});

test("compact quoted-message avatars route through AvatarSlot", () => {
  assert.match(
    quotedMessageCardSource,
    /<AvatarSlot context="compact-list" type="agent" agentAvatarUrl=\{author\.avatar \?\? null\} \/>/,
    "agent quote-preview avatars should use the shared avatar primitive",
  );
  assert.match(
    quotedMessageCardSource,
    /<AvatarSlot context="compact-list" type="human" humanAvatarUrl=\{author\.avatar \?\? null\} gravatarHash=\{author\.gravatarHash \?\? null\} \/>/,
    "human quote-preview avatars should use the shared avatar primitive",
  );
});

test("agent pixel avatars expose a stable share-screenshot marker", () => {
  assert.match(
    pixelAvatarSource,
    /data-agent-pixel-avatar="true"/,
    "share capture must be able to find CSS-grid pixel avatars before rasterization",
  );
});

test("AvatarSlot removes the global badge-size override and lets raft-ui own placement", () => {
  // Named decision: #proj-uiux task #817 removes the global badge size map.
  assert.match(
    avatarSlotSource,
    // Raft Design System: the status light on an avatar is a square pixel, so
    // its wrapper takes the pixel radius (2px), not a circle.
    /<AvatarBadge render=\{<span \/>\} offset=\{badgeOffset\} className="flex rounded-\[2px\] \[&>span\]:h-full \[&>span\]:w-full">\s*\{badge\}\s*<\/AvatarBadge>/,
    "AvatarBadge must own a native positioning wrapper even when a custom badge drops injected props; a caller's corner goes through raft-ui's own offset, never a local class",
  );
  assert.doesNotMatch(
    avatarSlotSource,
    /RAFT_AVATAR_BADGE_SIZE|translate-x-1\/4|translate-y-1\/4/,
    "AvatarSlot must not restore the global badge size/placement override map",
  );
});

test("Sidebar list status dots use AvatarBadge-owned placement without changing Members modal rows", () => {
  assert.match(
    sidebarSource,
    /function SidebarAgentActivityBadge\(\{ agentId \}: \{ agentId: string \}\)[\s\S]*<AgentActivityDot[\s\S]*size="sm"[\s\S]*data-sidebar-avatar-badge="true"/,
    "chat DM and Members rail rows should keep the smaller activity-mapped status dot while AvatarBadge owns placement",
  );
  const sidebarBadgeSource = sidebarSource.match(
    /function SidebarAgentActivityBadge[\s\S]*?\n}\n/,
  )?.[0] ?? "";
  assert.doesNotMatch(
    sidebarBadgeSource,
    /\bpulse\b/,
    "sidebar presence dots are static in every state (task #136)",
  );
  assert.doesNotMatch(
    sidebarSource,
    /data-sidebar-avatar-badge-shell="true" className="(?![^"]*absolute bottom-0 right-0)[^"]*"/,
    "the scoped shell must anchor the visual dot to the avatar's bottom-right corner",
  );
  assert.match(
    sidebarSource,
    /context="sidebar-list"[\s\S]*badge=\{peerId \? <SidebarAgentActivityBadge agentId=\{peerId\} \/> : undefined\}/,
    "agent DM rows should use the scoped sidebar status badge",
  );
  assert.match(
    sidebarSource,
    /context="sidebar-list"[\s\S]*badge=\{<SidebarAgentActivityBadge agentId=\{agent\.id\} \/>\}/,
    "Members page agent rows should use the scoped sidebar status badge",
  );
  assert.doesNotMatch(
    channelMemberListSource,
    /SidebarAgentActivityBadge|<AgentActivityDot[^>]*size="sm"|data-sidebar-avatar-badge-shell/,
    "ChannelMemberList must not use the smaller sidebar-only status badge",
  );
  assert.match(
    channelMemberListSource,
    /function ChannelMemberActivityBadge\([\s\S]*<AgentActivityDot[\s\S]*size="md"[\s\S]*data-channel-member-avatar-badge-shell="true"/,
    "ChannelMemberList agent rows should pass the scoped (static) dot directly to AvatarBadge",
  );
  assert.doesNotMatch(
    channelMemberListSource,
    /data-channel-member-avatar-badge-shell="true" className="absolute bottom-0 right-0 block size-0"/,
    "AvatarBadge must own corner geometry instead of a nested zero-size wrapper",
  );
});

test("list contexts are named for where they are used and sit on the DS avatar steps", () => {
  // "list-row" = rows in a list (members, profile/computer lists, the
  // workspace switcher): the DS ListRow avatar, 35 (raft-ui md). "compact-row"
  // = dense rows (search results, forward targets): the DS small avatar, 27
  // (sm). The former first-caller names ("surface-list", "members-row") are
  // gone. Profiles are the DS xl hero, 99; Settings' own row is lg, 51.
  assert.match(avatarSlotSource, /"list-row": "md",/);
  assert.match(avatarSlotSource, /"compact-row": "sm",/);
  assert.match(avatarSlotSource, /"profile-hero": "xl",/);
  assert.match(avatarSlotSource, /"profile-tile": "lg",/);
  assert.match(avatarSlotSource, /"sidebar-list": "2xs",/);
  assert.match(avatarSlotSource, /"face-stack": "xs",/);
  assert.doesNotMatch(avatarSlotSource, /surface-list|members-row/);
  for (const caller of [searchPageSource, sidebarSource, channelMemberListSource, serverSwitcherSource]) {
    assert.doesNotMatch(caller, /context="(?:surface-list|members-row)"/);
  }
});

test("profile heroes take the DS xl hero size from the context, not a forced box or shadow", () => {
  // DS Avatar: agent and human profiles and the onboarding hero are xl 99,
  // whose recipe carries the hard shadow and, in dark, the die-cut ring. A
  // forced size or `shadow-sticker` (which tailwind-merge swaps for the
  // recipe's shadow, dropping the ring) must not come back.
  const heroSources = {
    agentDetail: agentDetailSource,
    humanDetail: readFileSync(resolve(repoRoot, "src/components/member/HumanDetailPanel.tsx"), "utf8"),
    externalDetail: readFileSync(resolve(repoRoot, "src/components/profile/ExternalIdentityDetailPanel.tsx"), "utf8"),
    handoff: readFileSync(resolve(repoRoot, "src/components/onboarding/ServerSetupHandoffStep.tsx"), "utf8"),
    createAgent: readFileSync(resolve(repoRoot, "src/components/agent/CreateAgentDialog.tsx"), "utf8"),
  };
  for (const [name, source] of Object.entries(heroSources)) {
    assert.match(source, /context="profile-hero"/, `${name} uses the hero context`);
    assert.doesNotMatch(source, /context="profile-tile"/, `${name} has no off-scale profile tile`);
    assert.doesNotMatch(source, /<AvatarSlot[^>]*(?:!size-|shadow-sticker)/, `${name} adds no size or shadow to the hero`);
  }
});

test("every avatar-edit veil is the shared AvatarEditVeil, shown on keyboard focus too", () => {
  const veilSource = readFileSync(resolve(repoRoot, "src/components/ui/AvatarEditVeil.tsx"), "utf8");
  assert.match(veilSource, /group-hover\/avatar-edit:opacity-100/);
  assert.match(veilSource, /group-focus-visible\/avatar-edit:opacity-100/);
  assert.match(veilSource, /peer-focus-visible\/avatar-edit:opacity-100/, "a file input before it in a label trigger shows it too");
  assert.doesNotMatch(veilSource, /group-has-/, "no ancestor :has() styling a descendant");
  assert.match(veilSource, /bg-layer-backdrop/);
  const humanDetailSource = readFileSync(resolve(repoRoot, "src/components/member/HumanDetailPanel.tsx"), "utf8");
  assert.match(agentDetailSource, /<AvatarEditVeil icon=\{Pencil\} \/>/);
  assert.match(agentDetailSource, /const PROFILE_AVATAR_BUTTON_CLASS = "group\/avatar-edit relative /);
  assert.match(humanDetailSource, /className="group\/avatar-edit relative [^"]*"[\s\S]*?<AvatarEditVeil busy=\{avatarSaving\} \/>/);
  const settingsSource = readFileSync(resolve(repoRoot, "src/components/settings/SettingsPanel.tsx"), "utf8");
  // Both Settings uploaders: the focusable file input comes first as the veil's peer.
  assert.equal(settingsSource.match(/className="peer\/avatar-edit sr-only"[\s\S]*?<AvatarEditVeil busy=\{avatarSaving\} \/>/g)?.length, 2);
  for (const source of [agentDetailSource, humanDetailSource, settingsSource]) {
    assert.doesNotMatch(source, /absolute inset-0 flex items-center justify-center rounded-sticker bg-layer-/, "no hand-built veil");
  }
});
