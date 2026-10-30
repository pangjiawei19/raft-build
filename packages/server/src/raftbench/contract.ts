import { z } from "zod";
import { getRaftbenchCanaryServerId } from "../services/agentRuntimeProviderService";

/** This pilot permission is independent of browser flags and production enrollment. */
export const PILOT_SERVER_IDS = new Set([
  "4fc662e7-6626-4f59-a16d-3a224cd54acf",
  "95f993fa-2a68-4797-b8ae-7beb7d984ada",
  "90623df1-20ed-4321-88a1-e4e2b411a252",
]);
export function pilotServerIds(): string[] {
  const canary = getRaftbenchCanaryServerId();
  return [...PILOT_SERVER_IDS, ...(canary ? [canary] : [])];
}
export function isPilotServer(serverId: string, environment: string | undefined): boolean {
  return environment === "staging" && pilotServerIds().includes(serverId);
}
export const READ_GRANTS = ["server:read", "channel:read", "message:read"] as const;
export const configureSchema = z.object({
  enabled: z.boolean(),
  channelIds: z.array(z.string().uuid()).min(1).max(50),
  expectedRevision: z.number().int().nonnegative(),
  historyFrom: z.string().datetime().optional(),
  providerTarget: z.enum(["default", "canary"]).optional(),
}).strict();
// The credential binds identity: callers cannot nominate an agent principal.
export { raftbenchReportSchema as reportSchema } from "@botiverse/raft-shared";
import type { RaftbenchReport as AgentReport } from "@botiverse/raft-shared";
export type { RaftbenchReport as AgentReport } from "@botiverse/raft-shared";
export type RunState = "idle" | "queued" | "running" | "ready" | "partial" | "failed";
export type FetchedEvidence = { target: string; messageId: string; channelId: string };
export type ValidationProblem = { path: string; message: string; suggestedFix: string };

/** Validate every submitted reference against the server's fetched-source ledger. */
export function validateFetchedEvidence(report: AgentReport, fetched: readonly FetchedEvidence[]): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  for (const [index, pattern] of report.patterns.entries()) {
    for (const key of ["evidence", "counterevidence"] as const) {
      for (const [refIndex, ref] of pattern[key].entries()) {
        const matches = fetched.filter((source) => source.target === ref.target &&
          (source.messageId.toLowerCase() === ref.messageId.toLowerCase() ||
            (ref.messageId.length === 8 && source.messageId.toLowerCase().startsWith(ref.messageId.toLowerCase()))));
        if (matches.length !== 1) problems.push({
          path: `patterns[${index}].${key}[${refIndex}]`,
          message: matches.length ? "This short message ID is ambiguous in the fetched sources." : "This evidence was not read in this run.",
          suggestedFix: "Copy target and msg exactly from the material you were given, or remove this reference. Nothing has been saved.",
        });
      }
    }
  }
  return problems;
}
/** Hide the whole report, including counts, after any analyzed source loses visibility. */
export function reportVisibleTo(analysisChannelIds: readonly string[], visibleChannels: ReadonlySet<string>): boolean {
  return analysisChannelIds.every((id) => visibleChannels.has(id));
}
