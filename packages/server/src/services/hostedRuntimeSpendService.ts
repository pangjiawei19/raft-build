import { resolveProviderConfigForServer } from "./agentRuntimeProviderTargetService";
/**
 * A server's spend on its hosted runtime provider, proxied with the
 * provisioning token (antiproton `GET /provision/usage?raftServerId=`): today
 * against the server's daily limit, and totals by UTC day or month. The token
 * never reaches the browser; Raft stores no copy and nothing bills from it.
 *
 * The provider names agents by its own id; they are mapped back to Raft agents
 * through `agent_runtime_provisions.provider_agent_id`. Spend of agents Raft no
 * longer has is gathered into one `agentId: null` entry. Outcomes are
 * classified, never thrown.
 */
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { AgentRuntimeProviderKind, HostedRuntimeSpendView } from "@botiverse/raft-shared";
import { getDb } from "../db/index";
import { agentRuntimeProvisions, agents } from "../db/schema";
import { providerRequest, providerTenantUsagePath, type ProviderErrorBody } from "./agentRuntimeProviderService";

export const HOSTED_SPEND_BUCKETS = ["day", "month"] as const;
export type HostedSpendBucket = (typeof HOSTED_SPEND_BUCKETS)[number];
/** The provider rejects longer windows; Raft validates first so the user gets a precise 400. */
export const HOSTED_SPEND_MAX_WINDOW_MS = 400 * 24 * 60 * 60 * 1000;

export type HostedRuntimeSpendResult =
  | { kind: "ok"; view: HostedRuntimeSpendView }
  /** The provider is not configured on this deployment. */
  | { kind: "unavailable"; reason: string }
  | { kind: "bad_request"; error: ProviderErrorBody | null }
  /** The provider has no tenant for this server. */
  | { kind: "not_found"; error: ProviderErrorBody | null }
  | { kind: "upstream_unavailable"; reason: string; httpStatus: number | null };

// Minimal shape checks; extra fields are dropped.
const usdSchema = z.number().finite();
const spendSchema = z.object({
  currency: z.string().catch("USD"),
  estimated: z.boolean().catch(true),
  today: z.object({
    day: z.string(),
    spentUsd: usdSchema,
    limitUsd: usdSchema.nullable(),
    exempt: z.boolean().catch(false),
    platformLimitReached: z.boolean().catch(false),
    refusing: z.boolean(),
    resetsAt: z.string(),
  }),
  from: z.string(),
  to: z.string(),
  bucket: z.enum(HOSTED_SPEND_BUCKETS),
  totalUsd: usdSchema,
  periods: z.array(z.object({
    start: z.string(),
    totalUsd: usdSchema,
    unpriced: z.array(z.string()).catch([]),
  })),
  agents: z.array(z.object({ providerAgentId: z.string(), totalUsd: usdSchema })).catch([]),
});

async function withRaftAgents(
  serverId: string,
  entries: Array<{ providerAgentId: string; totalUsd: number }>,
): Promise<HostedRuntimeSpendView["agents"]> {
  if (entries.length === 0) return [];
  const rows = await getDb()
    .select({ providerAgentId: agentRuntimeProvisions.providerAgentId, agentId: agents.id, name: agents.name, displayName: agents.displayName })
    .from(agentRuntimeProvisions)
    .innerJoin(agents, eq(agents.id, agentRuntimeProvisions.agentId))
    .where(and(
      eq(agentRuntimeProvisions.serverId, serverId),
      inArray(agentRuntimeProvisions.providerAgentId, entries.map((entry) => entry.providerAgentId)),
    ));
  const byProviderId = new Map(rows.map((row) => [row.providerAgentId, row]));
  const result: HostedRuntimeSpendView["agents"] = [];
  let gone = 0;
  let anyGone = false;
  for (const entry of entries) {
    const agent = byProviderId.get(entry.providerAgentId);
    if (agent) result.push({ agentId: agent.agentId, name: agent.displayName || agent.name, totalUsd: entry.totalUsd });
    else {
      gone += entry.totalUsd;
      anyGone = true;
    }
  }
  if (anyGone) result.push({ agentId: null, name: null, totalUsd: gone });
  return result.sort((a, b) => b.totalUsd - a.totalUsd);
}

export async function getHostedRuntimeSpend(
  serverId: string,
  provider: AgentRuntimeProviderKind,
  params: { from?: string; to?: string; bucket?: HostedSpendBucket },
): Promise<HostedRuntimeSpendResult> {
  const config = await resolveProviderConfigForServer(serverId, provider);
  if (!config) return { kind: "unavailable", reason: "provider_not_configured" };
  const result = await providerRequest(config, "GET", providerTenantUsagePath(serverId, params));
  if (result.kind === "network") return { kind: "upstream_unavailable", reason: result.code, httpStatus: null };
  if (result.status === 400) return { kind: "bad_request", error: result.error };
  if (result.status === 404) return { kind: "not_found", error: result.error };
  if (result.status < 200 || result.status >= 300) {
    return { kind: "upstream_unavailable", reason: result.error?.code ?? `http_${result.status}`, httpStatus: result.status };
  }
  const parsed = spendSchema.safeParse(result.body);
  if (!parsed.success) return { kind: "upstream_unavailable", reason: "invalid_response", httpStatus: result.status };
  const body = parsed.data;
  return {
    kind: "ok",
    view: {
      currency: body.currency,
      estimated: body.estimated,
      today: body.today,
      from: body.from,
      to: body.to,
      bucket: body.bucket,
      totalUsd: body.totalUsd,
      periods: [...body.periods].sort((a, b) => b.start.localeCompare(a.start)),
      agents: await withRaftAgents(serverId, body.agents),
    },
  };
}

/** Validates optional `from`/`to`/`bucket`; omitted ones take the provider's defaults (30 days, by day). */
export function parseHostedSpendQuery(
  query: { from?: unknown; to?: unknown; bucket?: unknown },
): { ok: true; from?: string; to?: string; bucket?: HostedSpendBucket } | { ok: false; error: string } {
  const parseTime = (value: unknown): Date | null | undefined => {
    if (value === undefined || value === "") return undefined;
    if (typeof value !== "string") return null;
    const time = Date.parse(value);
    return Number.isNaN(time) ? null : new Date(time);
  };
  const from = parseTime(query.from);
  if (from === null) return { ok: false, error: "`from` must be an ISO 8601 timestamp" };
  const to = parseTime(query.to);
  if (to === null) return { ok: false, error: "`to` must be an ISO 8601 timestamp" };
  if (from && to) {
    if (from.getTime() >= to.getTime()) return { ok: false, error: "`from` must be before `to`" };
    if (to.getTime() - from.getTime() > HOSTED_SPEND_MAX_WINDOW_MS) return { ok: false, error: "The window may span at most 400 days" };
  }
  const bucket = query.bucket === undefined || query.bucket === "" ? undefined : query.bucket;
  if (bucket !== undefined && !HOSTED_SPEND_BUCKETS.includes(bucket as HostedSpendBucket)) {
    return { ok: false, error: "`bucket` must be day or month" };
  }
  return { ok: true, from: from?.toISOString(), to: to?.toISOString(), bucket: bucket as HostedSpendBucket | undefined };
}
