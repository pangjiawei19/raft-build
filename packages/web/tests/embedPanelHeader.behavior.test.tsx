import assert from "node:assert/strict";
import "./helpers/domSetup";
import { cleanup, render } from "@testing-library/react";

// The embed mode is LATCHED at module load from the entry URL (see embed.ts), so the
// URL must be set before PanelHeader is imported. Each case therefore imports a fresh
// module graph — which is also exactly how the real app behaves: one decision, taken
// once, before the first paint.
async function renderHeader(
  search: string,
  opts: { actions?: boolean; subtitle?: string } = {},
) {
  window.history.replaceState({}, "", `/${search}`);
  // The mode latches on first read (production decides once, at entry). Reset the latch
  // between cases so each one exercises a real entry URL.
  const { __embedTestInternals } = await import("../src/embed");
  __embedTestInternals.reset();
  const { default: PanelHeader } = await import("../src/components/ui/PanelHeader");
  return render(
    <PanelHeader
      title="Computers"
      subtitle={opts.subtitle}
      containerProps={{ "data-testid": "panel-header" }}
      actions={opts.actions === false ? undefined : <button data-testid="add-computer">+</button>}
    />,
  );
}

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

test("host-shell: the title bar is GONE on the first render — no flash, no second header", async () => {
  // The native WebView already draws a title bar. If web drew one too, that is the
  // double-header bug. And if this decision lived in an effect, the header would paint
  // on frame 1 and vanish on frame 2 — which every "final DOM" assertion would still
  // call green while the user watched it flash.
  const { queryByTestId } = await renderHeader("?embed=raft-settings-v1&shell=host");
  assert.equal(queryByTestId("panel-header"), null, "web must not render a second title bar");
  assert.equal(queryByTestId("panel-header")?.textContent ?? "", "");
});

test("host-shell: the ACTIONS survive — the + does not die with the header", async () => {
  // THE POINT (@artin's original question). The pre-contract client hid the whole
  // header, which silently deleted Computers' "+" and Connected Apps' "Register App".
  // Dropping the chrome must not drop the affordance.
  const { queryByTestId } = await renderHeader("?embed=raft-settings-v1&shell=host");
  assert.ok(queryByTestId("add-computer"), "the page action must survive host-shell embed");
  assert.ok(queryByTestId("panel-header-embed-actions"), "actions render in their own compact row");
});

test("host-shell with no actions: nothing at all is rendered", async () => {
  const { queryByTestId } = await renderHeader("?embed=raft-settings-v1&shell=host", { actions: false });
  assert.equal(queryByTestId("panel-header"), null);
  assert.equal(queryByTestId("panel-header-embed-actions"), null);
});

test("web-shell: the header STAYS (there is no native title bar to duplicate)", async () => {
  const { queryByTestId } = await renderHeader("?embed=raft-settings-v1&shell=web");
  assert.ok(queryByTestId("panel-header"), "shell=web keeps our header");
  assert.ok(queryByTestId("add-computer"));
});

test("not embedded: the header stays, exactly as before", async () => {
  const { queryByTestId } = await renderHeader("");
  assert.ok(queryByTestId("panel-header"));
  assert.ok(queryByTestId("add-computer"));
});

test("normal header gives title/subtitle the shrinkable column and keeps actions fixed", async () => {
  const { getByRole, getByTestId, getByText } = await renderHeader("", {
    subtitle: "Managed description",
  });

  const heading = getByRole("heading", { name: "Computers" });
  const titleColumn = heading.closest(".min-w-0.flex-1");
  assert.ok(titleColumn, "title and subtitle must own the shrinkable column");
  assert.equal(getByText("Managed description").parentElement, titleColumn);

  const action = getByTestId("add-computer");
  const actionColumn = action.parentElement;
  assert.ok(actionColumn);
  assert.ok(actionColumn.classList.contains("shrink-0"));
  assert.equal(actionColumn.parentElement, getByTestId("panel-header"));
});

test("an unknown embed version renders a normal page, not a half-applied contract", async () => {
  const { queryByTestId } = await renderHeader("?embed=raft-settings-v2&shell=host");
  assert.ok(queryByTestId("panel-header"), "unknown version must fall back to a normal page");
});

test("legacy embed=1 is NOT honoured — it falls back to a normal page", async () => {
  // @artin: 不用兼容. An old client gets one extra web header — NOT the double header.
  const { queryByTestId } = await renderHeader("?embed=1");
  assert.ok(queryByTestId("panel-header"));
});

test("the header icon tile is neutral unless the panel is a channel location", async () => {
  // Raft Design System: the yellow "you are here" sticker belongs to a channel
  // (#) head only; Tasks / Activity / Saved / Graph / Settings get the neutral
  // tile (`rf-chan` / `rf-tile`: sunken fill, ink-2 glyph, no visible edge).
  // A plain tile is not a sticker, so it never takes the die-cut ring that
  // stickers wear in dark mode.
  window.history.replaceState({}, "", "/");
  const { __embedTestInternals } = await import("../src/embed");
  __embedTestInternals.reset();
  const { default: PanelHeader } = await import("../src/components/ui/PanelHeader");
  const { container, rerender } = render(<PanelHeader title="Saved" icon={<svg />} />);
  const neutral = container.querySelector('[data-slot="panel-header-icon"]');
  assert.ok(neutral, "the icon tile renders");
  assert.match(neutral.className, /\bbg-fill-muted\b/);
  assert.match(neutral.className, /\bborder-transparent\b/);
  assert.match(neutral.className, /\btext-foreground-muted\b/);
  assert.match(neutral.className, /(?:^|\s)ring-0(?:\s|$)/, "no die-cut ring round a plain tile");
  assert.doesNotMatch(neutral.className, /ring-\[1\.5px\]/);
  assert.doesNotMatch(neutral.className, /\bbg-brand\b/);
  assert.doesNotMatch(neutral.className, /\bborder-sticker-ink\b/);

  rerender(<PanelHeader title="general" icon={<svg />} iconTone="location" />);
  const location = container.querySelector('[data-slot="panel-header-icon"]');
  assert.ok(location);
  assert.match(location.className, /\bbg-brand\b/);
  assert.match(location.className, /\bborder-sticker-ink\b/);
  assert.doesNotMatch(location.className, /\bbg-fill-muted\b/);
});
