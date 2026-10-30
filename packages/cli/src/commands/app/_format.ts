// Canonical app-config reply formatting for agent-facing output.
// Moved verbatim from config.ts (print-seam S2); byte-pin test in
// _format.test.ts copies the pre-move literal shape.
// This is an AX contract, not an implementation detail.

import type { AgentApiAppConfigResponse } from "@botiverse/raft-shared";
import { formatAgentAppConfig } from "@botiverse/raft-shared/src/agentCliSurface";

import { axSurface } from "../../core/renderer";

export const formatAppConfig = axSurface(
  "Built-in app durable-config snapshot with per-key source and next action.",
  (snapshot: AgentApiAppConfigResponse): string =>
    // The snapshot is shared with the SDK (`raft.apps`); the next-action line is the CLI's.
    `${formatAgentAppConfig(snapshot)}\nNext action: raft app config --app ${snapshot.appId}`,
  {
    examples: [{ args: [{ appId: "cleaner", revision: 4, schema: { intervalMinutes: { type: "number" }, enabled: { type: "boolean" } }, defaults: { intervalMinutes: 30, enabled: true }, overrides: { intervalMinutes: 15 }, effective: { intervalMinutes: 15, enabled: true } } as never] }],
  },
);
