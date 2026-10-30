/**
 * `GET /api/agent-runtime-providers/:kind` — read-only availability probe for
 * the create-agent dialog (raft-agent-provider.v1). Today the only kind is
 * `antiproton`.
 *
 * The provider is configured once per deployment (base URL fixed by
 * DEPLOYMENT_ENV + the ANTIPROTON_PROVISIONING_TOKEN secret) and enabled per server
 * by the `antiproton_hosted_runtime` feature flag. The answer is
 * `{kind, available}` and exposes nothing about the configuration.
 *
 * `GET /api/agent-runtime-providers/:kind/models` — the models a new hosted
 * agent can start on, for the create form's picker: the provider's list
 * fetched server-side with the provisioning token (never sent to the browser).
 */
import { Router, type Request, type Response, type Router as RouterType } from "express";
import { isAgentRuntimeProviderKind, type AgentRuntimeProviderAvailabilityView, type AgentRuntimeProviderKind } from "@botiverse/raft-shared";
import { actorHasServerCapabilityInServer } from "../lib/actorPermissions";
import { AgentRuntimeProviderError } from "../services/agentRuntimeProviderService";
import { getAgentRuntimeProviderAvailability } from "../services/agentRuntimeProviderFeature";
import { getHostedRuntimeModels } from "../services/hostedAgentModelService";
import { addTraceEvent } from "../tracing/semanticTrace";

export const agentRuntimeProviderRouter: RouterType = Router();

const STATUS_BY_CODE: Record<AgentRuntimeProviderError["code"], number> = {
  agent_runtime_provider_invalid: 400,
  agent_runtime_provider_disabled: 403,
  agent_runtime_provider_not_configured: 409,
  agent_runtime_provider_key_missing: 503,
  agent_runtime_provider_origin_unconfigured: 409,
};

export function sendAgentRuntimeProviderError(res: Response, error: AgentRuntimeProviderError): void {
  res.status(STATUS_BY_CODE[error.code] ?? 400).json({ error: error.message, code: error.code });
}

/** The provider kind, after the `createAgents` check; null when a refusal was sent. */
async function creatorProviderKind(req: Request, res: Response): Promise<AgentRuntimeProviderKind | null> {
  const kind = req.params.kind;
  if (!isAgentRuntimeProviderKind(kind)) {
    res.status(404).json({ error: "Unknown runtime provider", code: "agent_runtime_provider_unknown" });
    return null;
  }
  if (!await actorHasServerCapabilityInServer(req.serverId!, "user", req.userId!, "createAgents")) {
    res.status(403).json({ error: "createAgents capability required", code: "agent_runtime_provider_forbidden" });
    return null;
  }
  return kind;
}

agentRuntimeProviderRouter.get("/:kind", async (req, res, next) => {
  try {
    const kind = await creatorProviderKind(req, res);
    if (!kind) return;
    const availability = await getAgentRuntimeProviderAvailability(req.serverId!, kind);
    const view: AgentRuntimeProviderAvailabilityView = { kind, available: availability.available };
    res.setHeader("Cache-Control", "no-store");
    res.json(view);
  } catch (error) {
    next(error);
  }
});

agentRuntimeProviderRouter.get("/:kind/models", async (req, res, next) => {
  try {
    const kind = await creatorProviderKind(req, res);
    if (!kind) return;
    res.setHeader("Cache-Control", "no-store");
    const availability = await getAgentRuntimeProviderAvailability(req.serverId!, kind);
    if (!availability.available) {
      res.status(404).json({ error: "Cloud agents are not available on this server", code: "agent_runtime_provider_unavailable" });
      return;
    }
    const result = await getHostedRuntimeModels(req.serverId!, kind);
    if (result.kind === "ok") {
      res.json(result.view);
      return;
    }
    const reason = "reason" in result ? result.reason : result.error?.code ?? result.kind;
    addTraceEvent("agent_runtime_provider.models.failed", {
      route_action: "hosted_runtime_models_read", outcome: "error", reason, http_status: 502,
    });
    res.status(502).json({ error: "The cloud runtime is unavailable right now", code: "hosted_runtime_model_unavailable" });
  } catch (error) {
    next(error);
  }
});
