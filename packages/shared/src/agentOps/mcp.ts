// Managed MCP (Raft-held connectors such as Notion), for runtimes that mount
// the Server's catalog as their own tools: one model tool per catalog entry
// (`runtimeName`, `inputSchema`), exactly as the daemon's pi driver does, so a
// hosted agent and a Computer agent see the same tools. Credentials never
// leave Raft: a call goes through the agent API, which attaches them.
//
// Not a model-facing operation (not in RAFT_OPERATIONS): a generic
// `mcp_call(serverId, versions, …)` tool would make the model discover names
// and build arguments without a schema (Sage, AX).
//
// A call is never held for unread messages (it is not tied to a
// conversation) and never retried automatically (the route is a
// non-idempotent write; the route client sends it once).

import type { AgentApiClient } from "../agentApiClient";
import { flattenManagedMcpPromptText, formatManagedMcpPromptName } from "../managedMcp";
import type { AgentApiManagedMcpCallResponse, AgentApiManagedMcpToolsResponse } from "../agentApiContract";
import { failureFromClientResult, failureOutcome, opError, type RaftFailure, type RaftOutcome } from "./outcome";

/**
 * For runtimes that write their own lines about connectors or tools into the
 * model's context: quote a connector or tool name on one capped line
 * (`flattenMcpPromptText` puts remote text such as a description on one line).
 */
export { formatManagedMcpPromptName as formatMcpPromptName, flattenManagedMcpPromptText as flattenMcpPromptText } from "../managedMcp";

export type RaftMcpTool = AgentApiManagedMcpToolsResponse["tools"][number];

/** A connector this agent may use that needs reconnecting before it has tools. */
export interface RaftMcpReconnectRequired {
  mcpServerId: string;
  serverName: string;
}

export interface RaftMcpCatalog {
  tools: RaftMcpTool[];
  /** Connectors that contribute no tools until someone reconnects them (empty from Servers before this field). */
  reconnectRequired: RaftMcpReconnectRequired[];
}

/**
 * The line to put in the model's context for a connector that needs
 * reconnecting, so the agent tells the user what is wrong instead of saying
 * it has no such connector. Same words as the Server's call error. The name
 * is quoted on one line (`formatManagedMcpPromptName`), so a connector name
 * cannot break out of the sentence.
 */
export function formatMcpReconnectRequired(serverName: string): string {
  return `${formatManagedMcpPromptName(serverName)} is set up on this server but disconnected right now; someone who manages this server's integrations has to reconnect it in Raft. If a task needs it, tell the person who asked.`;
}

function catalogText(catalog: RaftMcpCatalog): string {
  const lines: string[] = [];
  if (catalog.tools.length === 0) lines.push("No managed MCP tools are available to you.");
  for (const tool of catalog.tools) {
    // Names and descriptions come from the remote server: names quoted, one line per tool.
    const description = tool.description ? flattenManagedMcpPromptText(tool.description) : "";
    lines.push(`- ${tool.runtimeName} (${formatManagedMcpPromptName(tool.serverName)}: ${formatManagedMcpPromptName(tool.toolName)})${description ? `: ${description}` : ""}`);
  }
  for (const server of catalog.reconnectRequired) lines.push(formatMcpReconnectRequired(server.serverName));
  return lines.join("\n");
}

/** The Server's managed MCP catalog for this agent, and the connectors that need reconnecting. */
export async function listMcpTools(client: Pick<AgentApiClient, "mcp">): Promise<RaftOutcome<RaftMcpCatalog, "tools" | "empty">> {
  const result = await client.mcp.tools();
  if (!result.ok) return failureFromClientResult(result);
  const catalog: RaftMcpCatalog = {
    tools: result.data.tools,
    reconnectRequired: (result.data.unavailable ?? []).map(({ mcpServerId, serverName }) => ({ mcpServerId, serverName })),
  };
  return {
    ok: true,
    state: catalog.tools.length > 0 ? "tools" : "empty",
    data: catalog,
    next: null,
    text: catalogText(catalog),
  };
}

/** What the model reads when a call's outcome is unknown (the connection to Raft failed mid-call). */
export const MCP_OUTCOME_UNKNOWN_TEXT = "The connection to Raft failed during this call, so it may already have taken effect. Check whether it did before calling the tool again; if you can't check, tell the person who asked instead of calling it again.";

/**
 * What the model reads when Raft itself failed during a call
 * (`managed_mcp_internal_error`): the error can come after the remote tool
 * already ran. The Server sends it; the SDK falls back to it for older Servers.
 */
export const MCP_CALL_INTERNAL_ERROR_TEXT = "Raft hit an error during this call, so it may already have taken effect. Check whether it did before calling the tool again; if you can't check, tell the person who asked instead of calling it again.";

/** How many characters of a remote tool's error text the model sees (as the daemon). */
export const MCP_TOOL_ERROR_TEXT_LIMIT = 4_000;

export interface CallMcpToolRequest {
  /** The catalog entry from `listMcpTools` (its ids and versions are sent; nothing is hand-built). */
  tool: Pick<RaftMcpTool, "mcpServerId" | "toolName" | "configVersion" | "assignmentVersion" | "serverName" | "runtimeName">;
  /** Arguments matching the tool's `inputSchema`. */
  arguments: Record<string, unknown>;
}

export interface RaftMcpResult {
  content: AgentApiManagedMcpCallResponse["content"];
  structuredContent?: Record<string, unknown>;
}

function contentText(content: AgentApiManagedMcpCallResponse["content"]): string {
  return content.filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text").map((block) => block.text).join("\n");
}

/**
 * A failure whose outcome is unknown: the connection failed, or something
 * between the caller and Raft (a gateway) answered 5xx without Raft's JSON
 * `code`. Either way the request may have reached Raft and the tool.
 */
function isOutcomeUnknown(failure: RaftFailure): boolean {
  const { code, status, serverCode } = failure.error;
  return code === "TRANSPORT_ERROR" || (status !== undefined && status >= 500 && serverCode === undefined)
    || serverCode === "managed_mcp_internal_error";
}

/**
 * What a failed call means for the runtime: `reconnect_required` (tell the
 * user; retrying will not help), `stale` (refetch the catalog and remount
 * before the next turn), `unavailable` (Raft confirmed the tool was not
 * called; try again later), `outcome_unknown` (the request may have reached
 * Raft and the tool: never retry blindly, check first), or null. The
 * model-facing words are the failure's `nextAction`.
 */
export function mcpFailureKind(failure: RaftFailure): "reconnect_required" | "stale" | "unavailable" | "outcome_unknown" | null {
  const code = failure.error.serverCode;
  if (code === "managed_mcp_oauth_required" || code === "managed_mcp_oauth_invalid_state"
    || code === "managed_mcp_auth_invalid" || code === "managed_mcp_endpoint_auth_rejected" || code === "managed_mcp_credential_invalid") return "reconnect_required";
  if (code === "managed_mcp_config_stale" || code === "managed_mcp_assignment_stale" || code === "managed_mcp_tool_not_allowed"
    || code === "managed_mcp_server_not_found" || code === "managed_mcp_server_disabled") return "stale";
  if (code === "managed_mcp_unreachable" || code === "managed_mcp_oauth_busy") return "unavailable";
  if (isOutcomeUnknown(failure)) return "outcome_unknown";
  return null;
}

/**
 * Call one managed MCP tool. `result`: the tool's content. `tool_error`: the
 * remote tool answered with an error (its own text, capped with a visible
 * marker); a normal answer the model reads. Failures carry the Server's
 * agent-facing words as `nextAction`; see `mcpFailureKind`.
 */
export async function callMcpTool(
  client: Pick<AgentApiClient, "mcp">,
  request: CallMcpToolRequest,
): Promise<RaftOutcome<RaftMcpResult, "result" | "tool_error">> {
  const { tool } = request;
  if (!tool?.mcpServerId || !tool.toolName || !request.arguments || typeof request.arguments !== "object" || Array.isArray(request.arguments)) {
    return failureOutcome(opError("INVALID_REQUEST", { message: "Pass a catalog entry from listMcpTools as `tool` and an arguments object. Nothing was sent." }));
  }
  const result = await client.mcp.call({
    mcpServerId: tool.mcpServerId,
    toolName: tool.toolName,
    arguments: request.arguments,
    expectedConfigVersion: tool.configVersion,
    expectedAssignmentVersion: tool.assignmentVersion,
  });
  if (!result.ok) {
    const failure = failureFromClientResult(result);
    // The call may have reached Raft and the tool (a non-idempotent write): say so, never "retry".
    if (isOutcomeUnknown(failure)) {
      // Raft's own internal error says so in its words (Raft answered; the connection did not fail).
      const nextAction = failure.error.serverCode === "managed_mcp_internal_error" ? MCP_CALL_INTERNAL_ERROR_TEXT : MCP_OUTCOME_UNKNOWN_TEXT;
      return failureOutcome({ ...failure.error, retryable: false, nextAction });
    }
    return failure;
  }
  const data: RaftMcpResult = {
    content: result.data.content,
    ...(result.data.structuredContent ? { structuredContent: result.data.structuredContent } : {}),
  };
  if (result.data.isError) {
    const full = contentText(result.data.content) || `${tool.runtimeName ?? formatManagedMcpPromptName(tool.toolName)} failed`;
    const text = full.length > MCP_TOOL_ERROR_TEXT_LIMIT ? `${full.slice(0, MCP_TOOL_ERROR_TEXT_LIMIT)}…[truncated]` : full;
    return { ok: true, state: "tool_error", data, next: null, text };
  }
  return { ok: true, state: "result", data, next: null, text: contentText(result.data.content) };
}
