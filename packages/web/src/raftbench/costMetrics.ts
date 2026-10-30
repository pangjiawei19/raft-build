import api from "../api/client";
import { comparisonWindow } from "./taskMetrics";

export interface CostComparison {
  currentUsd: number;
  previousUsd: number;
  unpriced: boolean;
  estimated: boolean;
  start: string;
  end: string;
}
/** Billing ACL stays authoritative; no tokens, provider identity or task attribution retained. */
export async function loadCostComparison(serverId: string, now: string, signal: AbortSignal): Promise<CostComparison> {
  const window = comparisonWindow(now);
  const from = new Date(window.previousStart).toISOString(), to = new Date(window.end).toISOString();
  const { data } = await api.get<unknown>("/billing/hosted-runtime-usage", {
    params: { from, to, bucket: "day" }, headers: { "X-Server-Id": serverId }, signal,
  });
  if (!data || typeof data !== "object") throw new Error("Invalid spend response");
  const row = data as Record<string, unknown>;
  if (row.currency !== "USD" || typeof row.estimated !== "boolean" || !Array.isArray(row.periods) || row.bucket !== "day" ||
    typeof row.from !== "string" || Date.parse(row.from) > window.previousStart ||
    typeof row.to !== "string" || Date.parse(row.to) < window.end ||
    !Number.isFinite(Date.parse(row.from)) || !Number.isFinite(Date.parse(row.to))) throw new Error("Invalid spend window");
  let currentUsd = 0, previousUsd = 0, unpriced = false;
  const seen = new Set<number>();
  for (const period of row.periods) {
    if (!period || typeof period !== "object") throw new Error("Invalid spend period");
    const p = period as Record<string, unknown>;
    const time = typeof p.start === "string" ? Date.parse(p.start) : NaN;
    if (!Number.isFinite(time) || time % 86_400_000 !== 0 || seen.has(time) ||
      typeof p.totalUsd !== "number" || !Number.isFinite(p.totalUsd) || !Array.isArray(p.unpriced) ||
      !p.unpriced.every((item) => typeof item === "string")) throw new Error("Invalid spend period");
    seen.add(time);
    if (time < window.previousStart || time >= window.end) continue;
    if (time >= window.start) currentUsd += p.totalUsd;
    else previousUsd += p.totalUsd;
    unpriced ||= p.unpriced.length > 0;
  }
  return { currentUsd, previousUsd, unpriced, estimated: row.estimated, start: new Date(window.start).toISOString(), end: to };
}
