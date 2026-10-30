import { DialogSurface, Field, FieldLabel, InputGroup, InputGroupAddon, InputGroupInput } from "@botiverse/raft-ui";
import CloseButton from "../ui/CloseButton";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useCallback } from "react";
import { Search, X } from "lucide-react";
import { useIntl } from "react-intl";
import Modal from "../Modal";
import ForwardedBundleCard from "./ForwardedBundleCard";
import type { ForwardedBundleAttachmentSnapshot, ForwardedBundleMetadata } from "./ForwardedBundleCard";
import MessageInput from "./MessageInput";
import { COMPOSER_DOCK_CLASS } from "./composerHost";
import SectionEyebrow from "../ui/SectionEyebrow";

// No-op close handler for the Modal while a send/join is in flight. Hoisted so
// the JSX does not allocate a fresh function per render.
function noopClose() {}

// DS UI text link (Clear): ink, 1.5px underline, semibold.
const FORWARD_TEXT_LINK_CLASS = "font-semibold text-foreground underline decoration-[1.5px] underline-offset-[3px]";

type Props = {
  sourceMessageCount: number;
  sourceLabelText: string;
  onClose: () => void;
  sending: boolean;
  joinInFlight: boolean;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  search: (query: string) => void;
  resetSearch: () => void;
  selectedCount: number;
  clearSelection: () => void;
  targetResults: ReactNode;
  warnings: ReactNode;
  previewMetadata: ForwardedBundleMetadata;
  onOpenAttachment: (attachment: ForwardedBundleAttachmentSnapshot) => void;
  noteComposerChannelId: string;
  noteMentionChannelId?: string;
  noteMentionScopeChannelType?: "channel" | "private" | "joint" | "dm" | "thread" | null;
  submitDisabled: boolean;
  submitDisabledReason: string | null;
  sendForwardNote: (note: string) => Promise<void>;
};

export default function ForwardComposerDesktop({
  sourceMessageCount,
  sourceLabelText,
  onClose,
  sending,
  joinInFlight,
  query,
  setQuery,
  search,
  resetSearch,
  selectedCount,
  clearSelection,
  targetResults,
  warnings,
  previewMetadata,
  onOpenAttachment,
  noteComposerChannelId,
  noteMentionChannelId,
  noteMentionScopeChannelType,
  submitDisabled,
  submitDisabledReason,
  sendForwardNote,
}: Props) {
  const { formatMessage } = useIntl();
  const sendLabel = formatMessage({ id: "message.forwardComposer.sendForward" });
  // Stable handler: the target search is a rui InputGroup control now, and an
  // inline arrow would be a new function prop on every render (react-perf gate).
  const handleSearchChange = useCallback((event: { target: { value: string } }) => {
    const value = event.target.value;
    setQuery(value);
    const trimmed = value.trim();
    if (trimmed) search(trimmed); else resetSearch();
  }, [setQuery, search, resetSearch]);
  return (
    <Modal onClose={sending || joinInFlight ? noopClose : onClose} closeOnBackdrop>
      {/* DS Dialog surface: raft-ui's DialogSurface on the raw Modal backdrop,
          because the two-column picker is wider than raft-ui's confirm Dialog. */}
      <DialogSurface className="h-[min(42rem,calc(100dvh-1rem))] w-[min(48rem,calc(100vw-1rem))] max-h-[calc(100dvh-1rem)] md:h-[min(clamp(30rem,72dvh,46rem),calc(100dvh-2rem))] md:w-[min(clamp(48rem,60vw,60rem),calc(100vw-2rem))]" data-testid="forward-composer-dialog">
        <div className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-line-seam py-2 pl-5 pr-3">
          <div className="min-w-0">
            <h2 className="text-headline">{formatMessage({ id: "message.forwardComposer.title" })}</h2>
            <p className="truncate text-caption text-foreground-hint">{formatMessage({ id: "message.forwardComposer.selectedFrom" }, { count: sourceMessageCount, source: sourceLabelText })}</p>
          </div>
          <CloseButton type="button"   onClick={onClose} disabled={sending || joinInFlight} aria-label={formatMessage({ id: "message.forwardComposer.close" })}><X size={16} /></CloseButton>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-0 md:grid md:grid-cols-[clamp(19rem,24vw,22rem)_minmax(0,1fr)]">
          <div className="flex max-h-[min(34dvh,13rem)] shrink-0 flex-col border-b border-line-seam p-3 md:h-full md:max-h-none md:min-h-0 md:border-b-0 md:border-r">
            <InputGroup className="mb-2">
              <InputGroupAddon>
                <Search size={14} aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                value={query}
                onChange={handleSearchChange}
                placeholder={formatMessage({ id: "message.forwardComposer.searchPlaceholder" })}
                aria-label={formatMessage({ id: "message.forwardComposer.searchPlaceholder" })}
                className="min-w-0 flex-1"
                autoFocus
              />
            </InputGroup>
            <SectionEyebrow as="div" className="mb-1 flex h-6 shrink-0 items-center justify-between px-1">
              <span data-testid="forward-selected-count">{formatMessage({ id: "message.forwardComposer.selectedCount" }, { count: selectedCount })}</span>
              {selectedCount > 0 && <button type="button" onClick={clearSelection} disabled={joinInFlight} className={FORWARD_TEXT_LINK_CLASS}>{formatMessage({ id: "message.forwardComposer.clear" })}</button>}
            </SectionEyebrow>
            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">{targetResults}</div>
          </div>
          <div className="flex min-w-0 min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {warnings}
              <div className="mb-2"><ForwardedBundleCard metadata={previewMetadata} onOpenAttachment={onOpenAttachment} fullWidth /></div>
            </div>
            <div className={COMPOSER_DOCK_CLASS} data-testid="forward-desktop-note-actions">
              <Field>
                <FieldLabel size="sm" htmlFor="forward-desktop-note">{formatMessage({ id: "message.forwardComposer.optionalNote" })}</FieldLabel>
                <MessageInput
                  channelId={noteComposerChannelId}
                  channelName={formatMessage({ id: "message.forwardComposer.optionalNote" })}
                  placeholder={formatMessage({ id: "message.forwardComposer.addNotePlaceholder" })}
                  variant="compact"
                  mentionChannelId={noteMentionChannelId}
                  mentionScopeChannelType={noteMentionScopeChannelType}
                  loadMentionMembers={Boolean(noteMentionChannelId)}
                  onSendOverride={sendForwardNote}
                  allowEmptySubmit
                  submitDisabled={submitDisabled}
                  submitBusy={sending}
                  submitDisabledReason={submitDisabledReason ?? undefined}
                  submitTitleOverride={sendLabel}
                  submitLabelOverride={sendLabel}
                  textareaId="forward-desktop-note"
                  maxLength={4000}
                />
              </Field>
            </div>
          </div>
        </div>
      </DialogSurface>
    </Modal>
  );
}
