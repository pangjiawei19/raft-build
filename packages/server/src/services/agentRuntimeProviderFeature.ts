import { and, eq } from "drizzle-orm";
import { ANTIPROTON_HOSTED_RUNTIME_FEATURE_FLAG_KEY, type AgentRuntimeProviderKind } from "@botiverse/raft-shared";
import { type DatabaseExecutor, getDb } from "../db/index";
import { agentRuntimeProvisions, servers } from "../db/schema";
import { evaluateFeatureFlag, getFeatureFlag } from "./featureFlagService";
import { isProviderDeploymentConfigured } from "./agentRuntimeProviderService";

const FLAG_BY_PROVIDER: Record<AgentRuntimeProviderKind, string> = {
  antiproton: ANTIPROTON_HOSTED_RUNTIME_FEATURE_FLAG_KEY,
};

/**
 * The server's current owner, the user hosted-runtime flags are evaluated for: a `user`
 * rule then covers every server that account owns (and follows an ownership transfer).
 */
export async function getServerOwnerId(serverId: string, executor: DatabaseExecutor = getDb()): Promise<string | null> {
  const [row] = await executor.select({ ownerId: servers.ownerId }).from(servers).where(eq(servers.id, serverId)).limit(1);
  return row?.ownerId ?? null;
}

/** Server-scoped gate (default off; enabled per server, or per owner, through the flag's rules). */
export async function isAgentRuntimeProviderEnabledForServer(
  serverId: string,
  kind: AgentRuntimeProviderKind,
  executor: DatabaseExecutor = getDb(),
): Promise<boolean> {
  const userId = await getServerOwnerId(serverId, executor);
  const evaluation = await evaluateFeatureFlag({ key: FLAG_BY_PROVIDER[kind], serverId, userId }, executor);
  return evaluation.enabled;
}

/**
 * The gate for a hosted agent that already has a provision: only the flag's kill switch
 * stops it. Rollout rules (percentage, server, user) decide creating one, so lowering a
 * rule or transferring the server doesn't break agents already running.
 */
export async function isAgentRuntimeProviderKillSwitched(
  kind: AgentRuntimeProviderKind,
  executor: DatabaseExecutor = getDb(),
): Promise<boolean> {
  return (await getFeatureFlag(FLAG_BY_PROVIDER[kind], executor))?.killSwitch === true;
}

/** Whether the server has ever had a hosted agent on `kind` (any provision row, deleted ones included). */
export async function serverHasHostedProvision(
  serverId: string,
  kind: AgentRuntimeProviderKind,
  executor: DatabaseExecutor = getDb(),
): Promise<boolean> {
  const [row] = await executor.select({ agentId: agentRuntimeProvisions.agentId }).from(agentRuntimeProvisions)
    .where(and(eq(agentRuntimeProvisions.serverId, serverId), eq(agentRuntimeProvisions.provider, kind))).limit(1);
  return Boolean(row);
}

export type AgentRuntimeProviderAvailability =
  | { available: true }
  | { available: false; reason: "flag_disabled" | "not_configured" };

/** Both gates: the deployment is configured AND the server has the flag. */
export async function getAgentRuntimeProviderAvailability(
  serverId: string,
  kind: AgentRuntimeProviderKind,
): Promise<AgentRuntimeProviderAvailability> {
  if (!await isAgentRuntimeProviderEnabledForServer(serverId, kind)) return { available: false, reason: "flag_disabled" };
  if (!isProviderDeploymentConfigured(kind)) return { available: false, reason: "not_configured" };
  return { available: true };
}
