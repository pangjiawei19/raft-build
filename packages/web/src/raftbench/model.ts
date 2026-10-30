import type { Message } from "../store/messageStore";

/** A minimal view of the existing receiver-visible message contract, not raw agent traces. */
export type EvidenceMessage = Pick<
  Message,
  | "id"
  | "channelId"
  | "senderType"
  | "senderId"
  | "senderName"
  | "messageType"
  | "content"
  | "createdAt"
>;
export type SignalKind = "frustration" | "negative" | "repetition";
export type ReviewLabel = "needs_review" | "confirmed" | "dismissed";
export interface Finding {
  id: string;
  kind: SignalKind;
  evidence: EvidenceMessage[];
}
export const RULE_VERSION = "raftbench-rules-0.1.0";
const frustration =
  /\b(frustrat(?:ed|ing)|annoy(?:ed|ing)|wast(?:ed|ing) (?:my )?time|stop asking|already told you|why (?:do|are) you keep|this (?:still )?(?:doesn.?t|does not) work|you.?re not listening)\b|烦死|别再问|说了好几遍|怎么又|浪费时间|你没听懂|还是不行|一直重复/iu;
const negative =
  /\b(disappoint(?:ed|ing)|unhelpful|terrible|awful|not helpful|not working)\b|不好用|没用|不满意|失望/iu;
const positive =
  /\b(thank you|thanks|excellent|great work|works perfectly|love it)\b|谢谢|太好了|搞定了|很好/iu;
export function evaluateMessages(
  messages: readonly EvidenceMessage[],
  minimum = 3,
) {
  if (!Number.isInteger(minimum) || minimum < 2 || minimum > 20)
    throw new Error("Invalid repeat threshold");
  const ordered = [...messages].sort(
    (a, b) =>
      Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
  const findings: Finding[] = [];
  const sentiment = { positive: 0, negative: 0, mixed: 0, unscored: 0 };
  const add = (kind: SignalKind, evidence: EvidenceMessage[]) =>
    findings.push({
      id: `${RULE_VERSION}:${kind}:${evidence[0].id}:${evidence.at(-1)!.id}`,
      kind,
      evidence,
    });
  const repetitions = new Map<string, EvidenceMessage[]>();
  for (const message of ordered) {
    if (message.messageType === "system") continue;
    if (message.senderType === "user") {
      const f = frustration.test(message.content),
        n = negative.test(message.content),
        p = positive.test(message.content);
      sentiment[
        p && (f || n)
          ? "mixed"
          : p
            ? "positive"
            : f || n
              ? "negative"
              : "unscored"
      ]++;
      if (f) add("frustration", [message]);
      else if (n) add("negative", [message]);
    } else if (message.senderType === "agent") {
      const text = message.content.toLowerCase().replace(/\s+/gu, " ").trim();
      if (text.length < 16) continue;
      const key = JSON.stringify([message.channelId, message.senderId, text]);
      let group = repetitions.get(key) ?? [];
      if (
        group.length &&
        Date.parse(message.createdAt) - Date.parse(group[0].createdAt) >
          15 * 60_000
      ) {
        if (group.length >= minimum) add("repetition", group);
        group = [];
      }
      group.push(message);
      repetitions.set(key, group);
    }
  }
  for (const group of repetitions.values())
    if (group.length >= minimum) add("repetition", group);
  findings.sort(
    (a, b) =>
      b.evidence
        .at(-1)!
        .createdAt.localeCompare(a.evidence.at(-1)!.createdAt) ||
      a.id.localeCompare(b.id),
  );
  return { findings, sentiment, messages: ordered };
}

/** Export only matched evidence, once per message; never the scanned corpus. */
export function exportFindingEvidence(findings: readonly Finding[]) {
  const messages = new Map<string, EvidenceMessage>();
  for (const finding of findings) for (const message of finding.evidence) messages.set(message.id, message);
  return {
    findings: findings.map((finding) => ({ id: finding.id, kind: finding.kind, evidenceIds: finding.evidence.map((message) => message.id) })),
    messages: [...messages.values()],
  };
}
