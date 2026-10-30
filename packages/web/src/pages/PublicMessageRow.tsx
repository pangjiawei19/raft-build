import type { Channel } from "../store/channelStore";
import MessageItem from "../components/message/MessageItem";
import type { MentionEntry, ReadOnlySenderProjection } from "../components/message/MessageItem";
import type { Message } from "../store/messageStore";
import type { OpenThreadRequest } from "../store/threadStore";
import { useMemo } from "react";
import { hydrateThreadRepliesScope } from "../store/threadRepliesReadModel";
import type { PublicMessage } from "./PublicServerPage";

const EMPTY_PUBLIC_MENTION_MAP = new Map<string, MentionEntry>();

export function PublicMessageRow({
  message,
  adaptedMessage,
  channels,
  parentChannelId,
  sender,
  onNavigateChannel,
  onOpenThread,
}: {
  message: PublicMessage;
  adaptedMessage: Message;
  channels: Channel[];
  parentChannelId: string;
  sender: ReadOnlySenderProjection | undefined;
  onNavigateChannel: (channel: Channel) => void;
  onOpenThread: (request: OpenThreadRequest) => void;
}) {
  const { threadId, replyCount, latestReplies, lastReplyAt } = message;
  // The same inline reply preview a member sees. Public replies carry no
  // sender id, so each gets a display-local key (like the parent rows); the
  // preview card falls back to the name and avatar sent with the reply.
  const replyScope = useMemo(() => (threadId && replyCount > 0 && latestReplies && latestReplies.length > 0
    ? hydrateThreadRepliesScope(latestReplies.map((reply) => ({
      ...reply,
      senderId: `public:${reply.senderType}:${reply.senderName}:${reply.senderAvatarUrl ?? ""}`,
      senderDisplayName: reply.senderName,
    })), replyCount)
    : undefined), [latestReplies, replyCount, threadId]);
  const threadSummary = useMemo(() => (threadId && replyCount > 0 ? {
    threadChannelId: threadId,
    replyCount,
    lastReplyAt: lastReplyAt ?? null,
    participantIds: [],
    unreadCount: 0,
    firstUnreadMessageId: null,
  } : undefined), [lastReplyAt, replyCount, threadId]);
  return (
    <div className="px-3" data-testid="public-server-message-row">
      <MessageItem
        message={adaptedMessage}
        mentionMap={EMPTY_PUBLIC_MENTION_MAP}
        channels={channels}
        parentChannelId={parentChannelId}
        threadSummary={threadSummary}
        canReact={false}
        readOnlyProjection
        readOnlySender={sender}
        readOnlyReplyScope={replyScope}
        onReadOnlyNavigateChannel={onNavigateChannel}
        onOpenThread={onOpenThread}
      />
    </div>
  );
}
