/**
 * Usage of a hosted (provider-backed) agent as reported by its provider via
 * `GET /agents/:id/hosted-runtime/usage`. Rows with the same `resource` share
 * a unit and can be summed; resources this client does not know are ignored.
 */
export interface HostedRuntimeUsageRow {
  at: string;
  resource: string;
  dimensions: Record<string, string>;
  unit: string;
  quantity: number;
  /** USD; `null` = not priced (e.g. tool calls); absent when the provider does not price usage. */
  cost?: number | null;
}

export interface HostedRuntimeUsageResponse {
  raftAgentId: string;
  bucket: string;
  from: string;
  to: string;
  asOf: string;
  partial: boolean;
  rows: HostedRuntimeUsageRow[];
}

export interface HostedRuntimeUsageSummary {
  /** Summed across models and buckets; `cacheWrite` is 5m + 1h writes, `total` includes unknown kinds. */
  tokens: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number; total: number };
  /** `total` includes outcomes other than succeeded/failed. */
  toolCalls: { total: number; succeeded: number; failed: number };
  /** Models by total tokens, largest first. */
  topModels: Array<{ model: string; tokens: number }>;
  hasUsage: boolean;
  /**
   * USD by UTC day (the `1d` bucket), newest first, only days with priced or
   * unpriced usage; `null` when no row carries a cost. Unpriced rows add
   * nothing to `usd` and only set `hasUnpriced`.
   */
  cost: {
    totalUsd: number;
    /** False when every row with a cost is unpriced: the total is "unpriced", not $0. */
    priced: boolean;
    hasUnpriced: boolean;
    days: Array<{ day: string; usd: number; priced: boolean; hasUnpriced: boolean }>;
  } | null;
}

type TokenKind = Exclude<keyof HostedRuntimeUsageSummary["tokens"], "total">;

const TOKEN_KIND: Record<string, TokenKind> = {
  input: "input",
  output: "output",
  reasoning: "reasoning",
  cache_read: "cacheRead",
  cache_write_5m: "cacheWrite",
  cache_write_1h: "cacheWrite",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The last `days` UTC days including today, so `1d` buckets are whole days. */
export function hostedRuntimeUsageWindow(now: Date, days = 7): { from: string; to: string } {
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { from: new Date(startOfToday - (days - 1) * DAY_MS).toISOString(), to: now.toISOString() };
}

export function hostedRuntimeUsagePath(agentId: string): string {
  return `/agents/${encodeURIComponent(agentId)}/hosted-runtime/usage`;
}

export function summarizeHostedRuntimeUsage(
  rows: readonly HostedRuntimeUsageRow[],
  options: { topModelCount?: number } = {},
): HostedRuntimeUsageSummary {
  const tokens = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  const toolCalls = { total: 0, succeeded: 0, failed: 0 };
  const byModel = new Map<string, number>();
  const costByDay = new Map<string, { usd: number; priced: boolean; hasUnpriced: boolean }>();
  for (const row of rows) {
    const quantity = row.quantity;
    if (!Number.isFinite(quantity)) continue;
    const at = Date.parse(row.at);
    if (row.cost !== undefined && !Number.isNaN(at) && (row.cost === null ? quantity > 0 : Number.isFinite(row.cost))) {
      // UTC day even if the provider ever sends an offset timestamp.
      const day = new Date(at).toISOString().slice(0, 10);
      const entry = costByDay.get(day) ?? { usd: 0, priced: false, hasUnpriced: false };
      if (row.cost === null) entry.hasUnpriced = true;
      else {
        entry.usd += row.cost;
        entry.priced = true;
      }
      costByDay.set(day, entry);
    }
    if (row.resource === "model.tokens") {
      tokens.total += quantity;
      const kind = TOKEN_KIND[row.dimensions?.kind ?? ""];
      if (kind) tokens[kind] += quantity;
      const model = row.dimensions?.model;
      if (model) byModel.set(model, (byModel.get(model) ?? 0) + quantity);
    } else if (row.resource === "tool.call") {
      toolCalls.total += quantity;
      const outcome = row.dimensions?.outcome;
      if (outcome === "succeeded") toolCalls.succeeded += quantity;
      else if (outcome === "failed") toolCalls.failed += quantity;
    }
  }
  const topModels = [...byModel]
    .map(([model, modelTokens]) => ({ model, tokens: modelTokens }))
    .filter((entry) => entry.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model))
    .slice(0, options.topModelCount ?? 3);
  const days = [...costByDay]
    .map(([day, entry]) => ({ day, ...entry }))
    .sort((a, b) => b.day.localeCompare(a.day));
  const cost = days.length === 0 ? null : {
    totalUsd: days.reduce((sum, day) => sum + day.usd, 0),
    priced: days.some((day) => day.priced),
    hasUnpriced: days.some((day) => day.hasUnpriced),
    days,
  };
  return { tokens, toolCalls, topModels, hasUsage: tokens.total > 0 || toolCalls.total > 0, cost };
}
