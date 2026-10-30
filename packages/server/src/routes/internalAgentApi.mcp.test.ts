import { createApiTest } from "../test/integration/apiTest";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { getDb } from "../db/index";
import { managedMcpServers, users } from "../db/schema";
import { createAgent } from "../services/agentService";
import { mintAgentCredential } from "../services/agentCredentialService";
import { createServer } from "../services/serverService";

const test = createApiTest({ humanActivityMuteFlagDefaultEnabled: true, onboardingOpenerFlagDefaultEnabled: false });

async function seed() {
  const suffix = randomUUID();
  const [user] = await getDb().insert(users).values({
    email: `mcp-agent-api-${suffix}@slock.test`,
    name: `mcp-agent-api-${suffix}`,
    displayName: "MCP Agent API Owner",
    passwordHash: "hash",
    emailVerified: true,
  }).returning();
  const server = await createServer("MCP Agent API", `mcp-agent-api-${suffix}`, user.id);
  const agent = await createAgent(server.id, `McpAgent${suffix.slice(0, 6)}`);
  const [mcpServer] = await getDb().insert(managedMcpServers).values({
    serverId: server.id,
    name: "Docs",
    endpointUrl: "https://example.com/mcp",
    toolCatalog: [{ name: "search", inputSchema: { type: "object" } }],
    catalogVersion: 1,
  }).returning();
  const mcpKey = await mintAgentCredential({ agentId: agent.id, scopes: ["mcp"], name: "mcp-test", createdByUserId: null });
  const readKey = await mintAgentCredential({ agentId: agent.id, scopes: ["read"], name: "read-test", createdByUserId: null });
  return { mcpKey: mcpKey.apiKey, readKey: readKey.apiKey, mcpServerId: mcpServer.id };
}

test("agent-api managed MCP snapshot is credential-bound and capability-gated", async ({ app }) => {
  const fixture = await seed();
  const denied = await fetch(`${app.baseUrl}/internal/agent-api/mcp/tools`, {
    headers: { Authorization: `Bearer ${fixture.readKey}` },
  });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json() as { requiredCapability?: string }).requiredCapability, "mcp");

  const response = await fetch(`${app.baseUrl}/internal/agent-api/mcp/tools`, {
    headers: {
      Authorization: `Bearer ${fixture.mcpKey}`,
      "X-Slock-Agent-Active-Capabilities": "mcp",
    },
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { catalogVersion: number; tools: Array<Record<string, unknown>> };
  assert.equal(body.catalogVersion, 1);
  assert.equal(body.tools.length, 1);
  assert.equal(body.tools[0].mcpServerId, fixture.mcpServerId);
  assert.equal(body.tools[0].toolName, "search");
  assert.equal(body.tools[0].assignmentVersion, 1);
  assert.equal("endpointUrl" in body.tools[0], false);
  assert.equal("headers" in body.tools[0], false);

  const invalidCall = await fetch(`${app.baseUrl}/internal/agent-api/mcp/call`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${fixture.mcpKey}`,
      "X-Slock-Agent-Active-Capabilities": "mcp",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ mcpServerId: "not-a-uuid", toolName: "search", arguments: {} }),
  });
  assert.equal(invalidCall.status, 400);
});

test("agent-api managed MCP: a disconnected connector is listed as unavailable, and a stale call reads as an agent can act on", async ({ app }) => {
  const fixture = await seed();
  const headers = { Authorization: `Bearer ${fixture.mcpKey}`, "X-Slock-Agent-Active-Capabilities": "mcp", "Content-Type": "application/json" };
  const [docs] = await getDb().select().from(managedMcpServers).where(eq(managedMcpServers.id, fixture.mcpServerId));
  const [notion] = await getDb().insert(managedMcpServers).values({
    serverId: docs!.serverId,
    name: "Notion",
    provider: "notion",
    authMode: "oauth",
    oauthStatus: "error",
    endpointUrl: "https://mcp.notion.com/mcp",
    toolCatalog: [{ name: "search", inputSchema: { type: "object" } }],
    catalogVersion: 1,
  }).returning();

  const tools = await fetch(`${app.baseUrl}/internal/agent-api/mcp/tools`, { headers });
  assert.equal(tools.status, 200);
  const body = await tools.json() as { tools: Array<{ serverName: string }>; unavailable?: unknown };
  assert.deepEqual(body.tools.map((t) => t.serverName), ["Docs"], "the disconnected connector contributes no tools");
  assert.deepEqual(body.unavailable, [{ mcpServerId: notion!.id, serverName: "Notion", status: "reconnect_required" }], "survives response validation");

  const stale = await fetch(`${app.baseUrl}/internal/agent-api/mcp/call`, {
    method: "POST",
    headers,
    body: JSON.stringify({ mcpServerId: fixture.mcpServerId, toolName: "search", arguments: {}, expectedConfigVersion: 999, expectedAssignmentVersion: 1 }),
  });
  assert.equal(stale.status, 409);
  const staleText = "\"search\" is no longer offered by \"Docs\"; don't call it again. If you still need it, tell the person who asked.";
  assert.deepEqual(await stale.json(), { code: "managed_mcp_config_stale", error: staleText, suggestedNextAction: staleText }, "raft-sdk shows suggestedNextAction");
});
