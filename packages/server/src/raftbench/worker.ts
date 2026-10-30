import { and, eq } from "drizzle-orm";
import { getDb } from "../db/index";
import { thirdPartyAgentEvents } from "../db/schema";
import type { AgentOrchestrator } from "../services/agentOrchestrator";
import { buildThirdPartyAgentMessage, claimQueuedThirdPartyAgentEventForDelivery, releaseThirdPartyAgentEventDeliveryClaim } from "../services/oauthService";
import { advanceServer, enrolledServers } from "./controls";

/** Source reads and model work stay in the hosted plugin; this worker only assigns bounded runs. */
export async function tickRaftbench(orchestrator: Pick<AgentOrchestrator, "deliverMessage">) {
  if (process.env.DEPLOYMENT_ENV !== "staging") return;
  for (const { serverId } of await enrolledServers()) {
    await advanceServer(serverId);
    const events = await getDb().select().from(thirdPartyAgentEvents).where(and(eq(thirdPartyAgentEvents.serverId, serverId), eq(thirdPartyAgentEvents.systemApp, "system.raftbench"), eq(thirdPartyAgentEvents.status, "queued"))).limit(1);
    for (const event of events) {
      if (!await claimQueuedThirdPartyAgentEventForDelivery(event.id)) continue;
      try {
        await orchestrator.deliverMessage(event.agentId, buildThirdPartyAgentMessage({ event, clientKey: "system.raftbench", clientName: "system.raftbench" }));
      } catch (error) {
        await releaseThirdPartyAgentEventDeliveryClaim(event.id);
        throw error;
      }
    }
  }
}
export function startRaftbenchWorker(orchestrator: Pick<AgentOrchestrator, "deliverMessage">) {
  let running = false;
  let stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try { await tickRaftbench(orchestrator); }
    catch { console.error("[RaftBench] assignment sweep failed; next tick will retry"); }
    finally { running = false; }
  };
  const timer = setInterval(() => { void tick(); }, 30_000);
  timer.unref();
  void tick();
  return { stop() { stopped = true; clearInterval(timer); } };
}
