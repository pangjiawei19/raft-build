import type { AgentInboxAppItem, AgentMessage } from "@botiverse/raft-shared";
import { REMINDER_INBOX_APP_ID } from "./apps/reminder/inboxDefinition";

/**
 * What woke a turn and how long it waited, for the end-to-end wake latency
 * view (trace gap T4). Only a kind and millisecond counts; no ids or content.
 *
 * - `trigger_age_ms`: turn start − creation of the OLDEST trigger in the
 *   batch. Message timestamps come from the Server clock, so a machine with a
 *   skewed clock skews this; negative values are kept as-is so they can be
 *   filtered out instead of being hidden at 0. App inbox items are minted on
 *   this machine, so their age is on one clock.
 * - `local_wait_ms`: turn start − when this daemon received the oldest
 *   trigger. Local clock only, so it is immune to skew and shows the part of
 *   the wait spent on this machine (e.g. the agent busy with a prior turn).
 */
export type TurnTriggerKind = "message" | "mention" | "reminder" | "wake_hint" | "app" | "other";

const WAKE_HINT_APP_IDS: ReadonlySet<string> = new Set(["system.cleaner"]);

export function turnTriggerKindForAppId(appId: string): TurnTriggerKind {
  if (appId === REMINDER_INBOX_APP_ID) return "reminder";
  if (WAKE_HINT_APP_IDS.has(appId)) return "wake_hint";
  return "app";
}

function oldest(values: readonly (number | undefined)[]): number | undefined {
  let min: number | undefined;
  for (const value of values) {
    if (value === undefined || !Number.isFinite(value)) continue;
    if (min === undefined || value < min) min = value;
  }
  return min;
}

function ageAttrs(nowMs: number, createdMs: number | undefined, receivedMs: number | undefined): Record<string, number> {
  return {
    ...(createdMs !== undefined ? { trigger_age_ms: Math.round(nowMs - createdMs) } : {}),
    ...(receivedMs !== undefined ? { local_wait_ms: Math.max(0, Math.round(nowMs - receivedMs)) } : {}),
  };
}

export function messageTurnTriggerAttrs(
  messages: readonly AgentMessage[] | undefined,
  nowMs: number,
  receivedAtMs: (message: AgentMessage) => number | undefined,
): Record<string, unknown> {
  if (!messages || messages.length === 0) return { trigger_kind: "other" };
  const kind: TurnTriggerKind = messages.some((message) => message.mentioned === true)
    ? "mention"
    : messages.every((message) => message.sender_type === "third_party_app") ? "app" : "message";
  return {
    trigger_kind: kind,
    ...ageAttrs(
      nowMs,
      oldest(messages.map((message) => Date.parse(message.timestamp))),
      oldest(messages.map(receivedAtMs)),
    ),
  };
}

export function appInboxTurnTriggerAttrs(
  items: readonly AgentInboxAppItem[],
  nowMs: number,
): Record<string, unknown> {
  if (items.length === 0) return { trigger_kind: "other" };
  const first = items.reduce((a, b) => ((b.createdAtMs ?? Infinity) < (a.createdAtMs ?? Infinity) ? b : a));
  const createdMs = oldest(items.map((item) => item.createdAtMs));
  // The item is written to the local inbox when it is minted, so mint time
  // is also receive time.
  return { trigger_kind: turnTriggerKindForAppId(first.appId), ...ageAttrs(nowMs, createdMs, createdMs) };
}
