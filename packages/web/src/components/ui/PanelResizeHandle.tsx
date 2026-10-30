import type { HTMLAttributes } from "react";

const SIDE_CLASS = {
  left: "-left-1",
  right: "-right-1",
} as const;

// Tailwind only sees literal class names, so the breakpoint is a lookup rather
// than an interpolated prefix.
const VISIBLE_FROM_CLASS = {
  sm: "sm:block",
  md: "md:block",
} as const;

export interface PanelResizeHandleProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Which edge of the positioned panel the handle straddles. */
  side: keyof typeof SIDE_CLASS;
  /** Breakpoint from which panels sit side by side; the handle is hidden below it. */
  visibleFrom: keyof typeof VISIBLE_FROM_CLASS;
}

/** Drag handle on the divider between two panels: an invisible 8px grab strip
 *  centred on the panel edge, with the resize cursor. It draws nothing: the
 *  panel's own border is the divider, and hovering it changes only the cursor,
 *  as in the signed-in app (its sidebar and thread resizers). A hairline here
 *  used to sit beside the border and darken on hover, so the public page's
 *  dividers looked and behaved differently (cindyz, #wg-rbac task #126).
 *  The parent must be positioned and must not clip its own edge. Pointer
 *  handlers, test ids and any extra classes pass straight through. */
export default function PanelResizeHandle({ side, visibleFrom, className = "", ...props }: PanelResizeHandleProps) {
  return (
    <div
      {...props}
      className={`absolute ${SIDE_CLASS[side]} top-0 bottom-0 z-20 hidden w-2 cursor-col-resize touch-none select-none ${VISIBLE_FROM_CLASS[visibleFrom]} ${className}`.trim()}
    />
  );
}
