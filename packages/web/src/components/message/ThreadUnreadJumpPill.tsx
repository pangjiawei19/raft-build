import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useIntl } from "react-intl";
import { ArrowDown, ArrowUp, X } from "lucide-react";

import { useMessagePlacement } from "../../hooks/useMessagePlacement";
import type { MessagePlacement } from "../../hooks/useMessagePlacement";
import { useParentUnreadThreadsForJump } from "../../hooks/useParentThreadUnread";
import type { FollowedThread } from "../../store/threadStore";
import { THREAD_UNREAD_BADGE_FLAG_KEY, useServerFeatureFlag } from "../../store/serverFeatureFlags";

/** The chat's loaded messages, to place unread threads whose parent row is not rendered. */
export type LoadedMessageRange = {
  /** createdAt of the oldest loaded message. */
  oldestAt: string | null;
  /** createdAt of the newest loaded message. */
  newestAt: string | null;
  /** Newer messages exist past the loaded ones (reading history). */
  hasNewer: boolean;
};

function placeUnrendered(parentAt: string | undefined, range: LoadedMessageRange): MessagePlacement {
  const time = parentAt ? Date.parse(parentAt) : Number.NaN;
  if (range.hasNewer && range.newestAt && !Number.isNaN(time) && time > Date.parse(range.newestAt)) return "below";
  // Not loaded and not newer: older history above (or an older server without the parent time).
  return "above";
}

/**
 * One pill for the unread followed threads of a channel whose parent message
 * is off screen (a parent on screen already shows its unread replies):
 * - some below: at the bottom, beside "Back to bottom", "Next unread thread
 *   (N)" goes to the nearest one below;
 * - only above: at the top, "Earliest unread thread (N)"
 *   goes to the topmost one.
 * So repeated clicks walk the channel top to bottom and then start over at
 * the top; N (all unread threads of the channel) shrinks as threads are read,
 * and ✕ stops it until the count changes. A click scrolls to the parent and
 * flashes it; it does not open the thread. Nothing is remembered between
 * clicks. Gated by `thread_unread_badge_v0`; renders nothing of its own when off.
 *
 * The pill has the shape, weight and height of the "Back to bottom" button.
 */
export function ThreadUnreadJumpPill({
  channelId,
  onJumpToMessage,
  bottomButton,
  loadedRange,
  renderKey,
}: {
  channelId: string;
  /** Scroll the channel's chat to this parent message and flash it. */
  onJumpToMessage: (messageId: string) => void;
  /** The chat's "back to bottom" button, laid out beside the bottom pill. */
  bottomButton?: ReactNode;
  loadedRange: LoadedMessageRange;
  /** Changes when the rendered message rows may have changed. */
  renderKey: string;
}) {
  const { formatMessage } = useIntl();
  const enabled = useServerFeatureFlag(THREAD_UNREAD_BADGE_FLAG_KEY).enabled;
  // Unread threads of this channel, top to bottom by parent message.
  const threads = useParentUnreadThreadsForJump(enabled ? channelId : null);
  const parentIds = useMemo(() => threads.map((thread) => thread.parentMessageId), [threads]);
  const placements = useMessagePlacement(parentIds, renderKey);
  // Dismissed per channel until the number of unread threads changes.
  const [dismissed, setDismissed] = useState<{ channelId: string; count: number } | null>(null);

  const { above, below } = useMemo(() => {
    const aboveThreads: FollowedThread[] = [];
    const belowThreads: FollowedThread[] = [];
    for (const thread of threads) {
      const placement = placements.get(thread.parentMessageId)
        ?? placeUnrendered(thread.parentMessageCreatedAt, loadedRange);
      if (placement === "above") aboveThreads.push(thread);
      else if (placement === "below") belowThreads.push(thread);
    }
    return { above: aboveThreads, below: belowThreads };
  }, [loadedRange, placements, threads]);

  const total = threads.length;
  const isDismissed = dismissed?.channelId === channelId && dismissed.count === total;
  const dismiss = useCallback(() => setDismissed({ channelId, count: total }), [channelId, total]);

  // Below first: the nearest one below. Only when none is below: the earliest above.
  const nearestBelow = below[0];
  const earliestAbove = above[0];

  const renderPill = (direction: "up" | "down", target: FollowedThread) => (
    <div
      // Same shape, weight and height as the "back to bottom" button: a paper
      // control with the ink control edge (DS small outline button), never a
      // coloured wash.
      className={`z-10 flex h-8 w-fit items-center overflow-hidden rounded-control border-[1.5px] border-line-strong bg-layer-card text-footnote font-bold text-foreground ${
        direction === "up" ? "absolute inset-x-0 top-3 mx-auto" : ""
      }`}
      data-testid="thread-unread-jump-pill"
      data-placement={direction === "up" ? "top" : "bottom"}
    >
      <button
        type="button"
        className="flex h-full items-center gap-1.5 pl-3 pr-1.5 outline-none hover:bg-fill-pressed focus-visible:bg-fill-pressed"
        onClick={() => onJumpToMessage(target.parentMessageId)}
      >
        {direction === "up" ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />}
        {formatMessage(
          { id: direction === "up" ? "message.chatPanel.threadUnreadJumpEarliest" : "message.chatPanel.threadUnreadJumpNext" },
          { count: total },
        )}
      </button>
      <button
        type="button"
        className="flex h-full items-center pl-1 pr-2.5 text-foreground-muted outline-none hover:bg-fill-pressed hover:text-foreground focus-visible:bg-fill-pressed focus-visible:text-foreground"
        aria-label={formatMessage({ id: "message.chatPanel.threadUnreadDismiss" })}
        onClick={dismiss}
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  );

  const bottomPill = !isDismissed && nearestBelow ? renderPill("down", nearestBelow) : null;
  const topPill = !isDismissed && !nearestBelow && earliestAbove ? renderPill("up", earliestAbove) : null;

  return (
    <>
      {topPill}
      {(bottomPill || bottomButton) && (
        <div className="absolute inset-x-0 bottom-3 z-10 mx-auto flex w-fit items-center gap-2" data-testid="chat-bottom-controls">
          {bottomButton}
          {bottomPill}
        </div>
      )}
    </>
  );
}
