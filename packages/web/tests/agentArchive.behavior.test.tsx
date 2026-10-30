import "./helpers/domSetup";

import assert from "node:assert/strict";
import { act } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AgentArchiveView } from "@botiverse/raft-shared";

import api from "../src/api/client";
import { AgentArchiveDialog } from "../src/components/agentArchive/AgentArchiveDialog";
import { AgentArchiveSection } from "../src/components/agentArchive/AgentArchiveSection";
import ArchivedAgentsSection from "../src/components/settings/ArchivedAgentsSection";
import type { Agent } from "../src/store/agentStore";
import { useAgentStore } from "../src/store/agentStore";
import { useMachineStore } from "../src/store/machineStore";
import { useServerStore } from "../src/store/serverStore";
import { TestIntlProvider } from "./helpers/intl";

const originalGet = api.get.bind(api);
const originalPost = api.post.bind(api);
const originalDelete = api.delete.bind(api);

const agent: Agent = {
  id: "agent-1",
  serverId: "server-1",
  serverName: "Server",
  serverSlug: "server",
  name: "helper",
  displayName: "Helper",
  avatarUrl: null,
  description: null,
  status: "stopped",
  model: "gpt-5",
  runtime: "codex",
  serverRole: null,
  reasoningEffort: null,
  executionMode: "byoc",
  envVars: null,
  machineId: "machine-1",
  creatorType: "user",
  creatorId: "user-1",
  creator: null,
  createdAgents: [],
  deletedAt: null,
  createdAt: "2026-08-22T00:00:00.000Z",
};

function archiveView(overrides: Partial<AgentArchiveView> = {}): AgentArchiveView {
  return {
    agentId: agent.id,
    archivedAt: "2026-10-12T10:00:00.000Z",
    archivedByUserId: "user-1",
    machineId: "machine-1",
    machineName: "Studio",
    workspaceState: "on_computer",
    pendingOp: null,
    waitingForComputer: false,
    lastErrorCode: null,
    lastErrorAt: null,
    ...overrides,
  };
}

function seed() {
  useServerStore.setState({
    current: { id: "server-1", name: "Server", slug: "server", ownerId: "user-1", role: "owner", plan: "free" },
    members: [{ userId: "user-1", name: "ada", displayName: "Ada" }],
  } as never);
  useMachineStore.setState({ machines: [{ id: "machine-1", name: "Studio" }] } as never);
}

function renderWithShell(node: React.ReactNode) {
  return render(<MemoryRouter><TestIntlProvider>{node}</TestIntlProvider></MemoryRouter>);
}

afterEach(() => {
  cleanup();
  api.get = originalGet as typeof api.get;
  api.post = originalPost as typeof api.post;
  api.delete = originalDelete as typeof api.delete;
  useAgentStore.setState(useAgentStore.getInitialState(), true);
  useServerStore.setState(useServerStore.getInitialState(), true);
  useMachineStore.setState(useMachineStore.getInitialState(), true);
});

test("archiving sends the chosen workspace option", async () => {
  seed();
  const calls: Array<{ url: string; data: unknown }> = [];
  api.delete = (async (url: string, config?: { data?: unknown }) => {
    calls.push({ url, data: config?.data });
    return { data: { ok: true } };
  }) as typeof api.delete;
  useAgentStore.setState({ agents: [agent] } as never);
  renderWithShell(<AgentArchiveDialog agent={agent} onClose={() => {}} />);

  assert.ok(screen.queryByTestId("agent-archive-option-backup") === null, "no backup option yet");
  fireEvent.click(screen.getByTestId("agent-archive-option-delete"));
  assert.ok(screen.getByText("Deleting the workspace cannot be undone."));
  await act(async () => {
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive Agent" }));
  });
  assert.deepEqual(calls, [{ url: "/agents/agent-1", data: { workspace: "delete" } }]);
});


test("an agent without a Computer workspace is archived without workspace options", () => {
  seed();
  renderWithShell(<AgentArchiveDialog agent={{ ...agent, machineId: null }} onClose={() => {}} />);
  assert.ok(screen.queryByTestId("agent-archive-option-keep") === null);
});


test("the archived profile shows who archived it and where the workspace is, and offers deleting it", async () => {
  seed();
  const archived = { ...agent, deletedAt: "2026-10-12T10:00:00.000Z" };
  api.get = (async (url: string) => {
    assert.equal(url, "/agents/agent-1/archive");
    return { data: { archive: archiveView() } };
  }) as typeof api.get;
  const posts: Array<{ url: string; body: unknown }> = [];
  api.post = (async (url: string, body: unknown) => {
    posts.push({ url, body });
    return { data: { archive: archiveView({ pendingOp: "delete", waitingForComputer: true }) } };
  }) as typeof api.post;
  renderWithShell(<AgentArchiveSection agent={archived} canManage />);

  await waitFor(() => assert.equal(screen.getByTestId("agent-archive-workspace-state").textContent, "On Studio"));
  assert.ok(screen.getByText(/by Ada/));
  fireEvent.click(screen.getByTestId("agent-archive-delete-workspace-button"));
  await act(async () => {
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete workspace from Computer" }));
  });
  assert.deepEqual(posts, [{ url: "/agents/agent-1/archive/workspace", body: { action: "delete" } }]);
  await waitFor(() => assert.ok(screen.getByText("Waiting for Studio to come online.")));
  assert.ok(screen.queryByTestId("agent-archive-delete-workspace-button") === null, "one op at a time");
});

test("a slow delete says the Computer is still deleting, not that it failed", async () => {
  seed();
  api.get = (async () => ({ data: { archive: archiveView({ pendingOp: "delete", lastErrorCode: "ARCHIVE_DELETE_TIMED_OUT" }) } })) as typeof api.get;
  renderWithShell(<AgentArchiveSection agent={{ ...agent, deletedAt: "2026-10-12T10:00:00.000Z" }} canManage />);
  assert.match((await screen.findByTestId("agent-archive-error")).textContent ?? "", /Studio is still deleting the workspace/);
});

test("a delete given up after timeouts says it may be done and offers asking again", async () => {
  seed();
  api.get = (async () => ({ data: { archive: archiveView({ lastErrorCode: "ARCHIVE_DELETE_UNCONFIRMED" }) } })) as typeof api.get;
  renderWithShell(<AgentArchiveSection agent={{ ...agent, deletedAt: "2026-10-12T10:00:00.000Z" }} canManage />);
  assert.match((await screen.findByTestId("agent-archive-error")).textContent ?? "", /may still be deleting, or may be done/);
  assert.ok(screen.getByTestId("agent-archive-delete-workspace-button"));
});

test("viewers without archive rights see the state but no actions, and a failed delete is explained", async () => {
  seed();
  api.get = (async () => ({ data: { archive: archiveView({ lastErrorCode: "ARCHIVE_ATTEMPTS_EXHAUSTED" }) } })) as typeof api.get;
  renderWithShell(<AgentArchiveSection agent={{ ...agent, deletedAt: "2026-10-12T10:00:00.000Z" }} canManage={false} />);
  assert.match((await screen.findByTestId("agent-archive-error")).textContent ?? "", /last workspace operation failed/);
  assert.ok(screen.queryByTestId("agent-archive-delete-workspace-button") === null);
});

test("an archived agent's workspace tab explains a deleted workspace and an offline Computer", async () => {
  const { default: AgentWorkspace } = await import("../src/components/agent/AgentWorkspace");
  api.get = (async () => {
    throw Object.assign(new Error("409"), { response: { status: 409, data: { code: "archive_workspace_unavailable" } } });
  }) as typeof api.get;
  const view = renderWithShell(<AgentWorkspace agentId="agent-1" />);
  assert.match((await screen.findByTestId("agent-workspace-load-error")).textContent ?? "", /deleted from its Computer, so there is nothing to browse/);
  assert.ok(screen.queryByRole("button", { name: "Retry" }) === null, "nothing to retry");
  view.unmount();

  api.get = (async () => {
    throw Object.assign(new Error("409"), { response: { status: 409, data: { code: "machine_offline" } } });
  }) as typeof api.get;
  renderWithShell(<AgentWorkspace agentId="agent-1" />);
  assert.match((await screen.findByTestId("agent-workspace-load-error")).textContent ?? "", /offline/);
  assert.ok(screen.getByRole("button", { name: "Retry" }), "it can come back online");
});

test("Settings lists archived agents like archived channels: name, archive date, workspace, and a browse button", async () => {
  useServerStore.setState({
    current: { id: "server-1", name: "Server", slug: "server", ownerId: "user-1", role: "owner", plan: "pro" },
    members: [{ userId: "user-1", name: "ada", displayName: "Ada" }],
  } as never);
  api.get = (async (url: string) => {
    assert.equal(url, "/agents/archived");
    return {
      data: {
        agents: [{
          agentId: "agent-9",
          name: "old-helper",
          displayName: "Old Helper",
          avatarUrl: null,
          creatorType: "user",
          creatorId: "user-1",
          createdAt: "2026-09-01T10:00:00.000Z",
          archivedAt: "2026-10-12T10:00:00.000Z",
          archivedByUserId: "user-1",
          workspaceState: "on_computer",
          pendingOp: null,
          machineName: "Studio",
        }, {
          agentId: "agent-8",
          name: "gone",
          displayName: null,
          avatarUrl: null,
          creatorType: "user",
          creatorId: "user-1",
          createdAt: "2026-09-01T10:00:00.000Z",
          archivedAt: "2026-10-11T10:00:00.000Z",
          archivedByUserId: null,
          workspaceState: "deleted",
          pendingOp: null,
          machineName: "Studio",
        }],
      },
    };
  }) as typeof api.get;
  renderWithShell(<ArchivedAgentsSection />);
  const row = await screen.findByTestId("archived-agent-row-agent-9");
  assert.ok(within(row).getByRole("button", { name: "Open Old Helper" }));
  assert.match(row.textContent ?? "", /Archived .* · Workspace on Studio/);
  assert.ok(within(row).getByRole("button", { name: "View the workspace of Old Helper" }));
  const gone = screen.getByTestId("archived-agent-row-agent-8");
  assert.match(gone.textContent ?? "", /Workspace deleted/);
  assert.ok(within(gone).queryByRole("button", { name: "View the workspace of gone" }) === null, "nothing to browse");
});


test("an archived agent's profile names the Computer it last ran on", async () => {
  const { renderHook, waitFor: waitForHook } = await import("@testing-library/react");
  const { useArchivedAgentMachineName } = await import("../src/components/agentArchive/useArchivedAgentMachineName");
  api.get = (async () => ({ data: { archive: archiveView({ machineName: "Studio Mac" }) } })) as typeof api.get;
  const archived = renderHook(() => useArchivedAgentMachineName("agent-1"));
  await waitForHook(() => assert.equal(archived.result.current, "Studio Mac"));
  const live = renderHook(() => useArchivedAgentMachineName(null));
  assert.equal(live.result.current, null);
});
