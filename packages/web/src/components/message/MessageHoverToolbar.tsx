import { MessageItemToolbar, MessageItemToolbarButton, ThreadIcon } from "@botiverse/raft-ui";
import type { MouseEvent } from "react";
import { useIntl } from "react-intl";
import { Bookmark, SmilePlus } from "lucide-react";
import { useMediaQuery } from "../../hooks/effectPrimitives";

/**
 * MessageHoverToolbar — the "骑线按钮组" (stdrc, task #44).
 *
 * The DS hover toolbar: a popover strip of 32px icon buttons that rides on a
 * message row's top edge, revealed on row hover. Built on RUI's
 * MessageItemToolbar and MessageItemToolbarButton, whose recipe owns its
 * placement, surface and the saved (active) state.
 *
 * The parent row must be `position: relative` (this renders absolutely against
 * it) and must allow vertical overflow (ChatPanel / ThreadPanel:
 * `overflow: clip visible`) so the pill isn't clipped above the row.
 */
export interface MessageHoverToolbarProps {
  /** Whether the message is currently saved/bookmarked. */
  isSaved: boolean;
  /** Whether the reaction picker is open (keeps the reaction button lit). */
  reactionActive: boolean;
  /** Hide the thread-reply action (e.g. inside a thread panel). */
  hideThreadActions?: boolean;
  /** System messages get no reaction action. */
  isSystem?: boolean;
  /** Read access does not imply reaction mutation authority. */
  canReact?: boolean;
  onReplyInThread: (e: MouseEvent) => void;
  onReactionClick: (e: MouseEvent<HTMLButtonElement>) => void;
  onToggleSave: (e: MouseEvent) => void;
}

export function MessageHoverToolbar({
  isSaved,
  reactionActive,
  hideThreadActions,
  isSystem,
  canReact = true,
  onReplyInThread,
  onReactionClick,
  onToggleSave,
}: MessageHoverToolbarProps) {
  const coarsePointer = useMediaQuery("(pointer: coarse)");
  const { formatMessage } = useIntl();

  if (coarsePointer) return null;

  return (
    <MessageItemToolbar
      data-message-affordance="toolbar"
      // Keep the toolbar hit-testable while invisible so hovering its upper half
      // across the row boundary does not drop row hover. While the reaction
      // picker is open its button carries data-popup-open, and the raft row
      // shows the toolbar for any open popup inside it.
      className="pointer-events-auto"
    >
      {!hideThreadActions && (
        <MessageItemToolbarButton
          onClick={onReplyInThread}
          aria-label={formatMessage({ id: "message.messageItem.replyInThread" })}
          data-message-affordance="thread"
        >
          <ThreadIcon width={18} height={18} />
        </MessageItemToolbarButton>
      )}
      {!isSystem && canReact && (
        <MessageItemToolbarButton
          onClick={onReactionClick}
          aria-label={formatMessage({ id: "message.messageItem.addReaction" })}
          aria-expanded={reactionActive}
          data-popup-open={reactionActive ? "" : undefined}
          data-message-affordance="reaction"
        >
          <SmilePlus size={18} strokeWidth={2} />
        </MessageItemToolbarButton>
      )}
      <MessageItemToolbarButton
        active={isSaved}
        onClick={onToggleSave}
        aria-label={isSaved ? formatMessage({ id: "message.messageItem.removeFromSaved" }) : formatMessage({ id: "message.messageItem.saveMessage" })}
        data-message-affordance="bookmark"
      >
        <Bookmark size={18} fill={isSaved ? "currentColor" : "none"} />
      </MessageItemToolbarButton>
    </MessageItemToolbar>
  );
}
