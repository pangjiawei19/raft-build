import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const overlay = readFileSync(resolve(import.meta.dirname, "../src/components/dev/DraggableDevOverlay.tsx"), "utf8");
const app = readFileSync(resolve(import.meta.dirname, "../src/App.tsx"), "utf8");
const debugPanel = app.slice(app.indexOf("function SlockdevDebugPanel("), app.indexOf("/** Resolves server from URL slug"));

test("dev overlay uses RUI Popover with live anchor tracking", () => {
  assert.match(overlay, /from "@botiverse\/raft-ui"/);
  assert.match(overlay, /<PopoverTrigger nativeButton=\{false\} render=\{trigger\}/);
  assert.match(overlay, /<PopoverContent/);
  assert.match(overlay, /disableAnchorTracking=\{false\}/);
  assert.match(overlay, /left: \(position\?\.left \?\? 0\) \+ \(transform\?\.x \?\? 0\)/);
});

test("edge release persists collapsed state and keyboard affordance remains", () => {
  assert.match(overlay, /data-dev-overlay-collapsed/);
  assert.match(overlay, /onKeyDown=\{\(event\)/);
  assert.match(overlay, /collapsed: Boolean\(collapsible\)/);
  assert.match(app, /collapsedChildren/);
  assert.match(app, /data-dev-overlay-handle/);
});

test("dev panel keeps header rows and close control geometry stable", () => {
  assert.match(app, /<div className="truncate">\{envName \|\| "slockdev"\}<\/div>/);
  assert.match(app, /<div className="truncate">/);
  // The dev chrome keeps its compact 24px close; the token is the scale's
  // small icon size (xs/sm/md all name the same raft size now).
  assert.match(app, /size="icon-sm"\s*variant="ghost"[\s\S]{0,120}data-testid="raftdev-debug-close"/);
  assert.match(app, /data-testid="raftdev-debug-close"/);
  assert.match(app, /className="size-6 shrink-0 self-start"/);
  assert.match(app, /className="flex size-6 touch-none/);
  assert.match(app, /<Settings2 size=\{12\}/);
});

test("server picker records a one-shot selection request before navigation", () => {
  assert.match(app, /requestServerSelection\(\);\n\s+serverPersistence\.clearLastServerSlug\(\);\n\s+window\.location\.assign\("\/"\);/);
  assert.match(app, /const \[showServerSelector\] = useState\(\(\) => consumeServerSelectionRequest\(\)\);/);
});

test("dev panel actions and surfaces use RUI theme contracts", () => {
  // A floating panel: the DS popover surface with a seam edge and the float shadow.
  assert.match(debugPanel, /bg-layer-popover/);
  assert.match(debugPanel, /shadow-float ring-1 ring-line-seam/);
  assert.match(debugPanel, /text-foreground/);
  assert.match(debugPanel, /border-line-hairline/);
  assert.match(debugPanel, /<Button[\s\S]*variant="accent"/);
  assert.match(debugPanel, /<Button[\s\S]*variant="outline"/);
  for (const token of ["bg-white", "text-black", "border-black"]) {
    assert.doesNotMatch(debugPanel, new RegExp(`(?<!theme-brutal:)${token.replaceAll("-", "\\-")}`));
  }
});

test("slockdev trigger stays an icon-only RUI control", () => {
  assert.match(app, /data-testid="raftdev-debug-trigger"/);
  assert.match(app, /<Settings2 size=\{14\} strokeWidth=\{2\.5\} aria-hidden="true" \/>/);
  assert.doesNotMatch(app, /<span data-testid="environment-badge">\{badgeLabel\}<\/span>/);
});
