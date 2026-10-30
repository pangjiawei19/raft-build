import type { Socket } from "socket.io";
import { clearDesktopAttention, recordDesktopAttention } from "../services/desktopAttention";
import type { SocketClientKind } from "./platformScope";

export const DESKTOP_ATTENTION_EVENT = "desktop:attention";

// Raft Desktop re-reports about once a minute while its window stays attended.
// Anything faster from one socket is dropped so a misbehaving client cannot
// turn the event into a Redis write loop.
export const DESKTOP_ATTENTION_MIN_INTERVAL_MS = 30 * 1000;

type DesktopAttentionDeps = {
  record?: (userId: string) => Promise<void>;
  clear?: (userId: string) => Promise<void>;
  now?: () => number;
};

/**
 * Accepts `desktop:attention { attended: true }` from Raft Desktop sockets only.
 * A browser socket cannot claim to be the desktop app and silence its own
 * user's browser notifications. A blur needs no message because the record
 * lapses on its own (see desktopAttention.ts). `{ attended: false }` means the
 * desktop saw the user go away (idle 10 minutes or screen locked) and clears
 * the record at once.
 */
export function attachDesktopAttentionHandler(
  socket: Pick<Socket, "on">,
  identity: { userId: string; clientKind: SocketClientKind },
  deps: DesktopAttentionDeps = {},
): void {
  if (identity.clientKind !== "desktop") return;
  const record = deps.record ?? recordDesktopAttention;
  const clear = deps.clear ?? clearDesktopAttention;
  const now = deps.now ?? Date.now;
  let lastRecordedAt = Number.NEGATIVE_INFINITY;
  let lastClearedAt = Number.NEGATIVE_INFINITY;
  socket.on(DESKTOP_ATTENTION_EVENT, (payload: unknown) => {
    if (!payload || typeof payload !== "object") return;
    const attended = (payload as { attended?: unknown }).attended;
    const at = now();
    if (attended === false) {
      if (at - lastClearedAt < DESKTOP_ATTENTION_MIN_INTERVAL_MS) return;
      lastClearedAt = at;
      // The user's return must be recorded at once, not up to 30 s later.
      lastRecordedAt = Number.NEGATIVE_INFINITY;
      clear(identity.userId).catch((err: unknown) => {
        // A failed clear only means the record lapses on its own.
        console.warn("[Socket] desktop attention clear failed:", (err as Error).message);
      });
      return;
    }
    if (attended !== true) return;
    if (at - lastRecordedAt < DESKTOP_ATTENTION_MIN_INTERVAL_MS) return;
    lastRecordedAt = at;
    record(identity.userId).catch((err: unknown) => {
      // Losing one report only means browser pushes are not suppressed.
      console.warn("[Socket] desktop attention record failed:", (err as Error).message);
    });
  });
}
