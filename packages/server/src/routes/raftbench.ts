import { Router, type Router as RouterType } from "express";
import { z } from "zod";
import { configureSchema } from "../raftbench/contract";
import { assignServiceAgent, configure, createUnassignedServiceAgent, dashboard, listServiceAgents } from "../raftbench/controls";
import { AgentRuntimeProviderError } from "../services/agentRuntimeProviderService";
import { RaftbenchError } from "../raftbench/service";
export const raftbenchRouter: RouterType = Router();
raftbenchRouter.get("/agents", async (req, res, next) => {
  try { res.json({ agents: await listServiceAgents(req.serverId!, req.userId!) }); }
  catch (error) { if (error instanceof RaftbenchError) { res.status(error.status).json({ error: error.message, code: error.code }); return; } next(error); }
});
raftbenchRouter.post("/agents", async (req, res, next) => {
  const parsed = z.object({ providerTarget: z.enum(["default", "canary"]).optional() }).strict().safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Invalid RaftBench agent settings" }); return; }
  try { res.status(201).json(await createUnassignedServiceAgent(req.serverId!, req.userId!, parsed.data.providerTarget)); }
  catch (error) { if (error instanceof RaftbenchError) { res.status(error.status).json({ error: error.message, code: error.code }); return; } if (error instanceof AgentRuntimeProviderError) { res.status(error.code === "agent_runtime_provider_disabled" ? 403 : 503).json({ error: error.message, code: error.code }); return; } next(error); }
});
raftbenchRouter.put("/assignment", async (req, res, next) => {
  const parsed = z.object({ agentId: z.string().uuid(), expectedRevision: z.number().int().nonnegative(), channelIds: z.array(z.string().uuid()).min(1).max(50).optional(), historyFrom: z.string().datetime().optional() }).strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid RaftBench assignment" }); return; }
  try { await assignServiceAgent(req.serverId!, req.userId!, parsed.data.agentId, parsed.data.expectedRevision, { channelIds: parsed.data.channelIds ?? [], historyFrom: parsed.data.historyFrom }); res.json({ saved: true }); }
  catch (error) { if (error instanceof RaftbenchError) { res.status(error.status).json({ error: error.message, code: error.code }); return; } next(error); }
});
raftbenchRouter.get("/", async (req, res, next) => {
  try {
    const raw = req.query.page ?? "1";
    if (typeof raw !== "string" || !/^[1-9]\d{0,3}$/.test(raw)) { res.status(400).json({ error: "Invalid result page" }); return; }
    res.json(await dashboard(req.serverId!, req.userId!, Number(raw)));
  } catch (error) {
    if (error instanceof RaftbenchError) { res.status(error.status).json({ error: error.message, code: error.code }); return; }
    next(error);
  }
});
raftbenchRouter.put("/", async (req, res, next) => {
  const parsed = configureSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid RaftBench settings", issues: parsed.error.issues }); return; }
  try {
    await configure(req.serverId!, req.userId!, parsed.data);
    res.json({ saved: true });
  } catch (error) {
    if (error instanceof RaftbenchError) { res.status(error.status).json({ error: error.message, code: error.code }); return; }
    if (error instanceof AgentRuntimeProviderError) { res.status(error.code === "agent_runtime_provider_disabled" ? 403 : 503).json({ error: error.message, code: error.code }); return; }
    next(error);
  }
});
