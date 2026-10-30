// Channel card (RFC 072 passive resource "channel", policy "once"; glimpse
// G1). On read: the first read of a channel, or of a thread in it, in a model
// context carries the channel's card, and so does the first read after the
// card changed; reading never waits on it. On send: the send names the card
// version its context has; the Server holds a send whose context never saw
// the card, and returns a changed card with the reply.
//
// Off unless the daemon switched passive AX on for this launch. A runtime
// that compacts without telling the daemon gets the card on every read and
// is never held for it: its contextId cannot bound "already shown".
import type { ChannelCard } from "@botiverse/raft-shared";
import {
  agentChannelRef,
  channelCardRev,
  isLocalStateAgentId,
  parseRaftRefTarget,
} from "@botiverse/raft-shared/src/agentCliSurface";

import type { CliIo } from "../core/io";
import { flushText } from "../core/renderer";
import { claimObservation, probeLedgerWritable, readObservation, recordObservation, releaseObservation } from "../state/agentLedger";
import { enabledContextSignal } from "./passiveEngine";

export interface ChannelCardForRead {
  /** The card to print before the read, or null. */
  card: { card: ChannelCard; changed: boolean } | null;
  /**
   * Call after writing the output: when it did not reach stdout, the card
   * this call recorded counts as not shown.
   */
  settle: (io: CliIo) => Promise<void>;
}

const NONE: ChannelCardForRead = { card: null, settle: async () => {} };

export function channelCardForRead(
  card: ChannelCard | undefined,
  agentId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ChannelCardForRead {
  if (!card?.name || !agentId || !isLocalStateAgentId(agentId)) return NONE;
  const signal = enabledContextSignal(env);
  if (!signal) return NONE;
  if (!signal.compactionReported) return { card: { card, changed: false }, settle: async () => {} };
  const { contextId } = signal;
  // Keyed by the channel's ref, the base of every target in it, so a send to
  // `#ops` or `#ops:<thread>` can look it up; a rename is a new card anyway.
  const id = agentChannelRef(card.name, card.type);
  const rev = channelCardRev(card);
  const before = readObservation(agentId, "channel", id, env);
  // A ledger error claims `true`: showing the card once too often is the safe direction.
  const claimed = claimObservation(agentId, "channel", id, rev, contextId, env) ?? true;
  if (!claimed) return NONE;
  return {
    card: { card, changed: before?.contextId === contextId && before.rev !== rev },
    settle: async (io) => {
      if (!(await flushText(io))) releaseObservation(agentId, "channel", id, rev, contextId, env);
    },
  };
}

export interface ChannelCardForSend {
  /** `seenCards` for the send request: the card version this context saw, or null. */
  seenCards: { channel: string | null };
  /** The context the version was read for; a card shown in the reply is recorded under it. */
  contextId: string;
}

/** `#ops` and `#ops:<thread>` belong to `#ops`; DMs and agent events have no channel card. */
export function channelRefOfTarget(target: string): string | undefined {
  const ref = parseRaftRefTarget(target);
  return ref?.kind === "channel" || ref?.kind === "channel-thread" ? `#${ref.channelName}` : undefined;
}

/**
 * What a send says about the target channel's card, or undefined to say
 * nothing (today's behavior: no card check). Not said when passive AX is off,
 * when the runtime does not report compaction (those get the card on every
 * read instead), or when a card the Server holds the send for could not be
 * recorded afterwards: a hold that can never be released would never release.
 */
export function channelCardForSend(
  agentId: string | undefined,
  target: string,
  env: NodeJS.ProcessEnv = process.env,
): ChannelCardForSend | undefined {
  if (!agentId || !isLocalStateAgentId(agentId)) return undefined;
  const ref = channelRefOfTarget(target);
  if (!ref) return undefined;
  const signal = enabledContextSignal(env);
  if (!signal?.compactionReported) return undefined;
  const { contextId } = signal;
  const seen = readObservation(agentId, "channel", ref, env);
  if (seen?.contextId === contextId) return { seenCards: { channel: seen.rev }, contextId };
  if (!probeLedgerWritable(agentId, env)) return undefined;
  return { seenCards: { channel: null }, contextId };
}

/**
 * Record a card shown in a send's reply, once that output reached stdout:
 * under the channel's ref and, when the target spelled the channel
 * differently (a thread short id resolves whatever channel part it carries),
 * under the target's ref too, so the next send to that target finds it.
 */
export async function recordChannelCardShown(
  agentId: string,
  card: ChannelCard,
  contextId: string,
  target: string,
  io: CliIo,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!(await flushText(io))) return;
  const rev = channelCardRev(card);
  const ref = agentChannelRef(card.name, card.type);
  recordObservation(agentId, "channel", ref, rev, contextId, env);
  const targetRef = channelRefOfTarget(target);
  if (targetRef && targetRef !== ref) recordObservation(agentId, "channel", targetRef, rev, contextId, env);
}
