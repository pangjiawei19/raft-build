// The entry point a host shell uses to take part in the web's top bar.
//
// The desktop app draws its window chrome around the web app. Rather than
// keep a second top bar of its own, it wraps the app in
// `TopBarHostContext` and hands over the few things only it has: history
// controls, its update pill, and the fact that the row is the window's title
// bar. With a host present the web shows its top bar inside that shell too,
// at any width, because the row is also the window's drag region.
//
// Without a provider nothing changes: a shell that still draws its own bar
// (an older desktop build) never gets a second one.

import { createContext, useContext } from "react";
import type { ReactNode } from "react";

export interface TopBarHost {
  /** Rendered at the end of the left region, next to the search field (history controls). */
  leadingEnd?: ReactNode;
  /** Rendered at the start of the right region, before the web's own actions (update pill). */
  trailingStart?: ReactNode;
  /** The row is the window's title bar: it carries `data-raft-titlebar` for the shell's drag region and insets. */
  titleBar?: boolean;
  /** The modifier of the shell's "switch to workspace N" shortcut, for the strip's tooltips. */
  workspaceShortcutModifier?: string | null;
  /**
   * Called with true when the bar mounts and false when it unmounts. The bar
   * only exists on server pages (MainLayout); a shell that relies on it for its
   * title bar draws a plain one of its own while it is absent (sign-in,
   * onboarding, the server picker).
   */
  onBarMounted?: (mounted: boolean) => void;
}

export const TopBarHostContext = createContext<TopBarHost | null>(null);

export function useTopBarHost(): TopBarHost | null {
  return useContext(TopBarHostContext);
}
