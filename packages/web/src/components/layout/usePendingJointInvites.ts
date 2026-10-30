import { useCallback, useEffect, useState } from "react";
import api from "../../api/client";
import { useServerStore } from "../../store/serverStore";

const POLL_MS = 60_000;

/** One row of `GET /channels/joint-invites`: invites to the current server
 *  addressed to the current user. */
export interface PendingJointInvite {
  id: string;
  fromServerName: string;
  fromServerSlug: string;
  channelName: string;
  expiresAt: string;
}

/**
 * RFC 075 §4.5: pending joint invites for the current user on the current
 * server, so they can be accepted in-app instead of only from the email link.
 * Only owners/admins can be invited (and accept), so nobody else polls.
 */
export function usePendingJointInvites(): {
  invites: PendingJointInvite[];
  refresh: () => Promise<void>;
} {
  const serverId = useServerStore((state) => state.current?.id ?? null);
  const role = useServerStore((state) => state.current?.role ?? null);
  const canBeInvited = role === "owner" || role === "admin";
  const [invites, setInvites] = useState<PendingJointInvite[]>([]);

  const refresh = useCallback(async () => {
    if (!serverId || !canBeInvited) {
      setInvites([]);
      return;
    }
    try {
      const { data } = await api.get<{ invites: PendingJointInvite[] }>("/channels/joint-invites", {
        headers: { "X-Server-Id": serverId },
      });
      // Drop a response that lands after the user switched servers.
      if (useServerStore.getState().current?.id !== serverId) return;
      setInvites(Array.isArray(data?.invites) ? data.invites : []);
    } catch {
      // Keep the last known list; the email link remains a fallback.
    }
  }, [canBeInvited, serverId]);

  useEffect(() => {
    void refresh();
    if (!serverId || !canBeInvited || typeof window === "undefined") return;
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [canBeInvited, refresh, serverId]);

  return { invites, refresh };
}
