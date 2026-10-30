// Built-in app configuration (`raft app config`): read a built-in app's
// durable config for this agent, or change it atomically. Shared by the CLI
// and the SDK so both print the same snapshot.

import { z } from "zod";
import { lazySchema } from "../lazySchema";
import type { AgentApiClient } from "../agentApiClient";
import type { AgentApiAppConfigPatchBody, AgentApiAppConfigResponse } from "../agentApiContract";
import { failureFromClientResult, validateOpRequest, type RaftOutcome } from "./outcome";
import { requestSchema } from "./requestSchema";

export interface AppConfigRequest {
  /** The built-in app, for example `system.cleaner`. */
  appId: string;
}

export interface PatchAppConfigRequest extends AppConfigRequest {
  /** The change: keys to set, and keys to reset to their defaults. */
  patch: AgentApiAppConfigPatchBody;
}

export const appConfigRequestSchema = lazySchema("appConfigRequestSchema", () => requestSchema<AppConfigRequest>()(z.object({
  appId: z.string().min(1).describe("The built-in app, for example `system.cleaner`."),
})));

/** The snapshot lines: each configurable key with its effective value, where it comes from, and its default. */
export function formatAgentAppConfig(snapshot: AgentApiAppConfigResponse): string {
  const lines = [`App: ${snapshot.appId}`, `Revision: ${snapshot.revision}`, "Config:"];
  for (const key of Object.keys(snapshot.schema).sort()) {
    const source = Object.hasOwn(snapshot.overrides, key) ? "override" : "default";
    lines.push(`  ${key} = ${String(snapshot.effective[key])} (${source}; default ${String(snapshot.defaults[key])})`);
  }
  if (Object.keys(snapshot.schema).length === 0) lines.push("  (no configurable fields)");
  return lines.join("\n");
}

export async function getAppConfig(
  client: Pick<AgentApiClient, "apps">,
  request: AppConfigRequest,
): Promise<RaftOutcome<AgentApiAppConfigResponse, "config">> {
  const invalid = validateOpRequest(appConfigRequestSchema, request); if (invalid) return invalid;
  const result = await client.apps.getConfig({ appId: request.appId });
  if (!result.ok) return failureFromClientResult(result);
  return { ok: true, state: "config", data: result.data, next: null, text: formatAgentAppConfig(result.data) };
}

export async function patchAppConfig(
  client: Pick<AgentApiClient, "apps">,
  request: PatchAppConfigRequest,
): Promise<RaftOutcome<AgentApiAppConfigResponse, "updated">> {
  const invalid = validateOpRequest(appConfigRequestSchema, { appId: request.appId }); if (invalid) return invalid;
  const result = await client.apps.patchConfig({ appId: request.appId }, request.patch);
  if (!result.ok) return failureFromClientResult(result);
  return { ok: true, state: "updated", data: result.data, next: null, text: formatAgentAppConfig(result.data) };
}
