import { getRaftbenchCanaryServerId } from "../services/agentRuntimeProviderService";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { asServerId, currentDate, EXTERNAL_AGENT_RUNTIME_ID, EXTERNAL_AGENT_RUNTIME_MODEL, type RaftbenchReport } from "@botiverse/raft-shared";
import { getDb, type DatabaseExecutor, type DatabaseTransaction } from "../db/index";
import { agentCredentials, agentRuntimeProvisions, agents, channels, channelAgents, messages, raftbenchFindings, raftbenchConfigs, raftbenchLatestRuns, raftbenchServiceAgents, serverMembers, servers, thirdPartyAgentEvents } from "../db/schema";
import * as channelService from "../services/channelService";
import { createAgent, invalidateRaftBenchServiceAgentBindings } from "../services/agentService";
import { updateAgentScopes } from "../services/agentScopesService";
import { assertProviderProvisioningAvailable, kickAgentRuntimeProvisionWorker, recordAgentProvisioning } from "../services/agentRuntimeProvisionService";
import { evaluateFeatureFlag } from "../services/featureFlagService";
import { getAgentInboundOAuthResource } from "../services/oauthService";
import { getActorServerRoleInServer } from "../lib/actorPermissions";
import { pilotServerIds, READ_GRANTS } from "./contract";
import { hasExactRaftbenchServiceScopes } from "./credentialScopes";
import { listFindings } from "./findings";
import { sourceCoverage } from "./sourceCoverage";
import { assertLiveSources, sourceVersionsLive, runCoverage, RaftbenchError, requirePilot } from "./service";

const INTERVAL_MS = 15 * 60_000;
const TIMEOUT_MS = 30 * 60_000;
function refuse(status: number, code: string, message: string): never {
  throw new RaftbenchError(status, code, message, "An administrator can review the RaftBench settings on this staging server.");
}
export async function requireAdmin(serverId: string, userId: string, requireFlag = true) {
  requirePilot(serverId);
  const role = await getActorServerRoleInServer(serverId, "user", userId);
  if (role !== "owner" && role !== "admin") refuse(403, "raftbench_admin_required", "Only this server's owner or administrator can use RaftBench.");
  if (requireFlag && !(await evaluateFeatureFlag({ key: "raftbench_overview_v0", serverId, userId })).enabled) refuse(403, "raftbench_disabled", "RaftBench is unavailable on this server.");
}
async function validateChannels(serverId: string, userId: string, channelIds: string[], executor: DatabaseExecutor = getDb()) {
  for (const id of channelIds) {
    const channel = await channelService.getChannel(id, { executor });
    const access = await channelService.resolveChannelAccess({ serverId, channelId: id, executor });
    if (!channel || !access || channel.deletedAt || channel.archivedAt || !["channel", "private", "joint"].includes(channel.type) ||
        !await channelService.canUserAccessChannel(id, userId, asServerId(serverId), { executor })) refuse(400, "raftbench_source_unavailable", "Select active channels you can access in this server. DMs and threads are excluded.");
  }
}
async function clearRun(tx: DatabaseTransaction, serverId: string, clearFindings = true) {
  if (clearFindings) {
    await tx.delete(raftbenchFindings).where(eq(raftbenchFindings.serverId, serverId));
    await tx.update(raftbenchConfigs).set({ readMessages: 0, readThroughSeq: 0, completedBatches: 0, scannedThroughAt: null }).where(eq(raftbenchConfigs.serverId, serverId));
  }
  await tx.delete(raftbenchLatestRuns).where(eq(raftbenchLatestRuns.serverId, serverId));
  // Assignment events contain identifiers only; remove stale ones on scope/consent change.
  await tx.delete(thirdPartyAgentEvents).where(and(eq(thirdPartyAgentEvents.serverId, serverId), eq(thirdPartyAgentEvents.systemApp, "system.raftbench")));
}
async function fenceAdmin(tx: DatabaseTransaction, serverId: string, userId: string) {
  const [member] = await tx.select().from(serverMembers).where(and(eq(serverMembers.serverId, serverId), eq(serverMembers.userId, userId))).for("share");
  if (!member || !["owner", "admin"].includes(member.role)) refuse(403, "raftbench_admin_required", "Your administrator permission changed before this update.");
  if (!(await evaluateFeatureFlag({ key: "raftbench_overview_v0", serverId, userId }, tx)).enabled) refuse(403, "raftbench_disabled", "RaftBench is unavailable on this server.");
}
export async function configure(serverId: string, userId: string, input: { enabled: boolean; channelIds: string[]; expectedRevision: number; historyFrom?: string; providerTarget?: "default" | "canary" }) {
  // Disable remains available to an admin even when the enrollment flag is off.
  await requireAdmin(serverId, userId, input.enabled);
  if (input.providerTarget === "canary" && serverId !== getRaftbenchCanaryServerId()) refuse(403, "raftbench_canary_not_enrolled", "Canary analysis is only available on the separately enrolled synthetic staging server.");
  const historyFrom = input.enabled && input.historyFrom ? new Date(input.historyFrom) : undefined;
  if (historyFrom && (!Number.isFinite(historyFrom.getTime()) || historyFrom >= currentDate())) refuse(400, "raftbench_history_invalid", "Choose a start date before now.");
  const ids = [...new Set(input.channelIds)];
  if (input.enabled) await validateChannels(serverId, userId, ids);
  const [existing] = await getDb().select().from(raftbenchConfigs).where(eq(raftbenchConfigs.serverId, serverId));
  if (existing) {
    if (input.enabled && !existing.agentId) {
      if (existing.revision !== input.expectedRevision) refuse(409, "raftbench_revision_conflict", "The settings changed. Reload them before saving.");
      await createServiceAgent(serverId, userId, input.providerTarget ?? "default", { ids, historyFrom: historyFrom ?? existing.historyFrom, existingRevision: existing.revision });
      return;
    }
    if (input.providerTarget !== undefined) {
      const [binding] = existing.agentId ? await getDb().select({ target: agentRuntimeProvisions.providerTarget }).from(agentRuntimeProvisions).where(eq(agentRuntimeProvisions.agentId, existing.agentId)) : [];
      if (input.providerTarget !== (binding?.target ?? "default")) refuse(409, "raftbench_target_immutable", "The provider target is fixed when the service is created. Create a separate canary service instead.");
    }
    await getDb().transaction(async tx => {
      const [config] = await tx.select().from(raftbenchConfigs).where(eq(raftbenchConfigs.serverId, serverId)).for("update");
      if (!config || config.revision !== input.expectedRevision) refuse(409, "raftbench_revision_conflict", "The settings changed. Reload them before saving.");
      if (input.enabled) {
        await fenceAdmin(tx, serverId, userId);
        await tx.select({ id: channels.id }).from(channels).where(inArray(channels.id, ids)).for("share");
        await validateChannels(serverId, userId, ids, tx);
      }
      else {
        const [member] = await tx.select().from(serverMembers).where(and(eq(serverMembers.serverId, serverId), eq(serverMembers.userId, userId))).for("share");
        if (!member || !["owner", "admin"].includes(member.role)) refuse(403, "raftbench_admin_required", "Your administrator permission changed.");
      }
      await clearRun(tx, serverId);
      if (config.agentId) {
        // This dedicated agent belongs only to this feature; removed sources lose membership.
        await tx.delete(channelAgents).where(eq(channelAgents.agentId, config.agentId));
        if (input.enabled) await tx.insert(channelAgents).values(ids.map(channelId => ({ channelId, agentId: config.agentId!, role: "member" as const }))).onConflictDoNothing();
      }
      await tx.update(raftbenchConfigs).set({ enabled: input.enabled, channelIds: ids, ...(historyFrom ? { historyFrom } : {}), configuredByUserId: userId, revision: config.revision + 1, updatedAt: currentDate() }).where(eq(raftbenchConfigs.serverId, serverId));
    });
    invalidateRaftBenchServiceAgentBindings();
  } else {
    if (!input.enabled) return;
    if (input.expectedRevision !== 0) refuse(409, "raftbench_revision_conflict", "The settings changed. Reload them before saving.");
    await createServiceAgent(serverId, userId, input.providerTarget ?? "default", { ids, historyFrom: historyFrom ?? null });
  }
}

/** Create a dedicated identity. The optional assignment is the legacy one-click shortcut. */
async function createServiceAgent(serverId: string, userId: string, target: "default" | "canary", assignment?: { ids: string[]; historyFrom: Date | null; existingRevision?: number }) {
    if (target === "canary" && serverId !== getRaftbenchCanaryServerId()) refuse(403, "raftbench_canary_not_enrolled", "Canary analysis is only available on the separately enrolled synthetic staging server.");
    await requireAdmin(serverId, userId);
    await assertProviderProvisioningAvailable(serverId, "antiproton", target);
    const created = await createAgent(serverId, assignment ? "raftbench-service" : `raftbench-service-${randomUUID().slice(0, 6)}`, {
      description: "Automated RaftBench analysis agent for this server. It analyzes the selected channels but does not reply to messages or mentions; results appear in the RaftBench dashboard.",
      runtime: EXTERNAL_AGENT_RUNTIME_ID, model: EXTERNAL_AGENT_RUNTIME_MODEL, creatorType: "user", creatorId: userId,
      actorCapabilityFence: { userId, capability: "createAgents" },
      afterInsert: async (tx, agent) => {
        await fenceAdmin(tx, serverId, userId);
        await tx.insert(raftbenchServiceAgents).values({ agentId: agent.id, serverId });
        await updateAgentScopes({ agentId: agent.id, scopes: assignment ? [...READ_GRANTS] : [], updatedByUserId: userId }, { executor: tx });
        if (assignment) {
          await tx.select({ id: channels.id }).from(channels).where(inArray(channels.id, assignment.ids)).for("share");
          await validateChannels(serverId, userId, assignment.ids, tx);
          if (assignment.existingRevision !== undefined) {
            const [config] = await tx.select().from(raftbenchConfigs).where(eq(raftbenchConfigs.serverId, serverId)).for("update");
            if (!config || config.revision !== assignment.existingRevision || config.agentId) refuse(409, "raftbench_revision_conflict", "The settings changed. Reload them before saving.");
            await clearRun(tx, serverId);
            await tx.update(raftbenchConfigs).set({ configuredByUserId: userId, enabled: true, channelIds: assignment.ids, historyFrom: assignment.historyFrom, agentId: agent.id, revision: config.revision + 1, updatedAt: currentDate() }).where(eq(raftbenchConfigs.serverId, serverId));
          } else {
            await tx.insert(raftbenchConfigs).values({ serverId, configuredByUserId: userId, enabled: true, channelIds: assignment.ids, historyFrom: assignment.historyFrom, agentId: agent.id, revision: 1 });
          }
          await tx.insert(channelAgents).values(assignment.ids.map(channelId => ({ channelId, agentId: agent.id, role: "member" as const }))).onConflictDoNothing();
        }
        await recordAgentProvisioning(tx, { agent, provider: "antiproton", createdByUserId: userId, profile: "raftbench_service", target });
      },
    });
    invalidateRaftBenchServiceAgentBindings();
    kickAgentRuntimeProvisionWorker();
    return created.id;
}

export async function createUnassignedServiceAgent(serverId: string, userId: string, target: "default" | "canary" = "default") {
  return { agentId: await createServiceAgent(serverId, userId, target) };
}

export async function listServiceAgents(serverId: string, userId: string) {
  await requireAdmin(serverId, userId);
  const rows = await getDb().select({ agentId: raftbenchServiceAgents.agentId, name: agents.name, state: agentRuntimeProvisions.state })
    .from(raftbenchServiceAgents).innerJoin(agents, eq(agents.id, raftbenchServiceAgents.agentId))
    .leftJoin(agentRuntimeProvisions, eq(agentRuntimeProvisions.agentId, agents.id))
    .where(and(eq(raftbenchServiceAgents.serverId, serverId), isNull(agents.deletedAt)));
  if (rows.length === 0) return [];
  const credentials = await getDb().select({ agentId: agentCredentials.agentId, scopes: agentCredentials.scopes }).from(agentCredentials)
    .where(and(inArray(agentCredentials.agentId, rows.map(row => row.agentId)), isNull(agentCredentials.revokedAt)));
  const readyAgentIds = new Set(credentials.filter(credential => hasExactRaftbenchServiceScopes(credential.scopes)).map(credential => credential.agentId));
  return rows.map(row => ({ ...row, ready: row.state === "active" && readyAgentIds.has(row.agentId) }));
}

/** Rebinding changes run ownership, but preserves results for unchanged sources/history. */
export async function assignServiceAgent(serverId: string, userId: string, agentId: string, expectedRevision: number, initial?: { channelIds: string[]; historyFrom?: string }) {
  await requireAdmin(serverId, userId);
  await getDb().transaction(async tx => {
    await tx.select({ id: servers.id }).from(servers).where(eq(servers.id, serverId)).for("update");
    const [config] = await tx.select().from(raftbenchConfigs).where(eq(raftbenchConfigs.serverId, serverId)).for("update");
    if ((config?.revision ?? 0) !== expectedRevision) refuse(409, "raftbench_revision_conflict", "The settings changed. Reload them before assigning an agent.");
    await fenceAdmin(tx, serverId, userId);
    const [candidate] = await tx.select({ id: agents.id, serverId: agents.serverId }).from(agents)
      .where(and(eq(agents.id, agentId), isNull(agents.deletedAt))).for("update");
    const [marker] = candidate ? await tx.select({ serverId: raftbenchServiceAgents.serverId }).from(raftbenchServiceAgents)
      .where(eq(raftbenchServiceAgents.agentId, agentId)) : [];
    if (!candidate || candidate.serverId !== serverId || marker?.serverId !== serverId) refuse(422, "raftbench_dedicated_agent_required", "Choose a RaftBench service agent created on this server.");
    const [provision] = await tx.select().from(agentRuntimeProvisions).where(eq(agentRuntimeProvisions.agentId, agentId));
    const credentials = await tx.select({ id: agentCredentials.id, scopes: agentCredentials.scopes }).from(agentCredentials)
      .where(and(eq(agentCredentials.agentId, agentId), isNull(agentCredentials.revokedAt))).for("share");
    if (!provision || provision.state !== "active" || !credentials.some(credential => hasExactRaftbenchServiceScopes(credential.scopes)))
      refuse(422, "raftbench_agent_not_ready", "Wait for this RaftBench service agent to finish provisioning, then assign it.");
    if (!config) {
      const ids = [...new Set(initial?.channelIds ?? [])];
      if (ids.length < 1 || ids.length > 50) refuse(422, "raftbench_sources_required", "Select 1 to 50 channels before assigning this service agent.");
      const historyFrom = initial?.historyFrom ? new Date(initial.historyFrom) : null;
      if (historyFrom && (!Number.isFinite(historyFrom.getTime()) || historyFrom >= currentDate())) refuse(400, "raftbench_history_invalid", "Choose a start date before now.");
      await tx.select({ id: channels.id }).from(channels).where(inArray(channels.id, ids)).for("share");
      await validateChannels(serverId, userId, ids, tx);
      await updateAgentScopes({ agentId, scopes: [...READ_GRANTS], updatedByUserId: userId }, { executor: tx });
      await tx.insert(channelAgents).values(ids.map(channelId => ({ channelId, agentId, role: "member" as const }))).onConflictDoNothing();
      await tx.insert(raftbenchConfigs).values({ serverId, configuredByUserId: userId, enabled: true, channelIds: ids, historyFrom, agentId, revision: 1 });
      return;
    }
    if (config.agentId === agentId) {
      if (!config.enabled) await tx.update(raftbenchConfigs).set({ enabled: true, revision: config.revision + 1, configuredByUserId: userId, updatedAt: currentDate() }).where(eq(raftbenchConfigs.serverId, serverId));
      return;
    }
    await tx.select({ id: channels.id }).from(channels).where(inArray(channels.id, config.channelIds)).for("share");
    await validateChannels(serverId, userId, config.channelIds, tx);
    await clearRun(tx, serverId, false);
    const revision = config.revision + 1;
    await tx.update(raftbenchFindings).set({ revision }).where(and(eq(raftbenchFindings.serverId, serverId), eq(raftbenchFindings.revision, config.revision)));
    if (config.agentId) {
      await tx.delete(channelAgents).where(eq(channelAgents.agentId, config.agentId));
      await updateAgentScopes({ agentId: config.agentId, scopes: [], updatedByUserId: userId }, { executor: tx });
      await tx.update(agentCredentials).set({ revokedAt: currentDate(), revokedReason: "raftbench_reassigned", revokedByUserId: userId })
        .where(and(eq(agentCredentials.agentId, config.agentId), isNull(agentCredentials.revokedAt)));
    }
    await updateAgentScopes({ agentId, scopes: [...READ_GRANTS], updatedByUserId: userId }, { executor: tx });
    await tx.insert(channelAgents).values(config.channelIds.map(channelId => ({ channelId, agentId, role: "member" as const }))).onConflictDoNothing();
    await tx.update(raftbenchConfigs).set({ agentId, enabled: true, revision, configuredByUserId: userId, updatedAt: currentDate() }).where(eq(raftbenchConfigs.serverId, serverId));
  });
  invalidateRaftBenchServiceAgentBindings();
}

/** One latest run, transactional assignment. Multiple replicas cannot enqueue duplicates. */
export async function advanceServer(serverId: string, now = currentDate(), force = false) {
  requirePilot(serverId);
  return getDb().transaction(async tx => {
    const [config] = await tx.select().from(raftbenchConfigs).where(eq(raftbenchConfigs.serverId, serverId)).for("update");
    if (!config) return;
    const runs = await tx.select().from(raftbenchLatestRuns).where(eq(raftbenchLatestRuns.serverId, serverId)).for("update");
    let run: typeof raftbenchLatestRuns.$inferSelect | undefined = runs[0];
    if (!config.enabled || !config.agentId) { if (run) await clearRun(tx, serverId); return; }
    let sources: Awaited<ReturnType<typeof assertLiveSources>>;
    try {
      const flag = await evaluateFeatureFlag({ key: "raftbench_overview_v0", serverId, userId: config.configuredByUserId }, tx);
      if (!flag.enabled) refuse(403, "raftbench_disabled", "Enrollment is disabled.");
      sources = await assertLiveSources(config, config.agentId);
    } catch (error) {
      if (!(error instanceof RaftbenchError)) throw error;
      await clearRun(tx, serverId);
      await tx.update(raftbenchConfigs).set({ enabled: false, revision: config.revision + 1, updatedAt: now }).where(eq(raftbenchConfigs.serverId, serverId));
      return;
    }
    // The worker also withdraws findings when no dashboard is open.
    await listFindings(serverId, config.revision, sources, 1, tx);
    let refreshedFrom: Date | undefined;
    if (run && !await sourceVersionsLive(tx, run, sources)) {
      refreshedFrom = run.from;
      await clearRun(tx, serverId, false);
      run = undefined;
    }
    if (run && ["queued", "running"].includes(run.status)) {
      if (now.getTime() - run.startedAt.getTime() < TIMEOUT_MS) return;
      await tx.update(raftbenchLatestRuns).set({ status: "failed", failureReason: "The cloud analysis did not finish within 30 minutes. No completed result was accepted.", updatedAt: now }).where(eq(raftbenchLatestRuns.serverId, serverId));
      return;
    }
    const [dedicated] = await tx.select({ agentId: raftbenchServiceAgents.agentId }).from(raftbenchServiceAgents)
      .where(and(eq(raftbenchServiceAgents.agentId, config.agentId), eq(raftbenchServiceAgents.serverId, serverId)));
    const credentials = await tx.select({ scopes: agentCredentials.scopes }).from(agentCredentials)
      .where(and(eq(agentCredentials.agentId, config.agentId), isNull(agentCredentials.revokedAt)));
    if (!dedicated || !credentials.some(credential => hasExactRaftbenchServiceScopes(credential.scopes))) return;
    if (run && !force && (run.exhausted || run.status === "failed") && now.getTime() - run.updatedAt.getTime() < INTERVAL_MS) return;
    // Advance only accepted analysis. Failure retries replay the same chunk,
    // with a server-enforced three-attempt cap and an explicit unknown gap.
    const failed = run?.status === "failed";
    const skip = !!run && failed && run.failureCount >= 2;
    const hasProgress = !!run && run.nextSeq > run.startAfterSeq;
    const continuation = !!run && (failed || !run.exhausted) && !(skip && !hasProgress);
    const failureCount = failed && !skip ? run!.failureCount + 1 : 0;
    const skippedRanges = [...(run?.skippedRanges ?? []), ...(skip ? [{ from: run!.from.toISOString(), to: run!.to.toISOString(), messages: run!.fetched.length || null }] : [])].slice(-10);
    const startAfterSeq = continuation ? (skip || (run!.report && !failed) ? run!.nextSeq : run!.startAfterSeq) : 0;
    const from = refreshedFrom ?? (continuation ? run!.from : run ? new Date(Math.min(run.to.getTime() - (skip ? 0 : 5 * 60_000), now.getTime() - 1)) : config.historyFrom ?? new Date(now.getTime() - 7 * 24 * 60 * 60_000));
    const to = continuation ? run!.to : now;
    const runId = randomUUID();
    const values = { serverId, agentId: config.agentId, runId, revision: config.revision, status: "queued" as const, from, to, fetched: [], nextSeq: startAfterSeq, startAfterSeq, failureCount, skippedRanges, sourceCharacters: 0, stopReason: "more_pages" as const, exhausted: false, report: null, submissionHash: null, receiptId: null, failureReason: null, startedAt: now, updatedAt: now };
    await tx.insert(raftbenchLatestRuns).values(values).onConflictDoUpdate({ target: raftbenchLatestRuns.serverId, set: values });
    await tx.delete(thirdPartyAgentEvents).where(and(eq(thirdPartyAgentEvents.serverId, serverId), eq(thirdPartyAgentEvents.systemApp, "system.raftbench")));
    const payload = { kind: "raftbench_run_assigned", runId, revision: config.revision, text: "This run is handled automatically by the system. You do not need to take any action or reply." };
    const [event] = await tx.insert(thirdPartyAgentEvents).values({ serverId, agentId: config.agentId, systemApp: "system.raftbench", kind: "event", summary: payload.text, payload, payloadHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"), resource: getAgentInboundOAuthResource(serverId), expiresAt: new Date(now.getTime() + TIMEOUT_MS), createdAt: now, updatedAt: now }).returning();
    return event;
  });
}

/** Server-owned counts and derived results only; raw source bodies are never returned here. */
export async function dashboard(serverId: string, userId: string, page = 1) {
  await requireAdmin(serverId, userId);
  const [config] = await getDb().select().from(raftbenchConfigs).where(eq(raftbenchConfigs.serverId, serverId));
  const [run] = await getDb().select().from(raftbenchLatestRuns).where(eq(raftbenchLatestRuns.serverId, serverId));
  const [provision] = config?.agentId ? await getDb().select().from(agentRuntimeProvisions).where(eq(agentRuntimeProvisions.agentId, config.agentId)) : [];
  const sources = config?.enabled && config.agentId ? await assertLiveSources(config, config.agentId) : [];
  const stale = !!run && !await sourceVersionsLive(getDb(), run, sources);
  const coverage = config?.enabled ? await sourceCoverage(config.serverId, config.revision, sources.map(source => source.storageId), config.historyFrom ?? new Date(config.updatedAt.getTime() - 7 * 24 * 60 * 60_000), run?.to ?? currentDate()) : null;
  const [inFlight] = config && run && run.fetched.length ? await getDb().select({ count: sql<number>`count(*)`.mapWith(Number) }).from(messages)
    .where(and(inArray(messages.id, run.fetched.map(ref => ref.messageId)), gt(messages.seq, config.readThroughSeq))) : [];
  const accumulated = config?.enabled ? await listFindings(config.serverId, config.revision, sources, page) : { patterns: [], total: 0, page: 1, pageCount: 1 };
  const legacyPatterns = (stale ? [] : run?.report?.patterns ?? []);
  const hasAccumulated = accumulated.total > 0;
  const legacyPage = Math.min(page, Math.max(1, Math.ceil(legacyPatterns.length / 5)));
  const patterns = hasAccumulated ? accumulated.patterns : legacyPatterns.slice((legacyPage - 1) * 5, legacyPage * 5).map(pattern => ({ ...pattern,
    evidence: pattern.evidence.map(ref => ({ ...ref, messageId: run?.fetched.find(source => source.target === ref.target && source.messageId.startsWith(ref.messageId))?.messageId ?? ref.messageId })),
    counterevidence: pattern.counterevidence.map(ref => ({ ...ref, messageId: run?.fetched.find(source => source.target === ref.target && source.messageId.startsWith(ref.messageId))?.messageId ?? ref.messageId })),
  }));
  const total = hasAccumulated ? accumulated.total : legacyPatterns.length;
  const pageCount = Math.max(1, Math.ceil(total / 5));
  const currentPage = Math.min(page, pageCount);
  return {
    historyFrom: config?.historyFrom?.toISOString() ?? null, coverage,
    progress: { readMessages: (config?.readMessages ?? 0) + (inFlight?.count ?? 0), completedBatches: config?.completedBatches ?? 0, scannedThroughAt: config?.scannedThroughAt?.toISOString() ?? null },
    enabled: config?.enabled ?? false, revision: config?.revision ?? 0, channelIds: config?.channelIds ?? [], agentId: config?.agentId ?? null,
    provisioning: provision ? { state: provision.state, error: provision.lastErrorCode, profile: provision.provisionedProfile, providerTarget: provision.providerTarget } : null,
    intervalMinutes: INTERVAL_MS / 60_000,
    run: run ? { runId: run.runId, status: stale ? "stale" : run.status, from: run.from.toISOString(), to: run.to.toISOString(), updatedAt: run.updatedAt.toISOString(), fetchedMessages: run.fetched.length, skippedRanges: run.skippedRanges, stopReason: run.stopReason, exhausted: runCoverage(run).exhausted, skippedChunks: runCoverage(run).skippedChunks, failureReason: stale ? null : run.failureReason,
      report: hasAccumulated || (!stale && run.report) ? { status: run.report?.status ?? "incomplete", reason: stale ? undefined : run.report?.reason, gaps: run.report?.gaps ?? ["partial_scan"], patterns } satisfies Partial<RaftbenchReport> : null } : null,
    pagination: { page: currentPage, pageCount, total, pageSize: 5 },
  };
}
export async function enrolledServers() {
  return getDb().select({ serverId: raftbenchConfigs.serverId }).from(raftbenchConfigs).where(and(eq(raftbenchConfigs.enabled, true), inArray(raftbenchConfigs.serverId, pilotServerIds())));
}
