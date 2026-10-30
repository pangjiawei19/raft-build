/**
 * Whether the app shell mounts the top bar.
 *
 * On its own the web shows it at desktop width only, and never inside a shell
 * that draws its own chrome (the desktop app's title bar, the host-shell
 * embed). A shell that hands its chrome to the bar through `TopBarHostContext`
 * gets it at any width: the row is then the window's title bar and its drag
 * region, which must not disappear when the window is narrow.
 *
 * Raft Design System: the bar is part of the frame, with the rail under it.
 */
export function shouldShowTopBar(input: {
  hosted: boolean;
  desktopWidth: boolean;
  hostShell: boolean;
  electronShell: boolean;
}): boolean {
  if (input.hosted) return true;
  return input.desktopWidth && !input.hostShell && !input.electronShell;
}
