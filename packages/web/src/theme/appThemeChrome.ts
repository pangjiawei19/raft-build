import type { ResolvedThemeMode } from "@botiverse/raft-ui";

/**
 * The browser / OS chrome continues the app frame: the light frame is the
 * Raft yellow, the dark frame is the neutral frame of the dark mode.
 */
export const RAFT_LIGHT_THEME_CHROME_COLOR = "#FFD440";
export const RAFT_DARK_THEME_CHROME_COLOR = "#0D0D0B";
/** A pushed page's header is paper, so its chrome is too. */
export const RAFT_LIGHT_PAPER_CHROME_COLOR = "#FFFFFF";
export const RAFT_DARK_PAPER_CHROME_COLOR = "#1B1B19";

export function appThemeChromeColor(resolvedMode: ResolvedThemeMode): string {
  return resolvedMode === "dark" ? RAFT_DARK_THEME_CHROME_COLOR : RAFT_LIGHT_THEME_CHROME_COLOR;
}

export function applyAppThemeChromeColor(
  targetDocument: Document,
  resolvedMode: ResolvedThemeMode,
): void {
  const themeColor = targetDocument.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  if (themeColor) themeColor.content = appThemeChromeColor(resolvedMode);
}
