import assert from "node:assert/strict";
import "./helpers/domSetup";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useRailMode } from "../src/hooks/useSidebarTab";
import { useServerStore } from "../src/store/serverStore";

// The ⌘K search overlay floats over the current page: the URL becomes /search
// but the page behind it stays. The rail mode (which drives the sidebar's
// content) must follow that page, or the sidebar behind the overlay falls back
// to the Chat channel list (seen from Settings: chat-tab-from-machine-detail
// 800px flake, skyzh 2026-10-14).

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
});

function railModeAt(entry: { pathname: string; state?: unknown }, wide: boolean): string {
  window.matchMedia = matchMediaStub(wide);
  useServerStore.setState({ ...originalServerState, current: { id: "s1", name: "Botiverse", slug: "botiverse" } as never });
  let seen = "";
  function Probe() {
    seen = useRailMode().railMode;
    return null;
  }
  render(<MemoryRouter initialEntries={[entry]}><Probe /></MemoryRouter>);
  return seen;
}

const overlayOver = (pathname: string) => ({
  pathname: "/s/botiverse/search",
  state: { searchFrom: pathname, backgroundLocation: { pathname, search: "" } },
});

test("behind the search overlay the rail mode is the page the overlay floats over", () => {
  assert.equal(railModeAt(overlayOver("/s/botiverse/settings/account"), true), "settings");
  assert.equal(railModeAt(overlayOver("/s/botiverse/members"), true), "members");
  assert.equal(railModeAt(overlayOver("/s/botiverse/computers"), true), "computers");
  assert.equal(railModeAt(overlayOver("/s/botiverse/channel/general"), true), "chat");
});

test("full-page search (no overlay) is still the search mode", () => {
  // Phone width: the overlay is off, /search is the page itself.
  assert.equal(railModeAt(overlayOver("/s/botiverse/settings/account"), false), "search");
  // Desktop width with nothing to float over (a fresh /search link): full page.
  assert.equal(railModeAt({ pathname: "/s/botiverse/search" }, true), "search");
});


test("RaftBench direct and trailing-slash links keep the Settings secondary sidebar", () => {
  assert.equal(railModeAt({ pathname: "/s/botiverse/raftbench" }, true), "settings");
  assert.equal(railModeAt({ pathname: "/s/botiverse/raftbench/" }, false), "settings");
  assert.equal(railModeAt(overlayOver("/s/botiverse/raftbench"), true), "settings");
});
