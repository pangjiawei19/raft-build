import assert from "node:assert/strict";
import { test as nodeTest } from "vitest";
import "./helpers/domSetup";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TestIntlProvider } from "./helpers/intl";
import api from "../src/api/client";

/**
 * Task #693 follow-up — DMs must show read state again.
 *
 * The per-@mentioned-agent badge hangs off `MentionLink`, and nobody @-mentions
 * anyone in a DM, so there is no mount point. Removing the legacy footer chip
 * (correct for channels: it fired on messages with no @agent at all, and on
 * large-summary scopes) silently left DMs with NO read indicator whatsoever.
 *
 * artin (option C): the DM read state is ONE status line under the DM's last
 * message (ChatPanel passes `showDmReadStatus` to that message only), never a
 * per-message footer chip — the footer chip created a footer row the moment the
 * peer read a message, so read messages jumped ~26px and every earlier message
 * repeated "Read".
 *
 * The restored chip is scoped to DMs ONLY, because that is the one surface
 * where it was never ambiguous: a DM has a single exposed peer, so "Read"
 * cannot quietly mean "some unrelated agent read the channel". The channel
 * case below is a regression guard for exactly the bug that removal fixed —
 * this fix must not bring it back.
 */

const test = ((name: string, fn: Parameters<typeof nodeTest>[1]) =>
  nodeTest(name,  fn)) as typeof nodeTest;

const originalPost = api.post.bind(api);

async function renderMessage(opts: {
  channelType: "dm" | "channel";
  peerMaxReadSeq?: number;
  messageSeq?: number;
  senderIsViewer?: boolean;
  hydrate?: boolean;
  reactions?: Record<string, unknown>[];
  showDmReadStatus?: boolean;
}) {
  const {
    channelType,
    peerMaxReadSeq = 10,
    messageSeq = 5,
    senderIsViewer = true,
    hydrate = true,
    reactions = [],
    showDmReadStatus = true,
  } = opts;

  const { default: MessageItem } = await import("../src/components/message/MessageItem");
  const { useAgentStore } = await import("../src/store/agentStore");
  const { useAuthStore } = await import("../src/store/authStore");
  const { useReadReceiptStore } = await import("../src/store/readReceiptStore");
  const { useSavedStore } = await import("../src/store/savedStore");
  const { useServerStore } = await import("../src/store/serverStore");
  const { useChannelStore } = await import("../src/store/channelStore");
  const {
    READ_RECEIPTS_FEATURE_FLAG_KEY,
    prefetchServerFeatureFlags,
    resetServerFeatureFlagsForTests,
  } = await import("../src/store/serverFeatureFlags");

  useAuthStore.setState({
    user: { id: "user-1", email: "u@example.com", name: "Current User" },
    accessToken: "t",
    refreshToken: "r",
    loading: false,
    initialized: true,
  } as never);
  useServerStore.setState({ current: { id: "server-1", slug: "s", name: "S" }, members: [] } as never);
  // Mirror the REAL wiring: the store keeps DMs in `dmChannels`, and ChatPanel
  // passes only `s.channels` down as the prop. A DM must therefore be provable
  // from the store alone — never from the prop.
  useChannelStore.setState({
    channels: channelType === "dm" ? [] : [{ id: "channel-1", name: "peer", type: "channel" }],
    dmChannels: channelType === "dm" ? [{ id: "channel-1", name: "peer", type: "dm" }] : [],
  } as never);
  useAgentStore.setState({ agents: [], agentActivities: {} } as never);
  useSavedStore.setState({ saved: [], savedIds: new Set(), loading: false, hasMore: false } as never);

  resetServerFeatureFlagsForTests();
  api.post = (async () => ({
    data: { evaluations: [{ key: READ_RECEIPTS_FEATURE_FLAG_KEY, enabled: true }] },
  })) as typeof api.post;
  await prefetchServerFeatureFlags("server-1");

  useReadReceiptStore.setState({
    scopes: hydrate
      ? { "channel-1": { kind: "peers", peers: [{ peerKind: "agent", peerId: "agent-1", maxReadSeq: peerMaxReadSeq }] } }
      : {},
  } as never);

  const view = render(
    <MemoryRouter>
      <TestIntlProvider>
        <MessageItem
          message={{
            id: "message-1",
            channelId: "channel-1",
            seq: messageSeq,
            senderType: "user",
            senderId: senderIsViewer ? "user-1" : "user-2",
            senderName: "Current User",
            messageType: "chat",
            content: "hello",
            createdAt: "2026-07-28T00:00:00.000Z",
            reactions,
          } as never}
          mentionMap={new Map()}
          showDmReadStatus={showDmReadStatus}
          // ChatPanel passes `useChannelStore(s => s.channels)` — which never
          // contains DMs. Passing the DM here would fake a shape the app cannot
          // produce, which is exactly how the original defect stayed green.
          channels={
            (channelType === "dm"
              ? []
              : [{ id: "channel-1", name: "peer", type: "channel" }]) as never
          }
        />
      </TestIntlProvider>
    </MemoryRouter>,
  );
  return view;
}

// raft-ui MessageItemFooter's slot: the row that, when created on read, made
// the message jump.
const FOOTER = "[data-slot='message-item-footer']";

function hasReadChip(view: { container: HTMLElement }): boolean {
  return view.container.querySelector("[data-message-affordance='read-receipt']") !== null;
}

afterEach(() => {
  cleanup();
  api.post = originalPost;
});

test("#693 a DM shows the read chip once the agent peer has read the message", async () => {
  const view = await renderMessage({ channelType: "dm", peerMaxReadSeq: 10, messageSeq: 5 });
  assert.equal(hasReadChip(view), true, "a DM is the one surface with an unambiguous single peer");
});

test("#693 option C: only the message ChatPanel marks as the DM's last shows the status", async () => {
  // The read watermark makes every earlier own message "read" too; repeating
  // the status on each of them was half of artin's complaint.
  const view = await renderMessage({ channelType: "dm", peerMaxReadSeq: 10, messageSeq: 5, showDmReadStatus: false });
  assert.equal(hasReadChip(view), false, "a read message that is not the DM's last shows nothing");
});

test("#693 option C: the status is its own right-aligned line, never in the footer", async () => {
  const view = await renderMessage({ channelType: "dm", peerMaxReadSeq: 10, messageSeq: 5 });
  const chip = view.container.querySelector("[data-message-affordance='read-receipt']");
  assert.ok(chip);
  const line = view.container.querySelector("[data-testid='dm-read-status']");
  assert.ok(line, "the status renders as its own line");
  assert.ok(line!.contains(chip), "the chip lives in the status line");
  assert.equal(line!.className.includes("justify-end"), true, "the status line is right-aligned");
});

test("#693 a DM shows nothing while the peer has not reached this message", async () => {
  const view = await renderMessage({ channelType: "dm", peerMaxReadSeq: 4, messageSeq: 5 });
  assert.equal(hasReadChip(view), false);
});

test("#693 REGRESSION GUARD: a channel never shows the aggregate chip", async () => {
  // This is the bug whose fix deleted the DM case. A read agent peer in a
  // CHANNEL must still produce nothing at message level — read state there
  // belongs on each @mentioned agent's own mention.
  const view = await renderMessage({ channelType: "channel", peerMaxReadSeq: 10, messageSeq: 5 });
  assert.equal(hasReadChip(view), false, "the channel-level aggregate chip must not come back");
});

test("#693 only the message's own sender sees the DM chip", async () => {
  const view = await renderMessage({ channelType: "dm", senderIsViewer: false });
  assert.equal(hasReadChip(view), false, "read state is visible to the sender only");
});

test("#693 an un-hydrated scope renders nothing rather than implying unread", async () => {
  const view = await renderMessage({ channelType: "dm", hydrate: false });
  assert.equal(hasReadChip(view), false);
});

test("#693 option C: a read message with no other footer content gets no footer row", async () => {
  // The jump artin saw: the chip alone used to be enough to create the footer.
  const view = await renderMessage({ channelType: "dm", peerMaxReadSeq: 10, messageSeq: 5 });
  const chip = view.container.querySelector("[data-message-affordance='read-receipt']");
  assert.ok(chip);
  assert.ok(
    view.container.querySelector(FOOTER) === null,
    "the read state alone must not create the footer row",
  );
});

test("#693 option C: with reactions the status still sits below the footer, not in it", async () => {
  const view = await renderMessage({
    channelType: "dm",
    peerMaxReadSeq: 10,
    messageSeq: 5,
    reactions: [{
      emoji: "\u{1F44D}",
      count: 2,
      reactorIds: ["user-2"],
      reactorNames: ["Bob"],
    }],
  });
  const line = view.container.querySelector("[data-testid='dm-read-status']");
  assert.ok(line, "the status must still render when the message has reactions");
  const footer = view.container.querySelector(FOOTER);
  assert.ok(footer, "precondition: the reaction footer exists");
  assert.equal(footer!.contains(line), false, "the status is not part of the footer");
  assert.ok(
    footer!.compareDocumentPosition(line!) & Node.DOCUMENT_POSITION_FOLLOWING,
    "the status line comes after the footer",
  );
});
