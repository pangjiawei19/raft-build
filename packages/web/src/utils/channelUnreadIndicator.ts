export function getChannelUnreadIndicatorState(opts: {
  unread: number;
  joined: boolean;
  showMutedIcon: boolean;
  /**
   * The unread summary's `hasNew`: a non-joined public channel with messages past
   * the cursor. It has no exact count (unread is 0), so it only lights the quiet
   * indicator of a non-joined row.
   */
  hasNew?: boolean;
  /**
   * Followed threads under the channel with unread replies (threads, not
   * replies). Lights the same badge as the channel's own unread, as a separate
   * segment; 0 when the thread-unread mark is gated off.
   */
  threadUnread?: number;
}): { showLoudUnreadBadge: boolean; showQuietUnreadCount: boolean; showQuietNewDot: boolean } {
  const hasUnread = opts.unread > 0 || (opts.threadUnread ?? 0) > 0;
  const showLoudUnreadBadge = hasUnread && opts.joined && !opts.showMutedIcon;
  const showQuietUnreadCount = hasUnread && (!opts.joined || opts.showMutedIcon);
  const showQuietNewDot = !showQuietUnreadCount && !opts.joined && opts.hasNew === true;
  return { showLoudUnreadBadge, showQuietUnreadCount, showQuietNewDot };
}

export function shouldShowActivityMutedIcon(opts: {
  activityMuted: boolean | undefined;
  joined: boolean | undefined;
}): boolean {
  return opts.activityMuted === true && opts.joined === true;
}

export type SectionUnreadChannel = {
  id: string;
  activityMuted?: boolean;
};

export function hasUnmutedUnread(
  unreadCounts: Readonly<Record<string, number>>,
  channels: ReadonlyArray<SectionUnreadChannel | undefined>,
): boolean {
  return channels.some((channel) => (
    channel !== undefined
    && channel.activityMuted !== true
    && (unreadCounts[channel.id] ?? 0) > 0
  ));
}
