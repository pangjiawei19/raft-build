import api from "../api/client";
import type { EvidenceMessage } from "./model";

export const OVERVIEW_CHANNEL_LIMIT = 20;
export const MESSAGE_WINDOW_LIMIT = 200;

export interface MessageSnapshot {
  messages: EvidenceMessage[];
  fetchedAt: string;
  historyLimited: boolean;
  /** A full page may have more history; v0 intentionally evaluates a bounded recent window. */
  mayHaveOlder: boolean;
}
/** Normal human API: existing auth/server interceptors and server channel ACL apply. */
export async function loadMessageSnapshot(
  channelId: string,
  serverId: string,
  signal: AbortSignal,
): Promise<MessageSnapshot> {
  const { data } = await api.get<unknown>(
    `/messages/channel/${encodeURIComponent(channelId)}`,
    {
      params: { limit: MESSAGE_WINDOW_LIMIT },
      headers: { "X-Server-Id": serverId },
      signal,
    },
  );
  if (
    !data ||
    typeof data !== "object" ||
    !("messages" in data) ||
    !Array.isArray(data.messages)
  )
    throw new Error("Invalid message response");
  const messages: EvidenceMessage[] = [];
  const ids = new Set<string>();
  const rows: unknown[] = data.messages;
  for (const candidate of rows) {
    if (
      !isEvidenceMessage(candidate) ||
      candidate.channelId !== channelId ||
      ids.has(candidate.id)
    )
      throw new Error("Invalid message row");
    const row = candidate;
    ids.add(row.id);
    // Only the minimal evidence fields enter the evaluator/export; no attachments,
    // forwarded bundles, mentions or receiver-private metadata are copied.
    messages.push({
      id: row.id,
      channelId,
      senderType: row.senderType,
      senderId: row.senderId,
      ...(row.senderName !== undefined ? { senderName: row.senderName } : {}),
      ...(row.messageType !== undefined
        ? { messageType: row.messageType }
        : {}),
      content: row.content,
      createdAt: row.createdAt,
    });
  }
  return {
    messages,
    fetchedAt: new Date().toISOString(),
    historyLimited: "historyLimited" in data && data.historyLimited === true,
    mayHaveOlder: messages.length >= MESSAGE_WINDOW_LIMIT,
  };
}

/** The only untyped network boundary; business logic consumes the narrow contract. */
function isEvidenceMessage(value: unknown): value is EvidenceMessage {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    row.id.length > 0 &&
    typeof row.channelId === "string" &&
    typeof row.senderId === "string" &&
    typeof row.content === "string" &&
    typeof row.createdAt === "string" &&
    Number.isFinite(Date.parse(row.createdAt)) &&
    (row.senderType === "user" ||
      row.senderType === "agent" ||
      row.senderType === "external_projection") &&
    (row.senderName === undefined || typeof row.senderName === "string") &&
    (row.messageType === undefined ||
      row.messageType === "chat" ||
      row.messageType === "system")
  );
}

export interface ChannelSnapshotSummary {
  channelId: string;
  messages: number;
  historyLimited: boolean;
  mayHaveOlder: boolean;
}
export interface OverviewSnapshot extends MessageSnapshot {
  channels: ChannelSnapshotSummary[];
  unavailableChannelIds: string[];
  requestedChannels: number;
}
/** Explicit foreground reads, capped by the caller, with four requests in flight.
 * A denied channel contributes no messages or signal counts to the overview. */
export async function loadChannelSnapshots(
  channelIds: readonly string[],
  serverId: string,
  signal: AbortSignal,
): Promise<OverviewSnapshot> {
  const targets = [...new Set(channelIds)];
  if (!targets.length || targets.length > OVERVIEW_CHANNEL_LIMIT)
    throw new Error("Expected 1–20 selected channels");
  const accepted: Array<{ channelId: string; snapshot: MessageSnapshot }> = [];
  const unavailableChannelIds: string[] = [];
  let next = 0;
  async function worker() {
    while (next < targets.length) {
      signal.throwIfAborted();
      const channelId = targets[next++];
      try {
        accepted.push({
          channelId,
          snapshot: await loadMessageSnapshot(channelId, serverId, signal),
        });
      } catch {
        signal.throwIfAborted();
        unavailableChannelIds.push(channelId);
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(4, targets.length) }, worker),
  );
  signal.throwIfAborted();
  if (!accepted.length) throw new Error("No channel could be read");
  accepted.sort((a, b) => a.channelId.localeCompare(b.channelId));
  return {
    messages: accepted.flatMap((result) => result.snapshot.messages),
    fetchedAt: new Date().toISOString(),
    historyLimited: accepted.some((result) => result.snapshot.historyLimited),
    mayHaveOlder: accepted.some((result) => result.snapshot.mayHaveOlder),
    channels: accepted.map(({ channelId, snapshot }) => ({
      channelId,
      messages: snapshot.messages.length,
      historyLimited: snapshot.historyLimited,
      mayHaveOlder: snapshot.mayHaveOlder,
    })),
    unavailableChannelIds: unavailableChannelIds.sort(),
    requestedChannels: targets.length,
  };
}
