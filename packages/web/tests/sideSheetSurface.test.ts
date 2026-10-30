/**
 * Contract test for the right-side sheet surface (task #1050).
 *
 * stdrc 2026-08-27 #proj-uiux:c50cb6c6: the chat side sheet (channel
 * settings) should read as the same surface as the sidebar. Investigation
 * showed both already share the `bg-palette-cream` token — the perceived
 * color difference comes from two other sources:
 *
 *   1. raft-ui's Drawer renders a modal overlay (`bg-layer-backdrop`,
 *      ~60% black) over the page, dimming the sidebar while the sheet
 *      stays above it. That is intended modal drawer behavior and stays.
 *   2. The sheet carried Tailwind's `shadow-xl`, a soft blurred shadow.
 *      The design language is hard-shadow only (`--shadow-brutal*`,
 *      `--shadow-soft-popover` reserved for tiny auto-dismiss overlays),
 *      and a wide blurred band along the sheet's left edge exaggerated
 *      the boundary contrast. The full-height sheet already has a 2px
 *      black left border as its delineator, so the blur shadow is
 *      removed with no replacement.
 *
 * Surface rule after the multitheme migration (Artea directive): each side
 * sheet follows the SIDEBAR's themed background layer — a semantic
 * `bg-layer-*` token for elegant/elegant-dark, with the production cream
 * kept only inside the `theme-brutal:` variant. The channel-settings drawer
 * uses the sidebar's muted canvas layer (`bg-layer-sidebar
 * theme-brutal:bg-palette-cream`); the shared OverflowSheet shell uses the
 * panel layer (`bg-layer-canvas theme-brutal:bg-palette-cream`). In brutal
 * both stay cream, visually identical to before.
 *
 * This test fails CI if a refactor:
 *   - reintroduces a Tailwind blur shadow (shadow-sm/md/lg/xl/2xl or
 *     arbitrary shadow-[...]) on any side sheet,
 *   - changes a sheet surface off its semantic `bg-layer-*` +
 *     `theme-brutal:bg-palette-cream` pair (sidebar-layer contract),
 *   - drops the 2px left border that delineates the sheet edge.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BLUR_SHADOW = /shadow-(?:sm|md|lg|xl|2xl)\b|shadow-\[/;

// The shared OverflowSheet shell is the Raft Design System drawer (`rf-drawer`):
// raft-ui's raft drawer recipe owns the popover surface, the seam edge and the
// float shadow. The shell must not paint over it — no local surface, no 2px
// edge, no theme-scoped variant — and its head is the white DS panel head with
// a seam under it (yellow stays on the frame).
test("../src/components/ui/OverflowSheet.tsx: the drawer surface belongs to the raft-ui drawer recipe", () => {
  const source = readFileSync(resolve(import.meta.dirname, "../src/components/ui/OverflowSheet.tsx"), "utf8");
  const contentClass = source.match(/<DrawerContent[\s\S]*?className="([^"]*)"/)?.[1] ?? "";
  assert.ok(contentClass, "DrawerContent keeps a layout className");
  assert.doesNotMatch(contentClass, /(?:^|\s)(?:bg-|border-l-2|shadow-|theme-brutal:)/, "layout only on the drawer content");
  // Head and body are raft-ui's drawer parts (the 56 head with its seam is
  // the recipe's DrawerHeader), the same frame as the channel settings drawer.
  assert.match(source, /<DrawerHeader\b[\s\S]*?<DrawerBody\b/);
  assert.doesNotMatch(contentClass, /max-w-/, "the 420 drawer width comes from the recipe");
  assert.doesNotMatch(source, /theme-brutal:|bg-palette-yellow|bg-palette-cream/);
  assert.doesNotMatch(source, BLUR_SHADOW, "side sheet must not carry a blurred shadow");
});

// Raft Design System › Sheet: the channel-settings drawer is a raft-ui
// Drawer whose recipe owns the surface (the popover layer, a seam edge and
// the float shadow) — the call site adds no background, border or shadow of
// its own, and the head/body/foot are the recipe's DrawerHeader/Body/Footer
// (56 head with a seam under it, a seam over the actions).
test("../src/components/channel/EditChannelDialog.tsx: side sheet leaves its surface to the raft-ui drawer recipe", () => {
  const source = readFileSync(resolve(import.meta.dirname, "../src/components/channel/EditChannelDialog.tsx"), "utf8");
  const contentClass = source.match(/<DrawerContent[\s\S]*?className="([^"]*)"/)?.[1] ?? "";
  assert.ok(contentClass, "DrawerContent keeps a layout className");
  assert.doesNotMatch(contentClass, /(?:^|\s)(?:bg-|border-|shadow-|rounded-)/, "no surface classes on the drawer");
  assert.doesNotMatch(source, BLUR_SHADOW, "side sheet must not carry a blurred shadow");
  assert.match(source, /<DrawerHeader[\s\S]*?<DrawerBody[\s\S]*?<DrawerFooter/);
});
