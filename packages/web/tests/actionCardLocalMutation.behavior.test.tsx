import assert from "node:assert/strict";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ActionCardMetadata } from "@botiverse/raft-shared";
import api from "../src/api/client";
import { ActionCard } from "../src/components/actions/ActionCard";
import { useMessageStore } from "../src/store/messageStore";
import type { Message } from "../src/store/messageStore";
import { useChannelStore } from "../src/store/channelStore";
import { useServerStore } from "../src/store/serverStore";
import { useThreadStore } from "../src/store/threadStore";
import { IntlProviderWrapper } from "../src/i18n/IntlProviderWrapper";
import { LocaleProvider } from "../src/i18n/LocaleProvider";

const channelId = "channel-1";
const messageId = "message-1";

function preparedMetadata(): ActionCardMetadata {
  return {
    kind: "action-card",
    state: "prepared",
    action: {
      type: "integration:approve_agent_login",
      requestId: "request-1",
      agentId: "agent-1",
      agentName: "Noel",
      clientId: "client-1",
      clientKey: "demo-app",
      clientName: "Demo App",
      scopes: ["messages:read"],
    },
  };
}

function executedMetadata(): ActionCardMetadata {
  return {
    ...preparedMetadata(),
    state: "executed",
    executedByUserName: "Wendy",
    result: {
      kind: "agent-integration-login",
      requestId: "request-1",
      agentId: "agent-1",
      agentName: "Noel",
      clientId: "client-1",
      clientKey: "demo-app",
      clientName: "Demo App",
      scopes: ["messages:read"],
      grantId: "grant-1",
    },
  };
}

function preparedCreateAgentMetadata(): ActionCardMetadata {
  return {
    kind: "action-card",
    state: "prepared",
    action: {
      type: "agent:create",
      name: "Scout",
    },
  };
}

function seedMessage(metadata: ActionCardMetadata) {
  const message: Message = {
    id: messageId,
    channelId,
    senderType: "agent",
    senderId: "agent-1",
    content: "",
    createdAt: "2026-06-29T14:00:00.000Z",
    actionMetadata: metadata,
  };

  useMessageStore.setState({
    currentChannelId: channelId,
    channelMessages: { [channelId]: [message] },
    messages: [message],
  });
  useChannelStore.setState({
    channels: [{ id: channelId, joined: true, archivedAt: null }],
  } as never);
  useServerStore.setState({
    current: { id: "server-1", role: "member" },
  } as never);
}

function seedDirectMessage(metadata: ActionCardMetadata) {
  seedMessage(metadata);
  useChannelStore.setState({
    channels: [],
    dmChannels: [{
      id: channelId,
      name: "Duoyu",
      description: null,
      type: "dm",
      createdAt: "2026-09-05T00:00:00.000Z",
      archivedAt: null,
      peerType: "user",
      peerId: "user-2",
      // Real DM projections do not carry a `joined` field.
    }],
  } as never);
}

function StoreBackedActionCard() {
  const metadata = useMessageStore((state) =>
    state.messages.find((message) => message.id === messageId)?.actionMetadata,
  ) as ActionCardMetadata | undefined;

  assert.ok(metadata);
  // ActionCard reads its copy through react-intl now, so it needs an intl
  // ancestor. Using the real providers (not a bare IntlProvider with a stub
  // catalog) keeps this test honest about what ships.
  return (
    <LocaleProvider>
      <IntlProviderWrapper>
        <ActionCard messageId={messageId} metadata={metadata} channelId={channelId} />
      </IntlProviderWrapper>
    </LocaleProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useMessageStore.setState({
    currentChannelId: null,
    channelMessages: {},
    messages: [],
  });
  useChannelStore.setState({ channels: [], dmChannels: [] } as never);
  useServerStore.setState({ current: null } as never);
  useThreadStore.setState({ openThreadChannelId: null, openParentChannelId: null } as never);
});

/**
 * A card this viewer cannot run starts folded to its header with a "View only"
 * label (cindyz, task #752). Unfold it the way a person would, so the disabled
 * action and its reason can be read.
 */
function unfoldViewOnlyCard() {
  const toggle = screen.getByRole("button", { name: "Show or hide details" });
  assert.equal(toggle.getAttribute("aria-expanded"), "false", "a view-only card should start folded");
  assert.ok(screen.getByText("View only"));
  fireEvent.click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
}

test("inline approve cards apply returned metadata immediately", async () => {
  seedMessage(preparedMetadata());

  vi.spyOn(api, "post").mockImplementation(async (url: string) => {
    assert.equal(url, `/actions/${messageId}/execute`);
    return { data: { messageId, metadata: executedMetadata() } };
  });

  render(<StoreBackedActionCard />);

  fireEvent.click(screen.getByRole("button", { name: "Approve Login" }));

  await waitFor(() => {
    assert.ok(screen.queryByRole("button", { name: "Approve Login" }) === null);
    assert.match(screen.getByText("Done").textContent ?? "", /Done/);
  });

  const updated = useMessageStore.getState().messages[0]?.actionMetadata as ActionCardMetadata | undefined;
  assert.equal(updated?.state, "executed");
});

test("public read without membership keeps a disabled action with a reason", () => {
  seedMessage(preparedMetadata());
  useChannelStore.setState({
    channels: [{ id: channelId, joined: false, archivedAt: null }],
  } as never);

  render(<StoreBackedActionCard />);
  // A view-only card folds; its reason sits under the title so it reads while
  // folded (cindyz 2026-10-15), not beside the button.
  const reason = screen.getByText("Join #channel to run this.");
  assert.equal(reason.getAttribute("data-slot"), "message-action-card-header-description");
  unfoldViewOnlyCard();

  const button = screen.getByRole("button", { name: "Approve Login" });
  assert.equal(button.hasAttribute("disabled"), true);
  assert.equal(button.getAttribute("aria-describedby"), reason.id);
  assert.equal(screen.getAllByText("Join #channel to run this.").length, 1, "the reason is not repeated beside the button");
  // Match whole class tokens. raft-ui 0.5.14 adds aria-disabled:cursor-not-allowed,
  // which a substring check would mistake for the legacy disabled: utilities.
  const classes = button.className.split(/\s+/);
  assert.equal(classes.some((token) => token === "disabled:opacity-50" || token === "disabled:cursor-not-allowed"), false);
});

test("archived channels show only the highest-priority blocked reason", () => {
  seedMessage(preparedCreateAgentMetadata());
  useChannelStore.setState({
    channels: [{ id: channelId, name: "archive", joined: false, archivedAt: "2026-09-05T00:00:00.000Z" }],
  } as never);
  useServerStore.setState({
    current: { id: "server-1", role: "guest" },
  } as never);

  render(<StoreBackedActionCard />);
  unfoldViewOnlyCard();

  assert.equal(screen.getByRole("button", { name: "Create Agent" }).hasAttribute("disabled"), true);
  assert.ok(screen.getByText("This channel is archived, so its actions can no longer be run."));
  assert.equal(screen.queryByText("Guests can't run channel actions."), null);
  assert.equal(screen.queryByText("Join #archive to run this."), null);
  assert.equal(screen.queryByText(/Create Agents permission/), null);
});

test("guests see a disabled action with the guest reason", () => {
  seedMessage(preparedMetadata());
  useServerStore.setState({
    current: { id: "server-1", role: "guest" },
  } as never);

  render(<StoreBackedActionCard />);
  unfoldViewOnlyCard();

  assert.equal(screen.getByRole("button", { name: "Approve Login" }).hasAttribute("disabled"), true);
  assert.ok(screen.getByText("Guests can't run channel actions."));
});

test("a card folded while its channel was unknown opens once the viewer turns out to be allowed", async () => {
  seedMessage(preparedMetadata());
  useChannelStore.setState({ channels: [], dmChannels: [] } as never);

  render(<StoreBackedActionCard />);
  assert.ok(screen.getByText("View only"));
  assert.ok(screen.queryByRole("button", { name: "Approve Login" }) === null);

  // The carrier channel arrives after the card mounted, and the viewer is a member.
  act(() => {
    useChannelStore.setState({ channels: [{ id: channelId, joined: true, archivedAt: null }] } as never);
  });

  await waitFor(() => assert.ok(screen.queryByText("View only") === null));
  const button = await screen.findByRole("button", { name: "Approve Login" });
  assert.equal(button.hasAttribute("disabled"), false);
});

test("thread action cards inherit the joined parent channel write projection", () => {
  seedMessage(preparedMetadata());
  const threadChannelId = "thread-1";
  useThreadStore.setState({
    openThreadChannelId: threadChannelId,
    openParentChannelId: channelId,
  } as never);

  render(
    <LocaleProvider>
      <IntlProviderWrapper>
        <ActionCard messageId={messageId} metadata={preparedMetadata()} channelId={threadChannelId} />
      </IntlProviderWrapper>
    </LocaleProvider>,
  );

  assert.ok(screen.getByRole("button", { name: "Approve Login" }));
});

test("direct-message action cards use the real dmChannels projection without joined", () => {
  seedDirectMessage(preparedMetadata());

  render(<StoreBackedActionCard />);

  assert.ok(screen.getByRole("button", { name: "Approve Login" }));
});

test("direct-message thread action cards inherit their dmChannels parent projection", () => {
  seedDirectMessage(preparedMetadata());
  const threadChannelId = "dm-thread-1";
  useThreadStore.setState({
    openThreadChannelId: threadChannelId,
    openParentChannelId: channelId,
  } as never);

  render(
    <LocaleProvider>
      <IntlProviderWrapper>
        <ActionCard messageId={messageId} metadata={preparedMetadata()} channelId={threadChannelId} />
      </IntlProviderWrapper>
    </LocaleProvider>,
  );

  assert.ok(screen.getByRole("button", { name: "Approve Login" }));
});

test("direct-message agent:create cards remain operable for a server admin", () => {
  seedDirectMessage(preparedCreateAgentMetadata());
  useServerStore.setState({
    current: { id: "server-1", role: "admin" },
  } as never);

  render(<StoreBackedActionCard />);

  assert.ok(screen.getByRole("button", { name: "Create Agent" }));
});

test("agent:create card keeps a disabled action for members without createAgents", () => {
  seedMessage(preparedCreateAgentMetadata());

  render(<StoreBackedActionCard />);
  unfoldViewOnlyCard();

  assert.ok(screen.getByText("@Scout"));
  const button = screen.getByRole("button", { name: "Create Agent" });
  assert.equal(button.hasAttribute("disabled"), true);
  assert.ok(screen.getByText("You need the Create Agents permission — ask a Server owner or admin to run this."));
});

test("direct-message agent:create cards stay disabled for an ordinary member", () => {
  seedDirectMessage(preparedCreateAgentMetadata());

  render(<StoreBackedActionCard />);
  unfoldViewOnlyCard();

  const button = screen.getByRole("button", { name: "Create Agent" });
  const reason = screen.getByText("You need the Create Agents permission — ask a Server owner or admin to run this.");
  assert.equal(button.hasAttribute("disabled"), true);
  assert.equal(button.getAttribute("aria-describedby"), reason.id);
});

test("agent:create card keeps its action for a server admin", () => {
  seedMessage(preparedCreateAgentMetadata());
  useServerStore.setState({
    current: { id: "server-1", role: "admin" },
  } as never);

  render(<StoreBackedActionCard />);

  assert.ok(screen.getByRole("button", { name: "Create Agent" }));
});

test("a done card says who ran it under its title, visible while folded, with no action row", () => {
  seedMessage(executedMetadata());
  render(<StoreBackedActionCard />);

  const toggle = screen.getByRole("button", { name: "Show or hide details" });
  assert.equal(toggle.getAttribute("aria-expanded"), "false", "a done card starts folded");
  const line = document.querySelector('[data-slot="message-action-card-header-description"]');
  assert.ok(line !== null, "the result line is in the header");
  assert.match(line.textContent ?? "", /Wendy/);
  assert.ok(document.querySelector('[data-slot="message-action-card-actions"]') === null);
  assert.ok(document.querySelector('[data-slot="message-action-card-actions-note"]') === null);
});

test("Raft's notice opens the content, above the properties", () => {
  // The scope list measures its overflow; jsdom has no ResizeObserver.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  seedMessage({
    kind: "action-card",
    state: "prepared",
    action: {
      type: "integration:install_marketplace_app",
      clientId: "11111111-1111-4111-8111-111111111111",
      clientKey: "me-build",
      clientName: "Me Build",
      clientNameSha256: "a".repeat(64),
      agentId: "22222222-2222-4222-8222-222222222222",
      agentName: "Peng",
      scopes: ["openid"],
    },
  } as ActionCardMetadata);
  render(<StoreBackedActionCard />);

  const notice = document.querySelector('[data-slot="message-action-card-notice"]');
  const properties = document.querySelector('[data-slot="message-action-card-properties"]');
  assert.ok(notice !== null && properties !== null, "this card carries a notice and properties");
  assert.ok(
    notice.compareDocumentPosition(properties) & Node.DOCUMENT_POSITION_FOLLOWING,
    "the notice comes before the properties",
  );
});

test("an agent login card's sending notes open the content too, above the properties", () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const metadata = preparedMetadata();
  seedMessage({ ...metadata, action: { ...metadata.action, scopes: ["openid", "agent:event:write"] } } as ActionCardMetadata);
  render(<StoreBackedActionCard />);

  const notices = [...document.querySelectorAll('[data-slot="message-action-card-notice"]')];
  const properties = document.querySelector('[data-slot="message-action-card-properties"]');
  assert.ok(notices.length >= 1 && properties !== null, "this card carries sending notes and properties");
  for (const notice of notices) {
    assert.ok(notice.compareDocumentPosition(properties) & Node.DOCUMENT_POSITION_FOLLOWING, notice.textContent ?? "");
  }
});
