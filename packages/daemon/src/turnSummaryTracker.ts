import {
  type ActivityTurnTrigger,
  type AgentMessage,
} from "@botiverse/raft-shared";
import { formatAgentMessageVisibleTarget } from "./agentVisibleDeliveryLedger";

export { TurnSummaryTracker, turnOutcomeForActivity } from "@botiverse/raft-shared";

/** The message that woke the agent: the first ordinary one handed over. */
export function turnTriggerFromMessages(messages: readonly AgentMessage[]): ActivityTurnTrigger | undefined {
  const first = messages[0];
  if (!first) return undefined;
  return {
    target: formatAgentMessageVisibleTarget(first),
    ...(first.channel_id ? { channelId: first.channel_id } : {}),
    ...(first.sender_name ? { sender: first.sender_name } : {}),
    ...(first.message_id ? { messageId: first.message_id } : {}),
  };
}
