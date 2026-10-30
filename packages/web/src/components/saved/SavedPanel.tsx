import { memo, useCallback, useEffect, useRef } from "react";
import { useIntl } from "react-intl";
import { Bookmark, Copy, Link, MessageSquare } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  PanelToggleAction,
  ListRow,
} from "@botiverse/raft-ui";
import { useSavedStore } from "../../store/savedStore";
import type { SavedEntry } from "../../store/savedStore";
import { useAgentStore } from "../../store/agentStore";
import { useAuthStore } from "../../store/authStore";
import { useServerStore } from "../../store/serverStore";
import { useThreadStore } from "../../store/threadStore";
import { useAppNavigate, useMobileBack, buildMessagePermalink } from "../../hooks/useAppNavigate";
import { resolveMessageSenderMemberFromList } from "../../utils/messageSenderMember";
import { formatRelativeTime } from "../../utils/relativeTime";
import AvatarSlot from "../ui/AvatarSlot";
import PanelHeader from "../ui/PanelHeader";
import EmptyState from "../ui/EmptyState";
import { ConversationCardSkeleton } from "../ui/Skeleton";

function stopKeyPropagation(event: React.KeyboardEvent) {
  event.stopPropagation();
}

// Raft Design System › ListRow: a saved message is a content row on the
// paper — no card frame. raft-ui's `plain` ListRow draws the hairline between
// consecutive rows from the 16px edge, the pressed overlay on hover and while
// its context menu is open, and an inset ink ring for keyboard focus. It is a
// div with the button role, since the row holds its own remove button.

const SavedItem = memo(function SavedItem({ entry, onOpenEntry, onRemoveMessage, serverSlug }: {
  entry: SavedEntry;
  onOpenEntry: (entry: SavedEntry) => void;
  onRemoveMessage: (messageId: string) => void;
  serverSlug: string | undefined;
}) {
  const { formatMessage, locale } = useIntl();
  const agents = useAgentStore((s) => s.agents);
  const members = useServerStore((s) => s.members);
  const currentUser = useAuthStore((s) => s.user);

  const isThread = entry.channelType === "thread";
  const isDm = isThread
    ? entry.parentChannelType === "dm"
    : entry.channelType === "dm";
  const sourceChannelName = isThread
    ? entry.parentChannelName
    : entry.channelName;
  const channelLabel = isDm
    ? `@${entry.senderName || entry.senderId}`
    : `#${sourceChannelName}`;

  const senderAgent = entry.senderType === "agent"
    ? agents.find((a) => a.id === entry.senderId)
    : null;
  const senderMember = entry.senderType === "user"
    ? resolveMessageSenderMemberFromList({ senderType: "user", senderId: entry.senderId }, members, currentUser) ?? null
    : null;
  const senderName = senderAgent?.displayName ?? senderAgent?.name ?? senderMember?.displayName ?? senderMember?.name ?? entry.senderName;

  const handleCopyLink = useCallback(() => {
    if (!serverSlug) return;
    const channelForLink = isThread ? entry.parentChannelId || entry.channelId : entry.channelId;
    const routeKind = isDm ? "dm" : "channel";
    const url = buildMessagePermalink(serverSlug, channelForLink, entry.messageId, {
      routeKind,
      threadParentMessageId: isThread ? entry.parentMessageId : null,
    });
    navigator.clipboard.writeText(url);
  }, [serverSlug, isDm, isThread, entry.parentChannelId, entry.parentMessageId, entry.channelId, entry.messageId]);

  const handleCopyMarkdown = useCallback(() => {
    navigator.clipboard.writeText(entry.content);
  }, [entry.content]);

  const handleRemove = useCallback(() => {
    onRemoveMessage(entry.messageId);
  }, [entry.messageId, onRemoveMessage]);

  const handleRemoveButtonClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onRemoveMessage(entry.messageId);
  }, [entry.messageId, onRemoveMessage]);

  const handleOpen = useCallback(() => {
    onOpenEntry(entry);
  }, [entry, onOpenEntry]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleOpen();
    }
  }, [handleOpen]);

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <ListRow
            variant="plain"
            render={<div />}
            role="button"
            tabIndex={0}
            data-saved-row=""
            onClick={handleOpen}
            onKeyDown={handleKeyDown}
          />
        }
      >
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex min-w-0 items-center gap-2 text-caption">
            <span className="shrink-0 text-foreground-hint">{channelLabel}</span>
            {isThread && (
              <span className="inline-flex shrink-0 items-center gap-1 text-foreground-hint">
                <MessageSquare size={12} />
                {formatMessage({ id: "saved.threadLabel" })}
              </span>
            )}
            {senderName && (
              <span className="inline-flex min-w-0 items-center gap-1 font-semibold text-foreground">
                {senderAgent ? (
                  <AvatarSlot context="preview-mini" type="agent" agentAvatarUrl={senderAgent.avatarUrl ?? null} />
                ) : entry.senderType === "external_projection" ? (
                  <AvatarSlot context="preview-mini" type="app" appAvatarUrl={entry.senderAvatarUrl} appInitials={senderName} />
                ) : (
                  <AvatarSlot context="preview-mini" type="human" humanAvatarUrl={senderMember?.avatarUrl} gravatarHash={senderMember?.gravatarHash} />
                )}
                <span className="truncate">{senderName}</span>
              </span>
            )}
            <span className="shrink-0 font-mono text-mono-meta text-foreground-hint">
              {formatRelativeTime(entry.createdAt, locale) ?? ""}
            </span>
          </div>
          <p className="line-clamp-3 text-callout text-foreground">
            {entry.content}
          </p>
        </div>
        <div className="ml-auto shrink-0 self-center">
          {/* Every row here is saved, so the filled bookmark carries the state
              and the toggle stays a quiet icon button: a yellow sticker on each
              row would paint the list yellow (Raft DS: yellow is for where you
              are, and content stays on white paper). */}
          <PanelToggleAction
            pressed
            onKeyDown={stopKeyPropagation}
            onClick={handleRemoveButtonClick}
            aria-label={formatMessage({ id: "saved.remove" })}
            className="data-pressed:border-transparent data-pressed:bg-transparent data-pressed:text-foreground data-pressed:hover:bg-fill-pressed"
          >
            <Bookmark size={14} fill="currentColor" aria-hidden />
          </PanelToggleAction>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem onClick={handleCopyLink}>
          <Link size={14} />
          <span>{formatMessage({ id: "saved.copyLink" })}</span>
        </ContextMenuItem>
        <ContextMenuItem onClick={handleCopyMarkdown}>
          <Copy size={14} />
          <span>{formatMessage({ id: "saved.copyMarkdown" })}</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleRemove}>
          <Bookmark size={14} />
          <span>{formatMessage({ id: "saved.remove" })}</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

export default function SavedPanel({ embedded = false }: {
  /** Embedded hosts own the surrounding panel header and navigation. */
  embedded?: boolean;
} = {}) {
  const { formatMessage } = useIntl();
  const saved = useSavedStore((s) => s.saved);
  // True total (server count), not the loaded-so-far page length — the panel
  // header has room for the exact number (the sidebar badge caps at 99+).
  const savedTotal = useSavedStore((s) => s.total);
  const loadSaved = useSavedStore((s) => s.loadSaved);
  const loadMore = useSavedStore((s) => s.loadMore);
  const hasMore = useSavedStore((s) => s.hasMore);
  const loading = useSavedStore((s) => s.loading);
  const unsaveMessage = useSavedStore((s) => s.unsaveMessage);
  const openThread = useThreadStore((s) => s.openThread);
  const serverSlug = useServerStore((s) => s.current?.slug);
  const serverId = useServerStore((s) => s.current?.id);
  const onMobileBack = useMobileBack(serverSlug ? `/s/${serverSlug}` : "/");
  const nav = useAppNavigate();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

  const openSavedEntry = useCallback((entry: SavedEntry) => {
    if (entry.channelType === "thread" && entry.parentChannelId && entry.parentMessageId) {
      nav.toMessage(entry.parentChannelId, entry.parentMessageId);
      // Stryker disable all: typed thread payload shape is covered by openThread payload/source contracts.
      void openThread({
        parentChannelId: entry.parentChannelId,
        parentMessageId: entry.parentMessageId,
        focusedMessageId: entry.messageId,
      });
      // Stryker restore all
    } else {
      nav.toMessage(entry.channelId, entry.messageId);
    }
  }, [nav, openThread]);

  const removeSavedMessage = useCallback((messageId: string) => {
    void unsaveMessage(messageId);
  }, [unsaveMessage]);

  useEffect(() => {
    // The route can mount one render before ServerResolver selects the URL's
    // server.  An early request has no X-Server-Id and is rejected/empty;
    // retry when the authoritative server context arrives so a refresh cannot
    // make an existing Saved row appear to disappear permanently.
    if (!serverId) return;
    void loadSaved({ query: "", sortDirection: "desc" });
  }, [loadSaved, serverId]);

  useEffect(() => {
    if (!hasMore || loading || saved.length === 0) return;
    if (typeof IntersectionObserver === "undefined") return;
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMore();
        }
      },
      {
        root: scrollerRef.current,
        rootMargin: "240px 0px",
        threshold: 0,
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore, loading, saved.length]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-layer-canvas">
      {!embedded ? (
        <PanelHeader
          title={formatMessage({ id: "saved.header.title" })}
          subtitle={formatMessage({ id: "saved.header.subtitle" }, { count: savedTotal })}
          onMobileBack={onMobileBack}
        />
      ) : null}

      {/* Saved list */}
      <div
        ref={scrollerRef}
        data-testid="saved-list-scroller"
        className="flex-1 overflow-y-auto bg-layer-canvas py-1 safe-bottom"
      >
        {loading && saved.length === 0 ? (
          <ConversationCardSkeleton />
        ) : saved.length === 0 ? (
          <EmptyState
            className="flex h-full flex-col items-center justify-center"
            icon={<Bookmark size={36} />}
            title={formatMessage({ id: "emptyState.noSavedTitle" })}
            description={formatMessage({ id: "saved.emptyDescription" })}
          />
        ) : (
          <div className="flex flex-col">
            {saved.map((entry) => (
              <SavedItem
                key={entry.messageId}
                entry={entry}
                serverSlug={serverSlug}
                onOpenEntry={openSavedEntry}
                onRemoveMessage={removeSavedMessage}
              />
            ))}
            {hasMore && (
              <div
                ref={loadMoreSentinelRef}
                data-testid="saved-infinite-scroll-sentinel"
                className="flex min-h-10 items-center justify-center py-3"
                aria-live="polite"
              >
                {loading ? (
                  <span className="font-mono text-mono-meta text-foreground-hint">{formatMessage({ id: "common.loading" })}</span>
                ) : (
                  <span className="sr-only">{formatMessage({ id: "saved.loadingMore" })}</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
