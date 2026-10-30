import type { Response } from "express";
import { setRequestTraceErrorCode } from "../middleware/requestObservability";
import { evaluateFeatureFlag, REMINDER_APP_FEATURE_FLAG_KEY } from "../services/featureFlagService";
import { serializeErrorForLog } from "../tracing/safeErrorLog";

export const REMINDERS_MOVED_TO_APP = "reminders_moved_to_app";

const REMINDERS_MOVED_TO_APP_MESSAGE =
  "Reminders on this server moved to the Reminder app, so `raft reminder schedule`, `update` and `snooze` no longer work here. Nothing was changed. Use the Reminder app from the \"Installed on this Server\" list in your instructions, or find its service id with `raft integration list`, then run `raft integration invoke --service <id> --list-actions`. If Reminder is not listed, the app is not installed on this server; ask a server admin. `raft reminder list`, `log` and `cancel` still work for your existing reminders.";

async function reminderAppRolloutEnabled(serverId: string | null | undefined): Promise<boolean> {
  if (!serverId) return false;
  try {
    return (await evaluateFeatureFlag({ key: REMINDER_APP_FEATURE_FLAG_KEY, serverId })).enabled === true;
  } catch (error) {
    console.warn(`[reminder] ${REMINDER_APP_FEATURE_FLAG_KEY} evaluation failed; leaving legacy reminders on`, serializeErrorForLog(error));
    return false;
  }
}

/**
 * Refuses a legacy reminder write (schedule, update, snooze) when the server's
 * `reminder_app` rollout flag is on, and reports whether it did. Covers both
 * the agent API and the machine-key `/internal/agent/:id/reminders` routes that
 * older Computers still call: their prompts still teach `raft reminder
 * schedule`, so this refusal is what points their agents at the app. List, log
 * and cancel are never guarded, and reminders already queued keep firing. The
 * code lands on the request span as `error_code`, which is how the rollout
 * counts remaining legacy callers per server and agent.
 */
export async function refuseIfRemindersMovedToApp(res: Response, serverId: string | null | undefined): Promise<boolean> {
  if (!(await reminderAppRolloutEnabled(serverId))) return false;
  setRequestTraceErrorCode(res, REMINDERS_MOVED_TO_APP);
  res.status(409).json({ error: REMINDERS_MOVED_TO_APP_MESSAGE, code: REMINDERS_MOVED_TO_APP });
  return true;
}
