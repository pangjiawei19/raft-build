import assert from "node:assert/strict";
import "./helpers/domSetup";
import { lazy, Suspense } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useAppNavigate } from "../src/hooks/useAppNavigate";
import { useRailMode } from "../src/hooks/useSidebarTab";
import { useServerStore } from "../src/store/serverStore";

// BrowserRouter commits a navigation inside a React transition: while the new
// page is still loading, the old page stays rendered and useLocation() still
// returns it. Search opened in that window must float over the page the user
// navigated to, not the one still on screen. It used to take the rendered page:
// clicking Settings and then Search showed Search over Computers and the
// Settings navigation was lost (chat-tab-from-machine-detail rail flake, skyzh
// 2026-10-15).

function matchMediaStub(matches: boolean): typeof window.matchMedia {
  return ((query: string) => ({
    matches, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
const originalMatchMedia = typeof window.matchMedia === "function" ? window.matchMedia : matchMediaStub(false);
const originalServerState = useServerStore.getState();

afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
  useServerStore.setState(originalServerState, true);
  window.history.replaceState(null, "", "/");
});

// A page whose code never finishes loading: its navigation stays pending.
const StillLoading = lazy(() => new Promise<never>(() => {}));

function Controls() {
  const { selectRailMode } = useRailMode();
  const nav = useAppNavigate();
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <button data-testid="to-settings" onClick={() => navigate("/s/botiverse/settings/account")}>settings</button>
      {/* The two search entries: the rail / top-bar field, and ⌘K (useAppNavigate). */}
      <button data-testid="search-rail" onClick={() => selectRailMode("search")}>rail</button>
      <button data-testid="search-shortcut" onClick={() => nav.toSearch()}>shortcut</button>
      {/* Navigate and open Search in one event: React has not rendered the new page at all yet. */}
      <button data-testid="settings-then-search-rail" onClick={() => { navigate("/s/botiverse/settings/account"); selectRailMode("search"); }}>both rail</button>
      <button data-testid="settings-then-search-shortcut" onClick={() => { navigate("/s/botiverse/settings/account"); nav.toSearch(); }}>both shortcut</button>
      <output data-testid="rendered">{location.pathname}</output>
    </>
  );
}

function renderApp() {
  window.matchMedia = matchMediaStub(true); // desktop width: Search is the overlay
  useServerStore.setState({ ...originalServerState, current: { id: "s1", name: "Botiverse", slug: "botiverse" } as never });
  window.history.replaceState(null, "", "/s/botiverse/computers");
  render(
    <BrowserRouter>
      <Controls />
      <Suspense fallback={null}>
        <Routes>
          <Route path="/s/botiverse/computers" element={null} />
          <Route path="/s/botiverse/settings/*" element={<StillLoading />} />
          <Route path="/s/botiverse/search" element={null} />
        </Routes>
      </Suspense>
    </BrowserRouter>,
  );
}

function assertSearchOverSettings() {
  assert.equal(window.location.pathname, "/s/botiverse/search");
  const state = (window.history.state as { usr?: { backgroundLocation?: { pathname: string }; searchFrom?: string } } | null)?.usr;
  assert.equal(state?.backgroundLocation?.pathname, "/s/botiverse/settings/account");
  assert.equal(state?.searchFrom, "/s/botiverse/settings/account");
}

for (const entry of ["search-rail", "search-shortcut"] as const) {
  test(`Search opened (${entry}) while a navigation is pending floats over the page navigated to`, async () => {
    renderApp();
    await act(async () => { fireEvent.click(screen.getByTestId("to-settings")); });
    // The precondition: the browser is on Settings, React still renders Computers.
    assert.equal(window.location.pathname, "/s/botiverse/settings/account");
    assert.equal(screen.getByTestId("rendered").textContent, "/s/botiverse/computers");
    await act(async () => { fireEvent.click(screen.getByTestId(entry)); });
    assertSearchOverSettings();
  });

  // Before React has rendered the pending page even once (the rail entry read
  // the committed location; ⌘K's render-time ref did too until a render ran).
  test(`Search opened (${entry}) in the same event as the navigation floats over the page navigated to`, async () => {
    renderApp();
    await act(async () => { fireEvent.click(screen.getByTestId(`settings-then-${entry}`)); });
    assertSearchOverSettings();
  });
}
