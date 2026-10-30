import type { ActivityTurnSummary, ActivityTurnTrigger } from "@botiverse/raft-shared";

/**
 * What the Activity overview may show about where a turn's waking message
 * came from. A viewer who can inspect the agent is not necessarily in the
 * private channel or DM that woke it (task #17, Tenny): then only the kind of
 * place is shown, never its name, the sender or the message.
 */
export type ActivityTurnTriggerView =
  | (ActivityTurnTrigger & { hidden?: undefined })
  | { hidden: "private_channel" | "dm" };

export type ActivityTurnSummaryView<T extends ActivityTurnSummary = ActivityTurnSummary> = Omit<T, "trigger"> & { trigger?: ActivityTurnTriggerView };

export async function viewTurnSummaries<T extends ActivityTurnSummary>(
  summaries: readonly T[],
  canViewerAccessChannel: (channelId: string) => Promise<boolean>,
): Promise<ActivityTurnSummaryView<T>[]> {
  // One access check per distinct channel, in order (no fan-out per summary).
  const access = new Map<string, boolean>();
  const views: ActivityTurnSummaryView<T>[] = [];
  for (const summary of summaries) {
    const { trigger, ...rest } = summary;
    if (!trigger) {
      views.push(rest);
      continue;
    }
    // App events name no channel or person.
    if (trigger.target?.startsWith("agent-event:")) {
      views.push({ ...rest, trigger });
      continue;
    }
    let allowed = false;
    if (trigger.channelId) {
      if (!access.has(trigger.channelId)) {
        access.set(trigger.channelId, await canViewerAccessChannel(trigger.channelId).catch(() => false));
      }
      allowed = access.get(trigger.channelId)!;
    }
    views.push(allowed ? { ...rest, trigger } : { ...rest, trigger: { hidden: trigger.target?.startsWith("dm:") ? "dm" : "private_channel" } });
  }
  return views;
}
