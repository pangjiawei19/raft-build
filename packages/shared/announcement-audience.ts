import { asServerId, type Brand, type ServerId } from "./src/brandedIds";

export type AnnouncementRecipientUserId = Brand<string, "AnnouncementRecipientUserId">;
export type AnnouncementAudience =
  | { type: "all" }
  | { type: "users"; userIds: AnnouncementRecipientUserId[] }
  | { type: "server_members"; serverIds: ServerId[] }
  | { type: "server_users"; targets: Array<{ serverId: ServerId; userIds: AnnouncementRecipientUserId[] }> };

export type AnnouncementDeliveryScope = { type: "account" } | { type: "server"; serverId: ServerId };
export interface AnnouncementAudienceSnapshot {
  audience: AnnouncementAudience;
  deliveryVersion: number;
  calculatedAt: string;
}

export const ANNOUNCEMENT_AUDIENCE_MAX_IDS = 10_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error("audience IDs must be UUIDs");
  return value.toLowerCase();
}

/** Mint only after validating the recipient identity at a DTO/fixture boundary. */
export function asAnnouncementRecipientUserId(value: string): AnnouncementRecipientUserId {
  return uuid(value) as AnnouncementRecipientUserId;
}

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid announcement audience");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !keys.includes(key))) throw new Error("unknown announcement audience field");
  return input;
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > ANNOUNCEMENT_AUDIENCE_MAX_IDS) {
    throw new Error(`audience lists must contain 1-${ANNOUNCEMENT_AUDIENCE_MAX_IDS} IDs`);
  }
  return [...new Set(value.map(uuid))].sort();
}

/** Syntax only. The publisher must separately resolve IDs and membership. */
export function validateAnnouncementAudience(value: unknown): AnnouncementAudience {
  if (value === undefined) return { type: "all" };
  const type = record(value, ["type", "userIds", "serverIds", "targets"]).type;
  switch (type) {
    case "all":
      record(value, ["type"]);
      return { type };
    case "users":
      return { type, userIds: ids(record(value, ["type", "userIds"]).userIds).map(asAnnouncementRecipientUserId) };
    case "server_members":
      return { type, serverIds: ids(record(value, ["type", "serverIds"]).serverIds).map(asServerId) };
    case "server_users": {
      const input = record(value, ["type", "targets"]);
      if (!Array.isArray(input.targets) || input.targets.length === 0 || input.targets.length > ANNOUNCEMENT_AUDIENCE_MAX_IDS) {
        throw new Error("server_users requires bounded nonempty targets");
      }
      const targets = new Map<ServerId, Set<AnnouncementRecipientUserId>>();
      let count = 0;
      for (const target of input.targets) {
        const item = record(target, ["serverId", "userIds"]);
        const serverId = asServerId(uuid(item.serverId));
        const userIds = ids(item.userIds).map(asAnnouncementRecipientUserId);
        count += userIds.length;
        if (count > ANNOUNCEMENT_AUDIENCE_MAX_IDS) throw new Error("too many audience user IDs");
        const users = targets.get(serverId) ?? new Set<AnnouncementRecipientUserId>();
        userIds.forEach((id) => users.add(id));
        targets.set(serverId, users);
      }
      return { type, targets: [...targets].sort(([a], [b]) => a.localeCompare(b)).map(([serverId, users]) => ({ serverId, userIds: [...users].sort() })) };
    }
    default:
      throw new Error("unknown announcement audience type");
  }
}

/** Current membership is authoritative; a copied server ID never grants eligibility. */
export function matchesAnnouncementAudience(
  audience: AnnouncementAudience,
  userId: AnnouncementRecipientUserId,
  serverId: ServerId | null,
  isCurrentMember: boolean,
): boolean {
  switch (audience.type) {
    case "all": return true;
    case "users": return audience.userIds.includes(userId);
    case "server_members": return serverId !== null && isCurrentMember && audience.serverIds.includes(serverId);
    case "server_users": return serverId !== null && isCurrentMember && audience.targets.some((target) => target.serverId === serverId && target.userIds.includes(userId));
  }
}
