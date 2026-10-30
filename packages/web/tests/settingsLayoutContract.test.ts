import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");

function readSource(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

function readSettingsSection(startMarker: string, endMarker: string): string {
  const source = readSource("src/components/settings/SettingsPanel.tsx");
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  assert.notEqual(start, -1, `missing start marker ${startMarker}`);
  assert.notEqual(end, -1, `missing end marker ${endMarker}`);
  return source.slice(start, end);
}

test("Account and Server Profile share one identity card hierarchy", () => {
  const accountSection = readSettingsSection("function AccountSection(", "function AccountSignOutSection()");
  const profileSection = readSettingsSection("function ProfileSection()", "function AdminsSection()");
  const profileCard = readSource("src/components/settings/SettingsProfileCard.tsx");

  assert.match(accountSection, /<SettingsProfileCard[\s\S]*?testId="account-profile-card"/);
  assert.match(profileSection, /<SettingsProfileCard[\s\S]*?testId="server-profile-card"/);
  // Raft DS card (raft-ui Card: surface, hairline, 10px radius, no shadow);
  // the name is the headline style, the handle is machine text.
  assert.match(profileCard, /<Card\s+data-testid=\{testId\}\s+className="space-y-4 p-4"/);
  assert.doesNotMatch(profileCard, /rounded-container border border-line-hairline bg-layer-card/);
  assert.match(profileCard, /className="flex items-start gap-4"/);
  assert.match(profileCard, /className="min-w-0 truncate text-headline text-foreground"/);
  assert.match(profileCard, /className="mt-0\.5 truncate font-mono text-mono-code text-foreground-muted"/);
  assert.doesNotMatch(profileCard, /theme-brutal:|shadow-raft-sm/);
  assert.match(profileCard, /className="space-y-3">\s*<Separator className="mb-4" \/>/);
  assert.doesNotMatch(accountSection, /className="flex items-center gap-4"/);
  assert.doesNotMatch(accountSection, /className="text-sm font-bold text-black">\{user\?\.displayName/);
  assert.doesNotMatch(profileSection, /px-5 py-5|px-5 py-4|p-5/);
});

test("Account fields mirror Server Profile display-name then identifier order", () => {
  const accountSection = readSettingsSection("function AccountSection(", "function AccountSignOutSection()");
  const profileSection = readSettingsSection("function ProfileSection()", "function AdminsSection()");

  // Display Name / Email migrated in sub-batch A; Username in sub-batch C. All
  // three are react-intl ids now — this anchors on the id, not the English text,
  // so it no longer breaks the next time copy changes.
  const accountDisplayName = accountSection.indexOf('label={formatMessage({ id: "settings.account.displayNameLabel" })}');
  const accountUsername = accountSection.indexOf('label={formatMessage({ id: "settings.account.usernameLabel" })}');
  const accountEmail = accountSection.indexOf('label={formatMessage({ id: "settings.account.emailLabel" })}');
  assert.ok(accountUsername >= 0, "username label anchor not found");
  assert.ok(accountDisplayName >= 0 && accountDisplayName < accountUsername);
  assert.ok(accountUsername < accountEmail);
  assert.match(accountSection, /<PrefixedInput[\s\S]*?data-testid="account-profile-username-input"[\s\S]*?prefix="@"/);

  // Name / Slug labels are migrated to react-intl ids (sub-batch B).
  const serverName = profileSection.indexOf('label={formatMessage({ id: "settings.serverProfile.nameLabel" })}');
  const serverSlug = profileSection.indexOf('label={formatMessage({ id: "settings.serverProfile.slugLabel" })}');
  assert.ok(serverName >= 0 && serverName < serverSlug);
  assert.match(profileSection, /<SlugInput[\s\S]*?value=\{server\.slug\}[\s\S]*?readOnly/);
});

test("Plan & Billing loading and loaded cards share the current layout and p-4 padding", () => {
  const planSection = readSettingsSection("function PlanBillingLoadingSection()", "// ── Danger Zone Section ──");
  const loadedPlan = readSource("src/components/settings/PlanSectionContent.tsx");

  assert.match(planSection, /function PlanBillingLoadingSection\(\)/);
  assert.match(planSection, /label=\{formatMessage\(\{ id: "billing\.managePlan" \}\)\}/);
  assert.match(planSection, /grid gap-4 p-4/);
  // The skeleton and the loaded section draw the same DS cards (raft-ui Card),
  // so the page does not jump when billing arrives.
  const managePlanCard = /<Card className="mb-6 grid gap-4 p-4 lg:grid-cols-\[minmax\(0,1fr\)_280px\]">/;
  const planHeader = /className="border-b border-line-hairline px-4 py-4"/;
  for (const section of [planSection, loadedPlan]) {
    assert.match(section, managePlanCard);
    assert.match(section, planHeader);
    assert.match(section, /<Separator \/>\s*<div className="px-4 py-4">/);
  }
  assert.doesNotMatch(planSection, /SectionEyebrow as="div" className="mb-3"[\s\S]*Plans/);
  assert.doesNotMatch(planSection, /p-5|px-5 py-4|gap-5/);
});

test("Connected Apps controls use shared primitives and primary action color", () => {
  const integrationsSection = readSettingsSection("function IntegrationsSection()", "function PreJoinAgreementSection()");
  const settingsSegmentedControls = readSource("src/components/settings/SettingsSegmentedControls.tsx");

  assert.match(integrationsSection, /<Button[\s\S]*?variant="accent"[\s\S]*?onClick=\{openRegisterDrawer\}[\s\S]*?settings\.connectedApps\.registerApp/);
  assert.match(integrationsSection, /<ConnectedAppsTabSegmentedControl/);
  assert.match(settingsSegmentedControls, /<SegmentedControl<ConnectedAppsTab>/);
  assert.match(settingsSegmentedControls, /aria-label=\{formatMessage\(\{ id: "settings\.connectedApps\.viewAria" \}\)\}/);
  assert.doesNotMatch(integrationsSection, /aria-pressed=\{activeTab === id\}/);
  assert.doesNotMatch(integrationsSection, /setActiveTab\(id\)/);
});

test("release note cards match Account card padding", () => {
  const releaseNotes = readSource("src/components/settings/ReleaseNotesPanel.tsx");

  assert.match(releaseNotes, /const isCurrentRelease = release\.releaseId === currentReleaseId/);
  // Raft DS: the release you run is marked with the yellow "you" sticker, not
  // a yellow wash over the whole card.
  assert.match(releaseNotes, /isCurrentRelease \? \(\s*<Badge appearance="solid" variant="primary">\s*\{formatMessage\(\{ id: "settings\.releaseNotes\.current" \}\)\}/);
  assert.doesNotMatch(releaseNotes, /bg-brand-soft/);
  assert.match(releaseNotes, /className="mt-2 list-disc space-y-1\.5 pl-5 marker:text-foreground-hint"/);
  // The card rides the rui standard component (chrome comes from the recipe);
  // only the Account-card padding stays local (task #696 — replacing the
  // hand-rolled frame).
  assert.match(releaseNotes, /<Card[\s\S]{0,200}className="p-4"/);
  assert.doesNotMatch(releaseNotes, /className=\{`border border-line-hairline p-4 shadow-raft-sm/);
  assert.doesNotMatch(releaseNotes, /className="border-2 border-black bg-white shadow-brutal-sm p-5"/);
});
