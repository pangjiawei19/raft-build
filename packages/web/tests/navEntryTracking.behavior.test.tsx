import assert from "node:assert/strict";
import "./helpers/domSetup";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import api from "../src/api/client";
import { flushProductEvents, resetProductEventsForTest, setProductEventServerIdGetter } from "../src/analytics/track";
import { LeftRail } from "../src/components/layout/LeftRail";
import { MobileTabBar } from "../src/components/layout/MainLayout";
import { AppTopBar } from "../src/components/topbar/AppTopBar";
import { useServerStore } from "../src/store/serverStore";
import { TestIntlProvider } from "./helpers/intl";

// nav_entry_selected (xxchan 2026-10-17): one event per click on a primary
// navigation entry, saying where it leads, which entry it was, and whether the
// user was already there. These teeth click the real entries and read the
// batch that would leave the browser.

const originalMatchMedia = window.matchMedia;
const originalApiGet = api.get;
const originalServerState = useServerStore.getState();
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const hadResizeObserver = typeof globalThis.ResizeObserver !== "undefined";
if (!hadResizeObserver) {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
}

let sent: Array<{ event: string; properties: Record<string, unknown> }> = [];

beforeEach(() => {
  window.matchMedia = ((media: string) => ({
    matches: false, media, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  api.get = (() => new Promise(() => {})) as typeof api.get;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (key: string) => (key === "slock_access_token" ? "token-1" : null), setItem() {}, removeItem() {} },
  });
  useServerStore.setState({
    ...originalServerState,
    current: { id: "server-1", name: "Botiverse", slug: "botiverse", role: "owner" } as never,
    servers: [{ id: "server-1", name: "Botiverse", slug: "botiverse" }] as never,
    serverUnreadCounts: {},
  });
  sent = [];
  resetProductEventsForTest(async (url, init) => {
    if (url.endsWith("/product-events/config")) {
      return new Response(JSON.stringify({ clientEventsAllowed: true }), { status: 200 });
    }
    const body = JSON.parse(String(init?.body)) as { events: typeof sent };
    sent.push(...body.events);
    return new Response(JSON.stringify({ accepted: body.events.length }), { status: 202 });
  });
  setProductEventServerIdGetter(() => "server-1");
});

afterEach(() => {
  cleanup();
  resetProductEventsForTest();
  setProductEventServerIdGetter(() => undefined);
  window.matchMedia = originalMatchMedia;
  api.get = originalApiGet;
  useServerStore.setState(originalServerState, true);
  if (originalLocalStorage) Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
  else delete (globalThis as { localStorage?: unknown }).localStorage;
});

/** Desktop-width web: the search entries open the ⌘K overlay over the current page. */
function desktopWidth(): void {
  window.matchMedia = ((media: string) => ({
    matches: media === "(min-width: 768px)", media, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

async function navEvents(): Promise<Array<[unknown, unknown, unknown]>> {
  await flushProductEvents();
  return sent
    .filter((event) => event.event === "nav_entry_selected")
    .map(({ properties }) => [properties.destination, properties.surface, properties.was_active]);
}

function renderAt(entry: string, ui: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <TestIntlProvider>{ui}</TestIntlProvider>
    </MemoryRouter>,
  );
}

test("rail entries record where they lead, and a click on the current one as a re-tap", async () => {
  renderAt("/s/botiverse/", <LeftRail />);
  fireEvent.click(screen.getByTestId("left-rail-tab-chat"));
  fireEvent.click(screen.getByTestId("left-rail-tab-tasks"));
  fireEvent.click(screen.getByTestId("left-rail-tab-tasks"));
  fireEvent.click(screen.getByTestId("left-rail-tab-activity"));
  fireEvent.click(screen.getByTestId("left-rail-tab-search"));
  fireEvent.click(screen.getByTestId("left-rail-settings"));
  assert.deepEqual(await navEvents(), [
    ["home", "rail", true],
    ["tasks", "rail", false],
    ["tasks", "rail", true],
    ["activity", "rail", false],
    ["search", "rail", false],
    ["settings", "rail", false],
  ]);
  const props = sent.find((event) => event.event === "nav_entry_selected")!.properties;
  assert.deepEqual(Object.keys(props).sort(), ["destination", "display_mode", "surface", "was_active"], "no ids, paths or text");
  assert.ok(sent.some((event) => event.event === "activity_open"), "Activity's own event stays");
});

test("the mobile tab bar records each tab, Home included", async () => {
  renderAt("/s/botiverse/", <MobileTabBar />);
  fireEvent.click(screen.getByLabelText("Home"));
  fireEvent.click(screen.getByLabelText("Tasks"));
  fireEvent.click(screen.getByLabelText("Members"));
  fireEvent.click(screen.getByLabelText("Settings"));
  assert.deepEqual(await navEvents(), [
    ["home", "mobile_tab_bar", true],
    ["tasks", "mobile_tab_bar", false],
    ["members", "mobile_tab_bar", false],
    ["settings", "mobile_tab_bar", false],
  ]);
});

test("the top bar's search field records a top_bar entry", async () => {
  renderAt("/s/botiverse/channel/general", <AppTopBar />);
  fireEvent.click(screen.getByTestId("app-top-bar-search"));
  assert.deepEqual(await navEvents(), [["search", "top_bar", false]]);
});

// John's review of #10176: with the overlay open, useRailMode's railMode names
// the page behind it, so a second click on search read as "not there yet".
test("with the search overlay open, search again is a re-tap and the page behind it is not current", async () => {
  desktopWidth();
  renderAt("/s/botiverse/channel/general", <AppTopBar />);
  fireEvent.click(screen.getByTestId("app-top-bar-search"));
  fireEvent.click(screen.getByTestId("app-top-bar-search"));
  assert.deepEqual(await navEvents(), [["search", "top_bar", false], ["search", "top_bar", true]]);
  cleanup();
  sent = [];

  renderAt("/s/botiverse/channel/general", <LeftRail />);
  fireEvent.click(screen.getByTestId("left-rail-tab-search"));
  fireEvent.click(screen.getByTestId("left-rail-tab-search"));
  fireEvent.click(screen.getByTestId("left-rail-tab-chat"));
  assert.deepEqual(await navEvents(), [
    ["search", "rail", false],
    ["search", "rail", true],
    ["home", "rail", false],
  ]);
});
