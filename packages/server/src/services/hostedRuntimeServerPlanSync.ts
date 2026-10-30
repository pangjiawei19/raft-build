import { resolveProviderConfigForServer } from "./agentRuntimeProviderTargetService";
/**
 * Tells the hosting provider each server's plan, which sets that server's
 * daily hosted spend limit (antiproton#884: Free $3/day, Pro $10/day).
 *
 * `hosted_runtime_server_plans` records the plan the provider last confirmed.
 * The sweep PUTs the current plan for every server that has a hosted agent
 * (not deleted) and whose confirmed plan differs or was never sent. That one
 * path covers the first sync of existing servers, every way a plan changes,
 * and retries (with backoff) after a failed PUT.
 */
import { and, eq, inArray, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import { currentDate, type AgentRuntimeProviderKind } from "@botiverse/raft-shared";
import { getDb } from "../db/index";
import { agentRuntimeProvisions, hostedRuntimeServerPlans, servers } from "../db/schema";
import { providerRequest, providerServerModelPickerPath, providerServerPlanPath } from "./agentRuntimeProviderService";
import { isHostedModelPickerEnabled } from "./hostedAgentModelService";
import { addTraceEvent } from "../tracing/semanticTrace";

export type HostedRuntimePlan = "free" | "pro";

/** Raft's server plan as the provider's tier: founder and partner count as pro (Tenny). */
export function hostedRuntimePlanFor(serverPlan: string | null | undefined): HostedRuntimePlan {
  return serverPlan === "pro" || serverPlan === "founder" || serverPlan === "partner" ? "pro" : "free";
}

export async function getHostedRuntimePlan(serverId: string): Promise<HostedRuntimePlan> {
  const [row] = await getDb().select({ plan: servers.plan }).from(servers).where(eq(servers.id, serverId)).limit(1);
  return hostedRuntimePlanFor(row?.plan);
}

const PLAN_SYNC_RETRY_BASE_MS = 30_000;
const PLAN_SYNC_RETRY_MAX_MS = 60 * 60_000;
const PLAN_SYNC_BATCH = 20;

function planSyncBackoffMs(failedAttempts: number): number {
  return Math.min(PLAN_SYNC_RETRY_MAX_MS, PLAN_SYNC_RETRY_BASE_MS * 2 ** Math.max(0, Math.min(20, failedAttempts - 1)));
}

export interface PlanSyncSummary { checked: number; synced: number; failed: number }

/** How long a replica holds a server's row while its PUT is in flight. */
const PLAN_SYNC_LEASE_MS = 60_000;

/**
 * Take one server's row for this pass, so replicas sweeping together (every
 * task restarts at a deploy) send each PUT once, not once per replica
 * (AndyLok). A conditional UPDATE pushes the next attempt past a short lease;
 * only the replica whose UPDATE matched sends. A server with no row yet gets
 * one first.
 */
async function claimServerRow(serverId: string, provider: AgentRuntimeProviderKind, kind: "plan" | "model_picker", now: Date): Promise<boolean> {
  await getDb().insert(hostedRuntimeServerPlans).values({ serverId, provider }).onConflictDoNothing();
  const column = kind === "plan" ? hostedRuntimeServerPlans.nextAttemptAt : hostedRuntimeServerPlans.modelPickerNextAttemptAt;
  const leaseUntil = new Date(now.getTime() + PLAN_SYNC_LEASE_MS);
  const claimed = await getDb().update(hostedRuntimeServerPlans)
    .set(kind === "plan" ? { nextAttemptAt: leaseUntil } : { modelPickerNextAttemptAt: leaseUntil })
    .where(and(
      eq(hostedRuntimeServerPlans.serverId, serverId),
      eq(hostedRuntimeServerPlans.provider, provider),
      or(isNull(column), lte(column, now)),
    ))
    .returning({ serverId: hostedRuntimeServerPlans.serverId });
  return claimed.length > 0;
}

type DuePlan = { serverId: string; plan: HostedRuntimePlan; failedAttempts: number | null };

/** Servers with a hosted agent whose provider plan is unconfirmed or stale, and not backing off. */
export async function dueHostedRuntimeServerPlans(input: { now?: Date; limit?: number; provider?: AgentRuntimeProviderKind } = {}): Promise<DuePlan[]> {
  const provider = input.provider ?? "antiproton";
  const now = input.now ?? currentDate();
  const mapped = sql<HostedRuntimePlan>`CASE WHEN ${servers.plan} IN ('pro', 'founder', 'partner') THEN 'pro' ELSE 'free' END`;
  const hosted = getDb().selectDistinct({ serverId: agentRuntimeProvisions.serverId }).from(agentRuntimeProvisions).where(and(
    eq(agentRuntimeProvisions.provider, provider),
    notInArray(agentRuntimeProvisions.state, ["deleting", "deleted"]),
  ));
  return getDb().select({ serverId: servers.id, plan: mapped, failedAttempts: hostedRuntimeServerPlans.failedAttempts })
    .from(servers)
    .leftJoin(hostedRuntimeServerPlans, and(eq(hostedRuntimeServerPlans.serverId, servers.id), eq(hostedRuntimeServerPlans.provider, provider)))
    .where(and(
      inArray(servers.id, hosted),
      or(isNull(hostedRuntimeServerPlans.syncedPlan), sql`${hostedRuntimeServerPlans.syncedPlan} <> ${mapped}`),
      or(isNull(hostedRuntimeServerPlans.nextAttemptAt), lte(hostedRuntimeServerPlans.nextAttemptAt, now)),
    ))
    .limit(input.limit ?? PLAN_SYNC_BATCH);
}

/**
 * One pass over `due` (default: looked up now). Safe on every replica: the PUT
 * is idempotent and the last write wins.
 */
export async function syncHostedRuntimeServerPlans(input: { now?: Date; limit?: number; provider?: AgentRuntimeProviderKind; due?: DuePlan[] } = {}): Promise<PlanSyncSummary> {
  const provider = input.provider ?? "antiproton";
  const summary: PlanSyncSummary = { checked: 0, synced: 0, failed: 0 };
  const now = input.now ?? currentDate();
  const due = input.due ?? await dueHostedRuntimeServerPlans({ now, limit: input.limit, provider });
  for (const row of due) {
    const config = await resolveProviderConfigForServer(row.serverId, provider);
    if (!config) continue;
    if (!await claimServerRow(row.serverId, provider, "plan", now)) continue;
    summary.checked += 1;
    const result = await providerRequest(config, "PUT", providerServerPlanPath(row.serverId), { body: { plan: row.plan } });
    if (result.kind === "response" && result.status >= 200 && result.status < 300) {
      summary.synced += 1;
      await getDb().insert(hostedRuntimeServerPlans)
        .values({ serverId: row.serverId, provider, syncedPlan: row.plan, syncedAt: now, failedAttempts: 0, nextAttemptAt: null, lastErrorCode: null })
        .onConflictDoUpdate({
          target: [hostedRuntimeServerPlans.serverId, hostedRuntimeServerPlans.provider],
          set: { syncedPlan: row.plan, syncedAt: now, failedAttempts: 0, nextAttemptAt: null, lastErrorCode: null },
        });
      addTraceEvent("server.hosted_runtime.plan_synced", { server_id: row.serverId, plan: row.plan });
      continue;
    }
    summary.failed += 1;
    const failedAttempts = (row.failedAttempts ?? 0) + 1;
    const code = result.kind === "response" ? `http_${result.status}` : result.code;
    await getDb().insert(hostedRuntimeServerPlans)
      .values({ serverId: row.serverId, provider, failedAttempts, nextAttemptAt: new Date(now.getTime() + planSyncBackoffMs(failedAttempts)), lastErrorCode: code })
      .onConflictDoUpdate({
        target: [hostedRuntimeServerPlans.serverId, hostedRuntimeServerPlans.provider],
        set: { failedAttempts, nextAttemptAt: new Date(now.getTime() + planSyncBackoffMs(failedAttempts)), lastErrorCode: code },
      });
    addTraceEvent("server.hosted_runtime.plan_sync_failed", { server_id: row.serverId, plan: row.plan, error_code: code, attempts: failedAttempts });
    console.warn(`[HostedRuntimePlan] server=${row.serverId} plan=${row.plan} failed=${code} attempts=${failedAttempts}`);
  }
  return summary;
}

/** A plan just changed: clear any backoff so the next sweep sends it right away. */
export async function markHostedRuntimePlanChanged(serverId: string): Promise<void> {
  await getDb().update(hostedRuntimeServerPlans).set({ nextAttemptAt: null, failedAttempts: 0 }).where(eq(hostedRuntimeServerPlans.serverId, serverId));
}

type DueModelPicker = { serverId: string; enabled: boolean; failedAttempts: number };

/**
 * Servers with a hosted agent whose `antiproton_model_picker` state the
 * provider has not confirmed (or confirmed differently), and not backing off.
 * The provider allows a model other than its default only where it was told
 * the picker is on; a server it never heard about counts as off.
 */
export async function dueHostedRuntimeModelPickers(input: { now?: Date; limit?: number; provider?: AgentRuntimeProviderKind } = {}): Promise<DueModelPicker[]> {
  const provider = input.provider ?? "antiproton";
  const now = input.now ?? currentDate();
  const hosted = getDb().selectDistinct({ serverId: agentRuntimeProvisions.serverId }).from(agentRuntimeProvisions).where(and(
    eq(agentRuntimeProvisions.provider, provider),
    notInArray(agentRuntimeProvisions.state, ["deleting", "deleted"]),
  ));
  const rows = await getDb().select({
    serverId: servers.id,
    synced: hostedRuntimeServerPlans.syncedModelPicker,
    failedAttempts: hostedRuntimeServerPlans.modelPickerFailedAttempts,
    nextAttemptAt: hostedRuntimeServerPlans.modelPickerNextAttemptAt,
  })
    .from(servers)
    .leftJoin(hostedRuntimeServerPlans, and(eq(hostedRuntimeServerPlans.serverId, servers.id), eq(hostedRuntimeServerPlans.provider, provider)))
    .where(inArray(servers.id, hosted));
  const due: DueModelPicker[] = [];
  // TODO(scale, Tenny): this evaluates the flag for every hosted server on every
  // pass. Fine at today's dozen; past a few thousand, cache it or key on the
  // flag's config version instead.
  for (const row of rows) {
    if (row.nextAttemptAt && row.nextAttemptAt > now) continue;
    // The flag lives in Feature Flag Admin, with no change event: compare on every pass.
    const enabled = await isHostedModelPickerEnabled(row.serverId);
    if (row.synced === enabled) continue;
    due.push({ serverId: row.serverId, enabled, failedAttempts: row.failedAttempts ?? 0 });
    if (due.length >= (input.limit ?? PLAN_SYNC_BATCH)) break;
  }
  return due;
}

/**
 * One pass: PUT each due server's picker state. Any non-2xx, a 404 included
 * (the provider route may not be deployed yet), backs off and retries.
 */
export async function syncHostedRuntimeModelPickers(input: { now?: Date; provider?: AgentRuntimeProviderKind; due?: DueModelPicker[] } = {}): Promise<PlanSyncSummary> {
  const provider = input.provider ?? "antiproton";
  const summary: PlanSyncSummary = { checked: 0, synced: 0, failed: 0 };
  const now = input.now ?? currentDate();
  const due = input.due ?? await dueHostedRuntimeModelPickers({ now, provider });
  for (const row of due) {
    const config = await resolveProviderConfigForServer(row.serverId, provider);
    if (!config) continue;
    if (!await claimServerRow(row.serverId, provider, "model_picker", now)) continue;
    summary.checked += 1;
    const result = await providerRequest(config, "PUT", providerServerModelPickerPath(row.serverId), { body: { enabled: row.enabled } });
    if (result.kind === "response" && result.status >= 200 && result.status < 300) {
      summary.synced += 1;
      await getDb().insert(hostedRuntimeServerPlans)
        .values({ serverId: row.serverId, provider, syncedModelPicker: row.enabled, modelPickerSyncedAt: now, modelPickerFailedAttempts: 0, modelPickerNextAttemptAt: null, modelPickerLastErrorCode: null })
        .onConflictDoUpdate({
          target: [hostedRuntimeServerPlans.serverId, hostedRuntimeServerPlans.provider],
          set: { syncedModelPicker: row.enabled, modelPickerSyncedAt: now, modelPickerFailedAttempts: 0, modelPickerNextAttemptAt: null, modelPickerLastErrorCode: null },
        });
      addTraceEvent("server.hosted_runtime.model_picker_synced", { server_id: row.serverId, enabled: row.enabled });
      continue;
    }
    summary.failed += 1;
    const failedAttempts = row.failedAttempts + 1;
    const code = result.kind === "response" ? `http_${result.status}` : result.code;
    const nextAttemptAt = new Date(now.getTime() + planSyncBackoffMs(failedAttempts));
    await getDb().insert(hostedRuntimeServerPlans)
      .values({ serverId: row.serverId, provider, modelPickerFailedAttempts: failedAttempts, modelPickerNextAttemptAt: nextAttemptAt, modelPickerLastErrorCode: code })
      .onConflictDoUpdate({
        target: [hostedRuntimeServerPlans.serverId, hostedRuntimeServerPlans.provider],
        set: { modelPickerFailedAttempts: failedAttempts, modelPickerNextAttemptAt: nextAttemptAt, modelPickerLastErrorCode: code },
      });
    addTraceEvent("server.hosted_runtime.model_picker_sync_failed", { server_id: row.serverId, enabled: row.enabled, error_code: code, attempts: failedAttempts });
  }
  return summary;
}

/**
 * Before a hosted agent is created (or re-created) on a picked model: make sure
 * the provider knows this server may pick, or it refuses the model. The
 * minute sweep would get there, but a server's first hosted agent can be
 * created before it does (cody). Best effort: a failure leaves the sweep to
 * retry and never blocks the create.
 */
export async function ensureServerModelPickerSynced(serverId: string, provider: AgentRuntimeProviderKind = "antiproton"): Promise<boolean> {
  try {
    const enabled = await isHostedModelPickerEnabled(serverId);
    const [row] = await getDb().select({ synced: hostedRuntimeServerPlans.syncedModelPicker, failedAttempts: hostedRuntimeServerPlans.modelPickerFailedAttempts })
      .from(hostedRuntimeServerPlans)
      .where(and(eq(hostedRuntimeServerPlans.serverId, serverId), eq(hostedRuntimeServerPlans.provider, provider)));
    if (row?.synced === enabled) return true;
    const summary = await syncHostedRuntimeModelPickers({ provider, due: [{ serverId, enabled, failedAttempts: row?.failedAttempts ?? 0 }] });
    return summary.synced === 1;
  } catch (error) {
    // Never the caller's failure: its database reads/writes can throw (Tenny).
    addTraceEvent("server.hosted_runtime.model_picker_presync_failed", {
      server_id: serverId,
      error_type: error instanceof Error ? error.name : "unknown",
    });
    return false;
  }
}
