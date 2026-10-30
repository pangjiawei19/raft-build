import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

test("AttentionDot primitive exposes lg/sm physical-fit axis + the DS pink attention pixel", () => {
  const src = read("src/components/ui/AttentionDot.tsx");
  // Two-tier physical-fit axis (stdrc 2026-05-14 PR #1709 amend,
  // msg=6ad15567). `lg` is canonical default, `sm` is compact-only.
  // Size is physical fit, NOT priority — don't reintroduce `md` (or any
  // intermediate tier) under another name. See CLAUDE.md "Attention
  // Dots" for the boundary test. Raft Design System: `lg` is the 9px
  // pixel with a 1.5px edge, `sm` the 6px compact one.
  assert.match(src, /sm:\s*"size-1\.5 rounded-\[1px\] border"/);
  assert.match(src, /lg:\s*"size-\[9px\] rounded-\[2px\] border-\[1\.5px\]"/);
  assert.doesNotMatch(src, /md:\s*"size-/);
  // API surface must expose only the two tiers — banning `md` at the
  // type level is what makes accidental reintroduction a typecheck error
  // rather than a code-review nit.
  assert.match(src, /size\?:\s*"sm"\s*\|\s*"lg"/);
  // Default size = lg (canonical). If a callsite drops the `size` prop
  // it should land on the canonical pixel, not the compact tier.
  assert.match(src, /size = "lg"/);
  // The attention pink (semantic accent) stays the canonical default tone —
  // overrides are explicit.
  assert.match(src, /tone = "bg-attention"/);
  // The ink edge is what makes the dot read as an attention pixel vs
  // decoration (every DS colour block is a sticker). Required at every tier.
  assert.match(src, /border-sticker-ink/);
  // Square = Raft: every dot is a square pixel, never a circle, never animated.
  assert.doesNotMatch(src, /rounded-full/);
  assert.doesNotMatch(src, /animate-/);
});

test("no `size=\"md\"` AttentionDot consumers remain (md was removed in PR #1709 amend)", () => {
  // After the 3-tier → 2-tier collapse, every `size="md"` AttentionDot
  // callsite was either promoted to `lg` (canonical) or dropped to `sm`
  // (compact-only). Re-introducing `md` is the symptom of someone
  // misreading the new physical-fit rule as a priority tier — fail CI
  // before the regression lands.
  //
  // Scan only the AttentionDot usages, not every `size="md"` literal in
  // the repo (Checkbox, Button, etc. have their own size
  // axes that are unrelated).
  const componentsDir = resolve(repoRoot, "src");
  let hits = "";
  try {
    hits = execSync(
      `grep -RnE '<AttentionDot[^/>]*size="md"' ${componentsDir}`,
      { encoding: "utf8" },
    );
  } catch (err: any) {
    if (err.status === 1) hits = "";
    else throw err;
  }
  assert.equal(
    hits.trim(),
    "",
    `AttentionDot size="md" is banned — collapse to size="lg" (canonical) or size="sm" (compact-only):\n${hits}`,
  );
});

test("LeftRail + Sidebar use AttentionDot for unread / cross-context dots", () => {
  const leftRail = read("src/components/layout/LeftRail.tsx");
  const sidebar = read("src/components/layout/Sidebar.tsx");

  assert.match(leftRail, /import AttentionDot from "\.\.\/ui\/AttentionDot";/);
  assert.match(sidebar, /import AttentionDot from "\.\.\/ui\/AttentionDot";/);

  // The desktop rail's server-switcher dot is the rail's shared attention
  // composite (raft-ui AppRailItemAttention); the mobile/short Sidebar surface
  // keeps the `lg` AttentionDot (cross-context attention).
  assert.match(leftRail, /<AppRailItemAttention title=\{formatMessage\(\{ id: "layout\.leftRail\.serverFallbackName" \}\)\} \/>/);
  assert.match(sidebar, /<AttentionDot[\s\S]*?size="lg"[\s\S]*?title=\{formatMessage\(\{ id: "layout\.sidebar\.otherServersUnread" \}\)\}/);

  // No raw inline pink-dot spans should remain in these two files. If a
  // new dot is added, route it through AttentionDot.
  assert.doesNotMatch(leftRail, /rounded-full border border-black bg-palette-pink/);
  assert.doesNotMatch(sidebar, /size-2 rounded-full bg-palette-pink border border-black/);
});

test("floating surfaces take raft-ui's DS float shadow, not a local token", () => {
  const css = read("src/index.css");
  // Raft Design System: controls carry no shadow; menus, popovers and
  // dialogs float on raft-ui's `shadow-float`. The web keeps no shadow
  // token of its own that could drift from it.
  assert.doesNotMatch(css, /--shadow-soft-popover|--shadow-brutal/);
});

test("centred modal frames draw through raft-ui's DialogSurface, not a restated frame", () => {
  // The dialog frame (popover layer, dialog radius, seam ring, float shadow)
  // is raft-ui's DialogSurface, so a change to it lands on every modal. An
  // unprefixed `rounded-dialog` in the app means a hand-rolled copy of it;
  // LegacyTaskPanel's sm:-only frame and the dev palette audit are the
  // deliberate exceptions.
  let hits = "";
  try {
    hits = execSync(`grep -RlE '(^|[^:])rounded-dialog' ${resolve(repoRoot, "src")}`, { encoding: "utf8" });
  } catch (err: any) {
    if (err.status === 1) hits = "";
    else throw err;
  }
  const offenders = hits.split("\n").filter(Boolean)
    .map((file) => file.slice(repoRoot.length + 1))
    .filter((file) => file !== "src/pages/PaletteAuditPage.tsx");
  assert.deepEqual(offenders, [], "use raft-ui's DialogSurface for a modal frame");
});

test("no inline shadow-[rgba(...)] arbitrary values in components/", () => {
  // Lint-ban: all shadow effects must reference a named token
  // (raft-ui's shadow-float / shadow-sticker / shadow-focus).
  const componentsDir = resolve(repoRoot, "src/components");
  let hits = "";
  try {
    hits = execSync(`grep -RnE 'shadow-\\[[^]]*rgba' ${componentsDir}`, { encoding: "utf8" });
  } catch (err: any) {
    // grep exits 1 when there are no matches — that's the success case.
    if (err.status === 1) hits = "";
    else throw err;
  }
  assert.equal(hits.trim(), "", `inline rgba shadows are banned (use raft-ui's shadow-float / shadow-sticker / shadow-focus instead):\n${hits}`);
});
