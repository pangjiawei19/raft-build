/**
 * A borderless button on the frame (the top bar, like the rail): on-frame ink
 * and the frame's pressed wash for hover, press and an open menu. Frame items
 * use raft-ui Button `variant="on-frame"`; this is left only for the workspace
 * strip's 32px avatar buttons, because on the frame raft-ui makes every icon
 * size the 36px frame item and the strip's slot (STRIP_SLOT_PX) is 32 + 4.
 */
export const ON_FRAME_GHOST_BUTTON =
  "text-foreground-on-frame hover:bg-fill-frame-pressed active:bg-fill-frame-pressed aria-expanded:bg-fill-frame-pressed";
