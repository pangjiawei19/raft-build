import { dismissLayerProps } from "./ui/dismissLayer";
import { RUNTIME_API_BASE } from "../desktopRuntimeEnvironment";
import type { DialogProps } from "@botiverse/raft-ui";
import { InlineCode, toast } from "@botiverse/raft-ui";
import { AnnouncementDialog, AnnouncementDialogAction, AnnouncementDialogBody, AnnouncementDialogClose, AnnouncementDialogContent, AnnouncementDialogFooter, AnnouncementDialogHeader, AnnouncementDialogLabel, AnnouncementDialogPicture, AnnouncementDialogSecondaryAction, AnnouncementDialogText, AnnouncementDialogTitle } from "@botiverse/raft-ui/wip";
import { useCallback, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Announcement } from "@botiverse/raft-shared";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router-dom";
import { useAnnouncementStore } from "../store/announcementStore";
import { useServerStore } from "../store/serverStore";
import { claimAnnouncementShown } from "../analytics/announcements";
import { trackEvent } from "../analytics/track";
import { shouldAutoDismissSlockdevAnnouncement } from "../utils/devMode";

type AnnouncementAction = "primary" | "secondary" | "close" | "outside" | "escape";

const REMARK_PLUGINS = [remarkGfm];
const MARKDOWN_COMPONENTS: Components = {
  // Raft Design System prose link: the link blue with a 2px underline that
  // turns pink on hover (a link is a place to go).
  a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-foreground-link underline decoration-2 underline-offset-2 hover:decoration-attention">{children}</a>,
  code: ({ children }) => <InlineCode>{children}</InlineCode>,
};

export default function AnnouncementModal({ suppressed = false }: { suppressed?: boolean }) {
  const pending = useAnnouncementStore((state) => state.pending);
  const writeFailedIds = useAnnouncementStore((state) => state.writeFailedIds);
  const { formatMessage } = useIntl();
  const notifiedRef = useRef<Set<string>>(new Set());

  // A failed read-complete write is invisible by construction: the modal has
  // already closed and the queue has already advanced past the row, so nothing
  // else in the UI would reveal that it was never recorded. Raised here rather
  // than inside the store so the copy stays translatable. This component is
  // mounted for the whole session (it returns null when idle), so the toast
  // still fires for a row whose modal has gone.
  useEffect(() => {
    for (const id of writeFailedIds) {
      if (notifiedRef.current.has(id)) continue;
      notifiedRef.current.add(id);
      toast.error(formatMessage({ id: "common.announcement.saveFailed" }));
    }
  }, [writeFailedIds, formatMessage]);

  const serverId = useServerStore((state) => state.current?.id);
  const candidate = pending[0];
  const current = suppressed || (candidate?.deliveryScope?.type === "server" && candidate.deliveryScope.serverId !== serverId) ? undefined : candidate;
  if (!current || current.pages.length === 0) return null;
  return <AnnouncementModalContent key={`${current.id}:${current.deliveryVersion ?? 1}`} current={current} />;
}

function AnnouncementModalContent({ current }: { current: Announcement }) {
  const { formatMessage } = useIntl();
  const navigate = useNavigate();
  const dismiss = useAnnouncementStore((state) => state.dismiss);
  const activated = useRef(false);
  const serverId = useServerStore((state) => state.current?.id);
  useEffect(() => {
    const shown = () => {
      if (document.visibilityState !== "visible" || !serverId) return;
      if (!claimAnnouncementShown(current.id, current.deliveryVersion ?? 1)) return;
      trackEvent("announcement_shown", { announcement_id: current.id, delivery_version: current.deliveryVersion ?? 1 }, { serverId });
    };
    shown();
    document.addEventListener("visibilitychange", shown);
    return () => document.removeEventListener("visibilitychange", shown);
  }, [current.id, current.deliveryVersion, serverId]);
  const close = useCallback((action?: AnnouncementAction) => {
    if (activated.current) return;
    activated.current = true;
    if (action) trackEvent("announcement_interacted", {
      announcement_id: current.id, delivery_version: current.deliveryVersion ?? 1,
      action, has_cta: Boolean(current.cta),
    }, { serverId });
    void dismiss(current.id);
  }, [current.id, current.deliveryVersion, current.cta, dismiss, serverId]);
  const onOpenChange = useCallback<NonNullable<DialogProps["onOpenChange"]>>((open, details) => {
    if (open) return;
    const action = details.reason === "outside-press" ? "outside"
      : details.reason === "escape-key" ? "escape"
      : details.reason === "close-press" ? "close" : undefined;
    close(action);
  }, [close]);
  const acknowledge = useCallback(() => close("secondary"), [close]);
  const activate = useCallback(() => {
    if (activated.current) return;
    close("primary");
    // Open external links synchronously in the user gesture; persistence failure
    // still appears through the store's save-failed toast.
    if (!current.cta) return;
    if ((current.cta.href.startsWith("/") || current.cta.href.startsWith("?"))) navigate(current.cta.href);
    else window.open(current.cta.href, "_blank", "noopener,noreferrer");
  }, [current.cta, close, navigate]);
  useEffect(() => {
    if (!shouldAutoDismissSlockdevAnnouncement(import.meta.env?.VITE_DEPLOYMENT_ENV)) return;
    const frame = requestAnimationFrame(() => close());
    return () => cancelAnimationFrame(frame);
  }, [close]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
      // Let the focused control perform its own action (including secondary/close).
      if (event.target instanceof Element && event.target.closest('[data-testid="announcement-modal"] button, [data-testid="announcement-modal"] a')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      activate();
    };
    // keydown-global-exempt: AnnouncementDialog owns initial focus; capture handles Enter before the background composer.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [activate, close, current.cta]);
  const gotIt = formatMessage({ id: "common.announcement.gotIt", defaultMessage: "Got it" });
  return <AnnouncementDialog open onOpenChange={onOpenChange}>
    <AnnouncementDialogContent {...dismissLayerProps} layer={1} data-testid="announcement-modal">
      <AnnouncementDialogBody>
        <AnnouncementDialogHeader>
          <AnnouncementDialogLabel>{current.label ?? formatMessage({ id: "common.announcement.whatsNew", defaultMessage: "Latest updates" })}</AnnouncementDialogLabel>
          <AnnouncementDialogClose aria-label={formatMessage({ id: "common.announcement.dismiss" })} />
        </AnnouncementDialogHeader>
        <AnnouncementDialogTitle data-testid="announcement-title">{current.title}</AnnouncementDialogTitle>
        {current.image && <AnnouncementDialogPicture><img src={`${RUNTIME_API_BASE.replace(/\/$/, "")}/announcements/images/${current.image.assetId}`} alt={current.image.alt} /></AnnouncementDialogPicture>}
        <AnnouncementDialogText data-testid="announcement-page-body">
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>{current.pages[0]?.body ?? ""}</ReactMarkdown>
        </AnnouncementDialogText>
      </AnnouncementDialogBody>
      <AnnouncementDialogFooter>
        {current.cta && <AnnouncementDialogSecondaryAction onClick={acknowledge}>{gotIt}</AnnouncementDialogSecondaryAction>}
        <AnnouncementDialogAction onClick={activate} data-testid="announcement-ok">{current.cta?.label ?? gotIt}</AnnouncementDialogAction>
      </AnnouncementDialogFooter>
    </AnnouncementDialogContent>
  </AnnouncementDialog>;
}
