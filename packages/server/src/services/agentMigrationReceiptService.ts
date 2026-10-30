import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { Server as SocketServer } from "socket.io";
import {
  currentDate,
  setClockInterval,
  type AgentMigrationHostedImportSummary,
  type AgentMigrationHostedSkipReason,
  type AgentMigrationTransferSummary,
  EXTERNAL_AGENT_RUNTIME_ID,
} from "@botiverse/raft-shared";
import { getDb, type DatabaseExecutor } from "../db/index";
import {
  agentMigrationReceiptChannels,
  agentMigrationReceiptOutbox,
  agentMigrations,
  agents,
  channels,
  jointChannels,
  jointChannelServers,
  messages,
} from "../db/schema";
import type { AgentOrchestrator } from "./agentOrchestrator";
import {
  broadcastSystemMessage,
  recordInboxFactsForPersistedMessages,
} from "./messageService";
import {
  classifyAgentMigrationReceiptDrain,
  createAgentMigrationWorkerObservability,
  type AgentMigrationReceiptRetryExhaustion,
  type AgentMigrationWorkerObservability,
} from "./agentMigrationWorkerObservability";

type AgentMigrationReceiptKind = (typeof agentMigrationReceiptOutbox.$inferSelect)["receiptKind"];
const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_STALE_LEASE_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
/** Rows looked at per drain; offline-computer rows are skipped, so scan past them. */
const DRAIN_SCAN_LIMIT = 500;
/** Consecutive failed delivery attempts before a receipt row is parked (~75 min with backoff). */
export const AGENT_MIGRATION_RECEIPT_MAX_ATTEMPTS = 20;
const RECEIPT_RETRY_BASE_MS = 5_000;
const RECEIPT_RETRY_MAX_MS = 5 * 60_000;

/** Wait after `attemptCount` consecutive failures: 5s, 10s, 20s, ... capped at 5 min. */
export function agentMigrationReceiptRetryDelayMs(attemptCount: number): number {
  if (attemptCount <= 0) return 0;
  return Math.min(RECEIPT_RETRY_BASE_MS * 2 ** (attemptCount - 1), RECEIPT_RETRY_MAX_MS);
}

export interface AgentMigrationReceiptEnqueueHooks {
  beforeOutboxInsert?: () => void | Promise<void>;
}

type ReceiptSurfaceResolution = {
  channel: typeof channels.$inferSelect;
};

async function hasActiveJointProjectionForReceiptServer(
  executor: DatabaseExecutor,
  channelId: string,
  serverId: string,
): Promise<boolean> {
  const [projection] = await executor.select({ channelId: jointChannelServers.localChannelId })
    .from(jointChannelServers)
    .innerJoin(jointChannels, eq(jointChannels.id, jointChannelServers.jointChannelId))
    .where(and(
      eq(jointChannelServers.localChannelId, channelId),
      eq(jointChannelServers.serverId, serverId),
      eq(jointChannelServers.status, "active"),
      eq(jointChannels.status, "active"),
    ))
    .limit(1);
  return Boolean(projection);
}

async function resolveAgentMigrationReceiptSurface(
  executor: DatabaseExecutor,
  migration: typeof agentMigrations.$inferSelect,
): Promise<ReceiptSurfaceResolution | null> {
  if (!migration.receiptChannelId) return null;
  const receiptChannelId = migration.receiptChannelId;
  const [surface] = await executor.select({ receiptChannel: agentMigrationReceiptChannels, channel: channels })
    .from(agentMigrationReceiptChannels)
    .innerJoin(channels, eq(channels.id, agentMigrationReceiptChannels.channelId))
    .where(and(
      eq(agentMigrationReceiptChannels.channelId, receiptChannelId),
      eq(agentMigrationReceiptChannels.migrationId, migration.id),
      eq(agentMigrationReceiptChannels.serverId, migration.serverId),
      eq(agentMigrationReceiptChannels.agentId, migration.agentId),
      isNull(channels.deletedAt),
    ))
    .limit(1);
  if (!surface) return null;

  const channelInReceiptServer = surface.channel.serverId === surface.receiptChannel.serverId
    || await hasActiveJointProjectionForReceiptServer(
      executor,
      surface.channel.id,
      surface.receiptChannel.serverId,
    );
  if (!channelInReceiptServer) return null;
  return { channel: surface.channel };
}

/** Receipts are read by people and agents: 1536 -> "1.5 KB" (binary units). */
export function formatReceiptBytes(bytes: number): string {
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${bytes} bytes`;
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}

export function formatAgentMigrationCompletedReceipt(input: {
  sourceMachineName: string;
  targetMachineName: string;
  supportRef: string;
  // Null for legacy migrations that predate transfer_summary; the receipt says
  // so instead of blocking completion on data that was never recorded.
  summary: AgentMigrationTransferSummary | null;
  /** The source copy has not been archived yet (cleanup continues in the background). */
  sourceCleanupPending?: boolean;
}): string {
  const cleanupLine = input.sourceCleanupPending
    ? `The old copy on ${input.sourceMachineName} is still being cleaned up in the background; this does not affect the agent.`
    : null;
  return [formatCompletedReceiptBody(input), cleanupLine].filter((line): line is string => line !== null).join("\n");
}

function formatCompletedReceiptBody(input: {
  sourceMachineName: string;
  targetMachineName: string;
  supportRef: string;
  summary: AgentMigrationTransferSummary | null;
}): string {
  const { summary } = input;
  if (!summary) {
    return [
      `Migration completed. Moved from ${input.sourceMachineName} to ${input.targetMachineName}.`,
      `Migration support ref: ${input.supportRef}.`,
      "Transfer details are unavailable for this legacy migration.",
      "The workspace moved successfully.",
      "工作区已迁移；该历史迁移没有记录传输明细。",
    ].join("\n");
  }
  const excluded = summary.excludedRegenerableByCategory;
  const keyEntries = [
    summary.keyWorkspaceEntries.memoryMdPresent ? "MEMORY.md" : null,
    summary.keyWorkspaceEntries.notesPresent ? "notes" : null,
  ].filter((entry): entry is string => entry !== null);
  const keyEntrySentence = keyEntries.length > 0
    ? ` ${keyEntries.join(" and ")} existed in the workspace and moved with it.`
    : "";
  const chineseKeyEntrySentence = keyEntries.length > 0
    ? `；其中原本存在的 ${keyEntries.join(" 和 ")} 已随工作区迁移。`
    : "。";

  const ignored = summary.excludedIgnored;
  const ignoredLargest = ignored?.largest.map((entry) => `${entry.path} (${formatReceiptBytes(entry.bytes)})`).join(", ");
  const ignoredLines = ignored
    ? [
      `Not moved, as listed in .raftmigrateignore: ${ignored.count} paths, ${ignored.fileCount} files (${formatReceiptBytes(ignored.bytes)})${ignoredLargest ? `; largest: ${ignoredLargest}` : ""}. The old workspace is archived on ${input.sourceMachineName} and kept for up to 30 days, so anything missing can be recovered from there.`,
      `按 .raftmigrateignore 未迁移：${ignored.count} 个路径，${ignored.fileCount} 个文件（${formatReceiptBytes(ignored.bytes)}）。旧工作区归档在 ${input.sourceMachineName} 上，最多保留 30 天，缺了可以从那里找回。`,
    ]
    : [];

  return [
    `Migration completed. Moved from ${input.sourceMachineName} to ${input.targetMachineName}.`,
    `Migration support ref: ${input.supportRef}.`,
    `Moved ${summary.includedFileCount} files (${formatReceiptBytes(summary.includedBytes)}). Filtered ${summary.excludedRegenerableCount} regenerable entries: third-party dependencies ${excluded.thirdPartyDependencies}, caches ${excluded.caches}, build outputs ${excluded.buildArtifacts}, other regenerable files ${excluded.otherRegenerable}.`,
    ...ignoredLines,
    `The workspace moved successfully.${keyEntrySentence}`,
    `迁移过程中会过滤部分第三方依赖、缓存、构建产物等可重新生成的非关键文件；工作区已迁移${chineseKeyEntrySentence}`,
  ].join("\n");
}

function wireValue(rawMessage: string, key: string): string | null {
  return rawMessage.match(new RegExp(`(?:^|:)${key}=([^:]*)`))?.[1] ?? null;
}

/** "path,n;path,n" with URI-encoded paths, as the source daemon reports them. */
function parseWirePathList(encoded: string | null): Array<{ path: string; value: number }> {
  if (!encoded) return [];
  const entries: Array<{ path: string; value: number }> = [];
  for (const item of encoded.split(";").slice(0, 3)) {
    const separator = item.lastIndexOf(",");
    if (separator <= 0) continue;
    let path: string;
    try {
      path = decodeURIComponent(item.slice(0, separator));
    } catch {
      continue;
    }
    const value = Number(item.slice(separator + 1));
    if (path.length > 128 || /[\u0000-\u001f\u007f]/.test(path) || !Number.isSafeInteger(value) || value < 0) continue;
    entries.push({ path, value });
  }
  return entries;
}

/**
 * A workspace too big to move is the one failure the agent itself can act on.
 * State only what the source already measured while packing (no extra scan),
 * then the next step; which paths to remove is the agent's call.
 */
export function formatAgentMigrationWorkspaceSizeLines(rawMessage: string | null | undefined): string[] {
  if (!rawMessage) return [];
  let measured: string;
  let largest: string;
  let largestLabel = "Largest";
  if (rawMessage.startsWith("MIGRATION_OBJECT_STORE_ENTRY_COUNT_LIMIT_EXCEEDED:")) {
    const entryCount = Number(wireValue(rawMessage, "entryCount"));
    const maxEntries = Number(wireValue(rawMessage, "maxEntries"));
    if (!Number.isSafeInteger(entryCount) || !Number.isSafeInteger(maxEntries) || maxEntries <= 0) return [];
    measured = `The workspace has ${entryCount} files and folders; the limit is ${maxEntries}.`;
    largest = parseWirePathList(wireValue(rawMessage, "topPathCounts"))
      .map((entry) => `${entry.path} (${entry.value})`)
      .join(", ");
  } else if (rawMessage.startsWith("MIGRATION_OBJECT_STORE_BUNDLE_TOO_LARGE:")) {
    const actualBytes = Number(wireValue(rawMessage, "actualBytes"));
    const maxBytes = Number(wireValue(rawMessage, "maxBytes"));
    if (!Number.isSafeInteger(actualBytes) || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) return [];
    // The source stops packing at the limit, so actualBytes is a lower bound.
    measured = `The workspace is over the ${formatReceiptBytes(maxBytes)} limit.`;
    // Path sizes are uncompressed; the limit applies to the compressed bundle.
    largestLabel = "Largest, before compression";
    largest = parseWirePathList(wireValue(rawMessage, "topEntries"))
      .map((entry) => `${entry.path} (${formatReceiptBytes(entry.value)})`)
      .join(", ");
  } else {
    return [];
  }
  return [
    largest ? `${measured} ${largestLabel}: ${largest}.` : measured,
    "To move it, delete what you no longer need or list it in .raftmigrateignore (listed paths are not moved), then ask for the migration to be retried.",
  ];
}

export function formatAgentMigrationTerminalReceipt(input: {
  kind: Exclude<AgentMigrationReceiptKind, "completed">;
  sourceMachineName: string;
  targetMachineName: string;
  supportRef: string;
  reason?: string | null;
  /** Raw daemon error message; only workspace-size failures add lines from it. */
  detail?: string | null;
  needsAttention?: boolean;
  /** Whether the agent had already been moved to the target when the migration ended. */
  flipped?: boolean;
}): string {
  const direction = `from ${input.sourceMachineName} to ${input.targetMachineName}`;
  const reason = input.reason ? ` Reason: ${input.reason}.` : "";
  // The agent will most likely be asked what happened, so say where it is now.
  const placement = input.flipped
    ? `Your workspace is now on ${input.targetMachineName}.`
    : `You are still on ${input.sourceMachineName}; your workspace there was not changed.`;
  if (input.kind === "canceled") {
    const cleanup = input.needsAttention
      ? " Background cleanup still needs attention, but this canceled migration no longer blocks new work."
      : " Background cleanup will continue independently if any cleanup acknowledgement is still missing.";
    return [
      `Migration canceled. The migration ${direction} has been stopped.`,
      `Migration support ref: ${input.supportRef}.${reason}${cleanup}`,
      "You can continue once the next task reaches this agent; this canceled migration is no longer the active gate.",
    ].join("\n");
  }
  if (input.kind === "aborted") {
    return [
      `Migration aborted. The migration ${direction} ran out of time and was stopped.`,
      placement,
      `Migration support ref: ${input.supportRef}.${reason}`,
      "This migration is no longer the active gate; messages held during it are delivered normally again.",
    ].join("\n");
  }
  return [
    `Migration failed. The migration ${direction} did not complete.`,
    placement,
    `Migration support ref: ${input.supportRef}.${reason}`,
    ...formatAgentMigrationWorkspaceSizeLines(input.detail),
    "This migration has ended; a new migration can be started separately.",
  ].join("\n");
}

async function enqueueAgentMigrationReceipt(
  executor: DatabaseExecutor,
  migration: typeof agentMigrations.$inferSelect,
  receiptKind: AgentMigrationReceiptKind,
  content: string,
  now: Date,
  hooks: AgentMigrationReceiptEnqueueHooks = {},
): Promise<typeof messages.$inferSelect> {
  // A hosted target has no machine name; the receipt text already names it.
  if (
    !migration.receiptChannelId
    || !migration.sourceMachineNameSnapshot
    || (migration.targetKind === "computer" && !migration.targetMachineNameSnapshot)
  ) {
    throw new Error("MIGRATION_RECEIPT_CONTEXT_MISSING");
  }

  const surface = await resolveAgentMigrationReceiptSurface(executor, migration);
  const channel = surface?.channel;
  if (!channel || channel.type !== "dm") {
    throw new Error("MIGRATION_RECEIPT_SURFACE_INVALID");
  }

  const [surfaceShape] = await executor.select({
    agentCount: sql<number>`(SELECT count(*)::int FROM channel_agents WHERE channel_id = ${channel.id})`,
    exactAgentCount: sql<number>`(SELECT count(*)::int FROM channel_agents WHERE channel_id = ${channel.id} AND agent_id = ${migration.agentId})`,
    humanCount: sql<number>`(SELECT count(*)::int FROM channel_humans WHERE channel_id = ${channel.id})`,
  })
    .from(channels)
    .where(eq(channels.id, channel.id))
    .limit(1);
  if (
    !surfaceShape
    || surfaceShape.agentCount !== 1
    || surfaceShape.exactAgentCount !== 1
    || surfaceShape.humanCount !== 0
  ) {
    throw new Error("MIGRATION_RECEIPT_SURFACE_AUDIENCE_INVALID");
  }

  const [existing] = await executor.select()
    .from(agentMigrationReceiptOutbox)
    .where(and(
      eq(agentMigrationReceiptOutbox.migrationId, migration.id),
      eq(agentMigrationReceiptOutbox.receiptKind, receiptKind),
    ))
    .limit(1);
  if (existing) {
    const [existingMessage] = await executor.select().from(messages).where(eq(messages.id, existing.messageId)).limit(1);
    if (!existingMessage) throw new Error("MIGRATION_RECEIPT_MESSAGE_MISSING");
    return existingMessage;
  }

  const [message] = await executor.insert(messages).values({
    id: randomUUID(),
    channelId: channel.id,
    senderType: "user",
    senderId: "system",
    messageType: "system",
    content,
    searchText: content,
    // notify-exclude: the migrated agent IS the intended reader and must see
    // this unread, so no causalActor (writing it would born-read-exclude them).
    systemSubtype: `agent.migration_${receiptKind}_receipt`,
    createdAt: now,
    updatedAt: now,
  }).returning();

  await recordInboxFactsForPersistedMessages([message], {
    inboxFactPolicy: {
      mode: "record",
      producer: `agent.migration_${receiptKind}_receipt`,
      reason: `Authoritative migration ${receiptKind} state is durable agent-visible activity`,
    },
    executor,
    channel,
  });
  await hooks.beforeOutboxInsert?.();
  await executor.insert(agentMigrationReceiptOutbox).values({
    migrationId: migration.id,
    receiptKind,
    serverId: migration.serverId,
    agentId: migration.agentId,
    channelId: channel.id,
    messageId: message.id,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });
  return message;
}

// A hosted target has no machine name; receipts name the destination instead.
const HOSTED_TARGET_RECEIPT_NAME = "the cloud";

/**
 * The failure reason of a hosted migration undone after the switch because the
 * provider never created the agent: the agent is back on its Computer, so its
 * receipt must not say the workspace moved.
 */
export const HOSTED_MIGRATION_NOT_CREATED_REASON = "HOSTED_AGENT_NOT_CREATED";

const HOSTED_SKIP_REASON_LABELS: Record<AgentMigrationHostedSkipReason, string> = {
  symlink: "symbolic links",
  git: "git data",
  raft_state: "Raft state files",
  path_rule: "excluded paths",
  reserved: "reserved names",
  file_too_large: "files over the per-file limit",
  not_text: "non-text files",
  over_budget: "files past the size budget",
  provider_rejected: "files the cloud refused (e.g. credential-like)",
};

export function formatHostedMigrationCompletedReceipt(input: {
  sourceMachineName: string;
  supportRef: string;
  summary: AgentMigrationHostedImportSummary | null;
  /** The source copy has not been archived yet (cleanup continues in the background). */
  sourceCleanupPending?: boolean;
}): string {
  const { summary } = input;
  const skipped = summary?.skipped.filter((group) => group.count > 0) ?? [];
  const skippedLines = skipped.length > 0
    ? [
      `Not brought over: ${skipped.map((group) => {
        const examples = group.largestPaths.length > 0 ? ` (e.g. ${group.largestPaths.slice(0, 3).join(", ")})` : "";
        return `${group.count} ${HOSTED_SKIP_REASON_LABELS[group.reason]}, ${formatReceiptBytes(group.bytes)}${examples}`;
      }).join("; ")}.`,
      `The old workspace is archived on ${input.sourceMachineName} and kept for up to 30 days, so anything missing can be recovered from there.`,
    ]
    : [];
  const cleanupLine = input.sourceCleanupPending
    ? `The old copy on ${input.sourceMachineName} is still being cleaned up in the background; this does not affect the agent.`
    : null;
  return [
    `Migration completed. Moved from ${input.sourceMachineName} to the cloud; you now run as a cloud agent.`,
    `Migration support ref: ${input.supportRef}.`,
    summary
      ? `Brought over ${summary.importedFileCount} files (${formatReceiptBytes(summary.importedBytes)}).`
      : "The workspace files were brought over.",
    ...skippedLines,
    `Your session context from ${input.sourceMachineName} did not come over; pick up from MEMORY.md and notes/.`,
    "GitHub needs to be reconnected once for this agent. MCP connections are unchanged.",
    cleanupLine,
    "已迁移到云端：会话上下文没有带过来，请从 MEMORY.md 和 notes/ 继续；GitHub 需要重新连接一次。",
  ].filter((line): line is string => line !== null).join("\n");
}

function receiptTargetName(migration: typeof agentMigrations.$inferSelect): string {
  return migration.targetMachineNameSnapshot ?? HOSTED_TARGET_RECEIPT_NAME;
}

export async function enqueueAgentMigrationCompletedReceipt(
  executor: DatabaseExecutor,
  migration: typeof agentMigrations.$inferSelect,
  now: Date,
  hooks: AgentMigrationReceiptEnqueueHooks = {},
): Promise<typeof messages.$inferSelect> {
  if (migration.state !== "completed") throw new Error("MIGRATION_RECEIPT_NOT_COMPLETED");
  if (migration.targetKind === "hosted") throw new Error("MIGRATION_RECEIPT_HOSTED_NEEDS_SUMMARY");
  return enqueueAgentMigrationReceipt(
    executor,
    migration,
    "completed",
    formatAgentMigrationCompletedReceipt({
      sourceMachineName: migration.sourceMachineNameSnapshot,
      targetMachineName: receiptTargetName(migration),
      supportRef: migration.supportRef,
      summary: migration.transferSummary,
      sourceCleanupPending: !migration.sourceWorkspaceArchivedAt,
    }),
    now,
    hooks,
  );
}

/** The completed receipt of a hosted migration: what came over, what did not, and what to redo. */
export async function enqueueHostedAgentMigrationCompletedReceipt(
  executor: DatabaseExecutor,
  migration: typeof agentMigrations.$inferSelect,
  summary: AgentMigrationHostedImportSummary | null,
  now: Date,
  hooks: AgentMigrationReceiptEnqueueHooks = {},
): Promise<typeof messages.$inferSelect> {
  if (migration.state !== "completed" || migration.targetKind !== "hosted") throw new Error("MIGRATION_RECEIPT_NOT_COMPLETED");
  return enqueueAgentMigrationReceipt(
    executor,
    migration,
    "completed",
    formatHostedMigrationCompletedReceipt({
      sourceMachineName: migration.sourceMachineNameSnapshot,
      supportRef: migration.supportRef,
      summary,
      sourceCleanupPending: !migration.sourceWorkspaceArchivedAt,
    }),
    now,
    hooks,
  );
}

export async function enqueueAgentMigrationCanceledReceipt(
  executor: DatabaseExecutor,
  migration: typeof agentMigrations.$inferSelect,
  now: Date,
  hooks: AgentMigrationReceiptEnqueueHooks = {},
): Promise<typeof messages.$inferSelect> {
  if (migration.state !== "canceled_pre_flip" && migration.state !== "canceled_post_flip") {
    throw new Error("MIGRATION_RECEIPT_NOT_CANCELED");
  }
  return enqueueAgentMigrationReceipt(
    executor,
    migration,
    "canceled",
    formatAgentMigrationTerminalReceipt({
      kind: "canceled",
      sourceMachineName: migration.sourceMachineNameSnapshot,
      targetMachineName: receiptTargetName(migration),
      supportRef: migration.supportRef,
      reason: migration.cancelReason,
      needsAttention: Boolean(migration.cancelNeedsAttentionAt),
    }),
    now,
    hooks,
  );
}

export async function enqueueAgentMigrationFailedReceipt(
  executor: DatabaseExecutor,
  migration: typeof agentMigrations.$inferSelect,
  now: Date,
  hooks: AgentMigrationReceiptEnqueueHooks = {},
): Promise<typeof messages.$inferSelect> {
  if (migration.state !== "failed") throw new Error("MIGRATION_RECEIPT_NOT_FAILED");
  return enqueueAgentMigrationReceipt(
    executor,
    migration,
    "failed",
    formatAgentMigrationTerminalReceipt({
      kind: "failed",
      sourceMachineName: migration.sourceMachineNameSnapshot,
      targetMachineName: receiptTargetName(migration),
      supportRef: migration.supportRef,
      reason: migration.failureReason ?? migration.transportErrorCode,
      detail: migration.transportErrorMessage,
      // A hosted switch undone because the provider never created the agent
      // leaves it on its Computer, as before the switch.
      flipped: migration.flippedAt !== null && migration.failureReason !== HOSTED_MIGRATION_NOT_CREATED_REASON,
    }),
    now,
    hooks,
  );
}

/**
 * Deadline aborts used to end silently: the agent never learned its migration
 * stopped. Unlike the other terminal receipts this one is not a DB-enforced
 * precondition of the state change (callers enqueue it best-effort), so an
 * abort can never be blocked by a missing receipt surface.
 */
export async function enqueueAgentMigrationAbortedReceipt(
  executor: DatabaseExecutor,
  migration: typeof agentMigrations.$inferSelect,
  now: Date,
  hooks: AgentMigrationReceiptEnqueueHooks = {},
): Promise<typeof messages.$inferSelect> {
  if (migration.state !== "aborted") throw new Error("MIGRATION_RECEIPT_NOT_ABORTED");
  return enqueueAgentMigrationReceipt(
    executor,
    migration,
    "aborted",
    formatAgentMigrationTerminalReceipt({
      kind: "aborted",
      sourceMachineName: migration.sourceMachineNameSnapshot,
      targetMachineName: receiptTargetName(migration),
      supportRef: migration.supportRef,
      reason: migration.abortReason,
      flipped: migration.flippedAt !== null,
    }),
    now,
    hooks,
  );
}

/**
 * Deliver pending receipt rows. The receipt message is already persisted
 * (unread for the agent), so delivery is only a nudge:
 * - rows whose agent's computer is offline are skipped without spending an
 *   attempt; seeing the computer offline also resets earlier failures, so a
 *   backed-off or parked row gets a fresh budget once the computer is back;
 * - a failed attempt backs off exponentially (agentMigrationReceiptRetryDelayMs,
 *   from updated_at and attempt_count, no schedule column);
 * - after AGENT_MIGRATION_RECEIPT_MAX_ATTEMPTS failures the row stays pending
 *   but parked (not attempted) and onRetryExhausted reports it once.
 */
export async function drainAgentMigrationReceiptOutbox(input: {
  io: SocketServer;
  orchestrator: AgentOrchestrator;
  batchSize?: number;
  now?: Date;
  staleLeaseMs?: number;
  afterBroadcast?: (messageId: string) => void | Promise<void>;
  onRetryExhausted?: (row: AgentMigrationReceiptRetryExhaustion) => void;
}): Promise<{ attempted: number; sent: number; failed: number }> {
  const db = getDb();
  const now = input.now ?? currentDate();
  const staleLockedAt = new Date(now.getTime() - (input.staleLeaseMs ?? DEFAULT_STALE_LEASE_MS));
  const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
  const scanned = await db.select({ row: agentMigrationReceiptOutbox, machineId: agents.machineId, runtime: agents.runtime })
    .from(agentMigrationReceiptOutbox)
    .leftJoin(agents, eq(agents.id, agentMigrationReceiptOutbox.agentId))
    .where(or(
      eq(agentMigrationReceiptOutbox.status, "pending"),
      and(
        eq(agentMigrationReceiptOutbox.status, "processing"),
        lt(agentMigrationReceiptOutbox.lockedAt, staleLockedAt),
      ),
    ))
    .orderBy(asc(agentMigrationReceiptOutbox.createdAt))
    .limit(DRAIN_SCAN_LIMIT);

  const machineStatus = new Map<string, Promise<"online" | "offline" | "unknown">>();
  const statusOf = (machineId: string | null) => {
    if (!machineId) return Promise.resolve("offline" as const);
    let status = machineStatus.get(machineId);
    if (!status) {
      status = input.orchestrator.getMachineStatus(machineId).catch(() => "unknown" as const);
      machineStatus.set(machineId, status);
    }
    return status;
  };

  const candidates: Array<typeof agentMigrationReceiptOutbox.$inferSelect> = [];
  // An agent that moved to Raft hosted has no Computer: the provider receives
  // its messages (and holds them until its workspace import lands).
  const hostedAgentIds = new Set<string>();
  for (const { row, machineId, runtime } of scanned) {
    const hosted = !machineId && runtime === EXTERNAL_AGENT_RUNTIME_ID;
    if (hosted) hostedAgentIds.add(row.agentId);
    const status = hosted ? "online" : await statusOf(machineId);
    if (status === "offline") {
      if (row.attemptCount > 0) {
        // Failures while the computer is gone say nothing about delivery once
        // it is back: start the budget over (one write, then the row is idle).
        await db.update(agentMigrationReceiptOutbox)
          .set({ status: "pending", attemptCount: 0, lockedAt: null, updatedAt: now })
          .where(and(
            eq(agentMigrationReceiptOutbox.id, row.id),
            eq(agentMigrationReceiptOutbox.status, row.status),
            eq(agentMigrationReceiptOutbox.attemptCount, row.attemptCount),
          ));
      }
      continue;
    }
    if (status !== "online") continue;
    if (row.attemptCount >= AGENT_MIGRATION_RECEIPT_MAX_ATTEMPTS) continue;
    if (
      row.status === "pending"
      && now.getTime() < row.updatedAt.getTime() + agentMigrationReceiptRetryDelayMs(row.attemptCount)
    ) {
      continue;
    }
    candidates.push(row);
    if (candidates.length >= batchSize) break;
  }

  let attempted = 0;
  let sent = 0;
  let failed = 0;
  for (const candidate of candidates) {
    const [claimed] = await db.update(agentMigrationReceiptOutbox)
      .set({
        status: "processing",
        lockedAt: now,
        attemptCount: sql`${agentMigrationReceiptOutbox.attemptCount} + 1`,
        updatedAt: now,
      })
      .where(and(
        eq(agentMigrationReceiptOutbox.id, candidate.id),
        // Unchanged since the scan: no other drainer attempted it meanwhile.
        eq(agentMigrationReceiptOutbox.attemptCount, candidate.attemptCount),
        or(
          eq(agentMigrationReceiptOutbox.status, "pending"),
          and(
            eq(agentMigrationReceiptOutbox.status, "processing"),
            lt(agentMigrationReceiptOutbox.lockedAt, staleLockedAt),
          ),
        ),
      ))
      .returning();
    if (!claimed) continue;
    attempted += 1;

    try {
      const [message] = await db.select().from(messages).where(eq(messages.id, claimed.messageId)).limit(1);
      if (!message) throw new Error("MIGRATION_RECEIPT_MESSAGE_MISSING");
      await broadcastSystemMessage(input.io, input.orchestrator, claimed.channelId, message.content, {
        inboxFactPolicy: {
          mode: "record",
          producer: `agent.migration_${claimed.receiptKind}_receipt`,
          reason: "Durable facts were committed with the migration completion transaction",
        },
        persistedMessage: message,
        targetAgentIds: [claimed.agentId],
        // A daemon acknowledges its queue; the hosted provider is reached by
        // its own push outbox, so there is no queue receipt to wait for.
        awaitAgentDelivery: !hostedAgentIds.has(claimed.agentId),
        bypassAgentMute: true,
        agentDeliveryOptions: {
          intrinsic: true,
          requireQueueReceipt: !hostedAgentIds.has(claimed.agentId),
        },
      });
      await input.afterBroadcast?.(message.id);
      await db.update(agentMigrationReceiptOutbox)
        .set({ status: "sent", sentAt: now, lockedAt: null, lastError: null, updatedAt: now })
        .where(and(
          eq(agentMigrationReceiptOutbox.id, claimed.id),
          eq(agentMigrationReceiptOutbox.status, "processing"),
        ));
      sent += 1;
    } catch (error) {
      const lastError = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      const [released] = await db.update(agentMigrationReceiptOutbox)
        .set({
          status: "pending",
          lockedAt: null,
          lastError,
          updatedAt: now,
        })
        .where(and(
          eq(agentMigrationReceiptOutbox.id, claimed.id),
          eq(agentMigrationReceiptOutbox.status, "processing"),
        ))
        .returning();
      failed += 1;
      if (released && released.attemptCount >= AGENT_MIGRATION_RECEIPT_MAX_ATTEMPTS) {
        input.onRetryExhausted?.({
          outboxId: released.id,
          migrationId: released.migrationId,
          receiptKind: released.receiptKind,
          attemptCount: released.attemptCount,
          lastError,
        });
      }
    }
  }
  return { attempted, sent, failed };
}

export function startAgentMigrationReceiptOutboxWorker(input: {
  io: SocketServer;
  orchestrator: AgentOrchestrator;
  intervalMs?: number;
  batchSize?: number;
  observability?: AgentMigrationWorkerObservability;
  drainOutbox?: typeof drainAgentMigrationReceiptOutbox;
}): { stop(): void } {
  let stopped = false;
  let running = false;
  const observability = input.observability ?? createAgentMigrationWorkerObservability({
    worker: "receipt_outbox",
  });
  const drainOutbox = input.drainOutbox ?? drainAgentMigrationReceiptOutbox;
  observability.startup();
  const drain = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const result = await drainOutbox({
        io: input.io,
        orchestrator: input.orchestrator,
        batchSize: input.batchSize,
        onRetryExhausted: (row) => observability.receiptRetryExhausted?.(row),
      });
      observability.drain(classifyAgentMigrationReceiptDrain(result));
    } catch (error) {
      observability.drain("failed", error);
      console.error("[AgentMigrationReceipt] Failed to drain outbox:", error);
    } finally {
      running = false;
    }
  };
  const timer = setClockInterval(() => void drain(), input.intervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  if (typeof timer === "object" && timer && "unref" in timer && typeof timer.unref === "function") {
    timer.unref();
  }
  void drain();
  return {
    stop() {
      stopped = true;
      clearInterval(timer as ReturnType<typeof setInterval>);
    },
  };
}
