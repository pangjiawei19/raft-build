import { SUBAGENT_OUTCOMES, SUBAGENT_PHASES, type SubagentLineage } from "@botiverse/raft-shared";

const SUBAGENT_ID_LIMIT = 160;
const SUBAGENT_TYPE_LIMIT = 80;

function boundedToken(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, limit) : undefined;
}

/**
 * The `subagent` marker on a hosted activity event, kept to ids and enums
 * (`SubagentLineage`). Any object counts as the marker, so an event that says
 * it is a subagent's never touches the agent's own status even when its fields
 * are unusable; fields that are not ids, known enums or a non-negative length
 * are dropped, never echoed. Null when the event carries no marker.
 */
export function normalizeExternalSubagentMarker(value: unknown): NonNullable<SubagentLineage["subagent"]> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const parentToolUseId = boundedToken(raw.parentToolUseId, SUBAGENT_ID_LIMIT);
  const subagentType = boundedToken(raw.subagentType, SUBAGENT_TYPE_LIMIT);
  const taskId = boundedToken(raw.taskId, SUBAGENT_ID_LIMIT);
  const phase = (SUBAGENT_PHASES as readonly unknown[]).includes(raw.phase) ? raw.phase as (typeof SUBAGENT_PHASES)[number] : undefined;
  const ended = phase === "ended";
  const outcome = ended && (SUBAGENT_OUTCOMES as readonly unknown[]).includes(raw.outcome) ? raw.outcome as (typeof SUBAGENT_OUTCOMES)[number] : undefined;
  const reportChars = ended && typeof raw.reportChars === "number" && Number.isSafeInteger(raw.reportChars) && raw.reportChars >= 0
    ? raw.reportChars
    : undefined;
  return {
    ...(parentToolUseId ? { parentToolUseId } : {}),
    ...(subagentType ? { subagentType } : {}),
    ...(taskId ? { taskId } : {}),
    ...(phase ? { phase } : {}),
    ...(outcome ? { outcome } : {}),
    ...(reportChars !== undefined ? { reportChars } : {}),
  };
}
