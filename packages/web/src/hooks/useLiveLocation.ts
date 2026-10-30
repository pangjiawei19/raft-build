import { useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";

export interface LiveLocation {
  pathname: string;
  search: string;
}

/**
 * The page the user is on at event time, as a getter.
 *
 * BrowserRouter commits each navigation inside a React transition. While the
 * new page is still loading (e.g. the lazy Settings panel's chunk), React keeps
 * rendering the old page, so `useLocation()` still returns it, but
 * `window.location` already holds the new URL. A navigation that records where
 * it came from (the search overlay's background) must read the latter: reading
 * the rendered location opened Search over Computers after Settings had been
 * clicked, and the pending Settings navigation was lost
 * (chat-tab-from-machine-detail rail flake, skyzh 2026-10-15).
 *
 * Same router detection as useLiveSearchParams: MemoryRouter/SSR callers keep
 * the rendered location. Like there, it is decided once, at the first render:
 * a component that first mounts while a navigation is pending (browser URL ≠
 * rendered URL) is classed as not browser-backed and keeps the rendered
 * location for its lifetime, i.e. the previous behaviour, never a worse one.
 */
export function useLiveLocation(): () => LiveLocation {
  const location = useLocation();
  const renderedRef = useRef<LiveLocation>(location);
  renderedRef.current = location;
  const isBrowserBackedRef = useRef<boolean | null>(null);
  if (isBrowserBackedRef.current === null) {
    isBrowserBackedRef.current = typeof window !== "undefined"
      && window.location.pathname === location.pathname
      && window.location.search === location.search;
  }
  return useCallback(() => {
    const source = isBrowserBackedRef.current && typeof window !== "undefined" ? window.location : renderedRef.current;
    return { pathname: source.pathname, search: source.search };
  }, []);
}
