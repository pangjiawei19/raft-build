import "./helpers/domSetup";

import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ANTIPROTON_HOSTED_RUNTIME_FEATURE_FLAG_KEY } from "@botiverse/raft-shared";
import type { ComponentProps } from "react";
import CreateAgentDialog from "../src/components/agent/CreateAgentDialog";
import api from "../src/api/client";
import { resetServerFeatureFlagsForTests, setServerFeatureFlagForTests } from "../src/store/serverFeatureFlags";
import { useAgentStore } from "../src/store/agentStore";
import { useChannelStore } from "../src/store/channelStore";
import { useMachineStore } from "../src/store/machineStore";
import { useServerStore } from "../src/store/serverStore";
import { TestIntlProvider } from "./helpers/intl";

/**
 * "Hosted by Raft (Antiproton)" in the normal Create Agent form (tygg,
 * #raft-antiproton:8008c6f0): a choice next to the computers, behind the
 * `antiproton_hosted_runtime` flag, that hides the computer's runtime fields
 * and creates through the hosted path with the picked model.
 */

const originalGet = api.get;
const originalPost = api.post;

const MODELS = {
  models: [
    { id: "deepseek-flash", label: "DeepSeek Flash", provider: "deepseek" },
    { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", provider: "cloudflare" },
  ],
  default: "deepseek-flash",
  defaultLabel: "DeepSeek Flash",
  locked: false,
};

const MACHINE = {
  id: "machine-1",
  name: "Mac",
  description: null,
  status: "online",
  statusVersion: 1,
  apiKeyPrefix: null,
  runtimes: ["cursor"],
  hostname: "mac.local",
  os: "darwin",
  daemonVersion: "0.72.6",
  lastHeartbeat: "2026-07-14T00:00:00.000Z",
  createdAt: "2026-07-14T00:00:00.000Z",
};

function seed({ machines, flag, available = true, models = MODELS }: { machines: unknown[]; flag: boolean; available?: boolean; models?: unknown }) {
  useServerStore.setState({
    current: {
      id: "server-1", name: "Launch", slug: "launch", avatarUrl: null, ownerId: "owner-1", onboardingAgentId: null,
      hideHumansFromMembers: false, plan: "free", planDowngradedAt: null, role: "owner", createdAt: "2026-07-14T00:00:00.000Z",
    },
    billing: null,
    loadBilling: async () => undefined,
  } as never);
  useMachineStore.setState({ machines } as never);
  useChannelStore.setState({ channels: [] } as never);
  useAgentStore.setState({ agents: [], loading: false } as never);
  setServerFeatureFlagForTests("server-1", ANTIPROTON_HOSTED_RUNTIME_FEATURE_FLAG_KEY, flag);
  const gets: string[] = [];
  api.get = (async (url: string) => {
    gets.push(url);
    if (url === "/agent-runtime-providers/antiproton") return { data: { kind: "antiproton", available } } as never;
    if (url === "/agent-runtime-providers/antiproton/models") {
      if (models === "unavailable") throw { response: { status: 502 } };
      return { data: models } as never;
    }
    if (url.endsWith("/runtime-options")) {
      return {
        data: {
          context: "new_agent", machineId: "machine-1",
          options: [{
            runtimeId: "cursor", capabilityStatus: "available", admissionStatus: "available_for_new", admissionReason: null,
            current: false, availableForNew: true, manageableForCurrentAgent: false, canSelectInThisContext: true,
          }],
        },
      } as never;
    }
    return { data: { models: [{ id: "auto", label: "Auto" }] } } as never;
  }) as typeof api.get;
  const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
  api.post = (async (url: string, body: Record<string, unknown>) => {
    posts.push({ url, body });
    return { data: { id: "agent-new", name: body.name, status: "inactive" } } as never;
  }) as typeof api.post;
  return { gets, posts };
}

function openDialog(props: Partial<ComponentProps<typeof CreateAgentDialog>> = {}) {
  render(
    <TestIntlProvider locale="en">
      <MemoryRouter initialEntries={["/s/launch"]}>
        <CreateAgentDialog onClose={() => undefined} {...props} />
      </MemoryRouter>
    </TestIntlProvider>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  api.get = originalGet;
  api.post = originalPost;
  resetServerFeatureFlagsForTests();
  useAgentStore.setState(useAgentStore.getInitialState(), true);
  useChannelStore.setState(useChannelStore.getInitialState(), true);
  useMachineStore.setState(useMachineStore.getInitialState(), true);
  useServerStore.setState(useServerStore.getInitialState(), true);
});

test("the computer list offers hosting next to the computers; picking it swaps the runtime fields for the model", async () => {
  const { gets, posts } = seed({ machines: [MACHINE], flag: true });
  openDialog();
  const computer = (await screen.findAllByRole("combobox"))[0]!;
  fireEvent.click(computer);
  const hosted = await screen.findByRole("option", { name: "Cloud agent, runs in the cloud · Free for a limited time" });
  fireEvent.pointerDown(hosted);
  fireEvent.click(hosted);
  assert.ok(await screen.findByTestId("create-agent-hosted-runtime"));
  const model = await screen.findByTestId("create-agent-hosted-model") as HTMLInputElement;
  assert.equal(model.value, "Default (DeepSeek Flash)", "the provider's default, DeepSeek Flash, is preselected");
  assert.ok(gets.includes("/agent-runtime-providers/antiproton/models"));
  assert.ok(screen.queryByText("Cursor CLI") === null, "no runtime fields for a hosted agent");

  fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "hosted-helper" } });
  fireEvent.click(screen.getByRole("button", { name: "Create Agent" }));
  await waitFor(() => assert.equal(posts.length, 1));
  assert.equal(posts[0]!.url, "/agents");
  assert.equal(posts[0]!.body.external, true);
  assert.equal(posts[0]!.body.provider, "antiproton");
  assert.ok(!("hostedModel" in posts[0]!.body), "the default is sent as no model");
  assert.equal(posts[0]!.body.machineId, undefined);
});

test("with no computer connected, a server with hosting gets the form instead of the connect-a-computer screen", async () => {
  const { posts } = seed({ machines: [], flag: true, models: { ...MODELS, models: MODELS.models.slice(0, 1) } });
  openDialog();
  const model = await screen.findByTestId("create-agent-hosted-model") as HTMLInputElement;
  assert.equal(model.value, "Default (DeepSeek Flash)", "the default is named, not hidden");
  fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "hosted-default" } });
  fireEvent.click(screen.getByRole("button", { name: "Create Agent" }));
  await waitFor(() => assert.equal(posts.length, 1));
  assert.equal(posts[0]!.body.provider, "antiproton");
  assert.ok(!("hostedModel" in posts[0]!.body), "the default is sent as no model");
});

test("where the server may not pick a model, the form shows no picker and sends none", async () => {
  const { posts } = seed({ machines: [], flag: true, models: { ...MODELS, picker: false } });
  openDialog();
  assert.ok(await screen.findByTestId("create-agent-hosted-runtime"));
  await waitFor(() => assert.ok(screen.queryByTestId("create-agent-hosted-model") === null));
  assert.ok(screen.queryByTestId("create-agent-hosted-model-locked") === null);
  fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "hosted-raft-decides" } });
  fireEvent.click(screen.getByRole("button", { name: "Create Agent" }));
  await waitFor(() => assert.equal(posts.length, 1));
  assert.equal(posts[0]!.body.provider, "antiproton");
  assert.ok(!("hostedModel" in posts[0]!.body), "Raft picks the model on the server");
});

test("while an administrator sets the model, it is shown read-only and none is sent", async () => {
  const { posts } = seed({ machines: [], flag: true, models: { ...MODELS, locked: true } });
  openDialog();
  assert.ok(await screen.findByTestId("create-agent-hosted-model-locked"));
  fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "hosted-locked" } });
  fireEvent.click(screen.getByRole("button", { name: "Create Agent" }));
  await waitFor(() => assert.equal(posts.length, 1));
  assert.ok(!("hostedModel" in posts[0]!.body));
});

test("flag off: no hosting choice, and no computer still means the connect-a-computer screen", async () => {
  const { gets } = seed({ machines: [], flag: false });
  openDialog();
  assert.ok(await screen.findByTestId("create-agent-needs-computer"));
  assert.ok(!gets.some((url) => url.startsWith("/agent-runtime-providers")), "nothing is probed while the flag is off");
});

test("the external-agent flow no longer offers hosting", async () => {
  seed({ machines: [MACHINE], flag: true });
  render(
    <TestIntlProvider locale="en">
      <MemoryRouter initialEntries={["/s/launch"]}>
        <CreateAgentDialog external onClose={() => undefined} />
      </MemoryRouter>
    </TestIntlProvider>,
  );
  await screen.findByRole("button", { name: /external/i });
  assert.ok(screen.queryByTestId("create-agent-hosted-runtime") === null);
  assert.ok(screen.queryByText("Cloud agent, runs in the cloud · Free for a limited time") === null);
});

test("the model list being unavailable still allows creating on the default, and says the model can change later", async () => {
  const { posts } = seed({ machines: [], flag: true, models: "unavailable" });
  openDialog();
  assert.ok(await screen.findByTestId("create-agent-hosted-model-error"));
  fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "hosted-no-list" } });
  fireEvent.click(screen.getByRole("button", { name: "Create Agent" }));
  await waitFor(() => assert.equal(posts.length, 1));
  assert.equal(posts[0]!.body.provider, "antiproton");
  assert.ok(!("hostedModel" in posts[0]!.body));
});

test("an action card that presets hosting opens on hosting with the card's model, and the human can still pick a computer", async () => {
  const { posts } = seed({ machines: [MACHINE], flag: true });
  openDialog({ actionCardMessageId: "msg-card", actionCardConfirmationVersion: 1, prefilledName: "card-hosted", prefilledHosting: "antiproton", prefilledHostedModel: "deepseek-flash" });
  assert.ok(await screen.findByTestId("create-agent-hosted-runtime"));
  await waitFor(async () => assert.equal((await screen.findByTestId("create-agent-hosted-model") as HTMLInputElement).value, "DeepSeek Flash"));
  fireEvent.click(screen.getByRole("button", { name: "Create Agent" }));
  await waitFor(() => assert.equal(posts.length, 1));
  assert.equal(posts[0]!.body.provider, "antiproton");
  assert.equal(posts[0]!.body.hostedModel, "deepseek-flash");
  assert.equal(posts[0]!.body.actionCardMessageId, "msg-card");
});

test("a card's model the provider no longer offers falls back to the usual preselection", async () => {
  seed({ machines: [], flag: true });
  openDialog({ actionCardMessageId: "msg-card", prefilledHosting: "antiproton", prefilledHostedModel: "retired-model" });
  await waitFor(async () => assert.equal((await screen.findByTestId("create-agent-hosted-model") as HTMLInputElement).value, "Default (DeepSeek Flash)"));
});

test("where the server may not pick, a card's model is not sent either", async () => {
  const { posts } = seed({ machines: [], flag: true, models: { ...MODELS, picker: false } });
  openDialog({ actionCardMessageId: "msg-card", prefilledHosting: "antiproton", prefilledHostedModel: "gpt-5.6-luna" });
  assert.ok(await screen.findByTestId("create-agent-hosted-runtime"));
  fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "hosted-card" } });
  fireEvent.click(screen.getByRole("button", { name: "Create Agent" }));
  await waitFor(() => assert.equal(posts.length, 1));
  assert.ok(!("hostedModel" in posts[0]!.body));
});

test("a card without hosting still offers it next to the computers", async () => {
  seed({ machines: [MACHINE], flag: true });
  openDialog({ actionCardMessageId: "msg-card" });
  const computer = (await screen.findAllByRole("combobox"))[0]!;
  fireEvent.click(computer);
  assert.ok(await screen.findByRole("option", { name: "Cloud agent, runs in the cloud · Free for a limited time" }));
});

test("a card that requires a computer never offers hosting", async () => {
  const { gets } = seed({ machines: [MACHINE], flag: true });
  openDialog({ actionCardMessageId: "msg-card", prefilledMachineId: "machine-1", prefilledMachineMode: "required" });
  const computer = (await screen.findAllByRole("combobox"))[0]!;
  fireEvent.click(computer);
  await screen.findByRole("option", { name: /Mac/ });
  assert.ok(screen.queryByRole("option", { name: "Cloud agent, runs in the cloud · Free for a limited time" }) === null);
  assert.ok(!gets.some((url) => url.startsWith("/agent-runtime-providers")), "nothing is probed");
});
