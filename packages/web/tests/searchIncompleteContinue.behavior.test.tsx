import assert from "node:assert/strict";
import "./helpers/domSetup";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { TestIntlProvider } from "./helpers/intl";
import type { Locale } from "../src/i18n/locale";
const render: typeof rtlRender = (ui, options) => rtlRender(ui, { wrapper: TestIntlProvider, ...options });
import api from "../src/api/client";
import type { Agent } from "../src/store/agentStore";
import type { User } from "../src/store/authStore";
import type { Channel } from "../src/store/channelStore";
import type { Server, ServerMember } from "../src/store/serverStore";

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
}

function installBrowserStubs() {
  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
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
    role: "owner",
    createdAt: "2026-07-01T00:00:00.000Z",
  };
}

async function renderSearchPage(locale?: Locale) {
  installBrowserStubs();
  localStorage.setItem("slock_access_token", "token");
  const { default: MessageSearchPage } = await import("../src/components/search/MessageSearchPage");
  const { useAgentStore } = await import("../src/store/agentStore");
  const { useAuthStore } = await import("../src/store/authStore");
  const { useChannelStore } = await import("../src/store/channelStore");
  const { useSearchContentStore } = await import("../src/store/searchContentStore");
  const { useServerStore } = await import("../src/store/serverStore");
  const { useThreadStore } = await import("../src/store/threadStore");

  useAuthStore.setState({
    user: makeUser(),
    accessToken: "token",
    refreshToken: "refresh",
    loading: false,
    initialized: true,
  });
  useServerStore.setState({
    current: makeServer(),
    members: [] as ServerMember[],
  });
  useChannelStore.setState({
    channels: [] as Channel[],
    dmChannels: [] as Channel[],
  });
  useAgentStore.setState({
    agents: [] as Agent[],
    agentActivities: {},
  });
  useSearchContentStore.setState({ slot: null });
  useThreadStore.setState({
    openParentMessageId: null,
    openThreadChannelId: null,
    openParentChannelId: null,
  });

  const tree = createElement(
    MemoryRouter,
    { initialEntries: ["/s/server/search?q=invoice&sort=recent"] },
    createElement(MessageSearchPage),
  );
  return locale
    ? rtlRender(createElement(TestIntlProvider, { locale }, tree))
    : render(tree);
}

afterEach(() => {
  cleanup();
});

const hit = {
  id: "message-old",
  channelId: "channel-1",
  threadId: null,
  parentMessageId: null,
  parentMessageContent: null,
  parentChannelId: "channel-1",
  parentChannelName: "billing",
  parentChannelType: "channel",
  parentChannelArchivedAt: null,
  senderId: "user-1",
  senderType: "user",
  senderName: "Current User",
  channelName: "billing",
  channelType: "channel",
  channelArchivedAt: null,
  content: "the invoice from september",
  snippet: "the invoice from september",
  createdAt: "2026-09-20T04:00:00.000Z",
};

test("an incomplete recent search is not shown as no results, and Continue searching resumes from the cursor", async () => {
  const originalGet = api.get;
  const calls: Array<Record<string, unknown>> = [];
  api.get = async (url: string, config?: { params?: Record<string, unknown> }) => {
    assert.equal(url, "/messages/search");
    const params = config?.params ?? {};
    calls.push(params);
    if (!params.cursor) {
      return { data: { results: [], hasMore: false, incomplete: true, nextCursor: "CUR-1", searchedThrough: "2026-10-01T00:00:00.000Z" } };
    }
    return { data: { results: [hit], hasMore: false } };
  };

  try {
    await renderSearchPage();

    await waitFor(() => {
      assert.ok(screen.getByText("No matches yet"));
    });
    assert.ok(screen.queryByText(/No results for/) === null, "an incomplete page is not an empty result");
    assert.ok(screen.getByText(/Older messages have not been searched yet\./));

    fireEvent.click(screen.getByRole("button", { name: "Continue searching" }));

    await waitFor(() => {
      assert.ok(screen.getByText(/september/));
    });
    const continued = calls.at(-1) ?? {};
    assert.equal(continued.cursor, "CUR-1");
    assert.equal("offset" in continued, false, "the cursor replaces the offset");
    assert.equal(continued.q, "invoice");
    assert.ok(screen.queryByRole("button", { name: "Continue searching" }) === null);
  } finally {
    api.get = originalGet;
  }
});
