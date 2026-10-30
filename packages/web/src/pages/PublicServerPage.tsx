import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { BadgeInfo, BookOpenText, Cookie, FileText, Hash, Languages, LogIn, MessageSquare, Type, User, UserPlus } from "lucide-react";
import { useIntl } from "react-intl";
import api from "../api/client";
import { recordPublicVisit } from "../analytics/publicVisits";
import { applyPublicVisitorIdMode, publicVisitorId, usePublicVisitorConsent } from "../analytics/publicVisitorConsent";
import PublicCookieConsent from "../components/server/PublicCookieConsent";
import Banner from "../components/ui/Banner";
import { AppShellMainSlot, AppShellPanelSlot, AppShellRailSlot, AppShellRoot, AppShellSidebarSlot, Button, ConversationPanelContent, ConversationPanelRoot, Spinner, SidebarItemIcon } from "@botiverse/raft-ui";
import PanelHeader from "../components/ui/PanelHeader";
import PanelResizeHandle from "../components/ui/PanelResizeHandle";
import EmptyState from "../components/ui/EmptyState";
import type { ReadOnlySenderProjection } from "../components/message/MessageItem";
import type { OpenThreadRequest } from "../store/threadStore";
import { PublicMessageRow } from "./PublicMessageRow";
import { ReadOnlyAttachmentUrlContext } from "../components/message/ReadOnlyMessageAttachments";
import type { ReadOnlyAttachmentUrls } from "../components/message/ReadOnlyMessageAttachments";
import { RUNTIME_API_BASE } from "../desktopRuntimeEnvironment";
import MessageTimeline from "../components/message/MessageTimeline";
import type { MessageTimelineSource } from "../components/message/MessageTimeline";
import ThreadPanel from "../components/message/ThreadPanel";
import type { ReadOnlyThreadData } from "../components/message/ThreadPanel";
import { LeftRail } from "../components/layout/LeftRail";
import SettingsSidebarList from "../components/settings/SettingsSidebarList";
import SettingsPanel from "../components/settings/SettingsPanel";
import type { SettingsTabId } from "../components/settings/settingsNavigation";
import ConfirmDialog from "../components/ConfirmDialog";
import CommunityAgreementDialog from "../components/server/CommunityAgreementDialog";
import PublicServerChannelSidebar from "../components/server/PublicServerChannelSidebar";
import PublicServerSidebarFrame from "../components/server/PublicServerSidebarFrame";
import type { CommunityAgreement } from "../components/server/CommunityAgreementDialog";
import {
  getThreadPanelDynamicMax,
  SIDEBAR_PANEL_BOUNDS,
  THREAD_PANEL_DEFAULT_WIDTH,
  THREAD_PANEL_MIN_WIDTH,
} from "../lib/panelBounds";
import { useMediaQuery } from "../hooks/effectPrimitives";
import { useTranslationBatch } from "../hooks/useTranslationBatch";
import { useResizablePanel } from "../hooks/useResizablePanel";
import { getApiErrorResponse } from "../utils/apiErrorResponse";
import { getPublicPersonalSettingsTabIds } from "../utils/translationContract";
import type { Channel } from "../store/channelStore";
import type { Message } from "../store/messageStore";
import { useTranslationStore } from "../store/translationStore";
import { getServerSurfaceCapabilities } from "@botiverse/raft-shared";
import type { PublicVisitorIdMode } from "@botiverse/raft-shared";

const PUBLIC_PANEL_RESIZE_QUERY = "(min-width: 640px)";

const CHANNEL_HEADER_CONTAINER_PROPS = { "data-testid": "public-server-channel-header" };
const CHANNEL_SIDEBAR_NAV = <nav />;
// A floating notice must carry its own width. The rui Banner is a size
// container, so its text adds nothing to its intrinsic width: without a width
// it collapses to one character per line.
// Floating notices are overlays, so they take the DS float shadow.
const FLOATING_NOTICE_WIDTH_CLASS = "w-[min(30rem,calc(100vw-2rem))] shadow-float";
const FLOATING_NOTICE_CLASS_TOP = `fixed left-1/2 top-4 z-50 -translate-x-1/2 ${FLOATING_NOTICE_WIDTH_CLASS}`;
const FLOATING_NOTICE_CLASS_BOTTOM = `fixed bottom-4 left-1/2 z-50 -translate-x-1/2 ${FLOATING_NOTICE_WIDTH_CLASS}`;
const noopLoadNewer = () => undefined;
const SETTINGS_SIDEBAR_ASIDE = <aside />;
const EMPTY_PUBLIC_CHANNELS: PublicChannel[] = [];
const ReleaseNotesPanel = lazy(() => import("../components/settings/ReleaseNotesPanel"));
type PublicSettingsView = SettingsTabId | "release-notes";

interface PublicChannel {
  id: string;
  name: string;
  description: string | null;
}

interface PublicServerReadback {
  server: { id: string; name: string; slug: string; avatarUrl: string | null; translationEnabled?: boolean };
  channels: PublicChannel[];
  canJoinAsGuest: boolean;
  translationAvailable?: boolean;
  /**
   * Present when a visitor id would be kept here: `ask` shows the cookie
   * banner first, `default_on` turns the id on with an opt-out (by country),
   * `default_off` (Global Privacy Control) keeps it off unless they opt in.
   */
  visitorIdMode?: PublicVisitorIdMode;
}

export interface PublicMessage {
  id: string;
  senderType: "user" | "agent" | "external_projection";
  sender: ReadOnlySenderProjection;
  messageType: "chat" | "system";
  content: string;
  createdAt: string;
  threadId: string | null;
  replyCount: number;
  /** Absent from servers older than the public rich-message projection. */
  attachments?: PublicAttachment[];
  mentions?: PublicMention[];
  reactions?: PublicReaction[];
  /** Absent from servers older than task #123. */
  lastReplyAt?: string | null;
  latestReplies?: PublicThreadReply[];
}

/** File metadata only; bytes come from the public attachment route. */
export interface PublicAttachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
}

/** `name` is the `@token` as written in the content; no principal id. */
export interface PublicMention {
  type: "user" | "agent" | "external";
  name: string;
  displayName: string;
}

/** Emoji and count only; reactor identities are never projected. */
export interface PublicReaction {
  emoji: string;
  count: number;
}

/** A reply in a message's inline thread preview: the public projection of ThreadReplyPreview (no sender id). */
export interface PublicThreadReply {
  messageId: string;
  seq: number;
  preview: string;
  senderType: "user" | "agent" | "system" | "external_projection";
  senderName: string;
  senderAvatarUrl: string | null;
  createdAt: string;
}

interface OpenPublicThread {
  threadChannelId: string;
  parentChannelId: string;
  parentMessageId: string;
}

function toReadOnlyMessage(message: PublicMessage, channelId: string): Message {
  return {
    id: message.id,
    channelId,
    senderType: message.senderType,
    // This key is display-local only. Public DTOs intentionally expose no
    // authority-bearing user/agent identifier.
    senderId: `public:${message.senderType}:${message.sender.displayName}:${message.sender.avatarUrl ?? ""}`,
    senderName: message.sender.displayName,
    senderDescription: message.sender.description,
    messageType: message.messageType,
    content: message.content,
    threadId: message.threadId,
    createdAt: message.createdAt,
    attachments: message.attachments ?? [],
    // Display-local mention keys, like senderId above: they let the shared
    // renderer highlight `@token` with the display name, and never reach an API.
    mentions: (message.mentions ?? []).map((mention) => ({
      type: mention.type,
      id: `public:${mention.type}:${mention.name}`,
      name: mention.name,
      displayName: mention.displayName,
    })),
    // Canonical shape with no actor preview: counts render, reactors cannot.
    reactions: (message.reactions ?? []).map((reaction) => ({ ...reaction, previewK: [] })),
  };
}

interface PublicPageState {
  readback: PublicServerReadback | null;
  selectedChannelId: string | null;
  messages: PublicMessage[];
  loadingMessages: boolean;
  hasOlder: boolean;
  error: string;
}

type PublicPageAction =
  | { type: "loadServer" }
  | { type: "serverLoaded"; readback: PublicServerReadback; initialChannelId?: string | null }
  | { type: "selectChannel"; channelId: string }
  | { type: "loadMessages" }
  | { type: "messagesLoaded"; messages: PublicMessage[] }
  | { type: "olderLoaded"; channelId: string; messages: PublicMessage[] }
  | { type: "failed"; error: string };

function publicPageReducer(state: PublicPageState, action: PublicPageAction): PublicPageState {
  switch (action.type) {
    case "loadServer": return {
      readback: null,
      selectedChannelId: null,
      messages: [],
      loadingMessages: false,
      hasOlder: false,
      error: "",
    };
    case "serverLoaded": return {
      ...state,
      readback: action.readback,
      selectedChannelId: action.readback.channels.find((channel) => channel.id === action.initialChannelId)?.id
        ?? action.readback.channels[0]?.id
        ?? null,
    };
    case "selectChannel": return { ...state, selectedChannelId: action.channelId, messages: [], hasOlder: false };
    case "loadMessages": return { ...state, loadingMessages: true, error: "" };
    case "messagesLoaded": return { ...state, loadingMessages: false, messages: action.messages, hasOlder: action.messages.length === 50 };
    case "olderLoaded": return state.selectedChannelId === action.channelId
      ? { ...state, loadingMessages: false, messages: [...action.messages, ...state.messages], hasOlder: action.messages.length === 50 }
      : state;
    case "failed": return { ...state, loadingMessages: false, error: action.error };
  }
}

export default function PublicServerPage({
  slug,
  initialChannelId = null,
  onSignIn,
  onRegister,
  onUnavailable,
  authenticated = false,
  onJoined,
}: {
  slug: string;
  /** Channel from a `/s/<slug>/channel/<id>` link; ignored unless it is public. */
  initialChannelId?: string | null;
  onSignIn: () => void;
  onRegister: () => void;
  onUnavailable: () => void;
  authenticated?: boolean;
  onJoined?: () => Promise<void> | void;
}) {
  const { formatMessage } = useIntl();
  const [state, dispatch] = useReducer(publicPageReducer, {
    readback: null,
    selectedChannelId: null,
    messages: [],
    loadingMessages: false,
    hasOlder: false,
    error: "",
  });
  const { readback, selectedChannelId, messages, loadingMessages, hasOlder, error } = state;
  // Attachment bytes come from the public route, which reauthorizes every
  // request; the member attachment API is never called from this page.
  const attachmentUrls = useMemo<ReadOnlyAttachmentUrls>(() => {
    const base = `${RUNTIME_API_BASE.replace(/\/$/, "")}/public/servers/${encodeURIComponent(slug)}/attachments`;
    return {
      inline: (attachmentId) => `${base}/${encodeURIComponent(attachmentId)}`,
      download: (attachmentId) => `${base}/${encodeURIComponent(attachmentId)}?download=1`,
      pdfPreview: (attachmentId) => `${base}/${encodeURIComponent(attachmentId)}?disposition=inline`,
    };
  }, [slug]);
  const [joinConfirmOpen, setJoinConfirmOpen] = useState(false);
  const [joining, setJoining] = useState(false);
  const visitorChoice = usePublicVisitorConsent();
  const [cookieSettingsOpen, setCookieSettingsOpen] = useState(false);
  // Read when the server's answer arrives, without refetching on sign-in.
  const authenticatedRef = useRef(authenticated);
  useEffect(() => {
    authenticatedRef.current = authenticated;
  }, [authenticated]);
  const [joinError, setJoinError] = useState("");
  const [agreement, setAgreement] = useState<CommunityAgreement | null>(null);
  const [surfaceMode, setSurfaceMode] = useState<"chat" | "settings">("chat");
  const [settingsTab, setSettingsTab] = useState<PublicSettingsView>(authenticated ? "account" : "about");
  const [serverSelectionNotice, setServerSelectionNotice] = useState(false);

  // The public page sizes its columns purely in Tailwind (`w-36` below sm, fixed px at sm+). The drag handles and the
  // persisted width therefore apply only at sm and above, where the columns actually sit side by side — below it the
  // thread panel is a full-screen overlay, so a width would be meaningless. matchMedia mirrors MainLayout's own
  // isLg gate rather than introducing a second breakpoint idiom.
  const isSmUp = useMediaQuery(PUBLIC_PANEL_RESIZE_QUERY);
  // Phones show one column at a time, like the signed-in app: the channel list
  // first, then the channel full width with a back button (Cindy, #wg-rbac
  // task #123). Side by side, a 144px list left the messages ~246px on a 390px
  // phone and cut sender names to one letter. A link to a channel opens it.
  const [phoneView, setPhoneView] = useState<"list" | "channel">(initialChannelId ? "channel" : "list");
  const phoneShowsList = !isSmUp && phoneView === "list";
  const phoneShowsChannel = !isSmUp && phoneView === "channel";
  const showPhoneChannelList = useCallback(() => {
    setPhoneView("list");
    setOpenThread(null);
  }, []);
  const phoneBackProps = useMemo(() => {
    const label = formatMessage({ id: "pages.publicServer.backToChannels" });
    return { "data-testid": "public-server-phone-back", "aria-label": label, title: label };
  }, [formatMessage]);

  // Same hook, same bounds and same persistence shape as the signed-in shell — the bounds now come from the shared
  // panelBounds module so the two surfaces cannot drift apart again (they had: this page allowed wider sidebars and a
  // narrower thread panel, so the same control behaved differently depending on whether you were signed in).
  // Keys stay namespaced to this page so a width set here never bleeds into the signed-in widths.
  const {
    width: channelSidebarWidth,
    handleResizeStart: handleChannelSidebarResizeStart,
    handleResizeMove: handleChannelSidebarResizeMove,
    handleResizeEnd: handleChannelSidebarResizeEnd,
  } = useResizablePanel({ storageKey: "slock:publicServer:channelSidebarWidth", ...SIDEBAR_PANEL_BOUNDS });
  const {
    width: settingsSidebarWidth,
    handleResizeStart: handleSettingsSidebarResizeStart,
    handleResizeMove: handleSettingsSidebarResizeMove,
    handleResizeEnd: handleSettingsSidebarResizeEnd,
  } = useResizablePanel({ storageKey: "slock:publicServer:settingsSidebarWidth", ...SIDEBAR_PANEL_BOUNDS });
  // The thread column mirrors the signed-in one exactly, including the viewport-derived max recomputed at drag start
  // and the live width measurement — matching only the numbers would still drift in behaviour.
  const threadPanelRef = useRef<HTMLElement | null>(null);
  const [threadPanelDynamicMax, setThreadPanelDynamicMax] = useState(() => getThreadPanelDynamicMax());
  const getThreadPanelDragStartWidth = useCallback(() => {
    const measured = threadPanelRef.current?.getBoundingClientRect().width;
    return measured && measured > 0 ? measured : undefined;
  }, []);
  const {
    width: threadPanelWidth,
    handleResizeStart: beginThreadPanelResize,
    handleResizeMove: handleThreadPanelResizeMove,
    handleResizeEnd: handleThreadPanelResizeEnd,
  } = useResizablePanel({
    storageKey: "slock:publicServer:threadPanelWidth",
    min: THREAD_PANEL_MIN_WIDTH,
    max: threadPanelDynamicMax,
    defaultWidth: THREAD_PANEL_DEFAULT_WIDTH,
    direction: "left",
    getDragStartWidth: getThreadPanelDragStartWidth,
  });
  const handleThreadPanelResizeStart = useCallback((event: React.PointerEvent) => {
    setThreadPanelDynamicMax(getThreadPanelDynamicMax());
    beginThreadPanelResize(event);
  }, [beginThreadPanelResize]);
  const [openThread, setOpenThread] = useState<OpenPublicThread | null>(null);
  const [threadMessages, setThreadMessages] = useState<PublicMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState("");
  const [threadHasOlder, setThreadHasOlder] = useState(false);
  const threadRequestGeneration = useRef(0);
  const surfaceCapabilities = useMemo(
    () => getServerSurfaceCapabilities(authenticated ? "public-authenticated-nonmember" : "public-anonymous"),
    [authenticated],
  );

  // Visit counts (RFC-067): one view per page shown, one open per channel the
  // visitor picks, one per thread they open. Refetches, pagination and failed
  // loads are not visits.
  const viewRecordedForSlug = useRef<string | null>(null);
  const pickedChannelId = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    dispatch({ type: "loadServer" });
    api.get<PublicServerReadback>(`/public/servers/${encodeURIComponent(slug)}`)
      .then(({ data }) => {
        if (!active) return;
        dispatch({ type: "serverLoaded", readback: data, initialChannelId });
        // Before the first visit, so it carries the id (or not) as decided.
        if (!authenticatedRef.current && data.visitorIdMode) applyPublicVisitorIdMode(data.visitorIdMode);
        if (viewRecordedForSlug.current !== slug) {
          viewRecordedForSlug.current = slug;
          recordPublicVisit(slug, "public_page_viewed");
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        const response = getApiErrorResponse(err);
        if (response?.status === 404) {
          onUnavailable();
          return;
        }
        dispatch({ type: "failed", error: response?.error || formatMessage({ id: "pages.publicServer.failedLoad" }) });
      });
    return () => {
      active = false;
    };
  }, [formatMessage, initialChannelId, onUnavailable, slug]);

  useEffect(() => {
    if (!readback) return;
    void useTranslationStore.getState().loadSettings(readback.server.id, {
      serverSlug: readback.server.slug,
      translationEnabled: readback.server.translationEnabled === true,
      translationAvailable: readback.translationAvailable === true,
      browserLocalPreferences: !authenticated,
    });
  }, [authenticated, readback]);

  useEffect(() => {
    if (!selectedChannelId) {
      return;
    }
    let active = true;
    dispatch({ type: "loadMessages" });
    api.get<{ messages: PublicMessage[] }>(`/public/servers/${encodeURIComponent(slug)}/channels/${selectedChannelId}/messages`)
      .then(({ data }) => {
        if (!active) return;
        dispatch({ type: "messagesLoaded", messages: data.messages });
        if (pickedChannelId.current === selectedChannelId) {
          pickedChannelId.current = null;
          recordPublicVisit(slug, "public_page_channel_opened", selectedChannelId);
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        const response = getApiErrorResponse(err);
        dispatch({ type: "failed", error: response?.status === 404
          ? formatMessage({ id: "pages.publicServer.noLongerPublic" })
          : response?.error || formatMessage({ id: "pages.publicServer.failedMessages" }) });
      });
    return () => {
      active = false;
    };
  }, [formatMessage, selectedChannelId, slug]);

  const loadOlder = useCallback(async () => {
    if (!selectedChannelId || messages.length === 0) return;
    dispatch({ type: "loadMessages" });
    try {
      const beforeMessageId = messages[0]!.id;
      const { data } = await api.get<{ messages: PublicMessage[] }>(
        `/public/servers/${encodeURIComponent(slug)}/channels/${selectedChannelId}/messages?beforeMessageId=${encodeURIComponent(beforeMessageId)}`,
      );
      dispatch({ type: "olderLoaded", channelId: selectedChannelId, messages: data.messages });
    } catch (err: unknown) {
      const response = getApiErrorResponse(err);
      dispatch({ type: "failed", error: response?.status === 404
        ? formatMessage({ id: "pages.publicServer.noLongerPublic" })
        : response?.error || formatMessage({ id: "pages.publicServer.failedMessages" }) });
    }
  }, [formatMessage, messages, selectedChannelId, slug]);

  const joinAsGuest = useCallback(async (agreementId?: string) => {
    setJoining(true);
    setJoinError("");
    try {
      // The visitor id from an earlier logged-out cookie consent, if any; the
      // server links it only for a joiner who shares usage data.
      const anonymousId = publicVisitorId();
      await api.post(`/public/servers/${encodeURIComponent(slug)}/join-as-guest`, {
        agreementId: agreementId ?? null,
        ...(anonymousId ? { anonymous_id: anonymousId } : {}),
      });
      setJoinConfirmOpen(false);
      setAgreement(null);
    } catch (err: unknown) {
      const response = getApiErrorResponse(err);
      const raw = (err as { response?: { data?: { error?: string; agreement?: CommunityAgreement } } })?.response?.data;
      if ((raw?.error === "agreement_required" || raw?.error === "agreement_changed") && raw.agreement) {
        setJoinConfirmOpen(false);
        setAgreement(raw.agreement);
        setJoining(false);
        return;
      }
      setJoinError(response?.error || formatMessage({ id: "pages.publicServer.failedJoin" }));
      setJoining(false);
      throw err;
    }

    try {
      await onJoined?.();
    } catch {
      // Membership is already durable. Do not tell the visitor the join failed
      // and invite an unsafe retry just because the local server-list refresh
      // or route transition failed.
      setJoinError(formatMessage({ id: "pages.publicServer.joinedRefresh" }));
    } finally {
      setJoining(false);
    }
  }, [formatMessage, onJoined, slug]);
  const confirmJoinAsGuest = useCallback(() => joinAsGuest(), [joinAsGuest]);
  const openJoinConfirm = useCallback(() => setJoinConfirmOpen(true), []);
  const closeJoinConfirm = useCallback(() => setJoinConfirmOpen(false), []);
  const closeAgreement = useCallback(() => setAgreement(null), []);

  const selected = readback?.channels.find((channel) => channel.id === selectedChannelId) ?? null;
  const displayChannels = useMemo<Channel[]>(() => (readback?.channels ?? []).map((channel) => ({
    ...channel,
    serverId: readback?.server.id,
    type: "channel",
    createdAt: "",
    joined: false,
    guestVisible: true,
  })), [readback?.channels, readback?.server.id]);
  const selectPublicChannel = useCallback((channel: Channel) => {
    pickedChannelId.current = channel.id;
    dispatch({ type: "selectChannel", channelId: channel.id });
    setOpenThread(null);
    setSurfaceMode("chat");
    setPhoneView("channel");
  }, []);
  const selectPublicChannelById = useCallback((channelId: string) => {
    const channel = displayChannels.find((item) => item.id === channelId);
    if (channel) selectPublicChannel(channel);
  }, [displayChannels, selectPublicChannel]);
  const openPublicThread = useCallback(async (request: OpenPublicThread) => {
    const generation = ++threadRequestGeneration.current;
    setOpenThread(request);
    setThreadMessages([]);
    setThreadError("");
    setThreadHasOlder(false);
    setThreadLoading(true);
    try {
      const { data } = await api.get<{ messages: PublicMessage[] }>(
        `/public/servers/${encodeURIComponent(slug)}/threads/${encodeURIComponent(request.threadChannelId)}/messages?limit=50`,
      );
      if (generation !== threadRequestGeneration.current) return;
      setThreadMessages(data.messages);
      setThreadHasOlder(data.messages.length === 50);
      recordPublicVisit(slug, "public_page_thread_opened", request.parentChannelId, request.threadChannelId);
    } catch (err: unknown) {
      if (generation !== threadRequestGeneration.current) return;
      const response = getApiErrorResponse(err);
      setThreadError(response?.status === 404
        ? formatMessage({ id: "pages.publicServer.noLongerPublic" })
        : response?.error || formatMessage({ id: "message.threadPanel.loadFailedTitle" }));
    } finally {
      if (generation === threadRequestGeneration.current) setThreadLoading(false);
    }
  }, [formatMessage, slug]);
  const handleOpenThread = useCallback((request: OpenThreadRequest) => {
    const threadChannelId = request.initialThreadChannelId ?? request.threadChannelId;
    if (threadChannelId) {
      void openPublicThread({
        threadChannelId,
        parentChannelId: request.parentChannelId,
        parentMessageId: request.parentMessageId,
      });
    }
  }, [openPublicThread]);
  const closeThread = useCallback(() => {
    threadRequestGeneration.current += 1;
    setOpenThread(null);
  }, []);
  const selectSettingsTabFromRail = useCallback((tab: PublicSettingsView) => {
    setSettingsTab(tab);
    setSurfaceMode("settings");
  }, []);
  const showServerSelectionNotice = useCallback(() => setServerSelectionNotice(true), []);
  const readbackServer = readback?.server;
  const publicProjection = useMemo(() => (readbackServer ? {
    server: readbackServer,
    authenticated,
    showHelp: surfaceCapabilities.showHelp,
    activeMode: surfaceMode,
    onSelectMode: setSurfaceMode,
    onSelectSettingsTab: selectSettingsTabFromRail,
    onAnonymousServerSelection: showServerSelectionNotice,
  } : null), [
    authenticated,
    readbackServer,
    selectSettingsTabFromRail,
    showServerSelectionNotice,
    surfaceCapabilities.showHelp,
    surfaceMode,
  ]);
  // Column widths apply only where the columns sit side by side (sm and up).
  const channelSidebarStyle = useMemo(
    () => (isSmUp ? { width: channelSidebarWidth } : undefined),
    [channelSidebarWidth, isSmUp],
  );
  const settingsLoadingFallback = useMemo(
    () => (
      <div className="flex justify-center p-6">
        <Spinner size="md" aria-label={formatMessage({ id: "common.loadingLabel" })} />
      </div>
    ),
    [formatMessage],
  );
  const settingsSidebarStyle = useMemo(
    () => (isSmUp ? { width: settingsSidebarWidth } : undefined),
    [isSmUp, settingsSidebarWidth],
  );
  const threadPanelStyle = useMemo(
    () => (isSmUp ? { width: threadPanelWidth } : undefined),
    [isSmUp, threadPanelWidth],
  );
  const loadOlderThreadMessages = useCallback(async () => {
    if (!openThread || threadLoading || threadMessages.length === 0) return;
    const generation = threadRequestGeneration.current;
    setThreadLoading(true);
    try {
      const beforeMessageId = threadMessages[0]!.id;
      const { data } = await api.get<{ messages: PublicMessage[] }>(
        `/public/servers/${encodeURIComponent(slug)}/threads/${encodeURIComponent(openThread.threadChannelId)}/messages?limit=50&beforeMessageId=${encodeURIComponent(beforeMessageId)}`,
      );
      if (generation !== threadRequestGeneration.current) return;
      setThreadMessages((current) => [...data.messages, ...current]);
      setThreadHasOlder(data.messages.length === 50);
    } catch (err: unknown) {
      if (generation !== threadRequestGeneration.current) return;
      const response = getApiErrorResponse(err);
      setThreadError(response?.status === 404
        ? formatMessage({ id: "pages.publicServer.noLongerPublic" })
        : response?.error || formatMessage({ id: "message.threadPanel.loadFailedTitle" }));
    } finally {
      if (generation === threadRequestGeneration.current) setThreadLoading(false);
    }
  }, [formatMessage, openThread, slug, threadLoading, threadMessages]);

  const adaptedMessages = useMemo(
    () => messages.map((message) => toReadOnlyMessage(message, selectedChannelId ?? "")),
    [messages, selectedChannelId],
  );
  useTranslationBatch(adaptedMessages, { skipSettingsLoad: true });
  const adaptedThreadMessages = useMemo(
    () => threadMessages.map((message) => toReadOnlyMessage(message, openThread?.threadChannelId ?? "")),
    [openThread?.threadChannelId, threadMessages],
  );
  useTranslationBatch(adaptedThreadMessages, { skipSettingsLoad: true });
  const publicSenderByMessageId = useMemo(
    () => new Map(messages.map((message) => [message.id, message.sender] as const)),
    [messages],
  );
  const publicMessageById = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages],
  );
  // The same scroll and pagination primitive the signed-in ChatPanel and the
  // read-only thread panel use. It takes plain data, so no member store is read.
  const messageSource = useMemo<MessageTimelineSource>(() => ({
    messages: adaptedMessages,
    hasOlder,
    hasNewer: false,
    loading: loadingMessages,
    loadOlder,
    loadNewer: noopLoadNewer,
  }), [adaptedMessages, hasOlder, loadOlder, loadingMessages]);
  const selectedId = selected?.id ?? "";
  const renderPublicMessage = useCallback((adaptedMessage: Message) => {
    const message = publicMessageById.get(adaptedMessage.id);
    if (!message) return null;
    return (
      <PublicMessageRow
        message={message}
        adaptedMessage={adaptedMessage}
        channels={displayChannels}
        parentChannelId={selectedId}
        sender={publicSenderByMessageId.get(adaptedMessage.id)}
        onNavigateChannel={selectPublicChannel}
        onOpenThread={handleOpenThread}
      />
    );
  }, [displayChannels, handleOpenThread, publicMessageById, publicSenderByMessageId, selectPublicChannel, selectedId]);
  const threadSenderByMessageId = useMemo(() => {
    const pairs = threadMessages.map((message) => [message.id, message.sender] as const);
    const parent = openThread ? messages.find((message) => message.id === openThread.parentMessageId) : null;
    if (parent) pairs.push([parent.id, parent.sender]);
    return new Map(pairs);
  }, [messages, openThread, threadMessages]);
  const readOnlyThreadData = useMemo<ReadOnlyThreadData | null>(() => {
    if (!openThread) return null;
    const parent = adaptedMessages.find((message) => message.id === openThread.parentMessageId);
    if (!parent) return null;
    return {
      threadChannelId: openThread.threadChannelId,
      parentChannelId: openThread.parentChannelId,
      parentMessage: parent,
      replies: adaptedThreadMessages,
      senderByMessageId: threadSenderByMessageId,
      channels: displayChannels,
      loading: threadLoading,
      error: threadError,
      hasOlder: threadHasOlder,
      loadOlder: loadOlderThreadMessages,
    };
  }, [adaptedMessages, adaptedThreadMessages, displayChannels, loadOlderThreadMessages, openThread, threadError, threadHasOlder, threadLoading, threadSenderByMessageId]);
  // Logged-out visitors only, and only where the server would keep the id.
  // Asked up front only where the law requires it; elsewhere the id is on by
  // default and Cookie settings opens the same banner to turn it off.
  const offerCookieConsent = !authenticated && readback?.visitorIdMode !== undefined;
  const closeCookieConsent = useCallback(() => setCookieSettingsOpen(false), []);
  const openCookieSettings = useCallback(() => setCookieSettingsOpen(true), []);
  const showCookieConsent = offerCookieConsent
    && ((readback?.visitorIdMode === "ask" && visitorChoice === null) || cookieSettingsOpen);
  const publicSettingsGroups = useMemo(() => [
    {
      label: formatMessage({ id: "layout.sidebar.settingsGroupPersonal" }),
      items: getPublicPersonalSettingsTabIds({
        authenticated: surfaceCapabilities.settingsScope === "account-and-resources",
        translationEnabled: readback?.server.translationEnabled === true,
      }).map((id) => ({
        id,
        label: formatMessage({ id: id === "account" ? "settings.tabs.account" : id === "language-region" ? "settings.tabs.languageRegion" : "settings.tabs.appearance" }),
        icon: id === "account" ? <User size={14} className="shrink-0" /> : id === "language-region" ? <Languages size={14} className="shrink-0" /> : <Type size={14} className="shrink-0" />,
        onClick: () => setSettingsTab(id),
        testId: `workspace-settings-nav-${id}`,
      })),
    },
    {
      label: formatMessage({ id: "layout.sidebar.settingsGroupAbout" }),
      items: [
        { id: "about", label: formatMessage({ id: "layout.sidebar.settingsAbout" }), icon: <SidebarItemIcon><BadgeInfo /></SidebarItemIcon>, onClick: () => setSettingsTab("about"), testId: "workspace-settings-nav-about" },
        { id: "documentation", label: formatMessage({ id: "layout.sidebar.settingsDocumentation" }), icon: <SidebarItemIcon><BookOpenText /></SidebarItemIcon>, href: "https://docs.raft.build", testId: "workspace-settings-nav-documentation" },
        ...(surfaceCapabilities.settingsScope === "account-and-resources" ? [
          { id: "feedback", label: formatMessage({ id: "settings.about.feedbackTitle" }), icon: <SidebarItemIcon><MessageSquare /></SidebarItemIcon>, onClick: () => setSettingsTab("feedback"), testId: "workspace-settings-nav-feedback" },
          { id: "release-notes", label: formatMessage({ id: "layout.sidebar.settingsReleaseNotes" }), icon: <SidebarItemIcon><FileText /></SidebarItemIcon>, onClick: () => setSettingsTab("release-notes"), testId: "workspace-settings-nav-release-notes" },
        ] : []),
        ...(offerCookieConsent ? [
          { id: "cookie-settings", label: formatMessage({ id: "pages.publicServer.cookieSettings" }), icon: <SidebarItemIcon><Cookie /></SidebarItemIcon>, onClick: openCookieSettings, testId: "public-server-cookie-settings" },
        ] : []),
      ],
    },
  ], [formatMessage, offerCookieConsent, openCookieSettings, readback?.server.translationEnabled, surfaceCapabilities.settingsScope]);
  const publicTranslationContext = useMemo(() => readback ? ({
    serverId: readback.server.id,
    serverSlug: readback.server.slug,
    translationEnabled: readback.server.translationEnabled === true,
    translationAvailable: readback.translationAvailable === true,
    browserLocalPreferences: !authenticated,
  }) : undefined, [authenticated, readback]);
  const joinable = readback?.canJoinAsGuest === true;
  const bottomBannerMessageId = authenticated
    ? joinable ? "pages.publicServer.joinableAuthenticatedBanner" : "pages.publicServer.viewOnlyAuthenticatedBanner"
    : joinable ? "pages.publicServer.joinableAnonymousBanner" : "pages.publicServer.viewOnlyAnonymousBanner";

  // Rendered as the last row of the columns grid, under the conversation and
  // the thread panel, starting at the channel column's right edge (Cindy,
  // #wg-rbac task #123). NOT inside the middle column: its `w-full` there meant
  // "100% of the middle column", which squeezed the copy to one character per
  // line (task #116). Living outside the chat/settings fork also means the
  // settings surface gets it without a second copy.
  const bottomBanner = (
  <Banner
    intent="info"
    density="sm"
    // The Banner is a CSS grid: copy at
    // col-start-1 row-start-1, actions at col-start-2 row-start-1. Its own rule
    // stacks them below roughly 400px. On phones (below sm) this keeps them on
    // one row instead, with small text and small buttons: stacked, the banner
    // was ~105px tall on a 390px phone; side by side it is ~50px with the
    // sentence on two lines in ~175px (Cindy, #wg-rbac task #123).
    //
    // Targets the recipe's published `data-slot` hook rather than :last-child.
    // These root-level child rules, (0,2,0), outrank the recipe's own
    // container-query placement on the action, (0,1,0).
    //
    // Why a grid at all: #7347 replaced slock's own hand-rolled flex Banner
    // wrapper with a delegation to raft-ui's Banner, whose recipe is a grid. The
    // raft-ui 0.5.11 -> 0.5.14 bump rode along in the same PR and is NOT the
    // cause — the recipe's banner layout is identical across those two versions.
    // A revert of #7347 therefore returns the wrapper to flex and makes every
    // rule below inert, with no test turning red.
    //
    // NOT here on purpose: `max-sm:grid-cols-1`. The recipe declares its columns
    // via `…:has(>[data-slot=banner-action])`, specificity (0,2,0); a plain
    // utility is (0,1,0) and a media query adds none, so it loses regardless of
    // order. It was in an earlier revision doing nothing at all.
    className="z-10 col-span-full col-start-1 row-start-2 w-full shrink-0 sm:col-span-2 sm:col-start-2 !items-center rounded-none border-x-0 border-b-0 !px-5 max-sm:!px-3 max-sm:!py-2 max-sm:gap-x-2 max-sm:[&>[data-slot=banner-action]]:col-start-2 max-sm:[&>[data-slot=banner-action]]:col-end-auto max-sm:[&>[data-slot=banner-action]]:row-start-1 max-sm:[&>[data-slot=banner-action]]:mt-0 max-sm:[&>[data-slot=banner-action]]:justify-self-end"
    data-testid="public-server-bottom-action"
    actions={authenticated ? (
      joinable ? (
        <Button size="sm" variant="accent" onClick={openJoinConfirm} disabled={joining} data-testid="public-server-join-guest">
          <UserPlus className="size-4" />{formatMessage({ id: "pages.publicServer.joinAsGuest" })}
        </Button>
      ) : null
    ) : joinable ? (
      <div className="flex items-center gap-2">
        <Button size="sm" variant="accent" onClick={onSignIn}><LogIn className="size-4" />{formatMessage({ id: "pages.publicServer.signIn" })}</Button>
        <Button size="sm" variant="outline" onClick={onRegister}><UserPlus className="size-4" />{formatMessage({ id: "pages.publicServer.join" })}</Button>
      </div>
    ) : (
      <div className="flex items-center gap-2">
        <Button size="sm" variant="accent" onClick={onRegister}><UserPlus className="size-4" />{formatMessage({ id: "pages.publicServer.join" })}</Button>
        <Button size="sm" variant="outline" onClick={onSignIn}><LogIn className="size-4" />{formatMessage({ id: "pages.publicServer.signIn" })}</Button>
      </div>
    )}
  >
    <span className="text-callout font-bold max-sm:text-footnote" data-testid="public-server-bottom-action-copy">
      {formatMessage({ id: bottomBannerMessageId }, { server: readback?.server.name ?? slug })}
    </span>
  </Banner>
  );

  if (!readback && !error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-layer-sidebar" data-testid="public-server-loading">
        <Spinner size="lg" aria-label={formatMessage({ id: "common.loadingLabel" })} />
      </div>
    );
  }

  return (
    // Same rui shell root as the signed-in MainLayout. It is what sets
    // --shell-header-height (56px, 48px on short viewports), so every
    // `h-panel-header` row below lines up with the shared PanelHeader and rail
    // header.
    // The slots default to `hidden md:flex`; this page keeps its channel column
    // and full-screen thread overlay on phones, so those two opt back in.
    // Height is the dynamic viewport only (task #754, Hands task #72). With
    // `min-h-screen` as well, mobile Chrome's 100vh (toolbar hidden) beat the
    // visible height while the toolbar showed, and overflow-hidden clipped the
    // bottom banner's "Join as Guest" off screen.
    <ReadOnlyAttachmentUrlContext.Provider value={attachmentUrls}>
    <AppShellRoot className="h-dvh flex-col overflow-hidden font-display" data-testid="public-server-page">
      <div className="relative flex min-h-0 flex-1" data-testid="public-server-app-shell">
        {publicProjection ? (
          <AppShellRailSlot>
            <LeftRail publicProjection={publicProjection} />
          </AppShellRailSlot>
        ) : null}

        <div className="relative flex min-w-0 flex-1 flex-col" data-testid="public-server-surface-stack">
        {/* A grid, so the bottom banner can sit under the conversation only: the
            channel (or settings) column runs the full height on the left, and the
            banner spans from that column's right edge to the window's right edge,
            under the messages and the thread panel (Cindy, #wg-rbac task #123).
            On phones the banner keeps the full width and the thread panel
            overlays the first row by grid placement instead of absolute
            positioning, so it still stops above the banner. */}
        <div className="relative grid min-h-0 flex-1 grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[minmax(0,1fr)_auto]" data-testid="public-server-columns">

        {surfaceMode === "chat" ? <AppShellSidebarSlot render={CHANNEL_SIDEBAR_NAV} className={`relative col-start-1 row-start-1 flex shrink-0 flex-col sm:row-span-2 sm:w-[240px] ${phoneShowsList ? "col-span-full w-full" : ""} ${phoneShowsChannel ? "hidden" : ""}`} style={channelSidebarStyle} aria-label={formatMessage({ id: "pages.publicServer.channelsLabel" })} data-testid="public-server-channel-sidebar">
          <PanelResizeHandle
            side="right"
            visibleFrom="sm"
            onPointerDown={handleChannelSidebarResizeStart}
            onPointerMove={handleChannelSidebarResizeMove}
            onPointerUp={handleChannelSidebarResizeEnd}
            onPointerCancel={handleChannelSidebarResizeEnd}
            data-testid="public-server-channel-sidebar-resize-handle"
          />
          {/* The scroll lives INSIDE the column: an overflow container clips an absolutely positioned handle that
              straddles its edge, so the divider existed but could not be grabbed (caught in a real browser —
              elementFromPoint at the handle's own centre returned the nav). */}
          <PublicServerChannelSidebar
            serverName={readback?.server.name ?? ""}
            channelsLabel={formatMessage({ id: "pages.publicServer.channelsLabel" })}
            channels={readback?.channels ?? EMPTY_PUBLIC_CHANNELS}
            selectedChannelId={selectedChannelId}
            onSelectChannel={selectPublicChannelById}
          />
          {offerCookieConsent ? (
            // Below md the rail (LeftRail: `hidden md:flex`) and its settings
            // menu are not shown, so this is the way back to the choice there.
            // Same breakpoint as the rail, or 640-767px had neither (John, #9872).
            <div className="shrink-0 px-3 py-2 md:hidden" data-testid="public-server-cookie-settings-phone-slot">
              <Button size="sm" variant="ghost" onClick={openCookieSettings} data-testid="public-server-cookie-settings-phone">
                <Cookie className="size-4" />{formatMessage({ id: "pages.publicServer.cookieSettings" })}
              </Button>
            </div>
          ) : null}
        </AppShellSidebarSlot> : null}

        {surfaceMode === "chat" ? <AppShellMainSlot className={`col-start-2 row-start-1 min-h-0 min-w-0 bg-layer-canvas ${phoneShowsChannel ? "col-span-full col-start-1" : ""} ${phoneShowsList ? "hidden" : ""}`} data-testid="public-server-channel-panel">
          {selected ? (
            <ConversationPanelRoot edge="inset" className="relative">
              <PanelHeader
                title={selected.name}
                subtitle={selected.description}
                icon={<Hash size={18} />}
                iconTone="location"
                containerProps={CHANNEL_HEADER_CONTAINER_PROPS}
                // The page's own phone breakpoint (sm) is narrower than the
                // header's default (md), so the button is passed only on phones
                // and shown whenever it is passed.
                onMobileBack={isSmUp ? undefined : showPhoneChannelList}
                backButtonVisibility="always"
                mobileBackProps={phoneBackProps}
              />
              <ConversationPanelContent>
              {error ? <Banner intent="warning" className="m-3 shrink-0">{error}</Banner> : null}
              <div className="relative min-h-0 flex-1 overflow-hidden" aria-live="polite">
                {messages.length > 0 ? (
                  <MessageTimeline
                    key={selected.id}
                    source={messageSource}
                    renderItem={renderPublicMessage}
                    className="h-full"
                    testId="public-server-message-timeline"
                    persistKey={`public-channel:${selected.id}`}
                    sparseAnchor="bottom"
                  />
                ) : null}
                {!loadingMessages && messages.length === 0 ? (
                  <EmptyState
                    className="flex h-full flex-col items-center justify-center"
                    icon={<MessageSquare size={36} />}
                    title={formatMessage({ id: "pages.publicServer.emptyMessages" })}
                    data-testid="public-server-empty-messages"
                  />
                ) : null}
                {loadingMessages && messages.length === 0 ? (
                  <div className="flex justify-center p-6" data-testid="public-server-messages-loading">
                    <Spinner size="md" aria-label={formatMessage({ id: "common.loadingLabel" })} />
                  </div>
                ) : null}
              </div>
              </ConversationPanelContent>
            </ConversationPanelRoot>
          ) : (
            <EmptyState
              className="flex h-full flex-col items-center justify-center"
              icon={<Hash size={36} />}
              title={formatMessage({ id: "pages.publicServer.emptyChannels" })}
              data-testid="public-server-empty-channels"
            />
          )}
        </AppShellMainSlot> : (
          <>
            <AppShellSidebarSlot render={SETTINGS_SIDEBAR_ASIDE} className="relative col-start-1 row-start-1 flex w-36 shrink-0 flex-col sm:row-span-2 sm:w-[240px]" style={settingsSidebarStyle} data-testid="public-server-settings-sidebar">
              <PanelResizeHandle
                side="right"
                visibleFrom="sm"
                onPointerDown={handleSettingsSidebarResizeStart}
                onPointerMove={handleSettingsSidebarResizeMove}
                onPointerUp={handleSettingsSidebarResizeEnd}
                onPointerCancel={handleSettingsSidebarResizeEnd}
                data-testid="public-server-settings-sidebar-resize-handle"
              />
              <PublicServerSidebarFrame
                title={formatMessage({ id: "layout.sidebar.headerSettings" })}
                testIdPrefix="public-server-settings-sidebar"
                scrollTestId="public-server-settings-list"
              >
                <nav aria-label={formatMessage({ id: "settings.tabs.navAriaLabel" })}>
                  <SettingsSidebarList groups={publicSettingsGroups} activeId={settingsTab} />
                </nav>
              </PublicServerSidebarFrame>
            </AppShellSidebarSlot>
            <AppShellMainSlot className="col-start-2 row-start-1 min-h-0 min-w-0 bg-layer-canvas" data-testid="public-server-settings-surface">
              {/* A flex column, as the member layout gives it: the settings panel frame
                  then fills the height and its left edge runs to the bottom (cindyz,
                  #wg-rbac:dadde6b1). As a plain block it stopped where the content did. */}
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
                {settingsTab === "release-notes" ? (
                  <Suspense fallback={settingsLoadingFallback}>
                    <ReleaseNotesPanel />
                  </Suspense>
                ) : <SettingsPanel
                  tab={settingsTab}
                  showAboutWorkspace={false}
                  publicTranslationContext={publicTranslationContext}
                  publicSurface
                />}
              </div>
            </AppShellMainSlot>
          </>
        )}
        {/* `sm:relative` (not `sm:static`) gives the resize handle below its positioning context. Side effect worth
            knowing: it also makes the `z-20` — previously mobile-only, when this panel was a full-screen overlay —
            apply at sm and above, so this column now stacks above the main column. That is what the -left-1 handle
            needs, but a future floating element on the main column's right edge would collide here
            (@Bugen, review of PR #7983). */}
        {/* `max-md:z-40`, the same breakpoint as the channel column's
            PanelHeader (`max-md:sticky max-md:z-30`). At z-20 that header
            painted over the thread's own header: on phones the thread covers
            the channel (its title read "Thread — # general" with the channel
            name on top), and from 640px the squeezed channel column's header
            overflows onto the thread. Either way it took the taps meant for
            the thread's back button. */}
        {/* No border of its own: the thread panel's root draws the divider,
            as in the signed-in app. One here as well doubled it into two
            1px lines (cindyz, #wg-rbac task #126). */}
        {readOnlyThreadData ? (
          <AppShellPanelSlot ref={threadPanelRef} className="relative z-20 max-md:z-40 col-span-full col-start-1 row-start-1 flex min-h-0 bg-layer-canvas sm:col-span-1 sm:col-start-3 sm:w-[380px]" style={threadPanelStyle} data-testid="public-server-thread-panel">            <PanelResizeHandle
              side="left"
              visibleFrom="sm"
              onPointerDown={handleThreadPanelResizeStart}
              onPointerMove={handleThreadPanelResizeMove}
              onPointerUp={handleThreadPanelResizeEnd}
              onPointerCancel={handleThreadPanelResizeEnd}
              data-testid="public-server-thread-panel-resize-handle"
            />
            <ThreadPanel
              presentation="side"
              onClose={closeThread}
              showComposer={false}
              readOnlyData={readOnlyThreadData}
            />
          </AppShellPanelSlot>
        ) : null}
        {showCookieConsent ? (
          // Until the visitor chooses, the cookie banner takes the join
          // banner's slot and covers it (cindyz, 2026-10-15): one bar at a
          // time. Choosing brings the join / sign-in actions straight back.
          // It is in the grid, not floating, so it never covers the
          // conversation (John, #9870).
          <div className="z-10 col-span-full col-start-1 row-start-2 flex min-w-0 flex-col sm:col-span-2 sm:col-start-2" data-testid="public-server-bottom-slot">
            <PublicCookieConsent onDone={closeCookieConsent} />
          </div>
        ) : bottomBanner}
        </div>
        </div>
      </div>

      {serverSelectionNotice ? (
        <Banner intent="info" density="sm" className={FLOATING_NOTICE_CLASS_TOP} data-testid="public-server-selection-notice" actions={<Button size="sm" variant="outline" onClick={onSignIn}>{formatMessage({ id: "pages.publicServer.signIn" })}</Button>}>
          {formatMessage({ id: "pages.publicServer.banner" })}
        </Banner>
      ) : null}

      {joinError ? <Banner intent="warning" density="sm" className={FLOATING_NOTICE_CLASS_BOTTOM} data-testid="public-server-join-error">{joinError}</Banner> : null}
      {joinConfirmOpen ? (
        <ConfirmDialog
          title={formatMessage({ id: "pages.publicServer.joinConfirmTitle" })}
          message={formatMessage({ id: "pages.publicServer.joinConfirmDescription" }, { server: readback?.server.name ?? slug })}
          confirmLabel={formatMessage({ id: "pages.publicServer.joinAsGuest" })}
          loadingLabel={formatMessage({ id: "server.communityAgreement.joining" })}
          confirmVariant="accent"
          onConfirm={confirmJoinAsGuest}
          onClose={closeJoinConfirm}
        />
      ) : null}
      {agreement ? (
        <CommunityAgreementDialog
          agreement={agreement}
          onAgree={joinAsGuest}
          onClose={closeAgreement}
        />
      ) : null}
    </AppShellRoot>
    </ReadOnlyAttachmentUrlContext.Provider>
  );
}
