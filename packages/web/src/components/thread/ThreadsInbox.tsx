import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { useIntl } from "react-intl";
import Tooltip from "../ui/Tooltip";
import SectionEyebrow from "../ui/SectionEyebrow";
import { formatRelativeTime } from "../../utils/relativeTime";
import { ArrowUp, AtSign, BellOff, Check, Hash, MessageSquareText, Pencil, Pin } from "lucide-react";
import { getInboxItemKey, useInboxStore } from "../../store/inboxStore";
import type { InboxItem, InboxFilter } from "../../store/inboxStore";
import { useActivityPanelWindowBundle } from "../../store/activityPanel/useActivityShadow";
import {
  Badge,
  Button,
  ActivityInboxPanel,
  DirectMessageIcon,
  MessageItemSearchMatch,
  SegmentedControl,
  SegmentedControlItem,
  SegmentedControlLabel,
  SidebarItemCount,
  SidebarItemIndicator,
  ThreadIcon,
  IconTile,
} from "@botiverse/raft-ui";
import { useMessageStore } from "../../store/messageStore";
import { captureReceiverPrivateIngressContext } from "../../store/receiverPrivateIngress";
import { useChannelStore } from "../../store/channelStore";
import { useAgentStore } from "../../store/agentStore";
import { useAuthStore } from "../../store/authStore";
import { useServerStore } from "../../store/serverStore";
import { useThreadStore } from "../../store/threadStore";
import { useTaskMetadataForMessage } from "../../store/taskStore";
import type { TaskStatus } from "../../store/taskStore";
import { StatusBadge } from "../task/StatusBadge";
import { useSearchContentStore } from "../../store/searchContentStore";
import type { Channel } from "../../store/channelStore";
import { ACTIVITY_CONVERSATION_LIST_FLAG_KEY, useServerFeatureFlag } from "../../store/serverFeatureFlags";
import { isSidebarPinnedInboxItem } from "./inboxPinnedConversation";
import {
  trackActivityItemOpen,
  trackActivityMark,
} from "../../analytics/activity";
import { useAppNavigate, useMobileBack } from "../../hooks/useAppNavigate";
import { resolveMessageSenderMemberFromList } from "../../utils/messageSenderMember";
import {
  activityInboxTraceScope,
  currentActivityInboxTraceCycle,
  traceActivityInboxTransition,
} from "../../utils/activityInboxTrace";
import InlineMarkdownPreview from "../markdown/InlineMarkdownPreview";
import PanelHeader from "../ui/PanelHeader";
import EmptyState from "../ui/EmptyState";
import { ConversationCardSkeleton } from "../ui/Skeleton";
import AvatarSlot from "../ui/AvatarSlot";
import { placeInboxContextMenu } from "./inboxContextMenuPosition";
import type { InboxContextMenuPosition } from "./inboxContextMenuPosition";
import { itemFilterChannelLabel } from "./inboxChannelFilter";
import DismissBackdrop from "../ui/DismissBackdrop";
import { InboxContextMenu } from "./InboxContextMenu";

function itemKey(item: InboxItem): string {
  return getInboxItemKey(item);
}

function handleNestedRowActionKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, action: () => void) {
  event.stopPropagation();
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  action();
}

function itemUnreadCount(item: InboxItem): number {
  return item.unreadCount;
}

type ThreadInboxItem = Extract<InboxItem, { kind: "thread" }>;

function asThreadItem(item: InboxItem): ThreadInboxItem | null {
  return item.kind === "thread" ? item : null;
}

function stripActivityTitlePrefix(value: string): string {
  return value.replace(/^[@#]+/, "");
}

type ActivityReadFilter = "all" | "unread";

function activityReadFilter(filter: InboxFilter): ActivityReadFilter {
  return filter === "unread" || filter === "unread_mentions" ? "unread" : "all";
}

function activityMentionsOnly(filter: InboxFilter): boolean {
  return filter === "mentions" || filter === "unread_mentions";
}

type CtxMenu = InboxContextMenuPosition;

// Raft Design System › Inbox rows: content rows on the paper, a hairline
// between consecutive rows starting where the text starts, pressed overlay on
// hover, cyan-soft for the row open beside the list, an inset ink ring for
// keyboard focus (the row sits inside the list's edge).
const INBOX_ROW_BASE_CLASS = [
  "group relative flex w-full gap-3 px-4 py-3 text-left outline-none transition-colors",
  "focus-visible:shadow-[inset_0_0_0_2px_var(--foreground)]",
  "before:pointer-events-none before:absolute before:top-0 before:right-0 before:hidden before:border-t before:border-line-hairline",
  "[[data-testid=inbox-row]+&]:before:block",
].join(" ");
const INBOX_ROW_SELECTED_CLASS = "bg-info-soft";
const INBOX_ROW_IDLE_CLASS = "hover:bg-fill-pressed";
// Mark as Done (Raft Design System › Inbox: a row's own action is an ink-outline
// button, never pink): a 32px outline icon button, paper with the 1.5px ink line,
// so it reads cleanly over the row's hover wash (a ghost button's wash on top of
// the row's wash only looked smudged). It takes the side column's place while it
// shows, so the time and the unread count step aside instead of sitting under
// it. Pointer and keyboard only: on touch the long-press menu carries Done.

function highlightActivitySearchText(value: string, query: string): ReactNode {
  const needle = query.trim();
  if (!needle) return value;
  const lowerValue = value.toLocaleLowerCase();
  const lowerNeedle = needle.toLocaleLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let index = lowerValue.indexOf(lowerNeedle);
  while (index !== -1) {
    if (index > cursor) parts.push(value.slice(cursor, index));
    const match = value.slice(index, index + needle.length);
    parts.push(
      <MessageItemSearchMatch key={`${index}-${match}`}>
        {match}
      </MessageItemSearchMatch>,
    );
    cursor = index + needle.length;
    index = lowerValue.indexOf(lowerNeedle, cursor);
  }
  if (cursor < value.length) parts.push(value.slice(cursor));
  return parts;
}

function renderActivityPreview(markdown: string, query: string): ReactNode {
  return query.trim()
    ? highlightActivitySearchText(markdown, query)
    : <InlineMarkdownPreview markdown={markdown} />;
}

/** List-layout leading visual: the peer for DMs, a # tile for channels, plus a thread mark for threads. */
function ConversationAvatar({ kind, dmChannel }: { kind: "thread" | "dm" | "channel"; dmChannel: Channel | null }) {
  if (kind === "dm" && dmChannel) {
    return (
      <div className="flex size-9 shrink-0 items-center justify-center" data-testid="conversation-card-avatar" data-kind="dm">
        {dmChannel.peerType === "agent" ? (
          <AvatarSlot context="panel-header" type="agent" agentAvatarUrl={dmChannel.peerAvatarUrl ?? null} />
        ) : (
          <AvatarSlot
            context="panel-header"
            type="human"
            humanAvatarUrl={dmChannel.peerAvatarUrl ?? null}
            gravatarHash={dmChannel.peerGravatarHash ?? null}
            humanPlaceholder={!dmChannel.peerAvatarUrl && !dmChannel.peerGravatarHash}
          />
        )}
      </div>
    );
  }
  return (
    <span className="relative flex size-9 shrink-0 items-center justify-center" data-testid="conversation-card-avatar" data-kind={kind}>
      {/* A channel is a place, not a face: the neutral DS channel tile
          (raft-ui IconTile, the 35px avatar step of the DM faces). */}
      <IconTile>
        {kind === "dm" ? <DirectMessageIcon /> : <Hash />}
      </IconTile>
      {kind === "thread" ? (
        <span className="absolute -bottom-1 -right-1 flex size-[18px] items-center justify-center rounded-sticker border border-line-seam bg-layer-card text-foreground-muted">
          <ThreadIcon width={11} height={11} />
        </span>
      ) : null}
    </span>
  );
}

function InboxRow({ item, filter, searchQuery, onOpen, onDone, onContextMenu, focused, active, focusRef, layout = "card" }: {
  item: InboxItem;
  filter: InboxFilter;
  searchQuery: string;
  onOpen: (e: React.MouseEvent | ReactKeyboardEvent, item: InboxItem) => void;
  onDone: (item: InboxItem) => void;
  onContextMenu: (e: React.MouseEvent, item: InboxItem) => void;
  focused?: boolean;
  active?: boolean;
  focusRef?: React.Ref<HTMLDivElement>;
  /** `list`: activity_conversation_list_v0 — one avatar row per conversation. */
  layout?: "card" | "list";
}) {
  const { formatMessage, locale } = useIntl();
  const channels = useChannelStore((s) => s.channels);
  const dmChannels = useChannelStore((s) => s.dmChannels);
  const agents = useAgentStore((s) => s.agents);
  const members = useServerStore((s) => s.members);
  const currentUser = useAuthStore((s) => s.user);
  const realtimeTaskMetadata = useTaskMetadataForMessage(item.kind === "thread" ? item.parentMessageId : null);

  const timestamp = item.kind === "thread"
    ? formatRelativeTime(item.lastActivityAt, locale)
    : item.kind === "mention_action"
      ? formatRelativeTime(item.createdAt, locale)
    : formatRelativeTime(item.lastMessageAt, locale);
  const unreadCount = itemUnreadCount(item);
  const shouldShowMentionBadge = !activityMentionsOnly(filter) && item.hasMention && unreadCount > 0;

  const channelLabel = itemFilterChannelLabel(item, channels, dmChannels);
  const titleLabel = (() => {
    if (item.kind === "thread") return null;
    if (item.kind === "mention_action") return stripActivityTitlePrefix(item.channelName);
    if (item.kind === "dm") {
      const ch = dmChannels.find((c) => c.id === item.channelId);
      return stripActivityTitlePrefix(ch?.peerDisplayName || ch?.peerName || item.channelName);
    }
    return stripActivityTitlePrefix(item.channelName);
  })();

  const senderType = item.kind === "thread" ? item.latestActivitySenderType : item.kind === "mention_action" ? "system" : item.lastMessageSenderType;
  const senderId = item.kind === "thread" ? item.latestActivitySenderId : item.kind === "mention_action" ? "" : item.lastMessageSenderId;
  const senderAgent = senderType === "agent" ? agents.find((a) => a.id === senderId) : null;
  const senderMember = senderType === "user"
    ? resolveMessageSenderMemberFromList({ senderType, senderId }, members, currentUser) ?? null
    : null;
  const senderName = senderAgent?.displayName
    ?? senderAgent?.name
    ?? senderMember?.displayName
    ?? senderMember?.name
    ?? (item.kind === "thread"
      ? item.latestActivitySenderName
      : item.kind === "channel" || item.kind === "dm"
        ? item.lastMessageSenderName
        : null);
  // System rows take the localized label first: a system row carries a raw
  // English `lastMessageSenderName` ("System") in its data, so resolving
  // senderName first would show that English and bypass the zh catalog. Detect
  // system identity by the real transport shape — mention_action rows surface
  // senderType "system", while channel/dm system broadcasts arrive as senderType
  // "user" with senderId "system" (messageService `createMessage(…, "user",
  // "system", …, "system")` → inboxTransport). Localize both; fall back to the
  // resolved name for genuine user/agent rows.
  const isSystemSender = senderType === "system" || senderId === "system";
  const activitySenderLabel = isSystemSender
    ? formatMessage({ id: "thread.row.systemSender" })
    : (senderName ?? null);
  const rawThreadItem = asThreadItem(item);
  const threadItem = useMemo(() => {
    if (!rawThreadItem || !realtimeTaskMetadata) return rawThreadItem;
    return {
      ...rawThreadItem,
      taskNumber: realtimeTaskMetadata.taskNumber,
      taskStatus: realtimeTaskMetadata.status,
      taskClaimedByName: realtimeTaskMetadata.claimedByName ?? null,
    };
  }, [rawThreadItem, realtimeTaskMetadata]);
  const hasThreadDraft = useMessageStore((s) =>
    threadItem ? !!s.drafts[threadItem.threadChannelId]?.trim() : false
  );
  const preview = item.kind === "thread"
    ? item.parentMessagePreview
    : item.kind === "mention_action"
      ? item.messagePreview
      : item.lastMessagePreview;
  const activityPreview = item.kind === "thread" ? item.latestActivityPreview : preview;
  const primaryContent = item.kind === "thread"
    ? renderActivityPreview(item.parentMessagePreview, searchQuery)
    : titleLabel
      ? highlightActivitySearchText(titleLabel, searchQuery)
      : null;
  const titleIconKind = item.kind === "thread"
    ? "thread"
    : item.kind === "dm" || (item.kind === "mention_action" && item.channelType === "dm")
      ? "dm"
      : "channel";
  const titleIcon = (() => {
    const className = "mr-1.5 inline-block align-[-2px] text-foreground-hint";
    if (titleIconKind === "thread") return <ThreadIcon width={13} height={13} className={className} />;
    if (titleIconKind === "dm") return <DirectMessageIcon width={13} height={13} className={className} />;
    return <Hash size={13} className={className} />;
  })();
  const subtitleContent = item.kind === "thread" ? channelLabel : null;
  const bodyContent = (
    <>
      {activitySenderLabel ? <span className="font-semibold text-foreground">{activitySenderLabel}: </span> : null}
      {renderActivityPreview(activityPreview, searchQuery)}
    </>
  );
  // List layout: the sender's face before their name, so a row says who spoke
  // while the leading tile stays the channel (xxchan picked option C).
  // DM rows already lead with the peer's face, so they skip it.
  // An unresolved sender (not loaded yet, or gone) keeps a placeholder face so
  // rows stay aligned.
  const senderAvatar = isSystemSender || titleIconKind === "dm" ? null : senderType === "agent" ? (
    <AvatarSlot context="sidebar-list" type="agent" agentAvatarUrl={senderAgent?.avatarUrl ?? null} />
  ) : senderType === "user" ? (
    <AvatarSlot
      context="sidebar-list"
      type="human"
      humanAvatarUrl={senderMember?.avatarUrl ?? null}
      gravatarHash={senderMember?.gravatarHash ?? null}
      humanPlaceholder={!senderMember?.avatarUrl && !senderMember?.gravatarHash}
    />
  ) : null;
  const listBodyContent = (
    <>
      {senderAvatar && activitySenderLabel ? (
        <span className="mr-1 inline-flex align-[-2px]" data-testid="conversation-card-sender-avatar">
          {senderAvatar}
        </span>
      ) : null}
      {bodyContent}
    </>
  );
  const rowSelected = Boolean(focused || active);
  const rowClassName = `${INBOX_ROW_BASE_CLASS} items-start before:left-4 ${rowSelected ? INBOX_ROW_SELECTED_CLASS : INBOX_ROW_IDLE_CLASS}`;
  const rowActionVisibilityClassName = active
    ? "pointer-events-auto opacity-100"
    : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-visible:pointer-events-auto group-focus-visible:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 [@media(hover:none)]:hidden";
  const doneActionClassName = `relative z-10 shrink-0 transition-opacity ${
    rowActionVisibilityClassName
  }`;
  const handleOpen = useCallback((event: React.MouseEvent | ReactKeyboardEvent) => onOpen(event, item), [item, onOpen]);
  const handleKeyDown = useCallback((event: ReactKeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onOpen(event, item);
  }, [item, onOpen]);
  const handleContextMenu = useCallback((event: React.MouseEvent) => onContextMenu(event, item), [item, onContextMenu]);
  const handleDone = useCallback(() => onDone(item), [item, onDone]);
  const handleDoneClick = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    handleDone();
  }, [handleDone]);
  const handleDoneKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => handleNestedRowActionKeyDown(event, handleDone),
    [handleDone],
  );
  // The side column (time, unread count) steps aside while Done shows.
  const timestampVisibilityClassName = active
    ? "opacity-0"
    : "transition-opacity group-hover:opacity-0 group-focus-within:opacity-0 [@media(hover:none)]:opacity-100";

  if (layout === "list") {
    const dmChannel = item.kind === "dm" || (item.kind === "mention_action" && item.channelType === "dm")
      ? dmChannels.find((c) => c.id === item.channelId) ?? null
      : null;
    const mutedChannelId = item.kind === "thread" ? item.parentChannelId : item.channelId;
    const muted = !!(channels.find((c) => c.id === mutedChannelId) ?? dmChannel)?.activityMuted;
    const strong = unreadCount > 0 && !muted;
    return (
      <div
        ref={focusRef}
        role="button"
        tabIndex={0}
        data-testid="inbox-row"
        data-layout="list"
        data-focused={focused ? "true" : undefined}
        data-active={active ? "true" : undefined}
        aria-current={focused || active ? "true" : undefined}
        onClick={handleOpen}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
        className={`${INBOX_ROW_BASE_CLASS} items-center before:left-16 ${rowSelected ? INBOX_ROW_SELECTED_CLASS : INBOX_ROW_IDLE_CLASS}`}
      >
        <ConversationAvatar kind={titleIconKind} dmChannel={dmChannel} />
        <div className="min-w-0 flex-1" data-testid="conversation-card-content">
          <div className="flex min-w-0 items-center gap-2">
            <div
              className={`min-w-0 flex-1 truncate text-subhead ${strong ? "font-bold text-foreground" : "font-semibold text-foreground-muted"}`}
              data-testid="conversation-card-primary"
            >
              {primaryContent}
            </div>
            {threadItem && threadItem.taskNumber != null && threadItem.taskStatus && (
              <StatusBadge
                status={threadItem.taskStatus as TaskStatus}
                size="sm"
                className="shrink-0"
                data-testid="conversation-card-task-badge"
              >
                {formatMessage({ id: "activity.list.taskNumber" }, { number: threadItem.taskNumber })}
              </StatusBadge>
            )}
            {timestamp ? (
              <span
                className={`shrink-0 font-mono text-mono-meta leading-5 text-foreground-hint ${timestampVisibilityClassName}`}
                data-testid="conversation-card-timestamp"
              >
                {timestamp}
              </span>
            ) : null}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <p
              className={`min-w-0 flex-1 truncate text-callout ${strong ? "text-foreground" : "text-foreground-muted"}`}
              data-testid="conversation-card-body"
            >
              {subtitleContent ? (
                <span className="mr-1" data-testid="conversation-card-subtitle">
                  {formatMessage({ id: "activity.list.threadChannel" }, { channel: subtitleContent })}
                </span>
              ) : null}
              {dmChannel && senderId === dmChannel.peerId ? renderActivityPreview(activityPreview, searchQuery) : listBodyContent}
            </p>
            {hasThreadDraft ? (
              <Pencil size={12} className="shrink-0 text-foreground-hint" aria-label={formatMessage({ id: "thread.row.draftTitle" })} data-testid="inbox-thread-draft-badge" />
            ) : null}
            {/* @you is the sidebar's yellow @ sticker, so a mention reads the same in both places. */}
            {shouldShowMentionBadge ? (
              <Tooltip content={formatMessage({ id: "layout.sidebar.mentionedYouTitle" })}>
              <SidebarItemIndicator
                className={`shrink-0 ${timestampVisibilityClassName}`}
                role="img"
                data-testid="inbox-mention-badge"
                aria-label={formatMessage({ id: "layout.sidebar.mentionedYouAria" })}
              >
                <AtSign />
              </SidebarItemIndicator>
              </Tooltip>
            ) : null}
            {muted ? (
              <BellOff size={14} className={`shrink-0 text-foreground-hint ${timestampVisibilityClassName}`} data-testid="conversation-card-muted" />
            ) : unreadCount > 0 ? (
              <SidebarItemCount className={`shrink-0 ${timestampVisibilityClassName}`} data-testid="conversation-card-new-badge">
                {unreadCount}
              </SidebarItemCount>
            ) : null}
          </div>
        </div>
        <div
          className="pointer-events-none absolute top-1/2 right-3 z-10 flex -translate-y-1/2 items-center"
          data-testid="conversation-card-actions"
        >
          <Tooltip content={formatMessage({ id: "thread.row.markAsDone" })}>
          <Button variant="outline" size="icon-md"
            type="button"
            onClick={handleDoneClick}
            onKeyDown={handleDoneKeyDown}
            className={doneActionClassName}
            aria-label={formatMessage({ id: "thread.row.markAsDone" })}
            data-testid="inbox-row-done"
          >
            <Check />
          </Button>
          </Tooltip>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={focusRef}
      role="button"
      tabIndex={0}
      data-testid="inbox-row"
      data-focused={focused ? "true" : undefined}
      data-active={active ? "true" : undefined}
      aria-current={focused || active ? "true" : undefined}
      onClick={handleOpen}
      onKeyDown={handleKeyDown}
      onContextMenu={handleContextMenu}
      className={rowClassName}
    >
      <div className="min-w-0 w-full" data-testid="conversation-card-content">
        {subtitleContent ? (
          <div
            className="mb-0.5 min-w-0 truncate text-caption text-foreground-hint"
            data-testid="conversation-card-subtitle"
          >
            {subtitleContent}
          </div>
        ) : null}
        <div className="mb-0.5 flex min-w-0 items-start gap-2">
          <div
            className={`line-clamp-2 min-w-0 flex-1 text-subhead ${unreadCount > 0 ? "font-bold text-foreground" : "font-semibold text-foreground-muted"}`}
            data-testid="conversation-card-primary"
          >
            <span aria-hidden="true" data-testid="conversation-card-title-icon" data-kind={titleIconKind}>
              {titleIcon}
            </span>
            {primaryContent}
          </div>
          {timestamp ? (
            <span
              className={`shrink-0 font-mono text-mono-meta leading-5 text-foreground-hint ${timestampVisibilityClassName}`}
              data-testid="conversation-card-timestamp"
            >
              {timestamp}
            </span>
          ) : null}
        </div>
        <p
          className={`line-clamp-2 text-callout ${unreadCount > 0 ? "text-foreground" : "text-foreground-muted"}`}
          data-testid="conversation-card-body"
        >
          {bodyContent}
        </p>
        <div
          className="mt-2 flex min-h-5 flex-wrap items-center gap-1.5"
          data-testid="conversation-card-metadata"
        >
          {threadItem && threadItem.taskNumber != null && threadItem.taskStatus && (
            <StatusBadge
              status={threadItem.taskStatus as TaskStatus}
              size="sm"
              data-testid="conversation-card-task-badge"
            >
              #{threadItem.taskNumber}
              {threadItem.taskClaimedByName && ` @${threadItem.taskClaimedByName}`}
            </StatusBadge>
          )}
          {threadItem && (
            <Badge
              appearance="outline"
              variant="muted"
              data-testid="conversation-card-reply-count"
            >
              {formatMessage({ id: "thread.row.replies" }, { count: threadItem.replyCount })}
            </Badge>
          )}
          {threadItem?.isFollowing === false && (
            <Badge
              appearance="outline"
              variant="muted"
              data-testid="conversation-card-unfollowed-badge"
            >
              <BellOff size={10} />
              {formatMessage({ id: "thread.row.unfollowed" })}
            </Badge>
          )}
          {shouldShowMentionBadge && (
            <Tooltip content={formatMessage({ id: "thread.row.mentionBadgeTitle" })}>
            <Badge
              variant="primary"
              data-slot="badge"
              data-testid="inbox-mention-badge"
            >
              <AtSign size={10} />
              {formatMessage({ id: "thread.row.mentionBadgeLabel" })}
            </Badge>
            </Tooltip>
          )}
          {unreadCount > 0 && (
            <Badge
              variant="accent"
              data-testid="conversation-card-new-badge"
            >
              {formatMessage({ id: "thread.row.unreadCount" }, { count: unreadCount })}
            </Badge>
          )}
          {hasThreadDraft && (
            <Tooltip content={formatMessage({ id: "thread.row.draftTitle" })}>
            <Badge
              appearance="outline"
              variant="muted"
              data-slot="badge"
              data-testid="inbox-thread-draft-badge"
              aria-label={formatMessage({ id: "thread.row.draftTitle" })}
            >
              <Pencil size={12} />
            </Badge>
            </Tooltip>
          )}
        </div>
      </div>
      <div
        className="pointer-events-none absolute right-3 top-3 z-10 flex items-center"
        data-testid="conversation-card-actions"
      >
        <Tooltip content={formatMessage({ id: "thread.row.markAsDone" })}>
        <Button variant="outline" size="icon-md"
          type="button"
          onClick={handleDoneClick}
          onKeyDown={handleDoneKeyDown}
          className={doneActionClassName}
          aria-label={formatMessage({ id: "thread.row.markAsDone" })}
          data-testid="inbox-row-done"
        >
          <Check />
        </Button>
        </Tooltip>
      </div>
    </div>
  );
}

function isDesktopMasterDetailViewport(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(min-width: 1024px)").matches;
}

export default function ThreadsInbox() {
  const { formatMessage } = useIntl();
  const serverSlug = useServerStore((s) => s.current?.slug);
  const onMobileBack = useMobileBack(serverSlug ? `/s/${serverSlug}` : "/");
  const legacyStoreItems = useInboxStore((s) => s.items);
  const acceptedWindowGeneration = useInboxStore((s) => s.acceptedWindowGeneration);
  const legacyActivityGroups = useInboxStore((s) => s.groups);
  const filter = useInboxStore((s) => s.filter);
  const channelFilterId = useInboxStore((s) => s.channelFilterId);
  const loading = useInboxStore((s) => s.loading);
  const loaded = useInboxStore((s) => s.loaded);
  const loadingMore = useInboxStore((s) => s.loadingMore);
  const legacyHasMore = useInboxStore((s) => s.hasMore);
  const legacyTotalCount = useInboxStore((s) => s.totalCount);
  const legacyTotalUnreadCount = useInboxStore((s) => s.totalUnreadCount);
  const sortDirection = useInboxStore((s) => s.sortDirection);
  const inboxSearchQuery = useInboxStore((s) => s.searchQuery);
  const savedScrollTop = useInboxStore((s) => s.scrollTop);
  const focusedItemKey = useInboxStore((s) => s.focusedItemKey);
  const setFilter = useInboxStore((s) => s.setFilter);
  const setSavedScrollTop = useInboxStore((s) => s.setScrollTop);
  const setFocusedItemKey = useInboxStore((s) => s.setFocusedItemKey);
  const loadInbox = useInboxStore((s) => s.loadInbox);
  const markRead = useInboxStore((s) => s.markRead);
  const markAllRead = useInboxStore((s) => s.markAllRead);
  const markDone = useInboxStore((s) => s.markDone);
  const openThread = useThreadStore((s) => s.openThread);
  const openContentSlot = useSearchContentStore((s) => s.open);
  const contentSlot = useSearchContentStore((s) => s.slot);
  const focusedThreadChannelId = useThreadStore((s) => s.focusedThreadChannelId);
  const setFocusedThreadChannelId = useThreadStore((s) => s.setFocusedThreadChannelId);
  const nav = useAppNavigate();
  const { enabled: conversationListEnabled } = useServerFeatureFlag(ACTIVITY_CONVERSATION_LIST_FLAG_KEY);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusedRowRef = useRef<HTMLDivElement>(null);
  const autoScrolledFocusKeyRef = useRef<string | null>(null);
  const isNearTopRef = useRef(true);
  const [newUpdateCount, setNewUpdateCount] = useState(0);
  const restoredScrollRef = useRef(false);
  const activeFocusKey = focusedItemKey ?? (focusedThreadChannelId ? `thread:${focusedThreadChannelId}` : null);
  // When an item is open in col 3 of the Activity master/detail, keep its row
  // visually selected in the master list — same affordance as the selected
  // /search result card. Slot kind→item-key mirrors getInboxItemKey:
  // thread → `thread:<threadChannelId>`, channel/dm → `<kind>:<channelId>`.
  const openItemKey = contentSlot
    ? `${contentSlot.kind}:${contentSlot.id}`
    : null;
  const receiverInput = useMemo(() => ({
    legacySnapshot: {
      generation: acceptedWindowGeneration,
      window: {
        items: legacyStoreItems,
        groups: legacyActivityGroups,
        totalCount: legacyTotalCount,
        totalUnreadCount: legacyTotalUnreadCount,
        hasMore: legacyHasMore,
        // The legacy endpoint paginates by offset. Preserve that exact cursor
        // as an opaque string so pagination travels through the same bundle as
        // rows/counts instead of being re-derived after the source decision.
        nextCursor: legacyHasMore ? String(legacyStoreItems.length) : null,
        complete: !legacyHasMore,
      },
    },
    activityView: "active" as const,
    filter,
    sortDirection,
    searchQuery: inboxSearchQuery,
    channelFilterId: null,
  }), [
    acceptedWindowGeneration,
    filter,
    inboxSearchQuery,
    legacyActivityGroups,
    legacyHasMore,
    legacyStoreItems,
    legacyTotalCount,
    legacyTotalUnreadCount,
    sortDirection,
  ]);
  const activityWindow = useActivityPanelWindowBundle(receiverInput);
  // S2's only visible source split. Every downstream active-window read uses
  // this one discriminated value; no field is selected again from Zustand.
  const items = activityWindow.items;
  const totalCount = activityWindow.totalCount;
  const totalUnreadCount = activityWindow.totalUnreadCount;
  const hasMore = activityWindow.hasMore;
  const nextCursor = activityWindow.nextCursor;
  const sidebarPinnedRefs = useServerStore((s) => s.sidebarOrder.pinned);
  const dmChannelsForPins = useChannelStore((s) => s.dmChannels);
  // Conversation list: sidebar-pinned conversations float to the top, in their
  // loaded order. Keyboard navigation and focus read this same order.
  const pinnedItemKeys = useMemo(() => {
    const keys = new Set<string>();
    if (!conversationListEnabled) return keys;
    for (const item of items) {
      if (isSidebarPinnedInboxItem(item, sidebarPinnedRefs ?? [], dmChannelsForPins)) keys.add(itemKey(item));
    }
    return keys;
  }, [conversationListEnabled, dmChannelsForPins, sidebarPinnedRefs, items]);
  const visibleItems = useMemo(
    () => pinnedItemKeys.size === 0
      ? items
      : [
        ...items.filter((item) => pinnedItemKeys.has(itemKey(item))),
        ...items.filter((item) => !pinnedItemKeys.has(itemKey(item))),
      ],
    [pinnedItemKeys, items],
  );
  const showMarkAllRead = totalUnreadCount > 0;
  const prevItemsRef = useRef(visibleItems);

  useEffect(() => {
    if (!loaded && !loading) {
      loadInbox({ reset: true });
    }
  }, [loadInbox, loaded, loading]);

  // Resolve a deferred "focus first unread" intent (set by the sidebar
  // dbl-click) once items are actually loaded — data-driven, so it doesn't
  // matter when items arrive or which loadInbox call populated them. If items
  // are loaded but none are unread, keep the intent pending until a later items
  // update (e.g. a new reply) can resolve it.
  useEffect(() => {
    if (useInboxStore.getState().pendingFocusKind !== "first-unread" || visibleItems.length === 0) return;
    const firstUnread = visibleItems.find((item) => item.unreadCount > 0);
    if (!firstUnread) return;
    setFocusedItemKey(itemKey(firstUnread));
    useInboxStore.getState().setPendingFocusKind(null);
  }, [setFocusedItemKey, visibleItems]);

  useEffect(() => {
    restoredScrollRef.current = false;
  }, [channelFilterId, filter]);

  useEffect(() => {
    if (restoredScrollRef.current || visibleItems.length === 0) return;
    const container = scrollRef.current;
    if (!container) return;
    const raf = requestAnimationFrame(() => {
      container.scrollTop = savedScrollTop;
      isNearTopRef.current = savedScrollTop < 50;
      restoredScrollRef.current = true;
    });
    return () => cancelAnimationFrame(raf);
  }, [savedScrollTop, visibleItems.length]);

  useEffect(() => {
    if (!activeFocusKey) {
      autoScrolledFocusKeyRef.current = null;
      return;
    }
    if (autoScrolledFocusKeyRef.current === activeFocusKey) return;
    const idx = visibleItems.findIndex((item) => itemKey(item) === activeFocusKey);
    if (idx === -1) return;
    const raf = requestAnimationFrame(() => {
      const container = scrollRef.current;
      const row = focusedRowRef.current;
      if (!container || !row) return;
      const containerRect = container.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      container.scrollTo({ top: container.scrollTop + rowRect.top - containerRect.top - 8, behavior: "smooth" });
      autoScrolledFocusKeyRef.current = activeFocusKey;
      traceActivityInboxTransition({
        source: "focus_scroll",
        itemKey: activeFocusKey,
        fromIndex: idx,
        toIndex: idx,
        focusOwner: true,
      }, currentActivityInboxTraceCycle(activityInboxTraceScope(
        captureReceiverPrivateIngressContext(useMessageStore.getState().currentUserId),
        activeFocusKey,
      )));
      isNearTopRef.current = false;
    });
    return () => cancelAnimationFrame(raf);
  }, [activeFocusKey, visibleItems]);

  useEffect(() => {
    if (!focusedItemKey) return;
    const t = setTimeout(() => setFocusedItemKey(null), 3000);
    return () => clearTimeout(t);
  }, [focusedItemKey, setFocusedItemKey]);

  useEffect(() => {
    if (!focusedThreadChannelId) return;
    const t = setTimeout(() => setFocusedThreadChannelId(null), 3000);
    return () => clearTimeout(t);
  }, [focusedThreadChannelId, setFocusedThreadChannelId]);

  useEffect(() => {
    const prev = prevItemsRef.current;
    prevItemsRef.current = visibleItems;
    if (prev === visibleItems) return;
    const prevTopId = prev[0] ? itemKey(prev[0]) : null;
    const newTopId = visibleItems[0] ? itemKey(visibleItems[0]) : null;
    if (prevTopId && newTopId && prevTopId !== newTopId && !isNearTopRef.current) {
      // oxlint-disable-next-line react-doctor/no-chain-state-updates -- YMNNE-family: pre-existing new-update counter now observes the atomic receiver result; behavior is unchanged.
      setNewUpdateCount((count) => count + 1);
    }
    if (restoredScrollRef.current && isNearTopRef.current && scrollRef.current && !focusedThreadChannelId) {
      scrollRef.current.scrollTop = 0;
      setSavedScrollTop(0);
    }
  }, [visibleItems, focusedThreadChannelId, setSavedScrollTop]);

  // Desktop: double-click an Activity item → navigate into the full chat page
  // focused on the message, identical to a /search result (MessageSearchPage
  // uses the same `event.detail >= 2` gesture + `nav.to*Message`). Single-click
  // keeps the col-3 master/detail preview via `handleOpen`, delayed 220ms so a
  // double doesn't also fire the single. Mobile has no Activity master/detail
  // preview, so a tap should open immediately instead of waiting for a desktop
  // double-click gesture. (stdrc #proj-activity:171042a3 2026-07-04)
  const activateTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (activateTimerRef.current !== null) {
        window.clearTimeout(activateTimerRef.current);
        activateTimerRef.current = null;
      }
    };
  }, []);

  const navigateToChat = useCallback((item: InboxItem) => {
    if (item.kind === "thread") {
      // Prefer the first message that actually @-mentions the user (when the row
      // carries a mention) over the first unread message, so mention rows focus
      // the mention instead of the earliest unread reply.
      const targetMessageId = item.firstMentionMessageId
        ?? (item.unreadCount > 0
          ? item.firstUnreadMessageId ?? item.latestActivityMessageId
          : item.latestActivityMessageId);
      // This gesture leaves Activity for a canonical thread permalink. Do not
      // pre-open threadStore: its store→URL subscriber would first PUSH
      // /activity?thread= and the route navigation below would PUSH again.
      // The destination URL already carries the complete thread identity, so
      // MainLayout's URL→store projection seeds threadStore after the single
      // navigation. One surface transition must own one history write.
      nav.toThreadMessage(
        item.parentChannelId,
        item.parentMessageId,
        targetMessageId,
        item.parentChannelType === "dm" ? "dm" : "channel",
      );
      return;
    }
    if (item.kind === "mention_action") {
      if (item.channelType === "dm") nav.toDmMessage(item.channelId, item.messageId);
      else nav.toMessage(item.channelId, item.messageId);
      return;
    }
    // channel | dm
    const targetMessageId = item.firstUnreadMessageId ?? item.lastMessageId;
    if (item.kind === "dm") nav.toDmMessage(item.channelId, targetMessageId);
    else nav.toMessage(item.channelId, targetMessageId);
  }, [nav]);

  const handleOpen = useCallback((item: InboxItem) => {
    trackActivityItemOpen(item.kind);
    if (item.unreadCount > 0) {
      void markRead(item);
    }
    // Master/detail (open in col 3) on desktop — identical interaction to
    // clicking a /search result (stdrc #proj-activity:171042a3 2026-06-23).
    // Mobile keeps the original full-page push behaviour. (The rail-vs-sidebar
    // placement A/B was dropped 2026-06-30 — rail master/detail is the default.)
    const desktopMasterDetail = isDesktopMasterDetailViewport();

    if (item.kind === "thread") {
      const targetMessageId = item.unreadCount > 0
        ? item.firstUnreadMessageId ?? item.latestActivityMessageId
        : item.latestActivityMessageId;
      // Desktop: also mark the slot as a thread so the layout flips to
      // master/detail and SearchContentRoute/InboxContentRoute renders
      // ThreadPanel embedded in col 3 (not the col-4 overlay). This in-place
      // surface is store-owned, so seed threadStore directly.
      if (desktopMasterDetail) {
        // Stryker disable all: typed thread payload shape is covered by openThread payload/source contracts.
        void openThread({
          parentChannelId: item.parentChannelId,
          parentMessageId: item.parentMessageId,
          focusedMessageId: targetMessageId,
          initialThreadChannelId: item.threadChannelId,
        });
        // Stryker restore all
        openContentSlot({ kind: "thread", id: item.threadChannelId, messageId: targetMessageId });
      } else {
        // Mobile leaves Activity for a canonical route. Let URL→store hydrate
        // the thread so this click produces one PUSH, not openThread()'s
        // /activity?thread= PUSH followed by another route PUSH.
        nav.toThreadMessage(
          item.parentChannelId,
          item.parentMessageId,
          targetMessageId,
          item.parentChannelType === "dm" ? "dm" : "channel",
        );
      }
      return;
    }

    if (item.kind === "mention_action") {
      if (desktopMasterDetail) {
        openContentSlot({ kind: "channel", id: item.channelId, messageId: item.messageId });
      } else {
        nav.toMessage(item.channelId, item.messageId);
      }
      return;
    }

    const targetMessageId = item.unreadCount > 0
      ? item.firstUnreadMessageId ?? item.lastMessageId
      : item.lastMessageId;
    if (desktopMasterDetail) {
      // Swapping col-3 entity should drop any col-4 thread from the previous
      // entity (mirror MessageSearchPage.openResult).
      useThreadStore.getState().closeThread();
      openContentSlot({
        kind: item.kind === "dm" ? "dm" : "channel",
        id: item.channelId,
        messageId: targetMessageId,
      });
    } else if (item.kind === "dm") {
      nav.toDmMessage(item.channelId, item.firstMentionMessageId ?? (item.unreadCount > 0 ? item.firstUnreadMessageId ?? item.lastMessageId : item.lastMessageId));
    } else {
      nav.toMessage(item.channelId, item.firstMentionMessageId ?? (item.unreadCount > 0 ? item.firstUnreadMessageId ?? item.lastMessageId : item.lastMessageId));
    }
  }, [markRead, nav, openContentSlot, openThread]);

  const handleActivate = useCallback((event: React.MouseEvent | ReactKeyboardEvent, item: InboxItem) => {
    const activationDetail = "detail" in event ? event.detail : 1;
    // Activity needs enough horizontal room for both the inbox list and the
    // detail pane. Tablet/narrow desktop keeps the rail but opens the target
    // route directly instead of crushing the middle column.
    if (!isDesktopMasterDetailViewport()) {
      if (activateTimerRef.current !== null) {
        window.clearTimeout(activateTimerRef.current);
        activateTimerRef.current = null;
      }
      handleOpen(item);
      return;
    }
    if (activationDetail >= 2) {
      if (activateTimerRef.current !== null) {
        window.clearTimeout(activateTimerRef.current);
        activateTimerRef.current = null;
      }
      trackActivityItemOpen(item.kind);
      if (item.unreadCount > 0) void markRead(item);
      navigateToChat(item);
      return;
    }
    if (activateTimerRef.current !== null) window.clearTimeout(activateTimerRef.current);
    activateTimerRef.current = window.setTimeout(() => {
      activateTimerRef.current = null;
      handleOpen(item);
    }, 220);
  }, [handleOpen, markRead, navigateToChat]);

  const openCtxMenu = useCallback((e: React.MouseEvent, item: InboxItem) => {
    e.preventDefault();
    setCtxMenu(placeInboxContextMenu({ x: e.clientX, y: e.clientY, item }));
  }, []);
  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  const handleRowDone = useCallback((item: InboxItem) => {
    trackActivityMark("done");
    void markDone(item);
  }, [markDone]);

  const focusNextUnread = useCallback(() => {
    const unreadItems = visibleItems.filter((item) => item.unreadCount > 0);
    if (unreadItems.length === 0) return;
    const currentIdx = activeFocusKey
      ? unreadItems.findIndex((item) => itemKey(item) === activeFocusKey)
      : -1;
    const next = unreadItems[(currentIdx + 1) % unreadItems.length];
    setFocusedItemKey(itemKey(next));
  }, [activeFocusKey, setFocusedItemKey, visibleItems]);

  const handleHeaderTitleClick = useCallback((event: React.MouseEvent) => {
    if (event.detail < 2) return;
    focusNextUnread();
  }, [focusNextUnread]);

  const jumpToNextUnreadTitle = formatMessage({ id: "thread.header.jumpToNextUnread" });
  const headerContainerProps = useMemo(() => ({
    "data-testid": "inbox-header",
    title: jumpToNextUnreadTitle,
  }), [jumpToNextUnreadTitle]);
  const headerTitleClickProps = useMemo(() => ({
    "data-testid": "inbox-header-title",
    title: jumpToNextUnreadTitle,
    onClick: handleHeaderTitleClick,
  }), [handleHeaderTitleClick, jumpToNextUnreadTitle]);

  const handleMarkAllRead = useCallback(() => {
    void markAllRead();
  }, [markAllRead]);
  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    setNewUpdateCount(0);
  }, []);

  const handleScroll = (target: HTMLDivElement) => {
    isNearTopRef.current = target.scrollTop < 50;
    setSavedScrollTop(target.scrollTop);
    if (isNearTopRef.current) setNewUpdateCount(0);
    if (
      target.scrollHeight - target.scrollTop - target.clientHeight < 240
      && hasMore
      && !loadingMore
      && nextCursor !== null
    ) {
      void loadInbox();
    }
  };

  const contextMenuBackdrop = ctxMenu ? (
    <DismissBackdrop onDismiss={closeCtxMenu} trapContextMenu />
  ) : null;

  const contextMenuPortal = ctxMenu ? createPortal(
    <InboxContextMenu ctxMenu={ctxMenu} onClose={closeCtxMenu} />,
    document.body,
  ) : null;

  return (
    // Its left neighbour (the rail, or the sidebar) already draws the seam.
    <ActivityInboxPanel edge="inset">
      <PanelHeader
        title={formatMessage({ id: "thread.header.title" })}
        subtitle={formatMessage({ id: "thread.header.subtitle" }, { activeCount: totalCount, unreadCount: totalUnreadCount })}
        onMobileBack={onMobileBack}
        containerProps={headerContainerProps}
        titleClickProps={headerTitleClickProps}
      />

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col">
          <div
            data-testid="inbox-toolbar"
            className="flex h-[54px] shrink-0 items-center justify-between gap-3 border-b border-line-seam bg-layer-canvas px-4"
          >
            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0">
                <SegmentedControl
                  value={filter}
                  onValueChange={setFilter}
                  aria-label={formatMessage({ id: "thread.filter.ariaLabel" })}
                >
                  <SegmentedControlItem value="all" data-testid="inbox-filter-all">
                    <SegmentedControlLabel>{formatMessage({ id: "thread.filter.all" })}</SegmentedControlLabel>
                  </SegmentedControlItem>
                  <SegmentedControlItem value="unread" data-testid="inbox-filter-unread">
                    <SegmentedControlLabel>{formatMessage({ id: "thread.filter.unread" })}</SegmentedControlLabel>
                  </SegmentedControlItem>
                  <SegmentedControlItem value="mentions" data-testid="inbox-filter-mentions">
                    <SegmentedControlLabel>{formatMessage({ id: "thread.filter.mentions" })}</SegmentedControlLabel>
                  </SegmentedControlItem>
                </SegmentedControl>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {showMarkAllRead && (
                <Tooltip content={formatMessage({ id: "thread.markAllRead.title" })}>
                  <Button
                    onClick={handleMarkAllRead}
                    size="sm"
                    variant="ghost"
                    className="shrink-0 whitespace-nowrap"
                    data-testid="inbox-mark-all-read"
                  >
                    {formatMessage({ id: "thread.markAllRead.label" })}
                  </Button>
                </Tooltip>
              )}
            </div>
          </div>

          <div
            ref={scrollRef}
            data-testid="inbox-scroll"
            className="scrollbar-quiet relative flex-1 overflow-y-overlay safe-bottom bg-layer-canvas py-1"
            onScroll={(e) => handleScroll(e.currentTarget)}
          >
            {newUpdateCount > 0 && (
              <Button
                onClick={scrollToTop}
                size="sm"
                variant="outline"
                className="sticky top-2 z-10 mx-auto my-2 flex w-fit"
              >
                <ArrowUp size={14} />
                {formatMessage({ id: "thread.newUpdates" }, { count: newUpdateCount })}
              </Button>
            )}
            {loading && visibleItems.length === 0 ? (
              <ConversationCardSkeleton />
            ) : visibleItems.length === 0 ? (
              <EmptyState
                className="flex h-full flex-col items-center justify-center"
                icon={<MessageSquareText size={36} />}
                title={filter === "mentions"
                  ? formatMessage({ id: "thread.empty.mentionsTitle" })
                  : activityReadFilter(filter) === "unread"
                    ? formatMessage({ id: "thread.empty.unreadTitle" })
                    : formatMessage({ id: "thread.empty.defaultTitle" })}
                description={filter === "mentions"
                  ? formatMessage({ id: "thread.empty.mentionsDescription" })
                  : formatMessage({ id: "thread.empty.defaultDescription" })}
              />
            ) : (
              <div className="flex flex-col" data-layout={conversationListEnabled ? "list" : "card"}>
                {visibleItems.map((item, index) => {
                  const key = itemKey(item);
                  const isPinned = pinnedItemKeys.has(key);
                  const sectionLabel = pinnedItemKeys.size === 0
                    ? null
                    : index === 0
                      ? formatMessage({ id: "activity.list.pinned" })
                      : !isPinned && pinnedItemKeys.has(itemKey(visibleItems[index - 1]))
                        ? formatMessage({ id: "activity.list.allConversations" })
                        : null;
                  // `focused` = transient keyboard/permalink flash; `active` =
                  // sticky "open in col 3" highlight, styled the same as an active
                  // search result (stdrc 2026-06-23).
                  const isFocused = key === activeFocusKey;
                  const isActive = key === openItemKey;
                  const row = (
                    <InboxRow
                      key={key}
                      layout={conversationListEnabled ? "list" : "card"}
                      item={item}
                      filter={filter}
                      searchQuery={inboxSearchQuery}
                      onOpen={handleActivate}
                      onDone={handleRowDone}
                      onContextMenu={openCtxMenu}
                      focused={isFocused}
                      active={isActive}
                      focusRef={isFocused ? focusedRowRef : undefined}
                    />
                  );
                  if (!sectionLabel) return row;
                  return (
                    <Fragment key={key}>
                      <SectionEyebrow
                        as="div"
                        className={`flex items-center gap-1.5 px-4 pb-1 ${index === 0 ? "pt-2" : "pt-4"}`}
                        data-testid="activity-list-section"
                      >
                        {isPinned ? <Pin size={12} /> : null}
                        {sectionLabel}
                      </SectionEyebrow>
                      {row}
                    </Fragment>
                  );
                })}
                {loadingMore && (
                  <div className="py-3 text-center font-mono text-mono-meta text-foreground-hint">{formatMessage({ id: "thread.loadingMore" })}</div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      {contextMenuBackdrop}
      {contextMenuPortal}
    </ActivityInboxPanel>
  );
}
