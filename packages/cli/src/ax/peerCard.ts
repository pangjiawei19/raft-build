// DM peer card (glimpse G1): the other side of a DM is the `sender` passive
// resource (RFC 072, policy "once"), so it shares the ledger row a message
// from them claims. Only "seen in this context or not" counts for the peer:
// their zone travels with each message, so comparing versions would call
// every message from another place a change. On read: a DM read starts with
// their card when this context has seen nothing of them (no card, no message
// from them showing their description). On send: the send says whether its
// context has seen them; the Server holds a send whose context has not.
//
// Off unless the daemon switched passive AX on for this launch. A runtime
// that compacts without telling the daemon gets the card on every read whose
// window has no message from the peer, and is never held for it.
import type {
  PeerCard,
} from "@botiverse/raft-shared";
import {
  isLocalStateAgentId,
  parseDmPeerRef,
  parseRaftRefTarget,
  peerCardId,
  peerCardRev,
  senderObservationId,
} from "@botiverse/raft-shared/src/agentCliSurface";

import type { CliIo } from "../core/io";
import { flushText } from "../core/renderer";
import { claimObservation, probeLedgerWritable, readObservation, recordObservation, releaseObservation } from "../state/agentLedger";
import { enabledContextSignal } from "./passiveEngine";

export interface PeerCardForRead {
  /** The card to print before the read, or null. */
  card: { card: PeerCard; changed: boolean } | null;
  /** Call after writing the output: when it did not reach stdout, the card counts as not shown. */
  settle: (io: CliIo) => Promise<void>;
}

const NONE: PeerCardForRead = { card: null, settle: async () => {} };

interface SenderFields {
  senderType?: unknown;
  sender_type?: unknown;
  senderName?: unknown;
  sender_name?: unknown;
}

function isFromPeer(message: SenderFields, card: PeerCard): boolean {
  const type = message.senderType ?? message.sender_type;
  const name = message.senderName ?? message.sender_name;
  return type === card.kind && name === card.name;
}

/**
 * The card to print before a DM read. Call after sender elision for the
 * printed messages, so a message that just showed the peer counts as seen.
 */
export function peerCardForRead(
  card: PeerCard | undefined,
  printed: ReadonlyArray<object>,
  agentId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): PeerCardForRead {
  if (!card?.name || !agentId || !isLocalStateAgentId(agentId)) return NONE;
  const signal = enabledContextSignal(env);
  if (!signal) return NONE;
  if (!signal.compactionReported) {
    // No ledger to consult: a message from them in this window already shows them.
    return printed.some((message) => isFromPeer(message as SenderFields, card)) ? NONE : { card: { card, changed: false }, settle: async () => {} };
  }
  const { contextId } = signal;
  const id = peerCardId(card);
  if (readObservation(agentId, "sender", id, env)?.contextId === contextId) return NONE;
  const rev = peerCardRev(card);
  // A ledger error claims `true`: showing the card once too often is the safe direction.
  const claimed = claimObservation(agentId, "sender", id, rev, contextId, env) ?? true;
  if (!claimed) return NONE;
  return {
    card: { card, changed: false },
    settle: async (io) => {
      if (!(await flushText(io))) releaseObservation(agentId, "sender", id, rev, contextId, env);
    },
  };
}

/** The ledger ids a DM target's peer may have: one when the target names the kind, both when it does not. */
export function peerIdsOfTarget(target: string): string[] | undefined {
  const ref = parseRaftRefTarget(target);
  if (ref?.kind !== "dm" && ref?.kind !== "dm-thread") return undefined;
  const parsed = parseDmPeerRef(ref.peerName);
  if (!parsed.ok) return undefined;
  return parsed.peerKind
    ? [senderObservationId(parsed.peerKind, parsed.peerName)]
    : [senderObservationId("human", parsed.peerName), senderObservationId("agent", parsed.peerName)];
}

export interface PeerCardForSend {
  /** `seenCards.peer` for the send request: the version this context has, or null (not seen). */
  seen: string | null;
  contextId: string;
}

/**
 * What a send to a DM says about the peer's card, or undefined to say
 * nothing. Same conditions as the channel card: passive AX on, compaction
 * reported, and a ledger that can record a card the Server holds the send for.
 */
export function peerCardForSend(
  agentId: string | undefined,
  target: string,
  env: NodeJS.ProcessEnv = process.env,
): PeerCardForSend | undefined {
  if (!agentId || !isLocalStateAgentId(agentId)) return undefined;
  const ids = peerIdsOfTarget(target);
  if (!ids) return undefined;
  const signal = enabledContextSignal(env);
  if (!signal?.compactionReported) return undefined;
  const { contextId } = signal;
  for (const id of ids) {
    const seen = readObservation(agentId, "sender", id, env);
    if (seen?.contextId === contextId) return { seen: seen.rev, contextId };
  }
  if (!probeLedgerWritable(agentId, env)) return undefined;
  return { seen: null, contextId };
}

/**
 * Record a peer card shown in a send's reply, once that output reached
 * stdout (JSON output counts as shown): under the peer's handle and, when the
 * target names them differently (a DM thread short id resolves whatever
 * handle it carries, e.g. one from before a rename), under that name too, so
 * the next send to that target finds it.
 */
export async function recordPeerCardShown(
  agentId: string,
  card: PeerCard,
  contextId: string,
  target: string,
  io: CliIo,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!(await flushText(io))) return;
  const rev = peerCardRev(card);
  recordObservation(agentId, "sender", peerCardId(card), rev, contextId, env);
  const ref = parseRaftRefTarget(target);
  const parsed = ref?.kind === "dm" || ref?.kind === "dm-thread" ? parseDmPeerRef(ref.peerName) : undefined;
  if (parsed?.ok && parsed.peerName !== card.name) {
    recordObservation(agentId, "sender", senderObservationId(card.kind, parsed.peerName), rev, contextId, env);
  }
}
