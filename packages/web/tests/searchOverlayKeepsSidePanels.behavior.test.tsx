import assert from "node:assert/strict";
import "./helpers/domSetup";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BrowserRouter, useLocation, useNavigate } from "react-router-dom";
import { __testInternals } from "../src/components/layout/MainLayout";
import { overlayCloseTarget, resolveSearchOverlayBackground, searchEntryState } from "../src/components/search/searchOverlayLocation";
import { useThreadStore } from "../src/store/threadStore";

// Task #763: opening the ⌘K search overlay over a channel with a side thread
// open must not touch the thread. The overlay's URL is /search?q=… (no
// `?thread=`); MainLayout's REAL right-panel URL sync used to read it, close the
// thread, and reopen it from the background URL when the overlay closed — the
// panel unmounted, refetched and flashed "loading" both ways.

const { useRightPanelUrlSync } = __testInternals;
const originalThreadState = useThreadStore.getState();
const CHANNEL = "/s/b/channel/c";
const THREAD_SEARCH = "?thread=c%3Am1";

function Shell() {
  useRightPanelUrlSync();
  const location = useLocation();
  const navigate = useNavigate();
  const bg = resolveSearchOverlayBackground(location);
  return (
    <>
      <button
        type="button"
        data-testid="open-search"
        onClick={() => navigate("/s/b/search?q=kubernetes", { state: searchEntryState({ pathname: location.pathname, search: location.search }) })}
      >
        search
      </button>
      <button type="button" data-testid="close-search" onClick={() => { if (bg) navigate(overlayCloseTarget(bg)); }}>
        close
      </button>
      {bg ? <div data-testid="overlay">overlay</div> : null}
      <output data-testid="real-location">{location.pathname}{location.search}</output>
    </>
  );
}

beforeEach(() => {
  (window as { raftDesktop?: unknown }).raftDesktop = { isDesktop: true };
  window.history.replaceState(null, "", `${CHANNEL}${THREAD_SEARCH}`);
  useThreadStore.setState({ openParentChannelId: "c", openParentMessageId: "m1" });
});

afterEach(() => {
  cleanup();
  useThreadStore.setState(originalThreadState, true);
  delete (window as { raftDesktop?: unknown }).raftDesktop;
  window.history.replaceState(null, "", "/");
});

test("opening and closing the search overlay leaves the open side thread untouched", async () => {
  const closeThread = useThreadStore.getState().closeThread;
  let closeCalls = 0;
  useThreadStore.setState({ closeThread: () => { closeCalls += 1; closeThread(); } });
  render(
    <BrowserRouter>
      <Shell />
    </BrowserRouter>,
  );

  await act(async () => { fireEvent.click(screen.getByTestId("open-search")); });
  assert.ok(screen.getByTestId("overlay"));
  assert.equal(screen.getByTestId("real-location").textContent, "/s/b/search?q=kubernetes", "the overlay URL carries no panel params");
  assert.equal(useThreadStore.getState().openParentMessageId, "m1", "the side thread stays open behind the overlay");

  await act(async () => { fireEvent.click(screen.getByTestId("close-search")); });
  assert.ok(screen.queryByTestId("overlay") === null);
  assert.equal(screen.getByTestId("real-location").textContent, `${CHANNEL}${THREAD_SEARCH}`);
  assert.equal(useThreadStore.getState().openParentMessageId, "m1");
  assert.equal(closeCalls, 0, "the thread was never closed and reopened");
});

test("a panel change while the overlay is up is not written onto the overlay URL", async () => {
  render(
    <BrowserRouter>
      <Shell />
    </BrowserRouter>,
  );
  await act(async () => { fireEvent.click(screen.getByTestId("open-search")); });
  await act(async () => { useThreadStore.setState({ openParentChannelId: "c", openParentMessageId: "m2" }); });
  assert.equal(screen.getByTestId("real-location").textContent, "/s/b/search?q=kubernetes");
});
