import { useCallback } from "react";
import { useIntl } from "react-intl";
import { MessageSquareCheck, MessageSquareDot } from "lucide-react";
import { useMessageStore } from "../../store/messageStore";
import { useParentThreadUnread } from "../../hooks/useParentThreadUnread";
import { THREAD_UNREAD_BADGE_FLAG_KEY, SIDEBAR_MARK_ALL_READ_FEATURE_FLAG_KEY, useServerFeatureFlag } from "../../store/serverFeatureFlags";
import MenuItem from "../ui/MenuItem";

export function SidebarReadToggleMenuItem({
  channelId,
  hasUnread,
  onDone,
  includeThreads = false,
}: {
  channelId: string;
  hasUnread: boolean;
  onDone: () => void;
  includeThreads?: boolean;
}) {
  const { formatMessage } = useIntl();
  const markRead = useMessageStore((s) => s.markRead);
  const markConversationRead = useMessageStore((s) => s.markConversationRead);
  const threadUnreadEnabled = useServerFeatureFlag(THREAD_UNREAD_BADGE_FLAG_KEY).enabled;
  const allReadEnabled = useServerFeatureFlag(SIDEBAR_MARK_ALL_READ_FEATURE_FLAG_KEY).enabled;
  const readConversation = includeThreads && threadUnreadEnabled && allReadEnabled;
  const threadUnread = useParentThreadUnread(readConversation ? channelId : null);
  const anyUnread = hasUnread || threadUnread.count > 0;
  const markUnread = useMessageStore((s) => s.markUnread);
  const toggleRead = useCallback(() => {
    onDone();
    const action = anyUnread
      ? (readConversation ? markConversationRead(channelId) : markRead(channelId))
      : markUnread(channelId);
    void action.catch(() => {
      void useMessageStore.getState().loadUnreadCounts();
    });
  }, [channelId, anyUnread, readConversation, markConversationRead, markRead, markUnread, onDone]);
  return (
    <MenuItem
      icon={anyUnread ? <MessageSquareCheck size={14} /> : <MessageSquareDot size={14} />}
      onClick={toggleRead}
    >
      {anyUnread
        ? formatMessage({ id: readConversation ? "layout.sidebar.markAllAsRead" : "layout.sidebar.markAsRead" })
        : formatMessage({ id: "layout.sidebar.markAsUnread" })}
    </MenuItem>
  );
}
