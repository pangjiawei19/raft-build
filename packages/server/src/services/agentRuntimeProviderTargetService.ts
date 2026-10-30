import { and, eq } from "drizzle-orm";
import type { AgentRuntimeProviderKind } from "@botiverse/raft-shared";
import { getDb } from "../db/index";
import { agentRuntimeProvisions } from "../db/schema";
import { getRaftbenchCanaryServerId, resolveProviderConfig } from "./agentRuntimeProviderService";

/** A dedicated server has one frozen provider target; enrollment refuses mixed targets. */
export async function resolveProviderConfigForServer(serverId: string, provider: AgentRuntimeProviderKind) {
  const [binding] = await getDb().select({ target: agentRuntimeProvisions.providerTarget }).from(agentRuntimeProvisions)
    .where(and(eq(agentRuntimeProvisions.serverId, serverId), eq(agentRuntimeProvisions.provider, provider))).limit(1);
  const target = binding?.target ?? (serverId === getRaftbenchCanaryServerId() ? "canary" : "default");
  return resolveProviderConfig(provider, process.env, target);
}
