import assert from "node:assert/strict";
import "./helpers/domSetup";
import { act, cleanup, render, screen } from "@testing-library/react";
import { BrowserRouter, useLocation, useSearchParams } from "react-router-dom";
import { useLiveSearchParams } from "../src/hooks/useLiveSearchParams";

function SameTickQueryWriters() {
  const location = useLocation();
  const [, setRouterSearchParams] = useSearchParams();
  const [, setLiveSearchParams] = useLiveSearchParams();

  return (
    <>
      <button
        data-testid="run-race"
        onClick={() => {
          // The thread surface navigates first. The still-mounted ChatPanel
          // callback then writes its own param before a render can refresh its
          // React Router searchParams snapshot.
          setRouterSearchParams((previous) => {
            const next = new URLSearchParams(previous);
            next.set("thread", "channel-1:message-1");
            return next;
          }, { replace: true });
          setLiveSearchParams((previous) => {
            const next = new URLSearchParams(previous);
            next.set("chatTab", "tasks");
            return next;
          }, { replace: true });
        }}
      >
        run race
      </button>
      <output data-testid="query">{location.search}</output>
    </>
  );
}

function ClearFocusAfterThreadWrite() {
  const location = useLocation();
  const [, setRouterSearchParams] = useSearchParams();
  const [, setLiveSearchParams] = useLiveSearchParams();

  return (
    <>
      <button
        data-testid="clear-focus-after-thread"
        onClick={() => {
          setRouterSearchParams((previous) => {
            const next = new URLSearchParams(previous);
            next.set("thread", "channel-1:message-1");
            return next;
          }, { replace: true });
          setLiveSearchParams((previous) => {
            const next = new URLSearchParams(previous);
            next.delete("msg");
            next.delete("message");
            return next;
          }, { replace: true });
        }}
      >
        clear focus
      </button>
      <output data-testid="query">{location.search}</output>
    </>
  );
}

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

test("same-tick query writers preserve params committed by another surface", async () => {
  window.history.replaceState({}, "", "/channel/channel-1?view=list");
  render(
    <BrowserRouter>
      <SameTickQueryWriters />
    </BrowserRouter>,
  );

  await act(async () => {
    screen.getByTestId("run-race").click();
    await Promise.resolve();
  });

  const query = new URLSearchParams(window.location.search);
  assert.equal(query.get("view"), "list");
  assert.equal(query.get("thread"), "channel-1:message-1");
  assert.equal(query.get("chatTab"), "tasks");
  assert.match(screen.getByTestId("query").textContent ?? "", /thread=channel-1%3Amessage-1/);
});

test("clearing a focused message preserves a same-tick thread param", async () => {
  window.history.replaceState({}, "", "/channel/channel-1?msg=message-1&view=list");
  render(
    <BrowserRouter>
      <ClearFocusAfterThreadWrite />
    </BrowserRouter>,
  );

  await act(async () => {
    screen.getByTestId("clear-focus-after-thread").click();
    await Promise.resolve();
  });

  const query = new URLSearchParams(window.location.search);
  assert.equal(query.get("view"), "list");
  assert.equal(query.get("thread"), "channel-1:message-1");
  assert.equal(query.has("msg"), false);
  assert.equal(query.has("message"), false);
});

function StaleSurfaceWriter() {
  const [, setLiveSearchParams] = useLiveSearchParams();
  return (
    <button
      data-testid="stale-write"
      onClick={() => {
        setLiveSearchParams((previous) => {
          const next = new URLSearchParams(previous);
          next.set("q", "late query");
          return next;
        }, { replace: true });
      }}
    >
      stale write
    </button>
  );
}

// slock e2e empty-escape-routing:125 (CI run 38508015465): Escape closed the
// search overlay back to /channel/c?msg=m, then a query write from the closing
// /search page merged the channel's params into /search and reopened the
// overlay at /search?msg=m&q=…. A surface whose page the browser already left
// must not write the URL.
test("a surface whose page the browser already left does not navigate back to it", async () => {
  window.history.replaceState({}, "", "/s/x/search?q=seed");
  render(
    <BrowserRouter>
      <StaleSurfaceWriter />
    </BrowserRouter>,
  );
  // The browser moves on without this surface re-rendering first (the close
  // navigation committed; the write was already queued).
  window.history.replaceState({}, "", "/s/x/channel/c?msg=m");
  await act(async () => {
    screen.getByTestId("stale-write").click();
  });
  assert.equal(`${window.location.pathname}${window.location.search}`, "/s/x/channel/c?msg=m");
});
