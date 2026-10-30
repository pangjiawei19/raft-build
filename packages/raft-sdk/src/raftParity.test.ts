// What `createRaftClient` (deprecated) offered that `createRaft` must also
// cover, so nobody migrating loses a capability: avatar upload, built-in app
// config, and creating the client from a credential store. Also: the held
// text a hosted agent sees is the one a Computer agent sees.
import assert from "node:assert/strict";
import { formatAgentHold } from "@botiverse/raft-shared";
import { createRaft, createRaftFromStore, RaftCredentialError, type RaftCredentialStore, type StoredRaftCredential } from "./index";

const credential = "sk_agent_parity_sentinel";
const secret = "server-private-detail";
const agentProfile = {
  kind: "agent", id: "agent-1", isSelf: true, name: "bobo", displayName: "BoBo",
  description: null, avatarUrl: "https://cdn.example/a.png", status: "active", serverRole: "member",
  runtime: "external", model: "external", reasoningEffort: null, executionMode: null,
  computerId: null, computerName: null, computerHostname: null, daemonVersion: null,
  creator: null, createdAgents: [], createdAt: "2026-09-27T00:00:00Z", deletedAt: null,
};
const appConfig = {
  appId: "system.cleaner", revision: 3,
  schema: { maxBytes: { type: "integer", minimum: 1, maximum: 1048576 } }, defaults: { maxBytes: 65536 }, overrides: { maxBytes: 1 }, effective: { maxBytes: 1 },
};

type Call = { url: string; method: string; body: unknown; authorization: string | null };
function recorder(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body instanceof FormData ? init.body : init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      authorization: headers.get("authorization"),
    };
    calls.push(call);
    return respond(call);
  };
  return { calls, fetch };
}

test("profile.updateAvatar uploads one multipart field and returns the profile as an outcome", async () => {
  const { calls, fetch } = recorder(() => Response.json(agentProfile));
  const raft = createRaft({ serverUrl: "https://raft.example", credential, fetch });
  const result = await raft.profile.updateAvatar({ data: new Uint8Array([137, 80, 78, 71]), filename: "avatar.png", mimeType: "image/png" });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.ok ? result.state : null, "updated");
  assert.equal(result.ok ? result.data.avatarUrl : null, "https://cdn.example/a.png");
  assert.match(result.text, /bobo/i);
  assert.deepEqual(calls.map((call) => [call.method, call.url]), [["POST", "https://raft.example/internal/agent-api/profile/avatar"]]);
  assert.equal(calls[0]!.authorization, `Bearer ${credential}`);
  assert.equal(((calls[0]!.body as FormData).get("avatar") as File).name, "avatar.png");
});

test("profile.updateAvatar refuses bad input before sending and never surfaces Server text", async () => {
  let fetches = 0;
  const raft = createRaft({
    serverUrl: "https://raft.example",
    credential,
    fetch: async () => { fetches += 1; return Response.json({ error: secret, errorCode: "avatar_too_large" }, { status: 413 }); },
  });
  const wrongType = await raft.profile.updateAvatar({ data: new Uint8Array([1]), filename: "a.svg", mimeType: "image/svg+xml" as never });
  assert.equal(wrongType.ok ? null : wrongType.error.code, "INVALID_REQUEST");
  assert.equal(fetches, 0);
  const rejected = await raft.profile.updateAvatar({ data: new Uint8Array([1]), filename: "a.png", mimeType: "image/png" });
  assert.equal(fetches, 1);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.ok ? null : rejected.error.serverCode, "avatar_too_large");
  assert.equal(JSON.stringify(rejected).includes(secret), false);
});

test("apps.getConfig / patchConfig hit the app-config routes and print the CLI's snapshot", async () => {
  const { calls, fetch } = recorder(() => Response.json(appConfig));
  const raft = createRaft({ serverUrl: "https://raft.example", credential, fetch });
  const shown = await raft.apps.getConfig({ appId: "system.cleaner" });
  const patched = await raft.apps.patchConfig({ appId: "system.cleaner", patch: { expectedRevision: 3, set: { maxBytes: 1 }, unset: [] } });
  assert.equal(shown.ok ? shown.state : null, "config");
  assert.equal(patched.ok ? patched.state : null, "updated");
  assert.equal(shown.text, [
    "App: system.cleaner",
    "Revision: 3",
    "Config:",
    "  maxBytes = 1 (override; default 65536)",
  ].join("\n"));
  assert.deepEqual(calls.map((call) => [call.method, call.url]), [
    ["GET", "https://raft.example/internal/agent-api/apps/system.cleaner/config"],
    ["PATCH", "https://raft.example/internal/agent-api/apps/system.cleaner/config"],
  ]);
  assert.deepEqual(calls[1]!.body, { expectedRevision: 3, set: { maxBytes: 1 }, unset: [] });
  const invalid = await raft.apps.getConfig({ appId: "" });
  assert.equal(invalid.ok ? null : invalid.error.code, "INVALID_REQUEST");
  assert.equal(calls.length, 2, "an invalid request sends nothing");
});

function stored(secretCredential: string): StoredRaftCredential {
  return {
    schemaVersion: 1,
    serverUrl: "https://raft.example",
    credential: secretCredential,
    storedAt: "2026-08-28T08:00:00.000Z",
    agentId: "agent-1",
    agentName: "bobo",
    agentDisplayName: "BoBo",
    serverId: "server-1",
    credentialId: "credential-1",
    scopes: ["read", "send"],
  };
}

test("createRaftFromStore builds createRaft from the saved credential and fails closed on an empty store", async () => {
  const { calls, fetch } = recorder(() => Response.json(agentProfile));
  const store: RaftCredentialStore = { load: async () => stored(credential), save: async () => undefined };
  const raft = await createRaftFromStore({ store, fetch });
  const shown = await raft.profile.show();
  assert.equal(shown.ok, true, JSON.stringify(shown));
  assert.deepEqual(calls.map((call) => [call.url, call.authorization]), [["https://raft.example/internal/agent-api/profile", `Bearer ${credential}`]]);
  await assert.rejects(
    createRaftFromStore({ store: { load: async () => null, save: async () => undefined } }),
    (error: unknown) => error instanceof RaftCredentialError && error.code === "CREDENTIAL_NOT_FOUND",
  );
});

// ── Held text: one text for hosted and Computer agents (glimpse G1-12). The
// SDK's interrupt.context is the CLI's held text (shared formatAgentHold),
// so the same Server hold reads the same for both.


const heldResponse = {
  ok: true, state: "held", decision: "syncing_hold",
  newMessageCount: 5, shownMessageCount: 2, omittedMessageCount: 3, firstShownSeq: 41, seenUpToSeq: 42,
  mentionAnnotation: { formalMentionCount: 1 },
  threadParentMessage: { seq: 30, senderName: "sample-human", createdAt: "2026-10-15T08:00:00.000Z", content: "Deploy plan" },
  heldMessages: [
    { id: "00000041-0000-0000-0000-000000000000", seq: 41, sender_type: "human", sender_name: "sample-human", timestamp: "2026-10-15T09:00:00.000Z", content: "deploy at 5?" },
    { id: "00000042-0000-0000-0000-000000000000", seq: 42, sender_type: "agent", sender_name: "sample-agent", timestamp: "2026-10-15T09:02:00.000Z", content: "canary is green" },
  ],
};

test("a held send reads the same as the CLI's held text, with tool-style commands under tool hints", async () => {
  for (const hints of ["cli", "tool"] as const) {
    const raft = createRaft({ serverUrl: "https://raft.example", credential, hints, fetch: async () => Response.json(heldResponse) });
    const outcome = await raft.messages.send({ target: "#ops:1a2b3c4d", content: "go", idempotencyKey: "k-held" });
    assert.equal(outcome.ok && outcome.state, "interrupted");
    if (!outcome.ok || outcome.state !== "interrupted") return;
    const expected = formatAgentHold("#ops:1a2b3c4d", heldResponse as never, {
      heldAction: "Your message was not sent.",
      draftInstructions: 'To send it unchanged, send it again with idempotencyKey "k-held". To change it, send the revised content instead. You can also choose not to send anything.\n',
    }, hints).trimEnd();
    assert.equal(outcome.interrupt.context, expected);
    assert.equal(outcome.text, expected);
    assert.match(expected, /┌ Thread start/);
    assert.match(expected, /├ ⋯ 3 earlier messages skipped in this notice\./);
    assert.match(expected, /│ @sample-human 09:00 {2}deploy at 5\?/);
    if (hints === "tool") {
      assert.match(expected, /Full text: messages_read\(\{ target: "#ops:1a2b3c4d" \}\)/);
      assert.match(expected, /Older exist: messages_read\(\{ target: "#ops:1a2b3c4d", before: 41 \}\)\./);
      assert.doesNotMatch(expected, /\braft [a-z]+ /, "no CLI command under tool hints");
    } else {
      assert.match(expected, /Full text: raft message read --target "#ops:1a2b3c4d"/);
    }
  }
});

test("a held task claim shows the same window, not just a count, in either hint style", async () => {
  for (const hints of ["cli", "tool"] as const) {
    const raft = createRaft({ serverUrl: "https://raft.example", credential, hints, fetch: async () => Response.json(heldResponse) });
    const outcome = await raft.tasks.claim({ target: "#ops:1a2b3c4d", taskNumbers: [7] });
    assert.equal(outcome.ok && outcome.state, "interrupted");
    if (!outcome.ok || outcome.state !== "interrupted") return;
    assert.equal(outcome.text, formatAgentHold("#ops:1a2b3c4d", heldResponse as never, {
      heldAction: "Your task claim was not applied.",
      draftInstructions: "After reviewing, rerun the claim if it is still correct.\n",
    }, hints).trimEnd());
    assert.match(outcome.text, /│ @sample-agent 09:02 {2}canary is green/);
    if (hints === "tool") assert.doesNotMatch(outcome.text, /\braft [a-z]+ /);
  }
});
