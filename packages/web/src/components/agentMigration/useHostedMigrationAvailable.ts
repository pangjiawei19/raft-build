import { AGENT_MIGRATION_HOSTED_FEATURE_FLAG_KEY } from "@botiverse/raft-shared";
import { useAgentRuntimeProvider } from "../../hooks/useAgentRuntimeProvider";
import { useServerFeatureFlag } from "../../store/serverFeatureFlags";

/**
 * Whether the start dialog offers the cloud as a target: the server's
 * hosted-migration flag, plus the cloud runtime being on and configured here
 * (the same check the create-agent form uses). Pro is the section's own gate.
 */
export function useHostedMigrationAvailable(enabled: boolean): boolean {
  const flag = useServerFeatureFlag(AGENT_MIGRATION_HOSTED_FEATURE_FLAG_KEY);
  const provider = useAgentRuntimeProvider("antiproton", enabled && flag.enabled);
  return enabled && flag.enabled && provider.available;
}
