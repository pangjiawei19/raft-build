import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The computer row's presence pixel intentionally overhangs its 19px icon box
// by 4px (absolute -right-1 -bottom-1, the Raft Design System avatar-status
// corner). The box must never clip it: no overflow-hidden wrapper (the old RUI
// Card tile clipped it twice before an `overflow-visible` opt-out was pinned).
// Pin the pair so a refactor that clips the pixel fails loudly.
test("computer row status dot overhang is never clipped by its icon box", () => {
  const sidebar = readFileSync(
    new URL("../src/components/layout/Sidebar.tsx", import.meta.url),
    "utf8",
  );

  // The box is raft-ui's SidebarItemIcon (the 19px identity box, ink on the
  // selected row), opened up for the pixel.
  const box = sidebar.match(
    /<SidebarItemIcon className="([^"]*)">\s*<Monitor \/>\s*<StatusDot/,
  );
  assert.ok(box, "computer row icon box (SidebarItemIcon wrapping Monitor + StatusDot) not found");
  assert.match(box[1], /\brelative\b/, "the icon box positions the overhanging pixel");
  assert.match(box[1], /\boverflow-visible\b/, "the icon box must let the overhanging pixel escape");
  assert.doesNotMatch(box[1], /\boverflow-hidden\b/);
  assert.doesNotMatch(sidebar, /<Card[^>]*>\s*<Monitor/, "no clipping Card tile around the monitor glyph");

  assert.match(
    sidebar,
    /<StatusDot\s+className="absolute -right-1 -bottom-1"/,
    "the computer status pixel must keep its by-design 4px overhang",
  );
});
