// Where the workspace strip starts and how much room it has (task #140). Kept
// apart from the strip so the top bar can size the name slot with it.

import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";
import { stripFreePx } from "./workspaceStripLayout";

/** The current-name text cap while the strip shows (AppTopBar's max-w). */
export const NAME_MAX_PX = 120;
/**
 * The ChevronDown after the name while the strip shows: 16px (Raft Design
 * System `.rf-ws .rf-i`). AppTopBar renders it at this size with an explicit
 * size class, so raft-ui's default icon sizing inside a Button cannot change
 * it: the slot below is reserved from this number, and a chevron wider than
 * the reservation moves the strip whenever the longest name is current.
 */
export const NAME_CHEVRON_PX = 16;
/** Name button chrome around the text while the strip shows: padding + gap + chevron. */
export const NAME_CHROME_PX = 8 + 8 + NAME_CHEVRON_PX + 8;

/**
 * Layout of the name + strip, as a function of the workspace LIST only (never
 * of which workspace is current), so switching moves nothing: the name slot is
 * as wide as the longest name (capped at NAME_MAX_PX), and the strip starts
 * after that slot, so no avatar shifts when the current workspace changes.
 *
 * `free`: width the avatars may use between the slot's end and the history
 * controls (see stripFreePx). `slotPx`: width reserved for the name button
 * while the strip shows.
 */
export function useStripLayout(nameRef: RefObject<HTMLElement | null>, names: readonly string[]): { free: number; slotPx: number } {
  const [layout, setLayout] = useState({ free: 0, slotPx: 0 });
  const namesKey = names.join("\n");
  useLayoutEffect(() => {
    const name = nameRef.current;
    const region = name?.parentElement;
    if (!name || !region) return;
    const ctx = document.createElement("canvas").getContext("2d");
    const measure = () => {
      const label = name.querySelector<HTMLElement>("[data-workspace-name]");
      let widest = label ? label.scrollWidth : 0;
      if (ctx && label) {
        ctx.font = getComputedStyle(label).font;
        for (const n of namesKey.split("\n")) widest = Math.max(widest, Math.ceil(ctx.measureText(n).width));
      }
      const nameSlotPx = Math.min(NAME_MAX_PX, widest);
      // The button's chrome around the text in its strip-shown shape: padding
      // + border (per theme) + the gap before the chevron + the chevron. Built
      // only from values that are the same whether the strip is shown or not:
      // measuring the live button gave a different answer in each state, and
      // near the threshold the strip flickered on and off (Josh, #110 review).
      const button = label?.closest("button");
      let chromePx = NAME_CHROME_PX;
      if (button && label?.parentElement) {
        const b = getComputedStyle(button);
        const px = (v: string) => Number.parseFloat(v) || 0;
        chromePx = Math.ceil(
          px(b.paddingLeft) + px(b.paddingRight) + px(b.borderLeftWidth) + px(b.borderRightWidth)
          + px(getComputedStyle(label.parentElement).columnGap) + NAME_CHEVRON_PX,
        );
      }
      // Measured against the STRIP-SHOWN layout (slot + chevron, no avatar),
      // not the button's current box: with the strip hidden the button also
      // carries the avatar, and measuring that would keep the strip hidden
      // forever right at the threshold.
      const slotRight = name.getBoundingClientRect().left + chromePx + nameSlotPx;
      // The history controls are the region's last item (ml-auto). Use the
      // region's right edge minus their width, NOT their current position:
      // when a resize leaves the old (wider) strip overflowing, the controls
      // get pushed against it, so their position depended on the strip itself
      // and one resize could hide the strip and bring it back (Josh, #110).
      const history = region.querySelector<HTMLElement>("[data-topbar-leading-end]");
      // The region's own right padding is not room for avatars (the web bar
      // pads the region; the desktop title bar does not).
      const regionPaddingRight = Number.parseFloat(getComputedStyle(region).paddingRight) || 0;
      const limit = region.getBoundingClientRect().right - regionPaddingRight - (history ? history.getBoundingClientRect().width : 0);
      const free = stripFreePx(limit - slotRight);
      const slotPx = chromePx + nameSlotPx;
      setLayout((prev) => (prev.free === free && prev.slotPx === slotPx ? prev : { free, slotPx }));
    };
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(region);
    ro?.observe(name);
    window.addEventListener("resize", measure);
    // Canvas measures with whatever font is loaded; re-measure once the display font arrives.
    void document.fonts?.ready.then(measure);
    return () => { ro?.disconnect(); window.removeEventListener("resize", measure); };
  }, [nameRef, namesKey]);
  return layout;
}
