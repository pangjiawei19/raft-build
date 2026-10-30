import { SLACK_BRIDGE_PRODUCT_FEATURE_FLAG_KEYS as SHARED_SLACK_BRIDGE_PRODUCT_FEATURE_FLAG_KEYS } from "../feature-flag-taxonomy";

export const AGENT_MIGRATION_FEATURE_FLAG_KEY = "agent_migration_v0";
/**
 * Migrating an agent to Raft hosted (task #16), on top of agent_migration_v0,
 * Pro and antiproton_hosted_runtime. Server-stage, default off, no rules: it
 * opens per server once the whole flow (completion included) has shipped.
 */
export const AGENT_MIGRATION_HOSTED_FEATURE_FLAG_KEY = "agent_migration_hosted_v0";
export const APPLE_WEB_LOGIN_FEATURE_FLAG_KEY = "apple_web_login_v0";
export const CHANNEL_MANAGER_ROLE_ACTIONS_FEATURE_FLAG_KEY = "channel_manager_role_actions_v0";
export const PROVIDER_CONNECTIONS_FEATURE_FLAG_KEY = "provider_connections_v0";
/** Hosted agent runtime on antiproton (raft-agent-provider.v1). Server-stage, default off. */
export const ANTIPROTON_HOSTED_RUNTIME_FEATURE_FLAG_KEY = "antiproton_hosted_runtime";
/** Computer-scoped provider probes (Phase 2A). Server-stage, default off. */
/** Wave 3: launch enforcement on matching fresh Computer receipts + legacy probe retirement. */
export const SERVER_LABS_UI_FEATURE_FLAG_KEY = "server_labs_ui_v0";
export const SERVER_GUEST_FEATURE_FLAG_KEY = "server_guest_v0";
/** Web remote Computer upgrade, v2 (request → reconnect readback). Default off. */
export const REMOTE_COMPUTER_UPGRADE_V2_FEATURE_FLAG_KEY = "remote_computer_upgrade_v2";
/** "Same physical machine" grouping of Computers: the Server asks for, stores and shows a per-server host hash. Server-scoped, default off. */
export const COMPUTER_HOST_IDENTITY_FEATURE_FLAG_KEY = "computer_host_identity_v0";
export const PUBLIC_SERVER_FEATURE_FLAG_KEY = "public_server_v0";
/** Public server SEO: indexing master switch for the search API (raft.build pages and sitemap). Default off. */
export const PUBLIC_SERVER_SEARCH_INDEX_FEATURE_FLAG_KEY = "public_server_search_index_v0";
export const COMPOSER_RESOURCE_REFERENCES_FEATURE_FLAG_KEY = "composer_resource_references_v0";

export const SLACK_BRIDGE_FEATURE_FLAG_KEYS = {
  master: "slack_bridge_v0",
  attachmentTransfer: "slack_attachment_transfer",
  reactionSync: "slack_reaction_sync",
} as const;

/**
 * Product capabilities are the only Slack Bridge flags that should be shown
 * in a user-facing Feature Flag Admin surface. Internal implementation fuses
 * remain code-owned and fail-closed, but are not operator-facing products.
 */
export const SLACK_BRIDGE_PRODUCT_FEATURE_FLAG_KEYS = SHARED_SLACK_BRIDGE_PRODUCT_FEATURE_FLAG_KEYS;

export const SLACK_BRIDGE_INTERNAL_FEATURE_FLAG_KEYS = [] as const;

export type SlackBridgeProductFeatureFlagKey =
  (typeof SLACK_BRIDGE_PRODUCT_FEATURE_FLAG_KEYS)[keyof typeof SLACK_BRIDGE_PRODUCT_FEATURE_FLAG_KEYS];

export function isSlackBridgeProductFeatureFlagKey(
  key: string,
): key is SlackBridgeProductFeatureFlagKey {
  return (Object.values(SLACK_BRIDGE_PRODUCT_FEATURE_FLAG_KEYS) as string[]).includes(key);
}

export type SlackBridgeFeatureFlagKey =
  (typeof SLACK_BRIDGE_FEATURE_FLAG_KEYS)[keyof typeof SLACK_BRIDGE_FEATURE_FLAG_KEYS];

export const CHANNEL_TO_JOINT_CONVERSION_FEATURE_FLAG_KEY = "channel_to_joint_conversion_v0";
export * from "./featureFlagRolloutGuardrail";
export * from "./featureFlagClientRules";

/** Sidebar parent+followed-thread read-all; enable only after all read workers support the mutation. */
export const SIDEBAR_MARK_ALL_READ_FEATURE_FLAG_KEY = "sidebar_mark_all_read_v0";
