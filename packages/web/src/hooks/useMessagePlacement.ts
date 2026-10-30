import { useEffect, useState } from "react";

/** Where a message row is relative to what the chat shows right now. */
export type MessagePlacement = "above" | "visible" | "below";

const NO_PLACEMENTS: ReadonlyMap<string, MessagePlacement> = new Map();

const messageRowSelector = (id: string) => `[data-timeline-message-id="${CSS.escape(id)}"]`;

function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

/**
 * Placement of each message row in `ids` that is rendered in the document,
 * reported by an IntersectionObserver on the rows (no scroll handler). A row
 * that is not rendered (not loaded) is absent from the map; the caller decides
 * where it sits.
 *
 * `renderKey` changes when the rendered rows may have changed (messages loaded
 * or added): the rows are looked up and observed again. Placements already
 * known are kept until the new observer reports, so the pills do not flicker
 * on every new message.
 */
export function useMessagePlacement(ids: readonly string[], renderKey: string): ReadonlyMap<string, MessagePlacement> {
  const key = `${renderKey}#${ids.join("|")}`;
  const [placements, setPlacements] = useState<ReadonlyMap<string, MessagePlacement>>(NO_PLACEMENTS);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const rows = ids
      .map((id) => [id, document.querySelector<HTMLElement>(messageRowSelector(id))] as const)
      .filter((entry): entry is readonly [string, HTMLElement] => entry[1] !== null);
    if (rows.length === 0) return;
    const idByRow = new Map(rows.map(([id, row]) => [row, id]));
    const root = scrollParent(rows[0]![1]);
    const observer = new IntersectionObserver((entries) => {
      setPlacements((previous) => {
        const next = new Map(previous);
        for (const entry of entries) {
          const id = idByRow.get(entry.target as HTMLElement);
          if (!id) continue;
          const bounds = entry.rootBounds ?? root?.getBoundingClientRect() ?? null;
          next.set(id, entry.isIntersecting
            ? "visible"
            : bounds && entry.boundingClientRect.bottom <= bounds.top ? "above" : "below");
        }
        return next;
      });
    }, { root, threshold: 0 });
    for (const [, row] of rows) observer.observe(row);
    return () => observer.disconnect();
    // `key` stands for ids and renderKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return placements;
}
