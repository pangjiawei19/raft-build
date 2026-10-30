import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sidebarSource = readFileSync(new URL("../src/components/layout/Sidebar.tsx", import.meta.url), "utf8");

// Raft Design System › NavBar `.rf-ws--pill`: the phone Home bar's workspace
// pill is an ink tile with the name in yellow 17/22 700, tilted -2°, 36 tall
// with a 44px hit area and a light veil when pressed. It is a plain CSS
// rotation of the tile, as in the DS reference: the measured SVG polygon
// surface (and its ResizeObserver) drew the slab and its fixed hard-shadow
// offset without rotating a DOM box, and the DS tile has no hard shadow.
test("mobile workspace pill is the DS ink tile, tilted -2deg, with the short-window text fallback", () => {
  const pill = sidebarSource.match(/const MOBILE_WORKSPACE_PILL_CLASS = \[([\s\S]*?)\]\.join\(" "\);/);
  assert.ok(pill, "the workspace pill keeps one named class contract");
  const className = pill[1];
  for (const token of [
    "min-h-9",
    "rounded-control",
    "bg-sticker-ink",
    "text-headline",
    "text-brand",
    "-rotate-2",
    "after:-inset-y-1",
    "focus-visible:shadow-focus",
    // stdrc #proj-uiux:648f8735: short windows drop the tile for text + chevron.
    "[@media(max-height:600px)]:rotate-0",
    "[@media(max-height:600px)]:bg-transparent",
    "[@media(max-height:600px)]:text-foreground-on-frame",
  ]) {
    assert.match(className, new RegExp(`(?:^|[\\s"])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[\\s"]|$)`), token);
  }
  assert.doesNotMatch(className, /shadow-brutal|border-2|tilt-neg-2|will-change-transform/);
  assert.match(sidebarSource, /className=\{MOBILE_WORKSPACE_PILL_CLASS\}/);
  assert.doesNotMatch(sidebarSource, /mobile-server-selector-vector/);
  assert.doesNotMatch(sidebarSource, /MobileServerSelectorVectorSurface/);
});
