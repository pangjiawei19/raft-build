import type { IntlShape } from "react-intl";
import { currentTimeMs } from "@botiverse/raft-shared";
import type { Machine } from "../../store/machineStore";
import { formatFileSizeBytes } from "../../utils/fileSizePresentation";
import {
  conventionalAgentWorkspacePath,
  migrationAbortDetailMessageId,
  migrationErrorPresentation,
  migrationFailureCopyCode,
  parseMigrationComputerCapabilityDetails,
  parseMigrationResumableCapabilityDetail,
} from "./errors";
import type { MigrationErrorPresentation } from "./errors";
import type { MessageId } from "../../i18n/messages";
import type { AgentMigrationNotice } from "./realtime";
import { isHostedMigration, isHostedReviewPending } from "./state";

export function migrationTargetLabel(formatMessage: IntlShape["formatMessage"], machines: Machine[], targetMachineId: string | null | undefined): string {
  if (!targetMachineId) return formatMessage({ id: "agent.detail.unknownComputer" });
  return machines.find((machine) => machine.id === targetMachineId)?.name ?? targetMachineId.slice(0, 8);
}

/**
 * After the switch a move to the cloud can stall without ending: the import or
 * the agent's setup in the cloud failed, but a retry can still finish it. The
 * migration stays `arriving` with one of these reasons (server R5).
 */
const HOSTED_ARRIVAL_ATTENTION_IDS = {
  HOSTED_IMPORT_FAILED: "agent.migration.hosted.attention.importFailed",
  HOSTED_IMPORT_STALLED: "agent.migration.hosted.attention.importStalled",
  HOSTED_PROVIDER_FAILED: "agent.migration.hosted.attention.providerFailed",
  // Not retryable: the cloud never sets up a deleted agent again under the same agent.
  HOSTED_AGENT_DELETED: "agent.migration.hosted.attention.agentDeleted",
  HOSTED_PROVIDER_MISMATCH: "agent.migration.hosted.attention.providerMismatch",
} as const satisfies Record<string, MessageId>;

/** The reason a switched move to the cloud needs attention, or null while it is fine or over. */
export function hostedArrivalAttentionReason(notice: {
  state: string;
  targetKind?: string | null;
  failureReason?: string | null;
}): keyof typeof HOSTED_ARRIVAL_ATTENTION_IDS | null {
  if (!isHostedMigration(notice) || (notice.state !== "arriving" && notice.state !== "starting")) return null;
  const reason = notice.failureReason ?? "";
  return Object.hasOwn(HOSTED_ARRIVAL_ATTENTION_IDS, reason) ? reason as keyof typeof HOSTED_ARRIVAL_ATTENTION_IDS : null;
}

/** The cloud never set the agent up, so Raft put it back on its Computer (terminal `failed`). */
const HOSTED_AGENT_NOT_CREATED = "HOSTED_AGENT_NOT_CREATED";

/** Where the migration goes: the target computer's name, or the cloud for a move to the cloud. */
export function migrationNoticeTargetLabel(
  formatMessage: IntlShape["formatMessage"],
  machines: Machine[],
  notice: { targetKind?: string | null; targetMachineId?: string | null },
): string {
  if (isHostedMigration(notice)) return formatMessage({ id: "agent.migration.hosted.targetName" });
  return migrationTargetLabel(formatMessage, machines, notice.targetMachineId);
}

export function migrationStartErrorPresentation(
  err: unknown,
  formatMessage: IntlShape["formatMessage"],
  computers: {
    sourceComputerName?: string | null;
    targetComputerName?: string | null;
    sourceComputerId?: string | null;
    targetComputerId?: string | null;
  } = {},
): MigrationErrorPresentation {
  const e = err as {
    response?: { data?: { error?: string; code?: string; details?: unknown } };
    message?: string;
  } | null;
  return migrationErrorPresentation({
    code: e?.response?.data?.code,
    rawMessage: e?.response?.data?.error ?? e?.message,
    context: "start",
    // task #1268: TARGET_RUNTIME_DETECTION_PENDING copy depends on details.detectionStatus.
    details: e?.response?.data?.details,
    computerCapabilityDetails: parseMigrationComputerCapabilityDetails(
      e?.response?.data?.details,
    ),
    resumableCapabilityDetail: parseMigrationResumableCapabilityDetail(
      e?.response?.data?.details,
    ),
    ...computers,
  }, formatMessage);
}

export function migrationStatusErrorPresentation(
  error: { code?: string; message?: string },
  formatMessage: IntlShape["formatMessage"],
): MigrationErrorPresentation {
  return migrationErrorPresentation({
    code: error.code,
    rawMessage: error.message,
    context: "status",
  }, formatMessage);
}

/**
 * Failure copy for a migration that ended. Before the flip the agent never left
 * the source, so the copy says that first; a user's first worry is whether the
 * agent still works.
 */
function migrationFailurePresentation(
  notice: AgentMigrationNotice,
  machines: Machine[],
  formatMessage: IntlShape["formatMessage"],
  formatTimestamp: (value: string) => string,
): MigrationErrorPresentation {
  if (isHostedMigration(notice) && (notice.failureReason === HOSTED_AGENT_NOT_CREATED || notice.transportErrorCode === HOSTED_AGENT_NOT_CREATED)) {
    const source = migrationTargetLabel(formatMessage, machines, notice.sourceMachineId);
    return {
      placement: formatMessage({ id: "agent.detail.migrationStillOnSource" }, { source }),
      message: formatMessage({ id: "agent.migration.hosted.agentNotCreated" }, { source }),
      technicalCode: HOSTED_AGENT_NOT_CREATED,
    };
  }
  if (notice.flippedAt) {
    const target = migrationTargetLabel(formatMessage, machines, notice.targetMachineId);
    const reason = migrationFailureReasonPresentation(notice, machines, formatMessage, formatTimestamp);
    return {
      ...reason,
      message: isHostedMigration(notice)
        ? formatMessage({ id: "agent.migration.hosted.failedAfterMove" })
        : formatMessage({ id: "agent.detail.migrationFailedAfterMove" }, { target }),
    };
  }
  const source = migrationTargetLabel(formatMessage, machines, notice.sourceMachineId);
  const reason = migrationFailureReasonPresentation(notice, machines, formatMessage, formatTimestamp);
  return {
    ...reason,
    placement: formatMessage({ id: "agent.detail.migrationStillOnSource" }, { source }),
  };
}

function migrationFailureReasonPresentation(
  notice: AgentMigrationNotice,
  machines: Machine[],
  formatMessage: IntlShape["formatMessage"],
  formatTimestamp: (value: string) => string,
): MigrationErrorPresentation {
  const sourceMachine = machines.find((machine) => machine.id === notice.sourceMachineId);
  const targetMachine = machines.find((machine) => machine.id === notice.targetMachineId);
  const source = migrationTargetLabel(formatMessage, machines, notice.sourceMachineId);
  const target = migrationNoticeTargetLabel(formatMessage, machines, notice);
  if (notice.state === "aborted") {
    const fallback = migrationErrorPresentation({
      context: "aborted",
      reason: notice.abortReason,
    }, formatMessage);
    const prepDeadlineAt = notice.prepDeadlineAt ?? null;
    const id = migrationAbortDetailMessageId(notice.abortReason, prepDeadlineAt !== null);
    return {
      message: formatMessage({ id }, {
        source,
        target,
        ...(prepDeadlineAt ? { deadline: formatTimestamp(prepDeadlineAt) } : {}),
      }),
      ...(fallback.technicalCode ? { technicalCode: fallback.technicalCode } : {}),
    };
  }
  const copyCode = migrationFailureCopyCode(notice.transportErrorCode, notice.failureReason);
  // There is no second computer in a move to the cloud: only the upload from the source can drop.
  if (isHostedMigration(notice) && copyCode === "MIGRATION_TRANSPORT_LOST") {
    return {
      message: formatMessage({ id: "agent.migration.hosted.transportLost" }, { source }),
      technicalCode: copyCode,
    };
  }
  return migrationErrorPresentation({
    code: copyCode,
    rawMessage: notice.transportErrorMessage,
    context: "failed",
    reason: notice.abortReason,
    // Workspace conflicts are the one failure whose remedy is a directory the
    // user has to find. `agentId` is always on the notice, so the copy can at
    // least point at the conventional location instead of leaving them to guess.
    agentWorkspacePath: conventionalAgentWorkspacePath(notice.agentId),
    sourceComputerName: source,
    targetComputerName: target,
    sourceComputerStatus: sourceMachine?.status,
    targetComputerStatus: targetMachine?.status,
    transportLostAt: notice.transportLostAt,
    formatTimestamp,
  }, formatMessage);
}

function migrationSourceStageMessage(
  formatMessage: IntlShape["formatMessage"],
  notice: AgentMigrationNotice,
  source: string,
  target: string,
): string {
  if (notice.transportControlRegisteredAt) {
    return isHostedMigration(notice)
      ? formatMessage({ id: "agent.migration.hosted.uploading" }, { source })
      : formatMessage({ id: "agent.detail.migrationUploading" }, { source, target });
  }
  if (!notice.sourceQuiescedAt) {
    return formatMessage({ id: "agent.detail.migrationStoppingSource" }, { source });
  }
  const progress = notice.sourceBuildProgress;
  if (progress && (progress.files > 0 || progress.bytes > 0)) {
    return formatMessage({ id: "agent.detail.migrationPackingProgress" }, {
      source,
      files: progress.files,
      size: formatFileSizeBytes(progress.bytes, formatMessage),
    });
  }
  const elapsedMinutes = Math.floor((currentTimeMs() - Date.parse(notice.sourceQuiescedAt)) / 60_000);
  if (elapsedMinutes >= 1) {
    return formatMessage({ id: "agent.detail.migrationPackingElapsed" }, { source, minutes: elapsedMinutes });
  }
  return formatMessage({ id: "agent.detail.migrationPacking" }, { source });
}

/**
 * Stage copy for a move to the cloud where it differs from a computer move:
 * the cloud checks the files, the user reviews, then the agent switches. Null
 * falls back to the shared copy (stopping/packing on the source, failures,
 * cancel states, which pick their hosted wording inline).
 */
function hostedMigrationStageMessage(
  formatMessage: IntlShape["formatMessage"],
  notice: AgentMigrationNotice,
  source: string,
): string | null {
  switch (notice.state) {
    case "ready":
      return formatMessage({ id: "agent.migration.hosted.checkingFiles" });
    case "in_transit":
      return isHostedReviewPending(notice)
        ? formatMessage({ id: "agent.migration.hosted.waitingForReview" }, { source })
        : formatMessage({ id: "agent.migration.hosted.checkingFiles" });
    case "arriving":
    case "starting":
      return formatMessage({ id: "agent.migration.hosted.switching" });
    default:
      return null;
  }
}

export function migrationSupportRef(notice: AgentMigrationNotice): string {
  return notice.migrationRef;
}

export type MigrationNoticePresentation = MigrationErrorPresentation & {
  intent: "info" | "warning" | "success";
  title: string;
};

export function migrationNoticePresentation(
  formatMessage: IntlShape["formatMessage"],
  notice: AgentMigrationNotice,
  machines: Machine[],
  formatTimestamp: (value: string) => string,
): MigrationNoticePresentation {
  const source = migrationTargetLabel(formatMessage, machines, notice.sourceMachineId);
  const target = migrationNoticeTargetLabel(formatMessage, machines, notice);
  const status = (message: string): MigrationNoticePresentation => ({
    intent: "info",
    title: formatMessage({ id: "agent.detail.migrationStatus" }),
    message,
  });
  const attention = hostedArrivalAttentionReason(notice);
  if (attention) {
    return {
      intent: "warning",
      title: formatMessage({ id: "agent.migration.hosted.attention.title" }),
      placement: formatMessage({ id: "agent.migration.hosted.attention.placement" }),
      message: formatMessage({ id: HOSTED_ARRIVAL_ATTENTION_IDS[attention] }),
      technicalCode: attention,
    };
  }
  if (isHostedMigration(notice)) {
    const hosted = hostedMigrationStageMessage(formatMessage, notice, source);
    if (hosted) return status(hosted);
  }
  switch (notice.state) {
    case "failed":
      return {
        intent: "warning",
        title: formatMessage({ id: "agent.detail.migrationFailed" }),
        ...migrationFailurePresentation(notice, machines, formatMessage, formatTimestamp),
      };
    case "aborted":
      return {
        intent: "warning",
        title: formatMessage({ id: "agent.detail.migrationAborted" }),
        ...migrationFailurePresentation(notice, machines, formatMessage, formatTimestamp),
      };
    case "cancel_requested_pre_flip":
      return notice.cancelNeedsAttention
        ? {
            intent: "warning",
            title: formatMessage({ id: "agent.migration.cancellationNeedsAttention" }),
            message: isHostedMigration(notice)
              ? formatMessage({ id: "agent.migration.hosted.cancelAttentionMessage" }, { source })
              : formatMessage({ id: "agent.migration.cancelPreAttentionMessage" }),
            technicalCode: notice.cancelErrorCode ?? undefined,
          }
        : {
            intent: "info",
            title: formatMessage({ id: "agent.migration.cancelingTitle" }),
            message: isHostedMigration(notice)
              ? formatMessage({ id: "agent.migration.hosted.cancelingMessage" }, { source })
              : formatMessage({ id: "agent.migration.cancelPreMessage" }),
          };
    case "cancel_requested_post_flip":
      return notice.cancelNeedsAttention
        ? {
            intent: "warning",
            title: formatMessage({ id: "agent.migration.cancellationNeedsAttention" }),
            message: formatMessage({ id: "agent.migration.cancelPostAttentionMessage" }),
            technicalCode: notice.cancelErrorCode ?? undefined,
          }
        : {
            intent: "info",
            title: formatMessage({ id: "agent.migration.stoppingMigratedAgentTitle" }),
            message: formatMessage({ id: "agent.migration.cancelPostMessage" }),
          };
    case "canceled_pre_flip":
      return {
        intent: "info",
        title: formatMessage({ id: "agent.migration.canceledTitle" }),
        message: isHostedMigration(notice)
          ? formatMessage({ id: "agent.migration.hosted.canceledMessage" }, { source })
          : formatMessage({ id: "agent.migration.canceledPreMessage" }),
      };
    case "canceled_post_flip":
      return {
        intent: "info",
        title: formatMessage({ id: "agent.migration.canceledTitle" }),
        message: formatMessage({ id: "agent.migration.canceledPostMessage" }),
      };
    case "provisioning":
      return status(migrationSourceStageMessage(formatMessage, notice, source, target));
    case "prep":
      return status(formatMessage({ id: "agent.detail.migrationPacking" }, { source }));
    case "ready":
      return status(formatMessage({ id: "agent.detail.migrationReady" }, { target }));
    case "in_transit":
      return status(formatMessage({ id: "agent.detail.migrationTransferring" }, { target }));
    case "arriving":
      return status(formatMessage({ id: "agent.detail.migrationArriving" }, { target }));
    case "starting":
      return notice.failureReason === "auto_start_failed"
        ? {
            intent: "warning",
            title: formatMessage({ id: "agent.detail.agentDidNotStart" }),
            message: formatMessage({ id: "agent.detail.agentDidNotStartMessage" }, { target }),
            technicalCode: "auto_start_failed",
          }
        : status(formatMessage({ id: "agent.detail.migrationStarting" }, { target }));
    case "completed":
      return {
        intent: "success",
        title: formatMessage({ id: "agent.detail.migrationStatus" }),
        message: isHostedMigration(notice)
          ? formatMessage({ id: "agent.migration.hosted.completed" })
          : formatMessage({ id: "agent.detail.migrationCompleted" }, { target }),
      };
    default:
      return status(formatMessage(
        { id: "agent.detail.migrationUnknownState" },
        { state: String(notice.state), target },
      ));
  }
}
