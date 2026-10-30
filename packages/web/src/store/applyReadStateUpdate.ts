import { useServerStore } from "./serverStore";
import { useMessageStore } from "./messageStore";
import { useThreadStore } from "./threadStore";
import { useInboxStore } from "./inboxStore";
import { consumeReadStateUpdate } from "./readStateSync";
import type { ReadStateUpdate } from "./readStateSync";

export function applyReadStateUpdate(update: ReadStateUpdate) {
  const currentServerId = useServerStore.getState().current?.id;
  if (update.serverId !== currentServerId) return;
  if (consumeReadStateUpdate(update) !== "accepted") return;
  const projection = useMessageStore.getState().applyReadStateProjection(update.scopeId);
  if (!projection.complete) {
    // This tab cannot count the thread's unread from loaded replies (read in
    // another tab, Activity "mark all read"); use the server's count so the
    // channel "N new" badge does not keep a stale number.
    const latest = useThreadStore.getState().followedThreads
      .find((thread) => thread.threadChannelId === update.scopeId)?.latestActivitySeq;
    // A read-all zero describes its captured frontier, not a newer reply this
    // tab already knows about. Loaded windows project that reply above; an
    // unloaded thread must not erase it just because the zero receipt is late.
    const hasNewerActivity = latest != null && BigInt(latest) > BigInt(update.maxReadSeq);
    if (update.unreadCount !== undefined && !(update.unreadCount === 0 && hasNewerActivity)) {
      useThreadStore.getState().applyServerThreadUnread(update.scopeId, update.unreadCount);
    }
    return;
  }
  useInboxStore.getState().applyReadStateProjection(update.scopeId, projection);
  useThreadStore.getState().applyReadStateProjection(update.scopeId, projection);
}
