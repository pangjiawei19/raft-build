import { Download, Eye, MessageSquare } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import type { Message } from "../../store/messageStore";
import AttachmentTooltip from "./attachmentTooltip";
import {
  MessageAttachmentAction,
  MessageAttachmentCard,
  MessageAttachmentMeta,
  MessageAttachmentMetaEnd,
  MessageAttachmentSummary,
  MessageAttachmentTitle,
  Spinner,
} from "@botiverse/raft-ui";
import { AttachmentTypeBadge } from "./AttachmentTypeBadge";

type MessageAttachment = NonNullable<Message["attachments"]>[number];

// Every non-gallery attachment is one chip: filename, meta and an optional
// summary stacked in RUI's MessageAttachment card, with its actions in the
// card's meta row end. Image attachments are the exception: they render in the
// message gallery (raft-ui's row builder), not as chips.

interface AttachmentChipProps {
  attachment: MessageAttachment;
  isOptimistic: boolean;
  loading?: boolean;
  loadingLabel?: string;
  onClick?: () => void;
  affordance?: "download" | "preview" | "none";
  affordanceName?: string;
  meta?: ReactNode;
  summary?: ReactNode;
  secondaryDownload?: {
    onClick: () => void;
    label: string;
    affordanceName?: string;
  };
  /** Overrides the accessible name; defaults to the filename. */
  ariaLabel?: string;
}

// Layout-only token (border / bg / padding / hover / active come from the RUI
// MessageAttachmentCard recipe). messageAttachmentChip width-contract guards
// (w-44 / min-w-44 / max-w-44 / shrink-0 / overflow-hidden) still live here and
// are passed to the card as className; the contract test pins this literal.
const COMPACT_CHIP_LAYOUT = "group/img relative inline-flex h-20 w-44 min-w-44 max-w-44 shrink-0 flex-col justify-between overflow-hidden text-left";

function TruncatedAttachmentTooltip({
  content,
  className,
  affordance,
  children,
}: {
  content: ReactNode;
  className: string;
  affordance: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  const measure = useCallback(() => {
    const node = ref.current;
    setIsTruncated(Boolean(node && node.scrollWidth > node.clientWidth + 1));
  }, []);

  useEffect(() => {
    measure();
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [measure]);

  const text = (
    <span
      ref={ref}
      data-message-affordance={affordance}
      className={className}
      onMouseEnter={measure}
    >
      {children}
    </span>
  );

  if (!isTruncated) return text;
  return <AttachmentTooltip content={content}>{text}</AttachmentTooltip>;
}

export function AttachmentChip({
  attachment,
  isOptimistic,
  loading = false,
  loadingLabel,
  onClick,
  affordance = "none",
  affordanceName,
  meta,
  summary,
  secondaryDownload,
  ariaLabel,
}: AttachmentChipProps) {
  const { formatMessage } = useIntl();
  const resolvedLoadingLabel = loadingLabel ?? formatMessage({ id: "message.attachment.openingPreview" });
  const disabled = isOptimistic || loading || !onClick;
  // Per-state overrides on top of the RUI card recipe. Loading is a passive
  // indicator (DS Loading: never the action pink), so the card keeps its
  // surface and the in-card loading row + spinner carry the busy signal.
  const stateClassName = isOptimistic
    ? "opacity-70"
    : loading
      ? "cursor-wait"
      : "";
  const loadingBar = (
    <div
      data-message-affordance="attachment-preview-loading"
      className="absolute inset-x-0 bottom-0 flex h-7 items-center gap-1.5 border-t border-line-hairline bg-layer-card px-2.5 text-caption text-foreground-muted"
    >
      <Spinner size="xs" aria-label={formatMessage({ id: "common.loadingLabel" })} />
      <span className="truncate">{resolvedLoadingLabel}</span>
    </div>
  );

  // The primary affordance icon is decorative: the whole card already carries
  // the click action, so it renders the RUI action recipe on a plain div
  // instead of nesting a real button inside the card button. The secondary
  // download (audio) is a real action with its own click handler.
  const affordanceIcon = affordance === "download" ? (
    <MessageAttachmentAction
      render={<div />}
      aria-hidden="true"
      data-message-affordance={affordanceName ?? "file-download"}
    >
      <Download size={16} />
    </MessageAttachmentAction>
  ) : affordance === "preview" ? (
    <MessageAttachmentAction
      render={<div />}
      aria-hidden="true"
      data-message-affordance={affordanceName ?? "file-preview"}
    >
      <Eye size={16} />
    </MessageAttachmentAction>
  ) : null;

  const handleSecondaryDownload = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    secondaryDownload?.onClick();
  }, [secondaryDownload]);

  return (
    <MessageAttachmentCard
      render={disabled ? <div /> : <button type="button" />}
      onClick={disabled ? undefined : onClick}
      aria-busy={loading ? "true" : undefined}
      aria-label={ariaLabel ?? attachment.filename}
      className={`${COMPACT_CHIP_LAYOUT}${stateClassName ? ` ${stateClassName}` : ""}`}
    >
      <MessageAttachmentTitle
        data-message-affordance="attachment-text-slot"
        className="min-w-0 overflow-hidden"
      >
        <span className="flex min-w-0 max-w-full items-center gap-1.5">
          <AttachmentTypeBadge
            filename={attachment.filename}
            data-message-affordance="attachment-type-badge"
          />
          <TruncatedAttachmentTooltip
            content={attachment.filename}
            affordance="attachment-filename"
            className="block min-w-0 max-w-full flex-1 truncate"
          >
            {attachment.filename}
          </TruncatedAttachmentTooltip>
        </span>
      </MessageAttachmentTitle>
      {summary ? (
        <MessageAttachmentSummary
          data-message-affordance="attachment-summary-slot"
          className="flex min-w-0 max-w-full overflow-hidden"
        >
          <TruncatedAttachmentTooltip
            content={summary}
            affordance="attachment-summary-text"
            className="inline-flex min-w-0 max-w-full flex-1 items-center gap-1.5 overflow-hidden truncate"
          >
            {summary}
          </TruncatedAttachmentTooltip>
        </MessageAttachmentSummary>
      ) : null}
      <MessageAttachmentMeta>
        {meta}
        {/* Scoped attachment-comment count (MVP §5): rendered inside the
            existing meta line — text-language badge, no new chip layer.
            Suppressed for pdf/image: those surfaces have no comment
            entry (descoped, cindyz 6/11), so a count would dead-end. */}
        {(attachment.commentCount ?? 0) > 0
          && !attachment.mimeType?.startsWith("image/")
          && attachment.mimeType?.split(";")[0]?.trim().toLowerCase() !== "application/pdf" ? (
          <span data-message-affordance="attachment-comment-count" className="inline-flex items-center gap-1 pl-1">
            {meta ? <span>·</span> : null}
            <MessageSquare size={12} className="shrink-0" />
            {attachment.commentCount}
          </span>
        ) : null}
        <MessageAttachmentMetaEnd>
          {loading ? null : isOptimistic ? (
            <Spinner size="sm" aria-label={formatMessage({ id: "common.loadingLabel" })} />
          ) : (
            <>
              {secondaryDownload ? (
                <MessageAttachmentAction
                  data-message-affordance={secondaryDownload.affordanceName ?? "file-download"}
                  aria-label={secondaryDownload.label}
                  onClick={handleSecondaryDownload}
                >
                  <Download size={16} />
                </MessageAttachmentAction>
              ) : null}
              {affordanceIcon}
            </>
          )}
        </MessageAttachmentMetaEnd>
      </MessageAttachmentMeta>
      {loading ? loadingBar : null}
      </MessageAttachmentCard>
  );
}
