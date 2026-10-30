import type { Channel } from "../../store/channelStore";
import type { InboxItem } from "../../store/inboxStore";
import { hasSidebarPinnedRef } from "../../utils/sidebarPinnedRefs";
import type { SidebarPinnedRef } from "../../utils/sidebarPinnedRefs";

/**
 * Whether an Activity row's conversation is pinned in the sidebar. Channels pin
 * by channel id; DMs pin by their peer (agent or human). Threads are never
 * pinned on their own.
 */
export function isSidebarPinnedInboxItem(
  item: InboxItem,
  pinnedRefs: readonly SidebarPinnedRef[],
  dmChannels: readonly Pick<Channel, "id" | "peerId" | "peerType">[],
): boolean {
  if (item.kind === "thread" || pinnedRefs.length === 0) return false;
  const isDm = item.kind === "dm" || (item.kind === "mention_action" && item.channelType === "dm");
  if (!isDm) return hasSidebarPinnedRef([...pinnedRefs], { kind: "channel", id: item.channelId });
  const dm = dmChannels.find((channel) => channel.id === item.channelId);
  if (!dm?.peerId) return false;
  return hasSidebarPinnedRef([...pinnedRefs], { kind: dm.peerType === "agent" ? "agent" : "human", id: dm.peerId });
}
