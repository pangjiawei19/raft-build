import { resolveProviderConfigForServer } from "./agentRuntimeProviderTargetService";
/**
 * Daily hosted spend for the observability report (antiproton#886). Only the
 * Raft server holds the provider token, so it pulls the previous UTC day once
 * and records it as trace events:
 *
 * - `server.hosted_runtime.agent_daily_spend`: one per hosted agent with spend
 *   that day (`budget` is `onboarding` for hosted Cindy), with the agent's age
 *   in days at that day;
 * - `server.hosted_runtime.onboarding_budget_daily`: the platform onboarding
 *   budget that day (limit, spent, capped);
 * - `server.hosted_runtime.spend_pull.result`: one per pulled scope, ok or
 *   failed with a count, so "no spend" and "not pulled" differ.
 *
 * `hosted_runtime_spend_pulls` has a row per (day, scope); a scope completes
 * once, so its events are written once (they carry `pull_id`). Failures back
 * off and retry; replicas claim scopes with a lease. The events go out just
 * before the row is marked complete: a process that dies between the two
 * re-pulls that scope and writes it again (with the same `pull_id`), which the
 * report dedupes by day + agent.
 */
import { and, eq, gte, isNull, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { clearClockInterval, currentDate, noopTracer, setClockInterval, type Tracer } from "@botiverse/raft-shared";
import { getDb } from "../db/index";
import { agentRuntimeProvisions, hostedRuntimeSpendPulls } from "../db/schema";
import { providerOnboardingBudgetPath, providerRequest, providerTenantUsagePath, resolveProviderConfig } from "./agentRuntimeProviderService";
import { addTraceEvent, withTraceRoot } from "../tracing/semanticTrace";

const DAY_MS = 24 * 60 * 60_000;
/** Pull a day only after its spend has settled at the provider. */
const PULL_DELAY_MS = 30 * 60_000;
/** Days pulled back: a pull that keeps failing near midnight still lands the next day. */
const CATCH_UP_DAYS = 3;
const LEASE_MS = 5 * 60_000;
const RETRY_BASE_MS = 5 * 60_000;
const RETRY_MAX_MS = 3 * 60 * 60_000;
const BATCH = 20;
export const ONBOARDING_SCOPE = "onboarding";

const agentDaysSchema = z.array(z.object({
  raftAgentId: z.string(),
  budget: z.string().nullable().catch(null),
  days: z.array(z.object({ day: z.string(), usd: z.number().finite() })),
}));
const usageSchema = z.object({
  agentDays: agentDaysSchema,
  /**
   * This server's daily share of the onboarding budget (admins can change it
   * per server). It is the share at pull time, not the pulled day's: a share
   * changed since then makes that day's comparison off (it is $1 by default).
   */
  today: z.object({ onboardingLimitUsd: z.number().finite().nullable().optional().catch(null) }).optional().catch(undefined),
});
const onboardingSchema = z.object({
  date: z.string(),
  limitUsd: z.number().finite().nullable(),
  spentUsd: z.number().finite(),
  capped: z.boolean(),
});

const isoDay = (time: number) => new Date(time).toISOString().slice(0, 10);
const dayStart = (day: string) => Date.parse(`${day}T00:00:00.000Z`);

/** UTC days ready to pull at `now`, newest first. */
export function spendDaysToPull(now: Date): string[] {
  const settled = now.getTime() - PULL_DELAY_MS;
  const lastFullDay = Math.floor(settled / DAY_MS) * DAY_MS - DAY_MS;
  return Array.from({ length: CATCH_UP_DAYS }, (_, i) => isoDay(lastFullDay - i * DAY_MS));
}

/** Servers whose hosted agents existed at some point of `day`. */
async function serversHostedOn(day: string): Promise<string[]> {
  const start = new Date(dayStart(day));
  const end = new Date(dayStart(day) + DAY_MS);
  const rows = await getDb().selectDistinct({ serverId: agentRuntimeProvisions.serverId }).from(agentRuntimeProvisions).where(and(
    lt(agentRuntimeProvisions.createdAt, end),
    or(isNull(agentRuntimeProvisions.deletedAt), gte(agentRuntimeProvisions.deletedAt, start)),
  ));
  return rows.map((row) => row.serverId);
}

async function ensureScopes(day: string): Promise<void> {
  const scopes = [ONBOARDING_SCOPE, ...(await serversHostedOn(day)).map((id) => `server:${id}`)];
  await getDb().insert(hostedRuntimeSpendPulls).values(scopes.map((scope) => ({ day, scope }))).onConflictDoNothing();
}

async function claimDue(now: Date, days: string[]) {
  const leaseUntil = new Date(now.getTime() + LEASE_MS);
  return getDb().update(hostedRuntimeSpendPulls)
    .set({ leaseExpiresAt: leaseUntil, attempts: sql`${hostedRuntimeSpendPulls.attempts} + 1` })
    .where(and(
      sql`(${hostedRuntimeSpendPulls.day}, ${hostedRuntimeSpendPulls.scope}) IN (
        SELECT day, scope FROM hosted_runtime_spend_pulls
        WHERE completed_at IS NULL
          AND day IN (${sql.join(days.map((day) => sql`${day}::date`), sql`, `)})
          AND (next_attempt_at IS NULL OR next_attempt_at <= ${now})
          AND (lease_expires_at IS NULL OR lease_expires_at < ${now})
        ORDER BY day DESC LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED)`,
      isNull(hostedRuntimeSpendPulls.completedAt),
    ))
    .returning();
}

type ScopeOutcome = { ok: true; count: number } | { ok: false; code: string };

async function pullServer(config: { baseUrl: string; token: string }, day: string, serverId: string, pullId: string): Promise<ScopeOutcome> {
  const from = new Date(dayStart(day)).toISOString();
  const to = new Date(dayStart(day) + DAY_MS).toISOString();
  const result = await providerRequest(config, "GET", providerTenantUsagePath(serverId, { from, to, bucket: "day", byAgent: "1" }));
  if (result.kind === "network") return { ok: false, code: result.code };
  // A server with no spend is a 200 with no agentDays; any other answer, a 404
  // included (a missing or rolled-back route), retries and never records a zero day.
  if (result.status < 200 || result.status >= 300) return { ok: false, code: result.error?.code ?? `http_${result.status}` };
  const parsed = usageSchema.safeParse(result.body);
  if (!parsed.success) return { ok: false, code: "invalid_response" };
  const ids = parsed.data.agentDays.map((entry) => entry.raftAgentId);
  const ages = new Map<string, Date>();
  if (ids.length > 0) {
    const rows = await getDb().select({ agentId: agentRuntimeProvisions.agentId, activatedAt: agentRuntimeProvisions.activatedAt, createdAt: agentRuntimeProvisions.createdAt })
      .from(agentRuntimeProvisions).where(eq(agentRuntimeProvisions.serverId, serverId));
    for (const row of rows) ages.set(row.agentId, row.activatedAt ?? row.createdAt);
  }
  let count = 0;
  for (const entry of parsed.data.agentDays) {
    for (const spend of entry.days) {
      if (spend.day !== day) continue;
      const since = ages.get(entry.raftAgentId);
      addTraceEvent("server.hosted_runtime.agent_daily_spend", {
        day,
        pull_id: pullId,
        server_id: serverId,
        agent_id: entry.raftAgentId,
        budget: entry.budget,
        usd: spend.usd,
        agent_age_days: since ? Math.max(0, Math.floor((dayStart(day) - since.getTime()) / DAY_MS)) : null,
        // The provider refuses only once spend reaches the share, so `usd >= onboarding_limit_usd`
        // means hosted Cindy used up that day's share.
        onboarding_limit_usd: entry.budget === "onboarding" ? parsed.data.today?.onboardingLimitUsd ?? null : null,
      });
      count += 1;
    }
  }
  return { ok: true, count };
}

async function pullOnboarding(config: { baseUrl: string; token: string }, day: string, pullId: string): Promise<ScopeOutcome> {
  const result = await providerRequest(config, "GET", providerOnboardingBudgetPath(day));
  if (result.kind === "network") return { ok: false, code: result.code };
  if (result.status < 200 || result.status >= 300) return { ok: false, code: result.error?.code ?? `http_${result.status}` };
  const parsed = onboardingSchema.safeParse(result.body);
  if (!parsed.success) return { ok: false, code: "invalid_response" };
  addTraceEvent("server.hosted_runtime.onboarding_budget_daily", {
    day,
    pull_id: pullId,
    limit_usd: parsed.data.limitUsd,
    spent_usd: parsed.data.spentUsd,
    capped: parsed.data.capped,
  });
  return { ok: true, count: 1 };
}

export interface SpendPullSummary { pulled: number; failed: number }

/** One pass; call inside a trace root so the events land on a span. */
export async function pullHostedRuntimeDailySpend(input: { now?: Date } = {}): Promise<SpendPullSummary> {
  const summary: SpendPullSummary = { pulled: 0, failed: 0 };
  const defaultConfig = resolveProviderConfig("antiproton");
  if (!defaultConfig && !resolveProviderConfig("antiproton", process.env, "canary")) return summary;
  const now = input.now ?? currentDate();
  const days = spendDaysToPull(now);
  for (const day of days) await ensureScopes(day);
  for (const row of await claimDue(now, days)) {
    const day = row.day;
    let outcome: ScopeOutcome;
    try {
      const config = row.scope === ONBOARDING_SCOPE ? defaultConfig
        : await resolveProviderConfigForServer(row.scope.slice("server:".length), "antiproton");
      outcome = !config ? { ok: false, code: "provider_not_configured" } : row.scope === ONBOARDING_SCOPE
        ? await pullOnboarding(config, day, row.pullId)
        : await pullServer(config, day, row.scope.slice("server:".length), row.pullId);
    } catch (error) {
      outcome = { ok: false, code: error instanceof Error ? error.name : "internal_error" };
    }
    const where = and(eq(hostedRuntimeSpendPulls.day, row.day), eq(hostedRuntimeSpendPulls.scope, row.scope));
    if (outcome.ok) {
      summary.pulled += 1;
      await getDb().update(hostedRuntimeSpendPulls).set({ completedAt: now, leaseExpiresAt: null, lastErrorCode: null }).where(where);
      addTraceEvent("server.hosted_runtime.spend_pull.result", { day, pull_id: row.pullId, scope: row.scope, outcome: "ok", count: outcome.count });
    } else {
      summary.failed += 1;
      const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, Math.min(10, row.attempts - 1)));
      await getDb().update(hostedRuntimeSpendPulls)
        .set({ leaseExpiresAt: null, nextAttemptAt: new Date(now.getTime() + backoff), lastErrorCode: outcome.code })
        .where(where);
      addTraceEvent("server.hosted_runtime.spend_pull.result", { day, pull_id: row.pullId, scope: row.scope, outcome: "failed", error_code: outcome.code, attempts: row.attempts });
    }
  }
  return summary;
}

/** Checks every 10 minutes; a day's scopes are pulled once, after 00:30 UTC. */
export function startHostedRuntimeDailySpendWorker(input: { tracer?: Tracer; intervalMs?: number } = {}) {
  const tracer = input.tracer ?? noopTracer;
  let running = false;
  const tick = () => {
    if (running || (!resolveProviderConfig("antiproton") && !resolveProviderConfig("antiproton", process.env, "canary"))) return;
    running = true;
    void (async () => {
      // A span only when something is due, so idle ticks leave no trace.
      const days = spendDaysToPull(currentDate());
      const [due] = await getDb().select({ n: sql<number>`count(*)::int` }).from(hostedRuntimeSpendPulls).where(and(
        isNull(hostedRuntimeSpendPulls.completedAt),
        sql`${hostedRuntimeSpendPulls.day} IN (${sql.join(days.map((day) => sql`${day}::date`), sql`, `)})`,
        or(isNull(hostedRuntimeSpendPulls.nextAttemptAt), lte(hostedRuntimeSpendPulls.nextAttemptAt, currentDate())),
      ));
      const [seen] = await getDb().select({ n: sql<number>`count(*)::int` }).from(hostedRuntimeSpendPulls)
        .where(eq(hostedRuntimeSpendPulls.day, days[0]!));
      if ((due?.n ?? 0) === 0 && (seen?.n ?? 0) > 0) return;
      await withTraceRoot(tracer, "server.hosted_runtime.spend_pull", { surface: "server", kind: "internal" }, async () => {
        await pullHostedRuntimeDailySpend();
      });
    })()
      .catch((error: unknown) => {
        console.error("[HostedRuntimeSpend] daily pull failed", error instanceof Error ? error.name : "unknown");
      })
      .finally(() => { running = false; });
  };
  tick();
  const handle = setClockInterval(tick, input.intervalMs ?? 10 * 60_000);
  if (typeof handle === "object" && handle && "unref" in handle && typeof handle.unref === "function") handle.unref();
  return { stop() { clearClockInterval(handle); } };
}
