import { getRedis, isRedisAvailable } from "../redis";

// Task #725: someone who is using Raft Desktop should not also get a browser
// notification for the same message. Raft Desktop reports, over its socket,
// that its window is attended (visible, not minimized, focused — the same test
// that stops the desktop app from notifying itself). While a user's desktop
// window was attended within the last DESKTOP_ATTENTION_WINDOW_MS, message web
// pushes to that user are skipped. Mobile push is unaffected.
//
// The window is fixed (cindyz, 2026-10-08: 10 minutes, not user-configurable).
// A desktop that is merely open but unused stops suppressing after it lapses,
// so a browser on another computer resumes notifying.
export const DESKTOP_ATTENTION_WINDOW_MS = 10 * 60 * 1000;

const KEY_PREFIX = "desktop-attended:";

// Single-replica fallback (dev, tests). Production always has Redis, which is
// the only store every replica can see.
const localAttendedUntil = new Map<string, number>();

export async function recordDesktopAttention(userId: string, now: number = Date.now()): Promise<void> {
  if (isRedisAvailable()) {
    await getRedis().set(`${KEY_PREFIX}${userId}`, "1", "PX", DESKTOP_ATTENTION_WINDOW_MS);
    return;
  }
  localAttendedUntil.set(userId, now + DESKTOP_ATTENTION_WINDOW_MS);
}

/**
 * Raft Desktop reports the user AWAY (no input for 10 minutes, or the screen
 * locked): drop the record now so browser pushes resume without waiting for
 * it to lapse. If another desktop of the same user is still attended, its
 * next once-a-minute report records it again.
 */
export async function clearDesktopAttention(userId: string): Promise<void> {
  if (isRedisAvailable()) {
    await getRedis().del(`${KEY_PREFIX}${userId}`);
    return;
  }
  localAttendedUntil.delete(userId);
}

/**
 * The subset of `userIds` whose Raft Desktop window was attended within the
 * window. Fails open: if the store cannot be read, nobody is suppressed and
 * browser pushes go out exactly as they did before this feature existed — a
 * duplicate notification is better than a missed one.
 */
export async function usersWithRecentDesktopAttention(
  userIds: readonly string[],
  now: number = Date.now(),
): Promise<Set<string>> {
  const attended = new Set<string>();
  if (userIds.length === 0) return attended;
  if (isRedisAvailable()) {
    try {
      const values = await getRedis().mget(userIds.map((id) => `${KEY_PREFIX}${id}`));
      values.forEach((value, idx) => {
        if (value !== null) attended.add(userIds[idx]!);
      });
    } catch (err) {
      console.warn("[DesktopAttention] lookup failed; sending browser pushes unfiltered:", (err as Error).message);
      return new Set();
    }
    return attended;
  }
  for (const id of userIds) {
    const until = localAttendedUntil.get(id);
    if (until === undefined) continue;
    if (until > now) attended.add(id);
    else localAttendedUntil.delete(id);
  }
  return attended;
}

export function __resetDesktopAttentionForTests(): void {
  localAttendedUntil.clear();
}
