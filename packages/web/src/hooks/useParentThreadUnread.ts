import { useShallow } from "zustand/react/shallow";

import { useThreadStore } from "../store/threadStore";
import type { FollowedThread } from "../store/threadStore";
import { NO_PARENT_THREAD_UNREAD, orderParentUnreadThreadsForJump, summarizeParentThreadUnread } from "../utils/threadUnreadByParent";
import type { ParentThreadUnread } from "../utils/threadUnreadByParent";

/**
 * Followed-thread unread of one channel, for its sidebar row. Shallow-compared,
 * so a reply in another channel's thread does not re-render this row. Pass null
 * (gate off / not joined) to skip the scan entirely.
 */
export function useParentThreadUnread(parentChannelId: string | null): ParentThreadUnread {
  return useThreadStore(useShallow((s) => (
    parentChannelId ? summarizeParentThreadUnread(s.followedThreads, parentChannelId) : NO_PARENT_THREAD_UNREAD
  )));
}

/** Unread followed threads of one channel in jump-pill order (longest waiting first). */
export function useParentUnreadThreadsForJump(parentChannelId: string | null): FollowedThread[] {
  return useThreadStore(useShallow((s) => (
    parentChannelId ? orderParentUnreadThreadsForJump(s.followedThreads, parentChannelId) : []
  )));
}
