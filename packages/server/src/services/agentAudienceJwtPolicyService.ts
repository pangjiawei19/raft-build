import { and, eq } from "drizzle-orm";
import { getDb } from "../db/index";
import { oauthClients, oauthClientInstalls } from "../db/schema";
import { oauthClientIsUserManagedPredicate } from "./oauthClientManagementPolicy";

export class AgentJwtPolicyError extends Error {
  constructor(readonly status: 404, message: string) { super(message); }
}

/** Read-only answer for web bundles from before Agent JWT became built in.
 * Remove together with the GET route in the release after this one. */
export type LegacyAppAgentJwtSettings = {
  scope: "app" | "installation"; enabled: true; appEnabled: true;
  effectiveEnabled: boolean; canEnable: false; audience: string; expiresIn: 300;
};

export async function getLegacyAppAgentJwtSettings(serverId: string, clientId: string): Promise<LegacyAppAgentJwtSettings> {
  const db = getDb();
  const [client] = await db.select({
    id: oauthClients.id, serverId: oauthClients.serverId, clientId: oauthClients.clientId,
    appType: oauthClients.appType, enabled: oauthClients.enabled, allowedScopes: oauthClients.allowedScopes,
  }).from(oauthClients).where(and(eq(oauthClients.id, clientId), oauthClientIsUserManagedPredicate()));
  if (!client) throw new AgentJwtPolicyError(404, "App not found on this Server");
  const [installation] = await db.select({ status: oauthClientInstalls.status })
    .from(oauthClientInstalls).where(and(eq(oauthClientInstalls.clientId, client.id), eq(oauthClientInstalls.serverId, serverId)));
  const source = client.serverId === serverId;
  if (!source && (client.appType !== "third_party_global" || !installation)) {
    throw new AgentJwtPolicyError(404, "App not found on this Server");
  }
  // Mirrors the issuer's App checks; per-Agent membership and revocation still apply at issuance.
  const effectiveEnabled = client.enabled && ["openid", "profile"].every((scope) => client.allowedScopes?.includes(scope))
    && (!installation || installation.status === "active")
    && (client.appType === "server_local" || installation?.status === "active");
  return {
    scope: source ? "app" : "installation", enabled: true, appEnabled: true,
    effectiveEnabled, canEnable: false, audience: client.clientId, expiresIn: 300,
  };
}
