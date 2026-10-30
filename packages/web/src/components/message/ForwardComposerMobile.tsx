import { useCallback, useEffect, useState } from "react";
import type { ChangeEvent, CSSProperties, Dispatch, ReactNode, SetStateAction } from "react";
import { ArrowLeft, Check, Search, Undo2 } from "lucide-react";
import { useIntl } from "react-intl";
import { Field, FieldLabel, InputGroup, InputGroupAddon, InputGroupInput, Button, PanelAction, PanelActions, PanelHeader } from "@botiverse/raft-ui";
import type { Message } from "../../store/messageStore";
import ForwardedBundleCard from "./ForwardedBundleCard";
import type { ForwardedBundleAttachmentSnapshot, ForwardedBundleMetadata } from "./ForwardedBundleCard";
import type { MobileForwardStep, SelectedDestination } from "./forwardComposerModel";
import MessageInput from "./MessageInput";
import { COMPOSER_DOCK_CLASS } from "./composerHost";
import SectionEyebrow from "../ui/SectionEyebrow";

// DS NavBar for a pushed phone page is raft-ui's panel head: white bar, seam
// under it, a ghost Back 3px from the edge, mirroring the last action.
const FORWARD_MOBILE_TITLE_CLASS = "truncate text-headline";
const FORWARD_MOBILE_SUBTITLE_CLASS = "truncate text-caption text-foreground-hint";

type Props = {
  mobileStep: MobileForwardStep;
  setMobileStep: Dispatch<SetStateAction<MobileForwardStep>>;
  sourceMessages: Message[];
  sourceLabelText: string;
  previewMetadata: ForwardedBundleMetadata;
  sending: boolean;
  joinInFlight: boolean;
  selectedDestinations: Map<string, SelectedDestination>;
  setSelectedDestinations: Dispatch<SetStateAction<Map<string, SelectedDestination>>>;
  mobileMultiSelect: boolean;
  setMobileMultiSelect: Dispatch<SetStateAction<boolean>>;
  hasSelection: boolean;
  noteComposerChannelId: string;
  noteMentionChannelId?: string;
  noteMentionScopeChannelType?: "channel" | "private" | "joint" | "dm" | "thread" | null;
  submitDisabled: boolean;
  submitDisabledReason: string | null;
  warnings: ReactNode;
  targetResults: ReactNode;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  search: (query: string) => void;
  resetSearch: () => void;
  openMobilePreview: () => void;
  openMobileDetail: () => boolean;
  onOpenAttachment: (attachment: ForwardedBundleAttachmentSnapshot) => void;
  sendForwardNote: (note: string) => Promise<void>;
  onClose: () => void;
};

export default function ForwardComposerMobile({
  mobileStep,
  setMobileStep,
  sourceMessages,
  sourceLabelText,
  previewMetadata,
  sending,
  joinInFlight,
  selectedDestinations,
  setSelectedDestinations,
  mobileMultiSelect,
  setMobileMultiSelect,
  hasSelection,
  noteComposerChannelId,
  noteMentionChannelId,
  noteMentionScopeChannelType,
  submitDisabled,
  submitDisabledReason,
  warnings,
  targetResults,
  query,
  setQuery,
  search,
  resetSearch,
  openMobilePreview,
  openMobileDetail,
  onOpenAttachment,
  sendForwardNote,
  onClose,
}: Props) {
  const { formatMessage } = useIntl();
  const [visualViewportStyle, setVisualViewportStyle] = useState<CSSProperties | undefined>(undefined);
  const selectedLabels = [...selectedDestinations.values()].map((entry) => entry.label).join(", ");
  const sendLabel = formatMessage({ id: "message.forwardComposer.sendForward" });
  const selectedFrom = formatMessage(
    { id: "message.forwardComposer.selectedFrom" },
    { count: sourceMessages.length, source: sourceLabelText },
  );

  const backToPreview = useCallback(() => setMobileStep("preview"), [setMobileStep]);
  const backToTargets = useCallback(() => setMobileStep("targets"), [setMobileStep]);
  const cancelMultiSelect = useCallback(() => {
    setSelectedDestinations(new Map());
    setMobileMultiSelect(false);
  }, [setSelectedDestinations, setMobileMultiSelect]);
  const startMultiSelect = useCallback(() => {
    setSelectedDestinations(new Map());
    setMobileMultiSelect(true);
  }, [setSelectedDestinations, setMobileMultiSelect]);
  const handleQueryChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setQuery(value);
    const trimmed = value.trim();
    if (trimmed) search(trimmed); else resetSearch();
  }, [setQuery, search, resetSearch]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const updateVisualViewport = () => {
      const activeElement = document.activeElement;
      const editableFocused = activeElement instanceof HTMLInputElement
        || activeElement instanceof HTMLTextAreaElement
        || (activeElement instanceof HTMLElement && activeElement.isContentEditable);
      const keyboardVisible = editableFocused && window.innerHeight - viewport.height > 100;

      setVisualViewportStyle(keyboardVisible
        ? {
            top: `${Math.max(viewport.offsetTop, 0)}px`,
            bottom: "auto",
            height: `${viewport.height}px`,
          }
        : undefined);
    };

    viewport.addEventListener("resize", updateVisualViewport);
    viewport.addEventListener("scroll", updateVisualViewport, { passive: true });
    window.addEventListener("resize", updateVisualViewport);
    document.addEventListener("focusin", updateVisualViewport);
    document.addEventListener("focusout", updateVisualViewport);
    return () => {
      viewport.removeEventListener("resize", updateVisualViewport);
      viewport.removeEventListener("scroll", updateVisualViewport);
      window.removeEventListener("resize", updateVisualViewport);
      document.removeEventListener("focusin", updateVisualViewport);
      document.removeEventListener("focusout", updateVisualViewport);
    };
  }, []);

  return (
    <div
      className="fixed bottom-0 left-0 right-0 top-0 z-40 flex min-h-0 flex-col bg-layer-canvas text-foreground"
      style={visualViewportStyle}
      data-testid={mobileStep === "detail"
        ? "forward-mobile-detail-page"
        : mobileStep === "preview"
          ? "forward-mobile-note-page"
          : "forward-mobile-target-page"}
    >
      {mobileStep === "detail" ? (
        <>
          <PanelHeader render={<header />}>
            <PanelAction onClick={backToPreview} aria-label={formatMessage({ id: "message.forwardComposer.backToPreview" })}>
              <ArrowLeft />
            </PanelAction>
            <div className="min-w-0">
              <h1 className={FORWARD_MOBILE_TITLE_CLASS}>{formatMessage({ id: "message.forwardComposer.forwardedMessages" })}</h1>
              <p className={FORWARD_MOBILE_SUBTITLE_CLASS}>{selectedFrom}</p>
            </div>
          </PanelHeader>
          <main className="min-h-0 flex-1 overflow-y-auto p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
            <ForwardedBundleCard metadata={previewMetadata} onOpenAttachment={onOpenAttachment} forceExpanded fullWidth />
          </main>
        </>
      ) : mobileStep === "preview" ? (
        <>
          <PanelHeader render={<header />}>
            <PanelAction onClick={backToTargets} disabled={sending || joinInFlight} aria-label={formatMessage({ id: "message.forwardComposer.backToDestinations" })}>
              <ArrowLeft />
            </PanelAction>
            <div className="min-w-0 flex-1">
              <h1 className={FORWARD_MOBILE_TITLE_CLASS}>{formatMessage({ id: "message.forwardComposer.addNoteTitle" })}</h1>
              <p className={FORWARD_MOBILE_SUBTITLE_CLASS}>{formatMessage({ id: "message.forwardComposer.sendTo" }, { targets: selectedLabels })}</p>
            </div>
          </PanelHeader>
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="forward-mobile-note-layout">
            <div
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3"
              data-testid="forward-mobile-note-scroll"
            >
              {warnings}
              <div data-testid="forward-mobile-preview-content">
                <SectionEyebrow as="div" className="mb-2">{formatMessage({ id: "message.forwardComposer.messagePreview" })}</SectionEyebrow>
                <ForwardedBundleCard metadata={previewMetadata} onOpenAttachment={onOpenAttachment} onShowAll={openMobileDetail} fullWidth />
              </div>
            </div>
            <div
              className={`${COMPOSER_DOCK_CLASS} bg-layer-canvas pb-[max(12px,env(safe-area-inset-bottom))]`}
              data-testid="forward-mobile-preview-actions"
            >
              <Field>
                <FieldLabel size="sm" htmlFor="forward-mobile-note">{formatMessage({ id: "message.forwardComposer.optionalNote" })}</FieldLabel>
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
                  textareaId="forward-mobile-note"
                  maxLength={4000}
                  autoFocus
                  autoFocusMode="always"
                />
              </Field>
            </div>
          </main>
        </>
      ) : (
        <>
          <PanelHeader render={<header />}>
            {mobileMultiSelect ? (
              <PanelAction onClick={cancelMultiSelect} disabled={sending || joinInFlight} aria-label={formatMessage({ id: "common.confirm.cancel" })}>
                <Undo2 />
              </PanelAction>
            ) : (
              <PanelAction onClick={onClose} disabled={sending || joinInFlight} aria-label={formatMessage({ id: "message.forwardComposer.closeTargetSelection" })}>
                <ArrowLeft />
              </PanelAction>
            )}
            <div className="min-w-0 flex-1">
              <h1 className={FORWARD_MOBILE_TITLE_CLASS}>{formatMessage({ id: "message.forwardComposer.selectDestinations" })}</h1>
              <p className={FORWARD_MOBILE_SUBTITLE_CLASS}>{selectedFrom}</p>
            </div>
            {/* Done is filled, so its shape (not its glyph) ends on 16: it
                sits straight in the head. Select multiple is a ghost, so it
                joins the overhanging actions. */}
            {mobileMultiSelect ? (
              <Button type="button" variant="accent" size="icon-lg" onClick={openMobilePreview} disabled={!hasSelection || sending || joinInFlight} aria-label={formatMessage({ id: "message.forwardComposer.done" })}>
                <Check size={14} />
              </Button>
            ) : (
              <PanelActions>
                <Button size="sm" type="button" variant="ghost" onClick={startMultiSelect} disabled={joinInFlight}>
                  {formatMessage({ id: "message.forwardComposer.selectMultiple" })}
                </Button>
              </PanelActions>
            )}
          </PanelHeader>
          <main className="flex min-h-0 flex-1 flex-col p-3">
            <InputGroup className="mb-3 shrink-0">
              <InputGroupAddon align="inline-start">
                <Search aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                value={query}
                onChange={handleQueryChange}
                placeholder={formatMessage({ id: "message.forwardComposer.searchPlaceholder" })}
                autoFocus
              />
            </InputGroup>
            <SectionEyebrow as="div" className="mb-1 flex h-6 shrink-0 items-center justify-between px-1">
              <span>{mobileMultiSelect
                ? formatMessage({ id: "message.forwardComposer.selectedCount" }, { count: selectedDestinations.size })
                : formatMessage({ id: "message.forwardComposer.recent" })}</span>
              {mobileMultiSelect && selectedDestinations.size > 0 && (
                <button type="button" onClick={() => setSelectedDestinations(new Map())} disabled={joinInFlight} className="font-semibold text-foreground underline decoration-[1.5px] underline-offset-[3px]">
                  {formatMessage({ id: "message.forwardComposer.clear" })}
                </button>
              )}
            </SectionEyebrow>
            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pb-2">{targetResults}</div>
          </main>
        </>
      )}
    </div>
  );
}
