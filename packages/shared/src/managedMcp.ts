export const MANAGED_MCP_TRANSPORT = "streamable_http" as const;
export const MANAGED_MCP_MAX_TOOLS_PER_SERVER = 200;
export const MANAGED_MCP_MAX_CATALOG_BYTES = 512 * 1024;
export const MANAGED_MCP_MAX_RESULT_BYTES = 512 * 1024;
export const MANAGED_MCP_OAUTH_RESULT_CHANNEL = "raft-managed-mcp-oauth-result";

export type ManagedMcpProvider = "notion" | "linear" | "custom";
export type ManagedMcpAuthMode = "oauth" | "headers" | "none";
export type ManagedMcpOAuthStatus = "disconnected" | "pending" | "connected" | "error";

export type ManagedMcpJsonSchema = {
  type: "object";
  properties?: Record<string, object>;
  required?: string[];
  [key: string]: unknown;
};

export interface ManagedMcpToolCatalogEntry {
  name: string;
  title?: string;
  description?: string;
  inputSchema: ManagedMcpJsonSchema;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export interface ManagedMcpAssignmentView {
  enabled: boolean;
  allowedTools: string[] | null;
  version: number;
}

export interface ManagedMcpUsageView {
  invocationCount: number;
  lastInvokedAt: string;
  lastToolName: string;
}

export interface ManagedMcpCredentialPatch {
  upsertHeaders: Record<string, string>;
  removeHeaderNames: string[];
}

export interface ManagedMcpServerView {
  id: string;
  name: string;
  description: string | null;
  provider: ManagedMcpProvider;
  authMode: ManagedMcpAuthMode;
  oauthStatus: ManagedMcpOAuthStatus;
  transport: typeof MANAGED_MCP_TRANSPORT;
  endpointUrl: string;
  enabled: boolean;
  configVersion: number;
  catalogVersion: number;
  toolCatalog: ManagedMcpToolCatalogEntry[];
  lastCheckedAt: string | null;
  lastCheckError: string | null;
  credentialHeaderNames: string[];
  hasCredentials: boolean;
  assignment: ManagedMcpAssignmentView | null;
  usage: ManagedMcpUsageView | null;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedMcpAgentCatalogResponse {
  servers: ManagedMcpServerView[];
  recommendations: ManagedMcpRecommendation[];
}

export interface ManagedMcpRecommendation {
  id: string;
  name: string;
  description: string;
  provider: Exclude<ManagedMcpProvider, "custom">;
  authMode: "oauth";
  endpointUrl: string;
  credentialHeaderNames: string[];
}

export interface ManagedMcpRuntimeTool {
  mcpServerId: string;
  serverName: string;
  toolName: string;
  runtimeName: string;
  title?: string;
  description?: string;
  inputSchema: ManagedMcpJsonSchema;
  annotations?: ManagedMcpToolCatalogEntry["annotations"];
  configVersion: number;
  assignmentVersion: number;
}

/**
 * A connector this agent would have tools from, but that is not usable now
 * (an OAuth connection that is not connected). It contributes no tools; it is
 * listed so the agent can say "<serverName> is disconnected; someone who
 * manages this server's integrations has to reconnect it in Raft" instead of
 * acting as if the connector did not exist.
 */
export interface ManagedMcpUnavailableServer {
  mcpServerId: string;
  serverName: string;
  status: "reconnect_required";
}

export interface ManagedMcpRuntimeSnapshot {
  catalogVersion: 1;
  tools: ManagedMcpRuntimeTool[];
  /** Additive; absent from older Servers. Never mapped to tools. */
  unavailable?: ManagedMcpUnavailableServer[];
}

export interface ManagedMcpCallRequest {
  mcpServerId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  expectedConfigVersion: number;
  expectedAssignmentVersion: number;
}

export type ManagedMcpResultContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface ManagedMcpCallResult {
  content: ManagedMcpResultContent[];
  isError: boolean;
  structuredContent?: Record<string, unknown>;
}

function stableToolNameHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** How many characters of a connector or tool name an agent sees. */
export const MANAGED_MCP_PROMPT_NAME_LIMIT = 80;

/** Remote text on one line: control, format and line/paragraph separator characters become spaces. */
export function flattenManagedMcpPromptText(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ").replace(/\s+/g, " ").trim();
}

/**
 * A connector or tool name as agents read it, in prompts and error text.
 * `toolName` comes from the remote MCP server (and `serverName` from whoever
 * set the connector up), so neither may break out of the sentence it sits in:
 * one line, capped, and quoted (`JSON.stringify`). Use this for every name
 * that goes into model-facing text.
 */
export function formatManagedMcpPromptName(value: string): string {
  const chars = Array.from(flattenManagedMcpPromptText(value));
  const capped = chars.length > MANAGED_MCP_PROMPT_NAME_LIMIT ? `${chars.slice(0, MANAGED_MCP_PROMPT_NAME_LIMIT).join("")}…` : chars.join("");
  return JSON.stringify(capped);
}

/** The prefix every runtime tool name of this connector starts with (`mcp_<id8>_`). */
export function formatManagedMcpRuntimeToolPrefix(mcpServerId: string): string {
  return `mcp_${mcpServerId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "server"}_`;
}

export function formatManagedMcpRuntimeToolName(mcpServerId: string, toolName: string): string {
  const serverPart = mcpServerId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "server";
  const toolPart = toolName
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "tool";
  return `mcp_${serverPart}_${toolPart}_${stableToolNameHash(`${mcpServerId}:${toolName}`)}`;
}
