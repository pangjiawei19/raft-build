import "./helpers/domSetup";
import { act } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TestIntlProvider } from "./helpers/intl";
import ChatPanel from "../src/components/message/ChatPanel";
import api from "../src/api/client";
import { useAgentStore } from "../src/store/agentStore";
import type { Agent } from "../src/store/agentStore";
import { useChannelStore } from "../src/store/channelStore";
import type { Channel } from "../src/store/channelStore";
import { useMessageStore } from "../src/store/messageStore";
import { useServerStore } from "../src/store/serverStore";
import { useTaskStore } from "../src/store/taskStore";

window.matchMedia = window.matchMedia ?? (() => ({ matches: false, media: "", onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
globalThis.ResizeObserver = globalThis.ResizeObserver ?? class { observe() {} unobserve() {} disconnect() {} } as typeof ResizeObserver;
const originalGet = api.get;
afterEach(() => {
  cleanup(); api.get = originalGet;
  useAgentStore.setState(useAgentStore.getInitialState(), true);
  useServerStore.setState(useServerStore.getInitialState(), true);
  useChannelStore.setState(useChannelStore.getInitialState(), true);
  useMessageStore.setState(useMessageStore.getInitialState(), true);
  useTaskStore.setState(useTaskStore.getInitialState(), true);
});

test("a bound RaftBench service agent DM explains the destination and has no composer", async () => {
  const dm: Channel = { id: "synthetic-dm", serverId: "synthetic-server", name: "service DM", description: null, type: "dm", createdAt: "2026-10-19T00:00:00Z", joined: true, peerType: "agent", peerId: "synthetic-agent", peerName: "raftbench-service" };
  const agent = { id: dm.peerId, name: "raftbench-service", displayName: "RaftBench", description: null, avatarUrl: null, status: "offline", model: "external", runtime: "external", serverRole: "member", reasoningEffort: null, executionMode: "cloud", envVars: null, machineId: null, creatorType: null, creatorId: null, creator: null, createdAgents: [], deletedAt: null, createdAt: dm.createdAt, raftbenchService: true } as Agent;
  api.get = (async () => ({ data: { humans: [], agents: [] } })) as typeof api.get;
  useServerStore.setState({ current: { id: dm.serverId, slug: "synthetic", name: "Synthetic", role: "admin" }, billing: null, members: [] } as never);
  useAgentStore.setState({ agents: [agent] });
  useChannelStore.setState({ channels: [], dmChannels: [dm], channelActivity: { [dm.id]: null } });
  useTaskStore.setState({ tasks: [], currentChannelId: dm.id, loadTasks: async () => {} });
  useMessageStore.setState({ messages: [], loading: false, loadingOlder: false, loadingNewer: false, hasMore: false, hasNewer: false, historyLimited: false, highlightedMessageId: null, contextLoadError: null, transientFocusRequest: null, loadMessages: async () => {}, loadMessageContext: async () => {}, loadMessageWindowSilent: async () => {}, loadOlderMessages: async () => {}, loadNewerMessages: async () => {} });
  await act(async () => { render(<MemoryRouter><TestIntlProvider><ChatPanel channel={dm} /></TestIntlProvider></MemoryRouter>); });
  expect(screen.getByTestId("raftbench-service-dm-notice").textContent).toContain("does not reply to DMs");
  expect(screen.queryByTestId("composer-textarea")).toBeNull();
});
