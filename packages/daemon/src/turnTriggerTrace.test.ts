import assert from "node:assert/strict";
import { test } from "vitest";
import type { AgentInboxAppItem, AgentMessage } from "@botiverse/raft-shared";
import { appInboxTurnTriggerAttrs, messageTurnTriggerAttrs } from "./turnTriggerTrace";

const NOW = Date.parse("2026-10-16T12:00:10.000Z");

function message(overrides: Partial<AgentMessage>): AgentMessage {
  return {
    channel_id: "c", channel_name: "general", channel_type: "channel",
    sender_id: "u", sender_name: "richard", sender_type: "human",
    content: "x", timestamp: "2026-10-16T12:00:00.000Z", ...overrides,
  };
}

test("no message is an `other` trigger with no age", () => {
  assert.deepEqual(messageTurnTriggerAttrs(undefined, NOW, () => undefined), { trigger_kind: "other" });
});

test("age comes from the oldest message; any mention makes it a mention", () => {
  const older = message({ timestamp: "2026-10-16T12:00:00.000Z" });
  const newer = message({ timestamp: "2026-10-16T12:00:05.000Z", mentioned: true });
  const received = new Map([[older, NOW - 3_000], [newer, NOW - 1_000]]);
  assert.deepEqual(messageTurnTriggerAttrs([newer, older], NOW, (m) => received.get(m)), {
    trigger_kind: "mention", trigger_age_ms: 10_000, local_wait_ms: 3_000,
  });
});

test("a skewed clock keeps a negative age instead of hiding it at 0", () => {
  const future = message({ timestamp: "2026-10-16T12:00:12.000Z" });
  assert.deepEqual(messageTurnTriggerAttrs([future], NOW, () => undefined), { trigger_kind: "message", trigger_age_ms: -2_000 });
});

test("third-party app events are their own kind", () => {
  assert.equal(messageTurnTriggerAttrs([message({ sender_type: "third_party_app" })], NOW, () => undefined).trigger_kind, "app");
});

test("app inbox items map reminder, cleaner hint and other apps", () => {
  const item = (appId: string, createdAtMs: number) => ({ appId, createdAtMs }) as AgentInboxAppItem;
  assert.deepEqual(appInboxTurnTriggerAttrs([item("system.cleaner", NOW - 50), item("system.reminder", NOW - 400)], NOW), {
    trigger_kind: "reminder", trigger_age_ms: 400, local_wait_ms: 400,
  });
  assert.equal(appInboxTurnTriggerAttrs([item("system.cleaner", NOW)], NOW).trigger_kind, "wake_hint");
  assert.equal(appInboxTurnTriggerAttrs([item("acme.app", NOW)], NOW).trigger_kind, "app");
});
