// The channel card on `message read` (passive resource "channel", policy
// "once"; glimpse G1): first read of a channel in a model context, and the
// first read after the card changed.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, test } from "vitest";

import type { ApiResponse } from "../../client";
import type { AgentContext } from "../../auth/env";
import { createCommandContext } from "../../core/context";
import type { CliIo } from "../../core/io";
import { readObservation } from "../../state/agentLedger";
import { messageReadCommand } from "./read";

const AGENT = "agent-channel-card";
const ENV_KEYS = ["SLOCK_CLI_STATE_DIR", "SLOCK_CLI_CONSUMED_SEQ_STATE_DIR", "SLOCK_CLI_DRAFT_STATE_DIR", "SLOCK_CLI_TRANSPORT_DIR", "RAFT_HOME"] as const;
let prior: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
let root = "";
let transportDir = "";

beforeEach(() => {
  prior = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  root = fs.mkdtempSync(path.join(os.tmpdir(), "raft-cli-channel-card-"));
  transportDir = path.join(root, "transport");
  fs.mkdirSync(transportDir, { recursive: true, mode: 0o700 });
  for (const key of ["SLOCK_CLI_STATE_DIR", "SLOCK_CLI_CONSUMED_SEQ_STATE_DIR", "SLOCK_CLI_DRAFT_STATE_DIR"] as const) {
    process.env[key] = path.join(root, "state");
  }
  process.env.RAFT_HOME = root;
  delete process.env.SLOCK_CLI_TRANSPORT_DIR;
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (prior[key] === undefined) delete process.env[key];
    else process.env[key] = prior[key];
  }
});

function context(contextId: string | null, opts: { passiveAx?: boolean; compactionReported?: boolean } = {}): void {
  if (contextId === null) {
    delete process.env.SLOCK_CLI_TRANSPORT_DIR;
    return;
  }
  process.env.SLOCK_CLI_TRANSPORT_DIR = transportDir;
  fs.writeFileSync(
    path.join(transportDir, "context-generation"),
    JSON.stringify({
      contextId,
      reason: "spawn",
      compactionReported: opts.compactionReported ?? true,
      runtime: "claude",
      writtenAt: "t",
      passiveAx: opts.passiveAx ?? true,
    }),
    { mode: 0o600 },
  );
}

const agentContext: AgentContext = {
  agentId: AGENT,
  serverUrl: "https://slock.example",
  serverId: "server-1",
  token: "secret-token",
  clientMode: "self-hosted-runner",
  secretSource: "profile-credential-file",
  activeCapabilities: null,
};

const card = (description = "Release coordination. Post go/no-go here.") => ({ id: "c-ops", name: "ops", type: "channel", description });
const CARD_LINE = "Channel #ops (public): Release coordination. Post go/no-go here.\nEquivalent: raft channel info \"#ops\"\n\n";

async function read(channelCard: unknown, opts: { failStdout?: boolean; target?: string } = {}): Promise<string> {
  const stdout: string[] = [];
  const io: CliIo = {
    stdout: opts.failStdout
      ? { write: (_chunk: string | Uint8Array, callback?: (error?: Error | null) => void) => { callback?.(new Error("EPIPE")); return false; } } as never
      : { write: (chunk: string | Uint8Array) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  };
  const ctx = createCommandContext({
    io,
    loadAgentContext: () => agentContext,
    createApiClient: () => ({
      request: async (): Promise<ApiResponse<unknown>> => ({
        ok: true,
        status: 200,
        error: null,
        data: {
          messages: [{ seq: 1, id: "00000001-0000-0000-0000-000000000000", createdAt: "2026-10-15T00:00:00.000Z", senderType: "human", senderName: "ana", content: "hi" }],
          has_more: false,
          has_older: false,
          has_newer: false,
          ...(channelCard ? { channel_card: channelCard } : {}),
        },
      }),
    }) as never,
  });
  await messageReadCommand.handler(ctx, { target: opts.target ?? "#ops" });
  return stdout.join("");
}

test("passive AX off, no context signal, or no card from the Server: the read is unchanged", async () => {
  context(null);
  assert.ok(!(await read(card())).includes("Channel #ops"));
  context("ctx-A", { passiveAx: false });
  assert.ok(!(await read(card())).includes("Channel #ops"));
  context("ctx-A");
  assert.ok(!(await read(undefined)).includes("Channel #ops"));
});

test("the first read in a context carries the card first; later reads do not", async () => {
  context("ctx-A");
  const first = await read(card());
  assert.ok(first.startsWith(CARD_LINE), first);
  assert.ok(!(await read(card())).includes("Channel #ops"));
  // A thread in the channel carries the same card, so it is not repeated there either.
  assert.ok(!(await read(card(), { target: "#ops:1a2b3c4d" })).includes("Channel #ops"));
  // Keyed by the channel ref, the base of every target in it, so a send can find it.
  assert.equal(readObservation(AGENT, "channel", "#ops")?.contextId, "ctx-A");
});

test("a changed card comes again, marked as changed; a new context starts over", async () => {
  context("ctx-A");
  await read(card());
  const changed = await read(card("Release coordination only."));
  assert.ok(changed.startsWith("Channel #ops (public), changed since you last saw it: Release coordination only.\n"), changed);
  assert.ok(!(await read(card("Release coordination only."))).includes("Channel #ops"));
  context("ctx-B");
  const fresh = await read(card("Release coordination only."));
  assert.ok(fresh.startsWith("Channel #ops (public): Release coordination only.\n"), fresh);
});

test("a runtime that does not report compaction gets the card on every read", async () => {
  context("ctx-A", { compactionReported: false });
  assert.ok((await read(card())).startsWith(CARD_LINE));
  assert.ok((await read(card())).startsWith(CARD_LINE));
});

test("a card that never reached stdout is not recorded as shown", async () => {
  context("ctx-A");
  await read(card(), { failStdout: true });
  assert.ok((await read(card())).startsWith(CARD_LINE));
});
