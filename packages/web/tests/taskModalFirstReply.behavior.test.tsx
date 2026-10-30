import assert from "node:assert/strict";
import "./helpers/domSetup";
import { act } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TestIntlProvider } from "./helpers/intl";
import api from "../src/api/client";
import ThreadPanel from "../src/components/message/ThreadPanel";
import { useAuthStore } from "../src/store/authStore";
import type { User } from "../src/store/authStore";
import { useChannelStore } from "../src/store/channelStore";
import type { Channel } from "../src/store/channelStore";
import { useMessageStore } from "../src/store/messageStore";
import { useServerStore } from "../src/store/serverStore";
import { useTaskStore } from "../src/store/taskStore";
import { useThreadStore } from "../src/store/threadStore";

/**
 * task #750 (Hands task #66): opening a zero-reply task from the Tasks board
 * and sending its first reply failed with "创建消息列失败". Root cause: the
 * task modal owns an independent identity slot (task #699's taskModal), and
 * the panel already read loading/error/retry from that slot — but the
 * composer's lazy thread resolution still called `ensureOpenThreadChannel`,
 * which reads the SIDE thread's open* slots. Those are null for a modal-only
 * open, so resolution threw before the thread was ever created.
 *
 * Teeth: with the wiring reverted to the side-thread ensure, test 1 fails —
 * no thread is created, the message is never sent, and the slot stays
 * unbound.
 */

const originalGet = api.get.bind(api);
const originalPost = api.post.bind(api);

window.matchMedia = window.matchMedia ?? (() => ({
  matches: false, media: "", onchange: null,
  addListener: () => {}, removeListener: () => {},
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
}));
globalThis.IntersectionObserver = globalThis.IntersectionObserver ?? class {
  observe() {} unobserve() {} disconnect() {}
} as typeof IntersectionObserver;
globalThis.ResizeObserver = globalThis.ResizeObserver ?? class {
  observe() {} unobserve() {} disconnect() {}
} as typeof ResizeObserver;
globalThis.CSS = globalThis.CSS ?? ({ escape: (value: string) => value } as typeof CSS);
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
HTMLElement.prototype.scrollTo = HTMLElement.prototype.scrollTo ?? function scrollTo() {};

afterEach(() => {
  cleanup();
  api.get = originalGet;
  api.post = originalPost;
  useAuthStore.setState(useAuthStore.getInitialState(), true);
  useServerStore.setState(useServerStore.getInitialState(), true);
  useChannelStore.setState(useChannelStore.getInitialState(), true);
  useMessageStore.setState(useMessageStore.getInitialState(), true);
  useThreadStore.setState(useThreadStore.getInitialState(), true);
  useTaskStore.setState(useTaskStore.getInitialState(), true);
});

function makeUser(): User {
  return {
    id: "user-1", email: "ada@example.com", gravatarHash: "", name: "ada", displayName: "Ada",
    description: null, avatarUrl: null, emailVerified: true, preferredLanguage: null,
    preferredTimezone: "UTC", autoTranslationEnabled: false, preferredTranslationDisplay: "original",
    preferredTimeFormat: null, preferredMessageBodyFontSize: null, referralSource: null,
    referralSourceOther: null, referralSourceSkippedAt: null,
  };
}

function seedZeroReplyTaskModal(sendMessage: (channelId: string, content: string) => Promise<unknown>) {
  const parentChannel: Channel = {
    id: "parent-channel", serverId: "server-1", name: "tasks-host", description: null,
    type: "channel", createdAt: "2026-10-13T00:00:00.000Z", joined: true, activityMuteSupported: false,
  };
  useAuthStore.setState({ user: makeUser(), initialized: true });
  useServerStore.setState({
    current: {
      id: "server-1", name: "S", avatarUrl: null, slug: "s", ownerId: "user-1",
      onboardingAgentId: null, hideHumansFromMembers: false, plan: "free", planDowngradedAt: null,
      role: "member", createdAt: "2026-10-13T00:00:00.000Z",
    },
    billing: null, members: [], sidebarOrder: null, loadBilling: async () => {},
  });
  useChannelStore.setState({
    channels: [parentChannel], dmChannels: [],
    channelActivity: { [parentChannel.id]: null },
  });
  useMessageStore.setState({
    messages: [], channelMessages: { [parentChannel.id]: [] },
    loading: false, loadingOlder: false, loadingNewer: false, hasMore: false, hasNewer: false,
    historyLimited: false, highlightedMessageId: null, contextLoadError: null, transientFocusRequest: null,
    unreadCounts: {}, drafts: {},
    loadMessages: async () => {}, loadMessageContext: async () => {}, loadMessageWindowSilent: async () => {},
    loadOlderMessages: async () => {}, loadNewerMessages: async () => {},
    sendMessage: sendMessage as never,
  });
  useTaskStore.setState({
    tasks: [], serverTasks: [], currentChannelId: parentChannel.id, tasksByChannelId: {},
    taskMetadataByMessageId: {}, taskMessageIdByTaskId: {}, loadTasks: async () => {},
  });
  // The task modal's independent slot, as opened from the Tasks board for a
  // task that has no replies yet: anchored, looked up, no durable thread.
  useThreadStore.setState({
    taskModal: {
      parentMessageId: "parent-message",
      parentChannelId: "parent-channel",
      threadChannelId: null,
      serverSlug: "s",
      focusedMessageId: null,
      loading: false,
      error: null,
    },
    summaries: {},
    followedThreads: [],
    taskUpdatesByMessageId: {},
  });
  api.get = (async () => ({ data: {} })) as typeof api.get;
}

const MODAL_THREAD_IDENTITY = {
  parentMessageId: "parent-message",
  parentChannelId: "parent-channel",
  threadChannelId: null,
  focusedMessageId: null,
} as const;

function renderModalTaskPanel() {
  return render(
    <TestIntlProvider>
      <MemoryRouter>
        <ThreadPanel presentation="modal" threadIdentity={MODAL_THREAD_IDENTITY} />
      </MemoryRouter>
    </TestIntlProvider>,
  );
}

function composerTextarea(): HTMLTextAreaElement {
  const textarea = document.querySelector("textarea");
  assert.ok(textarea, "task modal composer renders");
  return textarea as HTMLTextAreaElement;
}

test("task #750: first reply in a zero-reply task modal creates one thread and delivers through it", async () => {
  const sent: Array<{ channelId: string; content: string }> = [];
  const sendMessage = async (channelId: string, content: string) => {
    sent.push({ channelId, content });
    return { pendingMentionActions: [], unresolvedMentionHandles: [], deliveryWarnings: [] };
  };
  seedZeroReplyTaskModal(sendMessage);
  const posts: Array<{ url: string; body: unknown }> = [];
  api.post = (async (url: string, body?: unknown) => {
    posts.push({ url, body });
    if (url === "/channels/parent-channel/threads") {
      return { data: { threadChannelId: "thread-created" } };
    }
    return { data: {} };
  }) as typeof api.post;

  await act(async () => {
    renderModalTaskPanel();
    await new Promise((r) => setTimeout(r, 0));
  });

  const textarea = composerTextarea();
  fireEvent.change(textarea, { target: { value: "first reply" } });
  const form = textarea.closest("form");
  assert.ok(form);
  await act(async () => {
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  });

  await waitFor(() => assert.equal(sent.length, 1, "the reply is sent"));

  // Exactly one canonical thread, created from the modal slot's own anchor.
  assert.deepEqual(
    posts.filter((p) => p.url.endsWith("/threads")),
    [{ url: "/channels/parent-channel/threads", body: { parentMessageId: "parent-message" } }],
  );
  assert.equal(sent[0]?.channelId, "thread-created", "delivery goes through the created thread channel");
  assert.equal(sent[0]?.content, "first reply");

  // The durable accept binds the taskModal slot (and the summary) — the
  // composer is now on the real channel, no pending-thread key left behind.
  await waitFor(() =>
    assert.equal(useThreadStore.getState().taskModal?.threadChannelId, "thread-created"),
  );
  assert.equal(
    useThreadStore.getState().summaries["parent-message"]?.threadChannelId,
    "thread-created",
  );

  // The side thread's open* slots were never read or written.
  const state = useThreadStore.getState();
  assert.equal(state.openParentMessageId, null);
  assert.equal(state.openParentChannelId, null);
  assert.equal(state.openThreadChannelId, null);
});

test("task #750: a failed thread creation keeps the draft and sends nothing", async () => {
  const sent: string[] = [];
  const sendMessage = async (channelId: string) => {
    sent.push(channelId);
    return { pendingMentionActions: [], unresolvedMentionHandles: [], deliveryWarnings: [] };
  };
  seedZeroReplyTaskModal(sendMessage);
  api.post = (async (url: string) => {
    if (url === "/channels/parent-channel/threads") {
      throw new Error("boom");
    }
    return { data: {} };
  }) as typeof api.post;

  await act(async () => {
    renderModalTaskPanel();
    await new Promise((r) => setTimeout(r, 0));
  });

  const textarea = composerTextarea();
  fireEvent.change(textarea, { target: { value: "keep me" } });
  const form = textarea.closest("form");
  assert.ok(form);
  await act(async () => {
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  });

  // The failure surfaces in the composer, nothing was sent, and the slot is
  // still unbound so a retry can resolve again.
  await waitFor(() =>
    assert.ok(
      (document.body.textContent ?? "").length > 0 && sent.length === 0,
      "nothing is sent when thread creation fails",
    ),
  );
  assert.equal((composerTextarea() as HTMLTextAreaElement).value, "keep me", "the draft survives the failed send");
  assert.equal(useThreadStore.getState().taskModal?.threadChannelId, null);
  assert.equal(useMessageStore.getState().drafts["pending-thread:parent-message"], "keep me");
});
