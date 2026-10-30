import assert from "node:assert/strict";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AnnouncementModal from "../src/components/AnnouncementModal";
import { useAnnouncementStore } from "../src/store/announcementStore";
import { TestIntlProvider } from "./helpers/intl";
import * as analytics from "../src/analytics/track";
import { useServerStore } from "../src/store/serverStore";
import type { Server } from "../src/store/serverStore";
import api from "../src/api/client";
const row = { id: "90000000-0000-4000-8000-000000000001", title: "Analytics", pages: [{ body: "Body" }], publishedAt: "2026-01-01", startsAt: "2026-01-01", endsAt: null, locale: "en" as const, deliveryVersion: 7, cta: { label: "Visit", href: "https://example.com" } };
function tree(suppressed = false) { return <MemoryRouter><TestIntlProvider locale="en"><AnnouncementModal suppressed={suppressed} /></TestIntlProvider></MemoryRouter>; }
beforeEach(() => { useServerStore.setState({ current: { id: "10000000-0000-4000-8000-000000000001" } as Server }); });
afterEach(() => { cleanup(); useAnnouncementStore.getState().reset(); vi.restoreAllMocks(); });
test("background/suppressed content is not shown; visible rendering emits once per version", () => {
  const track = vi.spyOn(analytics, "trackEvent").mockImplementation(() => {});
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  useAnnouncementStore.setState({ pending: [row] });
  const view = render(tree(true));
  assert.equal(track.mock.calls.length, 0);
  view.rerender(tree());
  assert.equal(track.mock.calls.length, 0);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  act(() => { document.dispatchEvent(new window.Event("visibilitychange")); });
  assert.deepEqual(track.mock.calls, [["announcement_shown", { announcement_id: row.id, delivery_version: 7 }, { serverId: "10000000-0000-4000-8000-000000000001" }]]);
  view.rerender(tree(true)); view.rerender(tree());
  assert.equal(track.mock.calls.length, 1);
});
test("primary interaction precedes synchronous navigation and uses no content/URL fields", () => {
  const order: string[] = [];
  const track = vi.spyOn(analytics, "trackEvent").mockImplementation((event) => { order.push(event); });
  vi.spyOn(api, "post").mockResolvedValue({ data: {} });
  vi.spyOn(window, "open").mockImplementation(() => { order.push("navigate"); return null; });
  useAnnouncementStore.setState({ pending: [{ ...row, id: "90000000-0000-4000-8000-000000000002" }] });
  render(tree());
  fireEvent.click(screen.getByRole("button", { name: "Visit" }));
  assert.ok(order.indexOf("announcement_interacted") < order.indexOf("navigate"));
  assert.deepEqual(track.mock.calls.find(([event]) => event === "announcement_interacted")?.[1], { announcement_id: "90000000-0000-4000-8000-000000000002", delivery_version: 7, action: "primary", has_cta: true });
});


test("account popup waits for Server attribution and account reset permits another shown sample", () => {
  const track = vi.spyOn(analytics, "trackEvent").mockImplementation(() => {});
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  useServerStore.setState({ current: null });
  useAnnouncementStore.setState({ pending: [row] });
  render(tree());
  assert.equal(track.mock.calls.length, 0);
  act(() => { useServerStore.setState({ current: { id: "10000000-0000-4000-8000-000000000001" } as Server }); });
  assert.equal(track.mock.calls.filter(([event]) => event === "announcement_shown").length, 1);
  act(() => { useAnnouncementStore.getState().reset(); });
  act(() => { useAnnouncementStore.setState({ pending: [row] }); });
  assert.equal(track.mock.calls.filter(([event]) => event === "announcement_shown").length, 2);
});

for (const action of ["secondary", "close", "escape", "primary"] as const) {
  test(`interaction identifies ${action} without confusing dismissal with CTA conversion`, () => {
    const track = vi.spyOn(analytics, "trackEvent").mockImplementation(() => {});
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const hasCta = action !== "primary";
    useAnnouncementStore.setState({ pending: [{ ...row, cta: hasCta ? row.cta : undefined }] });
    render(tree());
    if (action === "secondary" || action === "primary") fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    else if (action === "close") fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    else fireEvent.keyDown(document, { key: "Escape" });
    const events = track.mock.calls.filter(([event]) => event === "announcement_interacted");
    assert.equal(events.length, 1);
    assert.deepEqual(events[0][1], { announcement_id: row.id, delivery_version: 7, action, has_cta: hasCta });
    assert.equal(open.mock.calls.length, 0);
    assert.equal(post.mock.calls.length, 1);
  });
}
