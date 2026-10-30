import assert from "node:assert/strict";
import { cleanup, render } from "@testing-library/react";
import Modal from "../src/components/Modal";
import DismissBackdrop from "../src/components/ui/DismissBackdrop";
import Lightbox from "../src/components/ui/Lightbox";
import { Popover } from "@botiverse/raft-ui";
import SelectionPopover, { SelectionPopoverPanel } from "../src/components/ui/SelectionPopover";
import { DISMISS_LAYER_ATTR } from "../src/components/ui/dismissLayer";
import { TestIntlProvider } from "./helpers/intl";

afterEach(() => cleanup());

// The marker must sit on the element that exists only while the layer is open
// (see dismissLayer.ts). These are the shared carriers the desktop shell relies
// on; the contract scan only proves a file mentions the marker.

test("Modal's root (the click-to-dismiss backdrop) carries the dismiss-layer marker", () => {
  render(<TestIntlProvider><Modal onClose={() => {}}><div data-testid="inner" /></Modal></TestIntlProvider>);
  const root = document.querySelector(`[${DISMISS_LAYER_ATTR}]`);
  assert.ok(root, "marker present");
  assert.ok(root!.contains(document.querySelector('[data-testid="inner"]')), "marker is on the backdrop root, above the card");
});

test("DismissBackdrop carries the marker", () => {
  render(<DismissBackdrop onDismiss={() => {}} />);
  assert.ok(document.querySelector(`[${DISMISS_LAYER_ATTR}]`));
});

test("Lightbox's backdrop root carries the marker even when callers pass extra attributes", () => {
  render(<TestIntlProvider><Lightbox onClose={() => {}} data-testid="lb"><span>x</span></Lightbox></TestIntlProvider>);
  const lb = document.querySelector('[data-testid="lb"]');
  assert.ok(lb && lb.hasAttribute(DISMISS_LAYER_ATTR));
});

test("SelectionPopover (shared picker popup) carries the marker on its root", () => {
  // It is the positioned content of a raft-ui Popover, portalled while open.
  render(<TestIntlProvider><Popover open><SelectionPopover title="t" options={[]} /></Popover></TestIntlProvider>);
  const layer = document.querySelector(`[${DISMISS_LAYER_ATTR}]`);
  assert.ok(layer);
  assert.equal(layer!.getAttribute("data-slot"), "popover-content");
});

test("SelectionPopoverPanel (the bare panel a caller places itself) carries the marker", () => {
  render(<TestIntlProvider><SelectionPopoverPanel title="t" options={[]} /></TestIntlProvider>);
  assert.ok(document.querySelector(`[${DISMISS_LAYER_ATTR}]`));
});
