/**
 * RFC 075 §4.5: a joint invite whose invitee is the inviter, on a target server
 * the inviter owns or administers, can connect directly without an email. This
 * only decides whether the dialog shows the confirmation; the server re-checks
 * the inviter's authority on both servers before accepting.
 */
export interface SameAdminJointServer {
  slug: string;
  name: string;
  role: string;
}

export function invitesSelf(
  invitedPeople: readonly string[],
  user: { name: string; email: string } | null | undefined,
): boolean {
  if (!user) return false;
  return invitedPeople.some((raw) => {
    const token = raw.trim();
    // Same token rules as the server's resolveJointInvitees: `a@b` is an
    // email (case-insensitive), anything else is a handle with optional `@`.
    if (token.includes("@") && !token.startsWith("@")) {
      return !!user.email && token.toLowerCase() === user.email.toLowerCase();
    }
    return !!user.name && token.replace(/^@/, "") === user.name;
  });
}

export function findSameAdminJointTarget<T extends SameAdminJointServer>(input: {
  servers: readonly T[];
  currentServerSlug: string | null | undefined;
  user: { name: string; email: string } | null | undefined;
  targetServerSlug: string;
  invitedPeople: readonly string[];
}): T | null {
  const slug = input.targetServerSlug.trim();
  if (!slug || slug === input.currentServerSlug) return null;
  if (!invitesSelf(input.invitedPeople, input.user)) return null;
  const target = input.servers.find((server) => server.slug === slug);
  if (!target || (target.role !== "owner" && target.role !== "admin")) return null;
  return target;
}

/** Invite dialogs accept people separated by commas or new lines. */
export function parseInvitedPeopleText(text: string): string[] {
  return text
    .split(/[\n,]+/)
    .map((person) => person.trim())
    .filter(Boolean);
}
