// Wire identifiers and limits for external-agent activity reports. Kept
// dependency-free so the agent CLI can use them without evaluating the shared
// root index, which re-exports everything here.

export const EXTERNAL_AGENT_ACTIVITY_EVENT_SCHEMA = "raft-activity.v1" as const;
export const EXTERNAL_AGENT_ACTIVITY_DRAIN_SCHEMA = "raft-activity-drain.v1" as const;
export const EXTERNAL_AGENT_ACTIVITY_INGEST_SCHEMA = "raft-agent-activity-ingest.v1" as const;
export const EXTERNAL_AGENT_ACTIVITY_PROVENANCE = "external/plugin-reported" as const;
export const EXTERNAL_AGENT_ACTIVITY_TEXT_LIMIT = 4096;
export const EXTERNAL_AGENT_ACTIVITY_TOOL_NAME_LIMIT = 120;
