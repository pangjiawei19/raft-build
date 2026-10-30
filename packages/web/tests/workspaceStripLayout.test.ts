import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STRIP_SLOT_PX, reorderAfterDrag, stripCapacity, stripFreePx, stripItems } from "../src/components/topbar/workspaceStripLayout";
import { NAME_CHEVRON_PX } from "../src/components/topbar/useStripLayout";

// Task #140: title-bar workspace strip — space decides the count, switcher order
// decides which, the current workspace is always visible, drag edits one order.

const ws = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}` }));

test("capacity follows the free width with no fixed cap; fewer than two never shows", () => {
  assert.equal(stripCapacity(STRIP_SLOT_PX * 3 + 5, 7), 3);
  assert.equal(stripCapacity(STRIP_SLOT_PX * 12, 20), 12, "no cap: a wide sidebar shows more");
  assert.equal(stripCapacity(STRIP_SLOT_PX * 12, 4), 4, "never more than there are");
  assert.equal(stripCapacity(STRIP_SLOT_PX * 1.9, 7), 0, "one avatar alone is hidden");
  assert.equal(stripCapacity(STRIP_SLOT_PX * 5, 1), 0, "a single workspace needs no switcher");
  assert.equal(stripCapacity(0, 7), 0);
});

test("the strip fills the span: no spare slot before the history controls", () => {
  // n avatars (the DS 32px IconButton) take 8 (lead) + 32n + 4(n-1) px,
  // plus the 5px divider an out-of-range current workspace brings. They fit
  // exactly when the span equals that, and one pixel less drops the last one.
  const span = (n: number) => 8 + 32 * n + 4 * (n - 1) + 5;
  for (const n of [2, 5, 9]) {
    assert.equal(stripCapacity(stripFreePx(span(n)), 20), n, `${n} fit in exactly their width`);
    assert.equal(stripCapacity(stripFreePx(span(n) - 1), 20), n - 1 < 2 ? 0 : n - 1);
  }
  assert.equal(stripFreePx(0), 0);
});

test("items are the first N in switcher order; a current workspace beyond them takes the last slot", () => {
  assert.deepEqual(stripItems(ws(7), "s2", 3), { items: [{ id: "s1" }, { id: "s2" }, { id: "s3" }], currentOutside: false });
  assert.deepEqual(stripItems(ws(7), "s6", 3), { items: [{ id: "s1" }, { id: "s2" }, { id: "s6" }], currentOutside: true });
  assert.deepEqual(stripItems(ws(7), null, 2).items.map((s) => s.id), ["s1", "s2"]);
  assert.deepEqual(stripItems(ws(7), "s1", 0), { items: [], currentOutside: false });
});

test("dragging moves one id within the single shared order and clamps at the ends", () => {
  const order = ["a", "b", "c", "d", "e"];
  assert.deepEqual(reorderAfterDrag(order, 1, 2), ["a", "c", "d", "b", "e"]);
  assert.deepEqual(reorderAfterDrag(order, 3, -3), ["d", "a", "b", "c", "e"]);
  assert.deepEqual(reorderAfterDrag(order, 0, 99), ["b", "c", "d", "e", "a"]);
  assert.deepEqual(reorderAfterDrag(order, 2, 0), order);
  assert.notEqual(reorderAfterDrag(order, 2, 0), order, "always a new array");
});

test("the name button's chevron renders at the width the name slot reserves for it", () => {
  // The slot is reserved from NAME_CHEVRON_PX. raft-ui's Button sizes any icon
  // without a size-* class itself (16px), whatever its size prop says, so a
  // 14px reservation for what rendered at 16 moved the strip 2px whenever the
  // longest name was current (desktop render smoke). jsdom collapses the
  // strip, so the coupling is pinned on the source.
  const topBar = readFileSync(new URL("../src/components/topbar/AppTopBar.tsx", import.meta.url), "utf8");
  const chevron = topBar.match(/<ChevronDown size=\{NAME_CHEVRON_PX\}[^>]*className="([^"]*)"/);
  assert.ok(chevron, "the chevron is sized from NAME_CHEVRON_PX");
  const sizeClass = chevron[1].split(/\s+/).find((c) => /^size-\d+(\.\d+)?$/.test(c));
  assert.ok(sizeClass, "an explicit size-* class keeps raft-ui's icon sizing off it");
  assert.equal(Number(sizeClass.slice("size-".length)) * 4, NAME_CHEVRON_PX, "its size class is NAME_CHEVRON_PX");
});
