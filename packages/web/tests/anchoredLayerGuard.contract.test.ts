import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// A layer hung under its trigger inline (`absolute … top-full`) cannot see the
// screen edge: opened near the right it runs off the screen, and focusing
// anything in it (an autofocused search box) scrolls the clipped column to
// show it — the whole page jumps sideways (the Tasks Assignee filter did).
// Popups belong to raft-ui's Popover / Menu / Select, which portal the layer
// and keep it on screen (shift, flip, never past the space it has).
//
// The only inline layers left are bounded on both sides by construction; a new
// one fails here. State the bound when you add one, or use raft-ui instead.

const SRC = path.resolve(__dirname, "../src");
const INLINE_ANCHORED = /absolute[^"`]*\b(top-full|top-\[calc\(100%)|\b(top-full|top-\[calc\(100%)[^"`]*\babsolute\b/;
const BOUNDED = new Map<string, string>([
  ["components/layout/SidebarConversationFinder.tsx", "finder results: inset-x-2 inside the sidebar"],
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

test("no popup is positioned inline under its trigger outside the bounded few", () => {
  const offenders: string[] = [];
  const seen = new Set<string>();
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join("/");
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      const code = line.trimStart();
      if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
      if (!INLINE_ANCHORED.test(line)) return;
      seen.add(rel);
      if (!BOUNDED.has(rel)) offenders.push(`${rel}:${index + 1}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    "position popups with raft-ui Popover / Menu / Select (portalled, kept on screen), not inline under the trigger",
  );
  for (const rel of BOUNDED.keys()) {
    assert.ok(seen.has(rel), `${rel} no longer has an inline layer: drop it from BOUNDED`);
  }
});

// The same failure with a fixed offset (`absolute right-0 top-8`): a raft-ui
// popup surface given `absolute` is hung on its trigger by hand. Use the part's
// own Root/Trigger/Content (DropdownMenu, Popover, Select) so it is anchored,
// portalled and kept on screen. Pointer-positioned context menus use `fixed`
// with a computed, clamped style and are not matched here.
const POPUP_PART = /<(ContextMenuPopup|PopoverPopup|MenuPopup|DropdownMenuPopup|SelectPopup)\b[^>]*?className=(?:"([^"]*)"|\{`([^`]*)`\})/g;

test("no raft-ui popup surface is positioned absolutely by hand", () => {
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join("/");
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(POPUP_PART)) {
      const className = match[2] ?? match[3] ?? "";
      if (/(?:^|\s)absolute(?:\s|$)/.test(className)) {
        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`${rel}:${line} <${match[1]}>`);
      }
    }
  }
  assert.deepEqual(offenders, [], "anchor popups with raft-ui DropdownMenu / Popover / Select, not an absolute popup part");
});

