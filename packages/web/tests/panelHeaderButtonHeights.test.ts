import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");

test("thread panel header close is the raft-ui PanelAction head icon button", () => {
  const source = readFileSync(
    resolve(repoRoot, "src/components/message/ThreadPanel.tsx"),
    "utf8",
  );


  // X close button: visible in modal (centered dialog), hidden in
  // mobile-modal (full-screen, back chevron), and `hidden lg:flex` in side
  // (msg=804c045d clarification). The class carries visibility only: the
  // size is raft-ui's PanelAction (44 on a phone, the DS small 32 on
  // desktop), not a hand-set square or a Button size.
  assert.match(
    source,
    /const closeButtonClassName = presentation === "modal"\s*\?\s*"flex"\s*:\s*"hidden lg:flex"/,
  );
  assert.match(
    source,
    /<PanelAction\s+onClick=\{handleClose\}\s+className=\{closeButtonClassName\}\s+aria-label=\{formatMessage\(\{ id: "common\.close" \}\)\}\s+data-testid="thread-close"/,
  );
  assert.doesNotMatch(source, /<CloseButton\s+size="icon-lg"/);
  assert.doesNotMatch(source, /size-7 items-center justify-center/);
});

test("profile panel header actions are raft-ui PanelAction head icon buttons", () => {
  const agentSource = readFileSync(
    resolve(repoRoot, "src/components/agent/AgentDetailPanel.tsx"),
    "utf8",
  );
  const humanSource = readFileSync(
    resolve(repoRoot, "src/components/member/HumanDetailPanel.tsx"),
    "utf8",
  );

  // The profile header actions are DS header icon buttons: raft-ui's
  // PanelAction (44 with a 22px glyph on a phone, the DS small 32 with an
  // 18px glyph on desktop) for Message and Close.
  const messageButtonIdx = humanSource.search(
    /<PanelAction\s+onClick=\{handleMessage\}\s+aria-label=\{formatMessage\(\{ id: "member\.detail\.message" \}\)\}\s*>\s*<DirectMessageIcon width=\{22\} height=\{22\} aria-hidden="true" \/>\s*<\/PanelAction>/,
  );
  assert.ok(messageButtonIdx >= 0, "human profile Message icon-button anchor not found");
  assert.doesNotMatch(
    humanSource,
    /<span[^>]*>Message<\/span>/,
  );
  assert.match(
    agentSource,
    /<PanelAction\s+onClick=\{onClose\}\s+className=\{onBack \? "flex" : "hidden md:flex"\}/,
  );
  assert.match(
    humanSource,
    /<PanelAction\s+onClick=\{onClose\}\s+className=\{onBack \? "flex" : "hidden md:flex"\}/,
  );
  assert.doesNotMatch(
    agentSource,
    /h-panel-header[\s\S]{0,2000}title=\{diagnosticCopied \? "Diagnostic info copied" : "Copy Diagnostic Info"\}/,
  );
});

test("secondary panel header icon actions use the shared h-7 icon button contract", () => {
  const panelFiles = [
    "src/components/message/ChatPanel.tsx",
    "src/components/thread/ThreadsInbox.tsx",
    "src/components/saved/SavedPanel.tsx",
    "src/components/settings/SettingsPanel.tsx",
    "src/components/settings/ReleaseNotesPanel.tsx",
    "src/components/search/MessageSearchPage.tsx",
    "src/components/machine/MachineDetailPanel.tsx",
    "src/components/machine/MobileComputersPanel.tsx",
    "src/components/task/LegacyTaskPanel.tsx",
    "src/components/message/SelectShareLightbox.tsx",
  ];

  for (const file of panelFiles) {
    const source = readFileSync(resolve(repoRoot, file), "utf8");
    assert.doesNotMatch(source, /h-panel-header[\s\S]{0,1200}btn-brutal-sm[^"]*p-1\.5/);
  }

  assert.equal(existsSync(resolve(repoRoot, "src/components/ui/Button.tsx")), false);
});

test("task #1298: server-switcher triggers shrink their full-bleed avatar on selected so the card frame shows", () => {
  const source = readFileSync(
    resolve(repoRoot, "src/components/layout/LeftRail.tsx"),
    "utf8",
  );
  // Both triggers (public rail + authenticated rail) host a full-bleed avatar
  // image, so the recipe's selected card (light bg + shadow) is invisible
  // behind it and the shadow reads as a doubled edge. The fix: the trigger is
  // a `group` and the avatar shrinks one step on selected.
  const triggers = source.match(/className="group size-10[^\n]*"[^]*?group-data-\[selected=true\]:!size-8/g) ?? [];
  assert.equal(
    triggers.length,
    2,
    "both server-switcher triggers (public + authenticated rail) must carry the group + selected-shrink pair",
  );
});
