import { resolveProviderConfigForServer } from "./agentRuntimeProviderTargetService";
/**
 * The model of a hosted (provider-backed) agent, proxied to its provider
 * (antiproton docs/agent-surface.md, "The agent's model"):
 *
 *   GET {base}/provision/models?raftServerId=                         the offered models and the default
 *   GET {base}/provision/agents/by-raft-agent/:raftAgentId/model?raftServerId=   what the next turn runs on
 *   PUT  same, {model: id | null}                                     pick an offered model, or follow the default
 *
 * A pick takes effect from the agent's next turn; nothing restarts. The
 * provider answers 422 for an id it does not offer and 409 `model_locked`
 * while an administrator's row decides the model. Only an `active`
 * provisioning row is served. Outcomes are classified, never thrown.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { HOSTED_DEFAULT_MODEL, type AgentRuntimeProviderKind, type HostedAgentModelView, type HostedRuntimeModelsView } from "@botiverse/raft-shared";
import { getDb } from "../db/index";
import { agentRuntimeProvisions } from "../db/schema";
import { ANTIPROTON_MODEL_PICKER_FEATURE_FLAG_KEY, evaluateFeatureFlag } from "./featureFlagService";
import {
  providerAgentModelByRaftIdPath,
  providerModelsPath,
  providerRequest,
  resolveProviderConfig,
  type ProviderCallResult,
  type ProviderErrorBody,
} from "./agentRuntimeProviderService";

export type HostedAgentModelResult =
  | { kind: "ok"; view: HostedAgentModelView }
  /** Not provisioned, not active yet, or the provider is not configured on this deployment. */
  | { kind: "unavailable"; reason: string }
  /** 422: the id is not offered (or not a valid value). */
  | { kind: "not_listed"; error: ProviderErrorBody | null }
  /** 409: an administrator's row decides this agent's model. */
  | { kind: "locked"; error: ProviderErrorBody | null }
  | { kind: "bad_request"; error: ProviderErrorBody | null }
  | { kind: "not_found"; error: ProviderErrorBody | null }
  | { kind: "upstream_unavailable"; reason: string; httpStatus: number | null };

// Minimal shape checks; extra fields are dropped.
const modelsSchema = z.object({
  models: z.array(z.object({ id: z.string(), label: z.string(), provider: z.string().catch("") })),
  default: z.string().nullable().catch(null),
  defaultLabel: z.string().nullable().catch(null),
});

// The server-level list also says whether an administrator decides the model.
const serverModelsSchema = modelsSchema.extend({ locked: z.boolean().catch(false) });

const agentModelSchema = z.object({
  model: z.string().nullable(),
  label: z.string().nullable().catch(null),
  source: z.enum(["default", "chosen", "admin"]).catch("default"),
  locked: z.boolean().catch(false),
});

type Failure = Exclude<HostedAgentModelResult, { kind: "ok" }>;

function classify<T>(result: ProviderCallResult, schema: z.ZodType<T>): { ok: true; body: T } | { ok: false; failure: Failure } {
  if (result.kind === "network") return { ok: false, failure: { kind: "upstream_unavailable", reason: result.code, httpStatus: null } };
  if (result.status === 422) return { ok: false, failure: { kind: "not_listed", error: result.error } };
  if (result.status === 409) return { ok: false, failure: { kind: "locked", error: result.error } };
  if (result.status === 400) return { ok: false, failure: { kind: "bad_request", error: result.error } };
  if (result.status === 404) return { ok: false, failure: { kind: "not_found", error: result.error } };
  if (result.status < 200 || result.status >= 300) {
    return { ok: false, failure: { kind: "upstream_unavailable", reason: result.error?.code ?? `http_${result.status}`, httpStatus: result.status } };
  }
  const parsed = schema.safeParse(result.body);
  if (!parsed.success) return { ok: false, failure: { kind: "upstream_unavailable", reason: "invalid_response", httpStatus: result.status } };
  return { ok: true, body: parsed.data };
}

async function hostedTarget(agentId: string): Promise<
  { ok: true; config: { baseUrl: string; token: string }; serverId: string } | { ok: false; failure: Failure }
> {
  const [row] = await getDb().select().from(agentRuntimeProvisions)
    .where(eq(agentRuntimeProvisions.agentId, agentId)).limit(1);
  if (!row) return { ok: false, failure: { kind: "unavailable", reason: "not_provisioned" } };
  if (row.state !== "active") return { ok: false, failure: { kind: "unavailable", reason: `state_${row.state}` } };
  const config = resolveProviderConfig(row.provider, process.env, row.providerTarget);
  if (!config) return { ok: false, failure: { kind: "unavailable", reason: "provider_not_configured" } };
  return { ok: true, config, serverId: row.serverId };
}

async function withModels(
  target: { config: { baseUrl: string; token: string }; serverId: string },
  agentModelCall: Promise<ProviderCallResult>,
): Promise<HostedAgentModelResult> {
  const [models, agentModel] = await Promise.all([
    providerRequest(target.config, "GET", providerModelsPath(target.serverId)),
    agentModelCall,
  ]);
  // The agent's answer decides the outcome first: a refused pick is reported as such.
  const agent = classify(agentModel, agentModelSchema);
  if (!agent.ok) return agent.failure;
  const list = classify(models, modelsSchema);
  if (!list.ok) return list.failure;
  return {
    kind: "ok",
    view: {
      models: list.body.models,
      default: list.body.default,
      defaultLabel: list.body.defaultLabel,
      model: agent.body.model,
      label: agent.body.label,
      source: agent.body.source,
      locked: agent.body.locked,
      picker: await isHostedModelPickerEnabled(target.serverId),
    },
  };
}

export async function getHostedAgentModel(agentId: string): Promise<HostedAgentModelResult> {
  const target = await hostedTarget(agentId);
  if (!target.ok) return target.failure;
  return withModels(target, providerRequest(target.config, "GET", providerAgentModelByRaftIdPath(agentId, target.serverId)));
}

/** `model: null` follows the provider's default. */
export async function setHostedAgentModel(agentId: string, model: string | null): Promise<HostedAgentModelResult> {
  const target = await hostedTarget(agentId);
  if (!target.ok) return target.failure;
  return withModels(target, providerRequest(target.config, "PUT", providerAgentModelByRaftIdPath(agentId, target.serverId), { body: { model } }));
}

/** `antiproton_model_picker` for this server; any evaluation failure reads as off (Raft decides). */
export async function isHostedModelPickerEnabled(serverId: string): Promise<boolean> {
  try {
    return (await evaluateFeatureFlag({ key: ANTIPROTON_MODEL_PICKER_FEATURE_FLAG_KEY, serverId })).enabled === true;
  } catch {
    return false;
  }
}

/**
 * The model a new hosted agent is provisioned with. Where the server may not
 * pick, none: the provider decides (its admin's per-agent, then per-server
 * model, then its deployment default, which is DeepSeek Flash). An explicit id
 * would be recorded as the user's choice and override the admin's (Tenny,
 * cody).
 */
export async function hostedModelForCreate(serverId: string, picked: string | null): Promise<string | null> {
  return await isHostedModelPickerEnabled(serverId) ? picked : null;
}

export type HostedRuntimeModelsResult =
  | { kind: "ok"; view: HostedRuntimeModelsView }
  | Extract<HostedAgentModelResult, { kind: "unavailable" | "bad_request" | "not_found" | "upstream_unavailable" }>;

/** The models a new hosted agent on this server can start on (no agent needed). */
export async function getHostedRuntimeModels(serverId: string, kind: AgentRuntimeProviderKind): Promise<HostedRuntimeModelsResult> {
  const config = await resolveProviderConfigForServer(serverId, kind);
  if (!config) return { kind: "unavailable", reason: "provider_not_configured" };
  const list = classify(await providerRequest(config, "GET", providerModelsPath(serverId)), serverModelsSchema);
  if (!list.ok) {
    const failure = list.failure;
    // A 422/409 on a read is not a refused pick; report it as the provider failing.
    if (failure.kind === "not_listed" || failure.kind === "locked") {
      return { kind: "upstream_unavailable", reason: failure.error?.code ?? failure.kind, httpStatus: null };
    }
    return failure;
  }
  return {
    kind: "ok",
    view: {
      models: list.body.models,
      default: list.body.default,
      defaultLabel: list.body.defaultLabel,
      locked: list.body.locked,
      picker: await isHostedModelPickerEnabled(serverId),
    },
  };
}

export type HostedModelChoiceResult =
  | { kind: "ok" }
  /** The server may not pick a model (`antiproton_model_picker` off); leave it out. */
  | { kind: "picker_disabled" }
  /** The id is not in the provider's current list. */
  | { kind: "not_listed" }
  /** An administrator decides the model; only `null` (the default) is accepted. */
  | { kind: "locked" }
  | Exclude<HostedRuntimeModelsResult, { kind: "ok" }>;

/**
 * Checks a model picked for a new (or re-provisioned) hosted agent against the
 * provider's current list before anything is written. `null` (the default)
 * needs no check. The provider checks again on POST; this only refuses early.
 */
export async function checkHostedModelChoice(
  serverId: string,
  kind: AgentRuntimeProviderKind,
  model: string | null,
): Promise<HostedModelChoiceResult> {
  if (model === null) return { kind: "ok" };
  if (!await isHostedModelPickerEnabled(serverId)) return model === HOSTED_DEFAULT_MODEL ? { kind: "ok" } : { kind: "picker_disabled" };
  const result = await getHostedRuntimeModels(serverId, kind);
  if (result.kind !== "ok") return result;
  if (result.view.locked) return { kind: "locked" };
  if (!result.view.models.some((option) => option.id === model)) return { kind: "not_listed" };
  return { kind: "ok" };
}
