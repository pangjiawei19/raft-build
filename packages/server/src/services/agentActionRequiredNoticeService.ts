import { getRuntimeDisplayName, type RuntimeErrorRequiredAction } from "@botiverse/raft-shared";
import { eq } from "drizzle-orm";
import type { Server as SocketServer } from "socket.io";
import { getAppUrl } from "../config/appUrl";
import { getDb } from "../db/index";
import { machines, servers } from "../db/schema";
import type { AgentOrchestrator } from "./agentOrchestrator";
import * as agentService from "./agentService";
import * as channelService from "./channelService";
import * as messageService from "./messageService";

/**
 * Tells an agent's owner, once, that the agent stopped on an error only they
 * can fix (a rejected credential, a model the plan does not allow) and that
 * automatic wakes are paused until they act. Before this the agent failed
 * quietly on every wake and the owner learned of it only by opening the agent
 * page (WangHuning, humanverse, 2026-10-13). The notice lands in the DM
 * between the owner and the agent, unread for the owner. It is born-read for
 * the agent and not delivered to it: the agent cannot run until the owner acts,
 * and must not take the notice as a message on its next start.
 *
 * The text is fixed per action and never quotes the runtime's error: the
 * agent can read this DM's history, and the error is shown on the agent page.
 *
 * `runtime_unavailable`: the agent's runtime could not start because the
 * computer does not have it (no CLI there). Same notice, other remedy.
 */
export type AgentActionRequiredNotice =
  | { kind: "runtime_error"; requiredAction: RuntimeErrorRequiredAction }
  | { kind: "runtime_unavailable"; runtime: string; machineId: string };

export async function postAgentActionRequiredNotice(
  io: SocketServer,
  agentOrchestrator: AgentOrchestrator,
  input: { agentId: string; notice: AgentActionRequiredNotice },
): Promise<boolean> {
  const agent = await agentService.getAgent(input.agentId, false, { dbCallsite: "agent_action_required_notice.get_agent" });
  if (!agent) return false;
  const ownerUserId = agent.creatorType === "user" ? agent.creatorId : null;
  if (!ownerUserId) return false;
  const { notice } = input;
  const [dm, [server], [machine]] = await Promise.all([
    channelService.findOrCreateDM(agent.serverId, ownerUserId, agent.id),
    getDb().select({ slug: servers.slug }).from(servers).where(eq(servers.id, agent.serverId)),
    notice.kind === "runtime_unavailable"
      ? getDb().select({ name: machines.name }).from(machines).where(eq(machines.id, notice.machineId))
      : Promise.resolve([]),
  ]);
  if (!dm) return false;
  const agentUrl = server
    ? new URL(`/s/${encodeURIComponent(server.slug)}/agent/${agent.id}`, getAppUrl()).toString()
    : null;
  await messageService.broadcastSystemMessage(
    io,
    agentOrchestrator,
    dm.id,
    notice.kind === "runtime_error"
      ? agentActionRequiredNoticeText({ agentName: agent.name, requiredAction: notice.requiredAction, agentUrl })
      : agentRuntimeUnavailableNoticeText({ agentName: agent.name, runtime: notice.runtime, computerName: machine?.name ?? null, agentUrl }),
    {
      inboxFactPolicy: {
        mode: "record",
        producer: "agent.runtime_action_required",
        reason: "the agent stopped on an error only its owner can fix; automatic wakes are paused",
        causalActor: { type: "agent", id: agent.id },
      },
      // Not for the agent: it cannot run until the owner acts.
      targetAgentIds: [],
    },
  );
  return true;
}

export function agentActionRequiredNoticeText(input: {
  agentName: string;
  requiredAction: RuntimeErrorRequiredAction;
  agentUrl: string | null;
}): string {
  const what = input.requiredAction === "user_model_access"
    ? "its model is not available on the current plan"
    : "its model credential was rejected";
  return [
    `@${input.agentName} stopped because ${what}. The agent page shows the error.`,
    "Messages and reminders wait until you fix it: change the agent's model, provider, API key or environment variables, or start it manually once the credential works again.",
    ...(input.agentUrl ? [`Agent page: ${input.agentUrl}`] : []),
  ].join("\n");
}

export function agentRuntimeUnavailableNoticeText(input: {
  agentName: string;
  runtime: string;
  computerName: string | null;
  agentUrl: string | null;
}): string {
  const runtimeName = getRuntimeDisplayName(input.runtime);
  const where = input.computerName ? `the computer "${input.computerName}"` : "its computer";
  return [
    `@${input.agentName} could not start: ${runtimeName} is not available on ${where}.`,
    // Neutral like the agent page (task #735): the lookup may not have proven
    // the CLI is absent (permission denied, or an old daemon with no reason).
    `Messages and reminders wait until you fix it: make ${runtimeName} available on that computer, move the agent to a computer that has it, or switch the agent's runtime.`,
    ...(input.agentUrl ? [`Agent page: ${input.agentUrl}`] : []),
  ].join("\n");
}
