/**
 * Agent archive: archiving an agent (the old "delete") keeps its record, and
 * its workspace is either kept on the Computer or removed from it.
 */

/** What happens to the workspace when an agent is archived. */
export const AGENT_ARCHIVE_WORKSPACE_CHOICES = ["keep", "delete"] as const;
export type AgentArchiveWorkspaceChoice = typeof AGENT_ARCHIVE_WORKSPACE_CHOICES[number];

/** Where the workspace still exists on the Computer it last ran on. */
export const AGENT_ARCHIVE_WORKSPACE_STATES = ["on_computer", "deleted", "unknown"] as const;
export type AgentArchiveWorkspaceState = typeof AGENT_ARCHIVE_WORKSPACE_STATES[number];

/** Workspace operation waiting for (or running on) the Computer. */
export const AGENT_ARCHIVE_PENDING_OPS = ["delete"] as const;
export type AgentArchivePendingOp = typeof AGENT_ARCHIVE_PENDING_OPS[number];

/** Archive record of an agent as the web sees it. */
export interface AgentArchiveView {
  agentId: string;
  archivedAt: string;
  archivedByUserId: string | null;
  machineId: string | null;
  machineName: string | null;
  workspaceState: AgentArchiveWorkspaceState;
  pendingOp: AgentArchivePendingOp | null;
  /** Set while the op waits for its Computer to come online. */
  waitingForComputer: boolean;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
}

export const AGENT_ARCHIVE_UPDATED_EVENT = "agent:archive:updated";
