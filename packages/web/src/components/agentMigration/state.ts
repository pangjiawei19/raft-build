import type { AGENT_MIGRATION_STATES } from "@botiverse/raft-shared";

export type AgentMigrationState = (typeof AGENT_MIGRATION_STATES)[number];

// Steps follow what the owner can observe: the agent stops on the source,
// the source packs the workspace (the slow part), the files move, and the
// agent starts on the target. Transport setup is near-instant and not shown.
// The last step is the outcome itself: it only finishes when the migration
// completes, so a successful migration reads as its own step.
export const MIGRATION_PROGRESS_STEPS = [
  "agent.detail.migrationStepStopAgent",
  "agent.detail.migrationStepPackWorkspace",
  "agent.detail.migrationStepTransfer",
  "agent.detail.migrationStepStartOnTarget",
  "agent.detail.migrationStepComplete",
] as const;

// A move to the cloud has no target computer to start on; instead the user
// reviews which files come over and confirms the switch. Same last-step rule.
export const HOSTED_MIGRATION_PROGRESS_STEPS = [
  "agent.migration.hosted.stepUpload",
  "agent.migration.hosted.stepCheckFiles",
  "agent.migration.hosted.stepReview",
  "agent.migration.hosted.stepSwitch",
  "agent.migration.hosted.stepComplete",
] as const;

export type AgentMigrationPhase = "active" | "completed" | "failed" | "canceled";

interface AgentMigrationStateInfo {
  phase: AgentMigrationPhase;
  /** Lowest progress step this state implies; notice timestamps can advance it. */
  step: number;
  cancellable: boolean;
}

// Exhaustive over the shared state union, so adding or removing a state is a
// compile error here rather than a silent fallthrough in the UI.
const AGENT_MIGRATION_STATE_INFO: Record<AgentMigrationState, AgentMigrationStateInfo> = {
  provisioning: { phase: "active", step: 0, cancellable: true },
  // Legacy enum value that is never written; presented as packing.
  prep: { phase: "active", step: 1, cancellable: true },
  ready: { phase: "active", step: 2, cancellable: true },
  in_transit: { phase: "active", step: 2, cancellable: true },
  arriving: { phase: "active", step: 3, cancellable: true },
  starting: { phase: "active", step: 3, cancellable: true },
  cancel_requested_pre_flip: { phase: "active", step: 0, cancellable: false },
  cancel_requested_post_flip: { phase: "active", step: 0, cancellable: false },
  canceled_pre_flip: { phase: "canceled", step: 0, cancellable: false },
  canceled_post_flip: { phase: "canceled", step: 0, cancellable: false },
  completed: { phase: "completed", step: MIGRATION_PROGRESS_STEPS.length, cancellable: false },
  aborted: { phase: "failed", step: 0, cancellable: false },
  failed: { phase: "failed", step: 0, cancellable: false },
};

// REST snapshots are not schema-validated, so an unknown state can still arrive.
function migrationStateInfo(state: string): AgentMigrationStateInfo | null {
  return Object.hasOwn(AGENT_MIGRATION_STATE_INFO, state)
    ? AGENT_MIGRATION_STATE_INFO[state as AgentMigrationState]
    : null;
}

export function migrationPhase(state: string): AgentMigrationPhase | null {
  return migrationStateInfo(state)?.phase ?? null;
}

export function isActiveMigrationState(state: string): boolean {
  return migrationPhase(state) === "active";
}

export function isCompletedMigrationState(state: string): boolean {
  return migrationPhase(state) === "completed";
}

export function isFailedMigrationState(state: string): boolean {
  return migrationPhase(state) === "failed";
}

export function isCanceledMigrationState(state: string): boolean {
  return migrationPhase(state) === "canceled";
}

export function isHostedMigration(notice: { targetKind?: string | null }): boolean {
  return notice.targetKind === "hosted";
}

export function canCancelMigration(notice: {
  state: string;
  revision?: number | null;
  targetKind?: string | null;
  flippedAt?: string | null;
}): boolean {
  // After the switch a cloud agent already runs in the cloud; there is no
  // computer to hand it back to, so the server refuses the cancel.
  if (isHostedMigration(notice) && (notice.flippedAt || notice.state === "arriving" || notice.state === "starting")) {
    return false;
  }
  return migrationStateInfo(notice.state)?.cancellable === true
    && Number.isInteger(notice.revision) && (notice.revision ?? 0) > 0;
}

/** The hosted review is built and waits for the user's confirm (or cancel). */
export function isHostedReviewPending(notice: {
  state: string;
  targetKind?: string | null;
  hosted?: { reviewReadyAt?: string | null; reviewConfirmedAt?: string | null } | null;
}): boolean {
  return isHostedMigration(notice)
    && notice.state === "in_transit"
    && Boolean(notice.hosted?.reviewReadyAt)
    && !notice.hosted?.reviewConfirmedAt;
}

/** 0-based step in HOSTED_MIGRATION_PROGRESS_STEPS; the steps' length once completed. */
export function hostedMigrationProgressStep(notice: {
  state: string;
  readyAt?: string | null;
  flippedAt?: string | null;
  hosted?: { reviewReadyAt?: string | null } | null;
}): number {
  if (isCompletedMigrationState(notice.state)) return HOSTED_MIGRATION_PROGRESS_STEPS.length;
  if (notice.flippedAt || notice.state === "arriving" || notice.state === "starting") return 3;
  if (notice.hosted?.reviewReadyAt) return 2;
  if (notice.readyAt || notice.state === "ready" || notice.state === "in_transit") return 1;
  return 0;
}

export function migrationProgressStep(notice: {
  state: string;
  sourceQuiescedAt?: string | null;
  transportControlRegisteredAt?: string | null;
  readyAt?: string | null;
  flippedAt?: string | null;
  arrivedAt?: string | null;
}): number {
  const step = migrationStateInfo(notice.state)?.step ?? 0;
  if (step === MIGRATION_PROGRESS_STEPS.length) return step;
  const observed = notice.arrivedAt || notice.flippedAt
    ? 3
    : notice.readyAt || notice.transportControlRegisteredAt
      ? 2
      : notice.sourceQuiescedAt
        ? 1
        : 0;
  return Math.max(step, observed);
}
