import type { AgentArchiveView } from "@botiverse/raft-shared";
import api from "../../api/client";
import type { MessageId } from "../../i18n/messages";

const REQUEST_ERROR_MESSAGE_IDS: Record<string, MessageId> = {
  archive_migration_active: "agent.archive.error.migrationActive",
};

/** A refused archive request in the user's language when the code is known, else the server's text. */
export function archiveRequestErrorMessage(error: unknown, formatMessage: (descriptor: { id: MessageId }) => string): string | null {
  const data = (error as { response?: { data?: { error?: unknown; code?: unknown } } } | null)?.response?.data;
  const messageId = typeof data?.code === "string" ? REQUEST_ERROR_MESSAGE_IDS[data.code] : undefined;
  if (messageId) return formatMessage({ id: messageId });
  return typeof data?.error === "string" ? data.error : null;
}

export async function fetchAgentArchive(agentId: string): Promise<AgentArchiveView | null> {
  const { data } = await api.get<{ archive: AgentArchiveView | null }>(`/agents/${agentId}/archive`);
  return data.archive;
}

export async function requestAgentArchiveWorkspaceDelete(agentId: string): Promise<AgentArchiveView> {
  const { data } = await api.post<{ archive: AgentArchiveView }>(`/agents/${agentId}/archive/workspace`, { action: "delete" });
  return data.archive;
}

/** Plain-language reason for the last failed workspace operation. */
export function archiveErrorMessageId(code: string): MessageId {
  switch (code) {
    case "ARCHIVE_WORKSPACE_MISSING":
      return "agent.archive.error.workspaceMissing";
    case "ARCHIVE_DELETE_UNCONFIRMED":
      return "agent.archive.error.deleteUnconfirmed";
    default:
      return "agent.archive.error.generic";
  }
}
