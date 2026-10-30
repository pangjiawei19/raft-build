import { useEffect, useState } from "react";
import { fetchAgentArchive } from "./archiveApi";

/** The Computer an archived agent last ran on (its archive record), or null. */
export function useArchivedAgentMachineName(archivedAgentId: string | null): string | null {
  const [loaded, setLoaded] = useState<{ agentId: string; name: string | null } | null>(null);
  useEffect(() => {
    if (!archivedAgentId) return;
    let canceled = false;
    // Advisory: any failure just keeps the plain "No computer assigned".
    Promise.resolve()
      .then(() => fetchAgentArchive(archivedAgentId))
      .then((archive) => {
        if (!canceled) setLoaded({ agentId: archivedAgentId, name: archive?.machineName ?? null });
      })
      .catch(() => {});
    return () => { canceled = true; };
  }, [archivedAgentId]);
  return archivedAgentId && loaded?.agentId === archivedAgentId ? loaded.name : null;
}
