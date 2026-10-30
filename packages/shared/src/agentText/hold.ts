// Canonical held text: what an agent sees when a send or a task call is held
// (unread messages in the conversation, a card it has not seen). Moved from
// the CLI's commands/freshness/_format.ts so the SDK prints the same text (the
// CLI wraps it in its axSurface registrations and pins the bytes with its
// snapshot tests). The text is an AX contract, not an implementation detail.

import type { RaftHintStyle } from "../agentOps/hint";
import { agentChannelRef } from "./server";
import {
  codePointLength,
  fitCards,
  GLIMPSE_PUSH_BUDGET_CHARS,
  renderChannelCard,
  renderPeerCard,
  renderThreadWindow,
  type ChannelCard,
  type PeerCard,
  type ThreadWindowMessage,
} from "../agentOps/passiveResources";


/** The Server's held response fields the text reads. */
export interface AgentHoldData {
  producerFactId?: string;
  decision?: "local_hold" | "syncing_hold";
  heldMessages?: unknown[];
  newMessageCount?: number;
  shownMessageCount?: number;
  omittedMessageCount?: number;
  withheldMessageCount?: number;
  freshnessContextMode?: "inline" | "withheld";
  mentionAnnotation?: { formalMentionCount: number };
  continueAnywaySuggested?: boolean;
  /** Lowest seq inside the displayed window; --before anchor for browsing older. */
  firstShownSeq?: number;
  /** Why the call was held (`unread_messages`, `channel_card`, `peer_card`); absent means unread messages. */
  holdReasons?: string[];
  /** The target's channel card, when this context has not seen its current version. */
  channelCard?: ChannelCard;
  /** This context saw an older version of `channelCard`. */
  channelCardChanged?: boolean;
  /** A DM target's peer card, when this context has seen nothing of the peer. */
  peerCard?: PeerCard;
  /** Thread-start anchor for thread targets (digest topic anchor). */
  threadParentMessage?: {
    seq: number;
    messageId?: string;
    senderName?: string | null;
    createdAt?: string | null;
    content?: string;
  };
}

export interface AgentHoldOptions {
  /** What happened to the call, e.g. "Your message has been saved as a draft." */
  heldAction: string;
  /** The ways forward, printed after "choose one path." */
  draftInstructions?: string;
  /** Offered when the Server suggests it (a busy thread). */
  continueAnywayInstruction?: string;
  withholdContext?: boolean;
  /**
   * Printed after the count under reviewer isolation. The CLI keeps that
   * text count-only (no target, no action, no resend flags: its isolation
   * invariant) and gives the next step through its error; the SDK passes what
   * happened and its key-based resend, since its text is all a model sees.
   */
  isolationInstructions?: string;
}

function heldWindowMessage(message: Record<string, unknown>): ThreadWindowMessage {
  return {
    seq: Number(message.seq),
    sender: (message.sender_name ?? message.senderName ?? null) as string | null,
    timestamp: (message.timestamp ?? message.createdAt ?? null) as string | null,
    content: (message.content ?? "") as string,
  };
}

function normalizeWithheldMessageCount(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

/** Reviewer isolation: the count only, no context bytes. */
export function redactAgentHoldForReviewerIsolation(data: AgentHoldData): {
  state: "held";
  freshnessContextMode: "withheld";
  withheldMessageCount: number;
} {
  return {
    state: "held",
    freshnessContextMode: "withheld",
    withheldMessageCount: normalizeWithheldMessageCount(data.withheldMessageCount ?? data.newMessageCount),
  };
}

export function formatAgentReviewerIsolationHold(data: AgentHoldData): string {
  const projected = redactAgentHoldForReviewerIsolation(data);
  const messageNoun = projected.withheldMessageCount === 1 ? "message" : "messages";
  return `Reviewer-isolation freshness hold: ${projected.withheldMessageCount} newer ${messageNoun} withheld.\n`;
}

/**
 * The held text: the opening line (unread messages, or the card that is new
 * to this context), the cards, the conversation's window form within the push
 * budget, then "choose one path" and the caller's ways forward.
 */
export function formatAgentHold(
  target: string,
  data: AgentHoldData,
  opts: AgentHoldOptions,
  style: RaftHintStyle = "cli",
): string {
  const withholdContext = opts.withholdContext === true || data.freshnessContextMode === "withheld";
  if (withholdContext) {
    // Counts only, no context bytes.
    return formatAgentReviewerIsolationHold(data) + (opts.isolationInstructions ? `\n${opts.isolationInstructions}` : "");
  }
  const newMessageCount = data.newMessageCount ?? 0;
  const shownMessageCount = data.shownMessageCount ?? data.heldMessages?.length ?? 0;
  const heldMessages = (data.heldMessages ?? []) as Array<Record<string, unknown>>;
  const mentionNote = (data.mentionAnnotation?.formalMentionCount ?? 0) > 0
    ? `\nNote: ${data.mentionAnnotation!.formalMentionCount} of these messages formally @mention you.`
    : "";
  const continueAnyway = data.continueAnywaySuggested && opts.continueAnywayInstruction
    ? opts.continueAnywayInstruction
    : "";
  const newMessageNoun = newMessageCount === 1 ? "message" : "messages";

  // Held for a card alone: no unread messages, so no window.
  const holdReasons = data.holdReasons ?? [];
  const cardOnlyLead = holdReasons.includes("unread_messages")
    ? undefined
    : data.channelCard && holdReasons.includes("channel_card")
      ? `the description of ${agentChannelRef(data.channelCard.name, data.channelCard.type)}`
      : data.peerCard && holdReasons.includes("peer_card")
        ? `@${data.peerCard.name}'s profile`
        : undefined;
  if (cardOnlyLead) {
    const card = [
      ...(data.channelCard ? renderChannelCard(data.channelCard, { changed: data.channelCardChanged === true, style }) : []),
      ...(data.peerCard ? renderPeerCard(data.peerCard, { style }) : []),
    ];
    return (
      `Held — ${cardOnlyLead} is not in your current context yet. ${opts.heldAction}\n\n` +
      `${card.join("\n")}\n\n` +
      `After reading it, choose one path.\n` +
      (opts.draftInstructions ?? "")
    );
  }

  // ── Digest: the state map the agent decides from (task #41 redesign): the
  // conversation's window form from the RFC 072 registry. Chat semantics
  // (task #41 final review): opening a conversation shows the latest window
  // and silently reads through, like a human opening a chat; the window says
  // how many were skipped this time and how to browse older.
  const parent = data.threadParentMessage;
  const windowLines = (withStart: boolean) => renderThreadWindow({
    target,
    ...(parent && withStart ? { start: { seq: parent.seq, sender: parent.senderName, timestamp: parent.createdAt ?? null, content: parent.content } } : {}),
    omittedCount: data.omittedMessageCount ?? 0,
    ...(data.firstShownSeq !== undefined ? { firstShownSeq: data.firstShownSeq } : {}),
    shownCount: shownMessageCount,
    messages: heldMessages.map(heldWindowMessage),
  }, style);

  const openingLine = `Held — ${newMessageCount} unread ${newMessageNoun} in ${target}. ${opts.heldAction}`;

  // The push budget (G1-11): the latest messages stay; card descriptions
  // shrink first, then the thread start goes. The draft and the paths after
  // it are the agent's own and do not count.
  const pushedText = (cardLines: string[], window: string[]) =>
    `${openingLine}${mentionNote}\n\n` + (cardLines.length > 0 ? `${cardLines.join("\n")}\n\n` : "") + window.join("\n");
  const fitsBudget = (cardLines: string[], window: string[]) =>
    codePointLength(pushedText(cardLines, window)) <= GLIMPSE_PUSH_BUDGET_CHARS;
  const cards = { channelCard: data.channelCard, channelCardChanged: data.channelCardChanged, peerCard: data.peerCard };
  const fit = (window: string[]) => ({ window, card: fitCards(cards, (cardLines) => fitsBudget(cardLines, window), style) });
  const withStart = fit(windowLines(true));
  const { window: lines, card: fittedCard } = fitsBudget(withStart.card, withStart.window) || !parent
    ? withStart
    : fit(windowLines(false));

  return (
    pushedText(fittedCard, lines) +
    `\n\nAfter reviewing the current state of this conversation, choose one path.\n` +
    (opts.draftInstructions ?? "") +
    continueAnyway
  );
}
