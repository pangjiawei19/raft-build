import assert from "node:assert/strict";
import { resetAttachmentPreviewSummaryCache } from "../src/components/message/attachmentPreviewSummaryCache";
import "./helpers/domSetup";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { TestIntlProvider } from "./helpers/intl";
const render: typeof rtlRender = (ui, options) => rtlRender(ui, { wrapper: TestIntlProvider, ...options });
import type { Agent } from "../src/store/agentStore";
import type { User } from "../src/store/authStore";
import type { Channel } from "../src/store/channelStore";
import type { Message, MessageAttachment } from "../src/store/messageStore";
import type { Server, ServerMember } from "../src/store/serverStore";
import type { Locale } from "../src/i18n/locale";

class MemoryStorage {
  private readonly map = new Map<string, string>();

  getItem(key: string) {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.map.set(key, value);
  }

  removeItem(key: string) {
    this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }
}

function installBrowserStubs() {
  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    value: new MemoryStorage(),
    configurable: true,
  });
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  class ImmediateIntersectionObserver {
    readonly root = null;
    readonly rootMargin = "";
    readonly thresholds = [0];

    constructor(private readonly callback: IntersectionObserverCallback) {}

    observe(target: Element) {
      this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }

    disconnect() {}
    unobserve() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  Object.defineProperty(window, "IntersectionObserver", {
    value: ImmediateIntersectionObserver,
    configurable: true,
  });
  Object.defineProperty(globalThis, "IntersectionObserver", {
    value: ImmediateIntersectionObserver,
    configurable: true,
  });
}

function makeUser(): User {
  return {
    id: "user-1",
    email: "current@example.com",
    gravatarHash: "currenthash",
    name: "current",
    displayName: "Current User",
    description: null,
    avatarUrl: null,
    emailVerified: true,
    preferredLanguage: null,
    preferredTimezone: null,
    autoTranslationEnabled: false,
    preferredTimeFormat: null,
    preferredMessageBodyFontSize: null,
    referralSource: null,
    referralSourceOther: null,
    referralSourceSkippedAt: null,
  };
}

function makeServer(): Server {
  return {
    id: "server-1",
    name: "Server",
    slug: "server",
    ownerId: "user-1",
    onboardingAgentId: null,
    hideHumansFromMembers: false,
    plan: "free",
    planDowngradedAt: null,
    role: "member",
    createdAt: "2026-07-04T00:00:00.000Z",
  };
}

function makeVideoAttachment(overrides: Partial<MessageAttachment> = {}): MessageAttachment {
  return {
    id: "video-1",
    filename: "tabs-before.mp4",
    mimeType: "video/mp4",
    sizeBytes: 4096,
    ...overrides,
  };
}

function makeMessage(attachment: MessageAttachment): Message {
  return {
    id: "message-1",
    channelId: "channel-1",
    senderType: "user",
    senderId: "user-1",
    senderName: "Current User",
    messageType: "chat",
    content: "video attachment",
    createdAt: "2026-07-04T00:00:00.000Z",
    attachments: [attachment],
  };
}

async function renderMessage(message: Message, locale?: Locale) {
  installBrowserStubs();
  const { default: MessageItem } = await import("../src/components/message/MessageItem");
  const { default: DocumentPreviewHost } = await import("../src/components/message/DocumentPreviewHost");
  const { default: MediaPreviewHost } = await import("../src/components/message/MediaPreviewHost");
  const { useAgentStore } = await import("../src/store/agentStore");
  const { useAuthStore } = await import("../src/store/authStore");
  const { useChannelStore } = await import("../src/store/channelStore");
  const { useSavedStore } = await import("../src/store/savedStore");
  const { useServerStore } = await import("../src/store/serverStore");

  useAuthStore.setState({
    user: makeUser(),
    accessToken: "token",
    refreshToken: "refresh",
    loading: false,
    initialized: true,
  });
  useServerStore.setState({ current: makeServer(), members: [] as ServerMember[] });
  useAgentStore.setState({ agents: [] as Agent[], agentActivities: {} });
  useChannelStore.setState({ dmChannels: [] as Channel[] });
  useSavedStore.setState({ saved: [], savedIds: new Set(), loading: false, hasMore: false });

  const tree = (
    <MemoryRouter>
      <MessageItem message={message} mentionMap={new Map()} channels={[]} hideThreadActions />
      {/* Preview modals are mounted app-level (see App.tsx), so a message-only
          render would never show them. */}
      <DocumentPreviewHost />
      <MediaPreviewHost />
    </MemoryRouter>
  );
  const view = locale
    ? rtlRender(<TestIntlProvider locale={locale}>{tree}</TestIntlProvider>)
    : render(tree);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  const row = view.container.querySelector<HTMLElement>("#message-message-1");
  assert.ok(row);
  return { ...view, row };
}

afterEach(() => {
  resetAttachmentPreviewSummaryCache();
  cleanup();
});


const VIDEO_TITLE = "video[title='Video attachment: tabs-before.mp4']";

type InlineUrlResponse = { url: string } | Error;

async function withInlineUrls(responses: InlineUrlResponse[], run: (ctx: { inlineRequests: () => number }) => Promise<void>) {
  const { default: api } = await import("../src/api/client");
  const originalGet = api.get;
  const originalPlay = HTMLMediaElement.prototype.play;
  const originalWarn = console.warn;
  const originalError = console.error;
  let inlineRequests = 0;
  HTMLMediaElement.prototype.play = function play() {
    playCalls.push(this.currentTime);
    return Promise.resolve();
  };
  console.warn = () => {};
  console.error = () => {};
  api.get = (async (url: string) => {
    if (url === "/channels/channel-1/members") {
      return { data: { agents: [], humans: [] } };
    }
    if (url === "/attachments/video-1/url?disposition=inline") {
      const response = responses[inlineRequests] ?? responses[responses.length - 1];
      inlineRequests += 1;
      if (response instanceof Error) throw response;
      return { data: response };
    }
    throw new Error(`unexpected GET ${url}`);
  }) as typeof api.get;
  try {
    await run({ inlineRequests: () => inlineRequests });
  } finally {
    HTMLMediaElement.prototype.play = originalPlay;
    console.warn = originalWarn;
    console.error = originalError;
    api.get = originalGet;
  }
}

const playCalls: number[] = [];

beforeEach(() => {
  playCalls.length = 0;
});

function failVideo(video: HTMLVideoElement, code: number, message = "") {
  Object.defineProperty(video, "error", { configurable: true, value: { code, message } });
  fireEvent.error(video);
}

async function findVideo(row: HTMLElement, src: string) {
  return waitFor(() => {
    const video = row.querySelector<HTMLVideoElement>(VIDEO_TITLE);
    assert.ok(video);
    assert.equal(video.getAttribute("src"), src);
    return video;
  });
}

test("a video error refreshes the presigned link and resumes playback instead of blaming the codec", async () => {
  await withInlineUrls([
    { url: "https://cdn.example.test/first.mp4" },
    { url: "https://cdn.example.test/second.mp4" },
  ], async ({ inlineRequests }) => {
    const { row } = await renderMessage(makeMessage(makeVideoAttachment()));
    const first = await findVideo(row, "https://cdn.example.test/first.mp4");

    fireEvent.play(first);
    first.currentTime = 42;
    // Chrome reports an expired link (403) as MEDIA_ERR_SRC_NOT_SUPPORTED.
    failVideo(first, 4);

    const second = await findVideo(row, "https://cdn.example.test/second.mp4");
    assert.equal(inlineRequests(), 2);
    assert.doesNotMatch(row.textContent ?? "", /codec/);

    fireEvent.loadedMetadata(second);
    assert.equal(second.currentTime, 42);
    assert.deepEqual(playCalls, [42]);
  });
});

test("a format error on a freshly refreshed link shows the codec warning", async () => {
  await withInlineUrls([
    { url: "https://cdn.example.test/first.mp4" },
    { url: "https://cdn.example.test/second.mp4" },
  ], async ({ inlineRequests }) => {
    const { row } = await renderMessage(makeMessage(makeVideoAttachment()));
    failVideo(await findVideo(row, "https://cdn.example.test/first.mp4"), 4);
    failVideo(await findVideo(row, "https://cdn.example.test/second.mp4"), 4, "PipelineStatus::DEMUXER_ERROR_NO_SUPPORTED_STREAMS: FFmpegDemuxer: no supported streams");

    await waitFor(() => assert.match(row.textContent ?? "", /This video may use a codec this browser cannot preview\./));
    assert.ok(screen.queryByLabelText("Retry loading tabs-before.mp4") === null);
    assert.ok(screen.getByLabelText("Download tabs-before.mp4"));
    assert.equal(inlineRequests(), 2);
  });
});

test("a network error after the refresh offers a retry instead of the codec warning", async () => {
  await withInlineUrls([
    { url: "https://cdn.example.test/first.mp4" },
    { url: "https://cdn.example.test/second.mp4" },
    { url: "https://cdn.example.test/third.mp4" },
  ], async ({ inlineRequests }) => {
    const { row } = await renderMessage(makeMessage(makeVideoAttachment()));
    failVideo(await findVideo(row, "https://cdn.example.test/first.mp4"), 2);
    failVideo(await findVideo(row, "https://cdn.example.test/second.mp4"), 2);

    await waitFor(() => assert.match(row.textContent ?? "", /Couldn't load this video preview\./));
    assert.doesNotMatch(row.textContent ?? "", /codec/);

    fireEvent.click(screen.getByLabelText("Retry loading tabs-before.mp4"));
    await findVideo(row, "https://cdn.example.test/third.mp4");
    assert.equal(inlineRequests(), 3);
  });
});

test("Chrome's bare format error for a failed media request is treated as a load failure, not a codec problem", async () => {
  await withInlineUrls([
    { url: "https://cdn.example.test/first.mp4" },
    { url: "https://cdn.example.test/second.mp4" },
  ], async () => {
    const { row } = await renderMessage(makeMessage(makeVideoAttachment()));
    // What Chrome reports for a 403/404 on the video request.
    failVideo(await findVideo(row, "https://cdn.example.test/first.mp4"), 4, "MEDIA_ELEMENT_ERROR: Format error");
    failVideo(await findVideo(row, "https://cdn.example.test/second.mp4"), 4, "MEDIA_ELEMENT_ERROR: Format error");

    await waitFor(() => assert.match(row.textContent ?? "", /Couldn't load this video preview\./));
    assert.doesNotMatch(row.textContent ?? "", /codec/);
    assert.ok(screen.getByLabelText("Retry loading tabs-before.mp4"));
  });
});

test("a failed link request shows a load failure with retry, not the codec warning", async () => {
  await withInlineUrls([
    new Error("network down"),
    { url: "https://cdn.example.test/first.mp4" },
  ], async () => {
    const { row } = await renderMessage(makeMessage(makeVideoAttachment()));

    await waitFor(() => assert.match(row.textContent ?? "", /Couldn't load this video preview\./));
    assert.doesNotMatch(row.textContent ?? "", /codec/);

    fireEvent.click(screen.getByLabelText("Retry loading tabs-before.mp4"));
    await findVideo(row, "https://cdn.example.test/first.mp4");
  });
});

test("a link older than a minute is refreshed again on a later error", async () => {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    await withInlineUrls([
      { url: "https://cdn.example.test/first.mp4" },
      { url: "https://cdn.example.test/second.mp4" },
      { url: "https://cdn.example.test/third.mp4" },
    ], async ({ inlineRequests }) => {
      const { row } = await renderMessage(makeMessage(makeVideoAttachment()));
      failVideo(await findVideo(row, "https://cdn.example.test/first.mp4"), 2);
      const second = await findVideo(row, "https://cdn.example.test/second.mp4");

      now += 6 * 60_000;
      failVideo(second, 2);
      await findVideo(row, "https://cdn.example.test/third.mp4");
      assert.equal(inlineRequests(), 3);
    });
  } finally {
    Date.now = realNow;
  }
});

test("each failure is reported to the media-preview trace with what the card did", async () => {
  const { __setMediaPreviewErrorEmitterForTest, __resetMediaPreviewErrorThrottleForTest } = await import("../src/utils/mediaPreviewErrorTrace");
  const emitted: Array<Record<string, unknown>> = [];
  __resetMediaPreviewErrorThrottleForTest();
  __setMediaPreviewErrorEmitterForTest((_name, attrs) => emitted.push(attrs));
  try {
    await withInlineUrls([
      { url: "https://cdn.example.test/first.mp4" },
      { url: "https://cdn.example.test/second.mp4" },
    ], async () => {
      const { row } = await renderMessage(makeMessage(makeVideoAttachment()));
      failVideo(await findVideo(row, "https://cdn.example.test/first.mp4"), 4, "MEDIA_ELEMENT_ERROR: Format error");
      failVideo(await findVideo(row, "https://cdn.example.test/second.mp4"), 4, "PipelineStatus::DEMUXER_ERROR_NO_SUPPORTED_STREAMS: FFmpegDemuxer: no supported streams");
      await waitFor(() => assert.match(row.textContent ?? "", /codec/));
    });
    assert.deepEqual(emitted.map((attrs) => [attrs.error_code, attrs.error_class, attrs.url_refreshed, attrs.url_age_bucket, attrs.outcome]), [
      ["src_not_supported", "chrome_fetch_failure", false, "<1m", "refreshing"],
      ["src_not_supported", "demuxer", true, "<1m", "shown_unsupported"],
    ]);
  } finally {
    __setMediaPreviewErrorEmitterForTest(null);
  }
});
