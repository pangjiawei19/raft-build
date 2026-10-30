import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");

test("iOS standalone chrome follows the Raft Design System buckets: frame on tab roots, paper on pushed pages, an in-flow tab bar", () => {
  const html = readFileSync(resolve(repoRoot, "index.html"), "utf8");
  const css = readFileSync(resolve(repoRoot, "src/index.css"), "utf8");
  const manifest = readFileSync(resolve(repoRoot, "public/site.webmanifest"), "utf8");
  const layout = readFileSync(
    resolve(repoRoot, "src/components/layout/MainLayout.tsx"),
    "utf8",
  );
  const themeChrome = readFileSync(
    resolve(repoRoot, "src/theme/appThemeChrome.ts"),
    "utf8",
  );

  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" \/>/);
  assert.match(html, /<meta name="theme-color" content="#FFD440" \/>/);
  assert.match(html, /<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" \/>/);
  assert.match(manifest, /"theme_color": "#FFD440"/);
  assert.match(manifest, /"background_color": "#FFD440"/);
  // The page canvas is paper, never the desktop sidebar's cream.
  assert.match(css, /html \{[^}]*background-color: var\(--layer-canvas\);/);
  assert.match(css, /body \{[^}]*background-color: var\(--layer-canvas\);/);

  // The frame (light yellow / dark #0d0d0b) and paper (white / #1b1b19).
  assert.match(themeChrome, /RAFT_LIGHT_THEME_CHROME_COLOR = "#FFD440"/);
  assert.match(themeChrome, /RAFT_DARK_THEME_CHROME_COLOR = "#0D0D0B"/);
  assert.match(themeChrome, /RAFT_LIGHT_PAPER_CHROME_COLOR = "#FFFFFF"/);
  assert.match(themeChrome, /RAFT_DARK_PAPER_CHROME_COLOR = "#1B1B19"/);

  // Tab roots wear the frame, pushed detail routes wear paper, in both modes;
  // the shell wrapper paints the same surface above the safe-area inset.
  assert.match(
    layout,
    /const isMobileTabRoot = mobileShowSidebarInline \|\| \(!isDesktop && isTasksRoute\)/,
  );
  assert.match(layout, /const mobileDetailChrome = !isDesktop && !isMobileTabRoot;/);
  assert.match(layout, /resolvedMode === "dark" \? RAFT_DARK_PAPER_CHROME_COLOR : RAFT_LIGHT_PAPER_CHROME_COLOR/);
  assert.match(layout, /resolvedMode === "dark" \? RAFT_DARK_THEME_CHROME_COLOR : RAFT_LIGHT_THEME_CHROME_COLOR/);
  assert.match(
    layout,
    /const shellBackgroundColor = isDesktop \? undefined : mobileDetailChrome \? "var\(--layer-canvas\)" : "var\(--layer-frame\)";/,
  );
  assert.match(layout, /backgroundColor: shellBackgroundColor/);
  assert.match(layout, /themeColor\.content = browserChromeColor/);

  // The tab bar is an in-flow edge bar; nothing floats over the content and
  // nothing is stacked above it.
  assert.match(layout, /<MobileNavRoot className="md:hidden shrink-0" style=\{IN_FLOW_TAB_BAR_STYLE\}>/);
  assert.doesNotMatch(layout, /floatingTabBar|MobileBottomBarStack|mobile-bottom-bar-overlay/);
  assert.doesNotMatch(css, /mobile-nav-clearance/);
  assert.match(layout, /<AppShellRoot/);
});
