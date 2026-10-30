import "./helpers/domSetup";

import assert from "node:assert/strict";

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  AGENT_MIGRATION_FEATURE_FLAG_KEY,
  AGENT_MIGRATION_HOSTED_FEATURE_FLAG_KEY,
  ANTIPROTON_HOSTED_RUNTIME_FEATURE_FLAG_KEY,
} from "@botiverse/raft-shared";
import api from "../src/api/client";
import { en as enMessages } from "../src/i18n/messages/en";
import { zhCn as zhMessages } from "../src/i18n/messages/zh-cn";
import {
  makeAgent,
  renderPanel,
  resetAgentDetailPanelState,
  seedPanelState,
  stubAgentDetailApi,
} from "./helpers/agentDetailPanelHarness";

afterEach(resetAgentDetailPanelState);

const MIGRATION_REF = "mig_abcdefghijklmnopqrstuv";

/** Migration, the hosted target flag and the cloud runtime flag; `hosted: false` turns only the hosted target off. */
function stubFlags(options: { hosted?: boolean } = {}) {
  const posts: Array<{ url: string; body: unknown }> = [];
  const hosted = options.hosted ?? true;
  api.post = async (url: string, body?: unknown) => {
    posts.push({ url, body });
    if (url === "/feature-flags/evaluate") {
      return {
        data: {
          evaluations: [
            { key: AGENT_MIGRATION_FEATURE_FLAG_KEY, enabled: true },
            { key: AGENT_MIGRATION_HOSTED_FEATURE_FLAG_KEY, enabled: hosted },
            { key: ANTIPROTON_HOSTED_RUNTIME_FEATURE_FLAG_KEY, enabled: true },
          ],
        },
      } as never;
    }
    if (url === "/agents/agent-1/migrate") {
      return {
        data: {
          migrationRef: MIGRATION_REF,
          state: "provisioning",
          sourceMachineId: "source-machine",
          targetMachineId: null,
        },
      } as never;
    }
    throw new Error(`unexpected POST ${url}`);
  };
  return posts;
}

/** The harness GETs plus the cloud runtime's availability and model list. */
function stubCloudRuntime(models: { picker?: boolean } = { picker: false }) {
  const harnessGet = api.get;
  api.get = async (url: string, config?: unknown) => {
    if (url === "/agent-runtime-providers/antiproton") return { data: { available: true } } as never;
    if (url === "/agent-runtime-providers/antiproton/models") {
      return { data: { models: [], default: null, defaultLabel: null, locked: false, ...models } } as never;
    }
    return harnessGet(url, config as never);
  };
}

async function openStartDialog(name: RegExp | string) {
  const section = await screen.findByTestId("agent-migration-section");
  fireEvent.click(await within(section).findByRole("button", { name }));
  return screen.getByRole("dialog");
}

async function targetOptions(label: string) {
  const selector = screen.getByRole("combobox", { name: label }) as HTMLInputElement;
  selector.focus();
  fireEvent.keyDown(selector, { key: "ArrowDown" });
  const listbox = (await screen.findAllByRole("listbox", { hidden: true })).at(-1)!;
  return within(listbox).getAllByRole("option", { hidden: true });
}

function reviewNotice(overrides: Record<string, unknown> = {}) {
  return {
    agentId: "agent-1",
    migrationRef: MIGRATION_REF,
    state: "in_transit",
    revision: 6,
    targetKind: "hosted",
    sourceMachineId: "source-machine",
    targetMachineId: null,
    readyAt: "2026-07-20T08:00:00.000Z",
    transferDeadlineAt: "2026-07-21T08:00:00.000Z",
    updatedAt: "2026-07-20T08:05:00.000Z",
    hosted: {
      provider: "antiproton",
      hostedModel: null,
      reviewReadyAt: "2026-07-20T08:05:00.000Z",
      reviewConfirmedAt: null,
      importSummary: {
        importedFileCount: 12,
        importedBytes: 4096,
        skipped: [
          {
            reason: "git",
            count: 7,
            bytes: 2048,
            largestPaths: ["repo/.git/objects/pack/a.pack", "repo/.git/index"],
          },
          { reason: "not_text", count: 1, bytes: 512, largestPaths: ["build/app.bin"] },
        ],
      },
    },
    ...overrides,
  };
}

test("the start dialog offers the cloud only when the server allows moving agents there", async () => {
  const agent = seedPanelState("server-hosted-flag-off");
  stubAgentDetailApi();
  stubCloudRuntime();
  stubFlags({ hosted: false });

  renderPanel(agent);

  await openStartDialog("Move to another Computer");
  const labels = (await targetOptions("Target computer")).map((option) => option.textContent?.trim());
  assert.deepEqual(labels, ["Target Computer"]);
});

test("choosing the cloud says what happens up front and starts a move to the cloud", async () => {
  const agent = seedPanelState("server-hosted-start");
  stubAgentDetailApi();
  stubCloudRuntime();
  const posts = stubFlags();

  renderPanel(agent);

  const dialog = await openStartDialog("Move agent");
  assert.ok(within(dialog).getByRole("heading", { name: "Move agent" }));
  const cloud = (await targetOptions("Move to")).find((option) => option.textContent?.trim() === "Cloud");
  assert.ok(cloud, "the cloud is a target beside the computers");
  fireEvent.pointerDown(cloud, { pointerType: "mouse" });
  fireEvent.click(cloud);

  const notes = await within(dialog).findByTestId("agent-migration-hosted-notes");
  const text = notes.textContent ?? "";
  assert.match(text, /The agent stops on Source Computer while the cloud checks its files/);
  assert.match(text, /stored in the cloud, and the copy on Source Computer will be archived/);
  assert.match(text, /session context isn't carried over/);
  assert.match(text, /reconnect GitHub once/);
  assert.match(text, /can't be undone/);
  assert.doesNotMatch(dialog.textContent ?? "", /hosted|antiproton|atpt|no computer/i);

  const start = within(dialog).getByRole("button", { name: "Move to the cloud" });
  await waitFor(() => assert.equal((start as HTMLButtonElement).disabled, false));
  fireEvent.click(start);
  await waitFor(() => {
    assert.deepEqual(
      posts.find((post) => post.url === "/agents/agent-1/migrate")?.body,
      { target: { kind: "hosted" } },
    );
  });
});

test("the review lists what moves and what stays, and Confirm sends the revision it was shown at", async () => {
  const agent = seedPanelState("server-hosted-review");
  const confirmed = reviewNotice({
    state: "arriving",
    revision: 7,
    flippedAt: "2026-07-20T08:10:00.000Z",
    hosted: { ...reviewNotice().hosted, reviewConfirmedAt: "2026-07-20T08:10:00.000Z" },
  });
  let current: unknown = reviewNotice();
  stubAgentDetailApi();
  const harnessGet = api.get;
  api.get = async (url: string, config?: unknown) => {
    if (url === "/agents/agent-1/migration") return { data: { migration: current } } as never;
    return harnessGet(url, config as never);
  };
  const posts = stubFlags();
  const flagPost = api.post;
  api.post = async (url: string, body?: unknown) => {
    if (url === "/agents/agent-1/migration/confirm-hosted") {
      posts.push({ url, body });
      current = confirmed;
      return { data: { migration: confirmed } } as never;
    }
    return flagPost(url, body);
  };

  renderPanel(agent);

  const review = await screen.findByTestId("hosted-migration-review");
  assert.ok(screen.getByRole("heading", { name: "Moving to the cloud" }));
  assert.equal(within(review).getByTestId("hosted-migration-review-imported").textContent, "12 files (4.0 KB)");
  const [git, notText] = within(review).getAllByTestId("hosted-migration-review-skipped");
  assert.ok(within(git).getByText("Left behind: Git data (.git)"));
  assert.ok(within(git).getByText("7 files (2.0 KB)"));
  assert.ok(within(git).getByText("repo/.git/objects/pack/a.pack"));
  assert.ok(within(git).getByText("and 5 more"));
  assert.ok(within(notText).getByText("Left behind: Not text"));
  assert.ok(within(notText).getByText("1 file (512 B)"));
  // The review owns the only Cancel while it waits.
  const section = screen.getByTestId("agent-migration-section");
  assert.equal(within(section).getAllByRole("button", { name: "Cancel" }).length, 1);

  fireEvent.click(within(review).getByRole("button", { name: "Confirm and move" }));
  await waitFor(() => {
    assert.deepEqual(posts.find((post) => post.url === "/agents/agent-1/migration/confirm-hosted")?.body, {
      migrationRef: MIGRATION_REF,
      expectedRevision: 6,
    });
  });
  await waitFor(() => assert.ok(screen.queryByTestId("hosted-migration-review") === null));
  assert.ok(screen.getByText("Switching the agent to the cloud."));
  // After the switch there is nothing to cancel.
  assert.ok(within(section).queryByRole("button", { name: "Cancel" }) === null);
});

test("a stale confirm re-reads the status and says the migration changed", async () => {
  const agent = seedPanelState("server-hosted-review-stale");
  let statusCalls = 0;
  stubAgentDetailApi();
  const harnessGet = api.get;
  api.get = async (url: string, config?: unknown) => {
    if (url === "/agents/agent-1/migration") {
      statusCalls += 1;
      return { data: { migration: reviewNotice({ revision: statusCalls === 1 ? 6 : 8 }) } } as never;
    }
    return harnessGet(url, config as never);
  };
  stubFlags();
  const flagPost = api.post;
  api.post = async (url: string, body?: unknown) => {
    if (url === "/agents/agent-1/migration/confirm-hosted") {
      const error = new Error("stale") as Error & { response?: { status: number; data: { code: string; error: string } } };
      error.response = { status: 409, data: { code: "MIGRATION_REVISION_STALE", error: "The migration changed since this review was shown" } };
      throw error;
    }
    return flagPost(url, body);
  };

  renderPanel(agent);

  const review = await screen.findByTestId("hosted-migration-review");
  const callsBefore = statusCalls;
  fireEvent.click(within(review).getByRole("button", { name: "Confirm and move" }));
  await within(review).findByText("The migration changed before this action completed. Refresh and try again.");
  assert.ok(statusCalls > callsBefore, "the stale confirm re-reads the migration status");
});

test("a cloud agent keeps showing the move that brought it there, without migration actions", async () => {
  const agent = seedPanelState(
    "server-hosted-arrival",
    makeAgent({
      serverId: "server-hosted-arrival",
      external: true,
      runtime: "external",
      machineId: null,
      hostedRuntime: { provider: "antiproton", state: "provisioning" } as never,
    }),
  );
  stubAgentDetailApi(reviewNotice({
    state: "arriving",
    revision: 7,
    flippedAt: "2026-07-20T08:10:00.000Z",
    hosted: { ...reviewNotice().hosted, reviewConfirmedAt: "2026-07-20T08:10:00.000Z" },
  }));
  stubFlags();

  renderPanel(agent);

  const section = await screen.findByTestId("agent-migration-section");
  await within(section).findByRole("list", { name: "Progress of the move to the cloud" });
  assert.ok(within(section).getByText("Switching the agent to the cloud."));
  assert.ok(within(section).queryByRole("button", { name: /Move/ }) === null);
  assert.ok(within(section).queryByRole("button", { name: "Cancel" }) === null);
});

for (const [label, completedAt, visible] of [
  ["recent", () => new Date(Date.now() - 60 * 60_000).toISOString(), true],
  ["over a day old", () => new Date(Date.now() - 25 * 60 * 60_000).toISOString(), false],
] as const) {
  test(`a cloud agent shows a completed move to the cloud by completedAt (${label})`, async () => {
    const serverId = `server-hosted-completed-${visible ? "recent" : "old"}`;
    const agent = seedPanelState(serverId, makeAgent({
      serverId,
      external: true,
      runtime: "external",
      machineId: null,
      hostedRuntime: { provider: "antiproton", state: "provisioning" } as never,
    }));
    let statusCalls = 0;
    stubAgentDetailApi();
    const harnessGet = api.get;
    api.get = async (url: string, config?: unknown) => {
      if (url === "/agents/agent-1/migration") {
        statusCalls += 1;
        return {
          data: {
            migration: reviewNotice({
              state: "completed",
              revision: 9,
              flippedAt: "2026-07-20T08:10:00.000Z",
              // updatedAt is always recent here: only completedAt may date the banner.
              updatedAt: new Date().toISOString(),
              completedAt: completedAt(),
            }),
          },
        } as never;
      }
      return harnessGet(url, config as never);
    };
    stubFlags();

    renderPanel(agent);

    await waitFor(() => assert.ok(statusCalls > 0));
    if (visible) {
      const section = await screen.findByTestId("agent-migration-section");
      assert.ok(within(section).getByRole("heading", { name: "Moved to the cloud" }));
    } else {
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.ok(screen.queryByTestId("agent-migration-section") === null);
    }
  });
}

test("a cloud agent with no move to the cloud shows no migration section", async () => {
  const agent = seedPanelState(
    "server-hosted-native",
    makeAgent({
      serverId: "server-hosted-native",
      external: true,
      runtime: "external",
      machineId: null,
      hostedRuntime: { provider: "antiproton", state: "active" } as never,
    }),
  );
  let statusCalls = 0;
  stubAgentDetailApi();
  const harnessGet = api.get;
  api.get = async (url: string, config?: unknown) => {
    if (url === "/agents/agent-1/migration") {
      statusCalls += 1;
      return { data: { migration: null } } as never;
    }
    if (url.includes("/hosted-runtime/usage")) return { data: { rows: [] } } as never;
    return harnessGet(url, config as never);
  };
  stubFlags();

  renderPanel(agent);

  await waitFor(() => assert.ok(statusCalls > 0));
  assert.ok(screen.queryByTestId("agent-migration-section") === null);
});

test("the review renders in zh-CN", async () => {
  const agent = seedPanelState("server-hosted-review-zh");
  stubAgentDetailApi(reviewNotice());
  stubFlags();

  renderPanel(agent, "zh-cn");

  const review = await screen.findByTestId("hosted-migration-review");
  assert.ok(screen.getByRole("heading", { name: "正在迁移到云端" }));
  assert.equal(within(review).getByTestId("hosted-migration-review-imported").textContent, "12 个文件（4.0 KB）");
  assert.ok(within(review).getByText("不会迁过去：Git 数据（.git）"));
  assert.ok(within(review).getByRole("button", { name: "确认迁移" }));
});

for (const [reason, copy] of [
  ["HOSTED_IMPORT_FAILED", /couldn't import the workspace files/],
  ["HOSTED_IMPORT_STALLED", /still hasn't imported the workspace files/],
  ["HOSTED_PROVIDER_FAILED", /couldn't set up the agent/],
  ["HOSTED_AGENT_DELETED", /deleted in the cloud, and the cloud can't set it up again/],
  ["HOSTED_PROVIDER_MISMATCH", /under a different account than Raft expected/],
] as const) {
  test(`a switched move stalled on ${reason} needs attention but is not over`, async () => {
    const agent = seedPanelState(`server-hosted-attention-${reason}`);
    stubAgentDetailApi(reviewNotice({
      state: "arriving",
      revision: 9,
      flippedAt: "2026-07-20T08:10:00.000Z",
      failureReason: reason,
      hosted: { ...reviewNotice().hosted, reviewConfirmedAt: "2026-07-20T08:10:00.000Z" },
    }));
    stubFlags();

    renderPanel(agent);

    const section = await screen.findByTestId("agent-migration-section");
    await within(section).findByRole("heading", { name: "Move to the cloud needs attention" });
    assert.ok(within(section).getByText("The agent is already in the cloud."));
    assert.ok(within(section).getByText(copy));
    assert.ok(within(section).getByText(/Raft team has been alerted/));
    assert.ok(within(section).getByText(/include the migration ID/));
    if (reason === "HOSTED_AGENT_DELETED") {
      // Deleted in the cloud is final for this agent: no hint that it may still finish or can be retried.
      assert.doesNotMatch(section.textContent ?? "", /can still finish|try again/i);
    }
    // The support reference is shown, the last step is not done, and there is nothing to cancel or retry.
    assert.ok(within(section).getByText(MIGRATION_REF));
    const steps = within(within(section).getByRole("list", { name: "Progress of the move to the cloud" })).getAllByRole("listitem");
    assert.equal(steps.at(-1)!.classList.contains("r-step--finish"), false);
    assert.equal(steps[3]!.getAttribute("aria-current"), "step");
    assert.ok(within(section).queryByRole("button", { name: "Cancel" }) === null);
    assert.ok(within(section).queryByRole("button", { name: /Try migration again|Move agent/ }) === null);
  });
}

test("a move the cloud never set up says the agent is back on its Computer and can retry", async () => {
  const agent = seedPanelState("server-hosted-not-created");
  stubAgentDetailApi(reviewNotice({
    state: "failed",
    revision: 10,
    flippedAt: "2026-07-20T08:10:00.000Z",
    failureReason: "HOSTED_AGENT_NOT_CREATED",
    hosted: { ...reviewNotice().hosted, reviewConfirmedAt: "2026-07-20T08:10:00.000Z" },
  }));
  stubCloudRuntime();
  stubFlags();

  renderPanel(agent);

  const section = await screen.findByTestId("agent-migration-section");
  await within(section).findByText("The agent is still on Source Computer and works as usual.");
  assert.ok(within(section).getByText(
    "The cloud never set the agent up, so Raft put it back on Source Computer unchanged. You can try again.",
  ));
  assert.ok(within(section).queryByText(/switched to the cloud but/) === null);
  assert.ok(within(section).getByRole("button", { name: "Try migration again" }));
});

test("a dropped upload to the cloud does not blame two computers", async () => {
  const agent = seedPanelState("server-hosted-transport-lost");
  stubAgentDetailApi(reviewNotice({
    state: "failed",
    revision: 5,
    readyAt: null,
    hosted: null,
    failureReason: "MIGRATION_TRANSPORT_LOST",
    transportErrorCode: "MIGRATION_TRANSPORT_LOST",
    transportLostAt: "2026-07-20T08:03:00.000Z",
  }));
  stubFlags();

  renderPanel(agent);

  const section = await screen.findByTestId("agent-migration-section");
  await within(section).findByText("The upload to the cloud was interrupted. Make sure Source Computer is online, then try again.");
  assert.ok(within(section).getByText("The agent is still on Source Computer and works as usual."));
  assert.doesNotMatch(section.textContent ?? "", /two computers|both computers/);
});

test("move-to-the-cloud copy says cloud and never names the provider or 'hosted'", () => {
  const en = enMessages as Record<string, string>;
  const zh = zhMessages as Record<string, string>;
  const ids = Object.keys(en).filter((id) => id.startsWith("agent.migration.hosted.") || id.startsWith("migration.error.hosted"));
  assert.ok(ids.length > 40);
  for (const id of ids) {
    for (const value of [en[id], zh[id]]) {
      assert.doesNotMatch(value, /hosted|antiproton|atpt|no computer/i, id);
    }
  }
});
