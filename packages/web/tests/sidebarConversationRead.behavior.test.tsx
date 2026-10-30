import "./helpers/domSetup";
import assert from "node:assert/strict";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { SidebarReadToggleMenuItem } from "../src/components/layout/SidebarReadToggleMenuItem";
import { useMessageStore } from "../src/store/messageStore";
import { useThreadStore } from "../src/store/threadStore";
import type { FollowedThread } from "../src/store/threadStore";
import { useServerStore } from "../src/store/serverStore";
import { resetServerFeatureFlagsForTests, setServerFeatureFlagForTests, THREAD_UNREAD_BADGE_FLAG_KEY, SIDEBAR_MARK_ALL_READ_FEATURE_FLAG_KEY } from "../src/store/serverFeatureFlags";
import { renderWithIntl } from "./helpers/intl";

const original = useMessageStore.getState();
afterEach(() => {
  cleanup();
  useMessageStore.setState({ markRead: original.markRead, markUnread: original.markUnread, markConversationRead: original.markConversationRead });
  useThreadStore.setState({ followedThreads: [] });
  useServerStore.setState(useServerStore.getInitialState(), true);
  resetServerFeatureFlagsForTests();
});
function setup(enabled: boolean) {
  useServerStore.setState({ current: { id: "server-1", role: "owner" }, serverEpoch: 1 } as never);
  setServerFeatureFlagForTests("server-1", THREAD_UNREAD_BADGE_FLAG_KEY, enabled);
  setServerFeatureFlagForTests("server-1", SIDEBAR_MARK_ALL_READ_FEATURE_FLAG_KEY, enabled);
  useThreadStore.setState({ followedThreads: [{ threadChannelId: "thread-1", parentChannelId: "channel-1", unreadCount: 12 }] as FollowedThread[] });
}
test("thread-only unread offers All Read and dispatches the whole conversation once", () => {
  setup(true);
  const calls: string[] = [];
  useMessageStore.setState({
    markConversationRead: async (id) => { calls.push(`all:${id}`); },
    markRead: async () => { throw new Error("must not read parent only"); },
    markUnread: async () => { throw new Error("must not mark unread"); },
  });
  const onDone = () => { calls.push("close"); };
  renderWithIntl(<SidebarReadToggleMenuItem channelId="channel-1" hasUnread={false} includeThreads onDone={onDone} />, { locale: "zh-cn" });
  fireEvent.click(screen.getByRole("menuitem", { name: "全部已读" }));
  assert.deepEqual(calls, ["close", "all:channel-1"]);
});
test("gate off and DM menu retain the existing single-scope action", () => {
  setup(false);
  const calls: string[] = [];
  useMessageStore.setState({ markUnread: async (id) => { calls.push(id); } });
  const onDone = () => {};
  renderWithIntl(<SidebarReadToggleMenuItem channelId="channel-1" hasUnread={false} includeThreads onDone={onDone} />);
  fireEvent.click(screen.getByRole("menuitem", { name: "Mark as Unread" }));
  assert.deepEqual(calls, ["channel-1"]);
  cleanup();
  setup(true);
  renderWithIntl(<SidebarReadToggleMenuItem channelId="channel-1" hasUnread={false} onDone={onDone} />);
  assert.ok(screen.getByRole("menuitem", { name: "Mark as Unread" }));
});

test("the rollout gate keeps new mutation admission out of an old-worker deployment", () => {
  setup(true);
  setServerFeatureFlagForTests("server-1", SIDEBAR_MARK_ALL_READ_FEATURE_FLAG_KEY, false);
  const onDone = () => {};
  renderWithIntl(<SidebarReadToggleMenuItem channelId="channel-1" hasUnread={false} includeThreads onDone={onDone} />);
  assert.ok(screen.getByRole("menuitem", { name: "Mark as Unread" }));
  assert.ok(screen.queryByRole("menuitem", { name: "Mark All as Read" }) === null);
});
