import { and, eq, isNull } from "drizzle-orm";
import { projectAppSetup, asAppSetupInstallationId, type AppSetupInstallationId, type AppSetupState } from "@botiverse/raft-shared";
import { getDb } from "../db";
import { oauthClients, oauthClientInstalls, servers } from "../db/schema";
import { oauthClientIsUserManagedPredicate } from "./oauthClientManagementPolicy";
import { recordIntegrationAuditEvent } from "./integrationAuditService";

export class AppSetupConflictError extends Error {}

/** Callers establish human Server access or authenticate the owning App first. */
export async function getAppInstallationSetup(input: { clientId: string; serverId: string }): Promise<AppSetupState | null> {
  const [row] = await getDb().select({ client: oauthClients, installation: oauthClientInstalls })
    .from(oauthClientInstalls)
    .innerJoin(oauthClients, eq(oauthClients.id, oauthClientInstalls.clientId))
    .innerJoin(servers, eq(servers.id, oauthClientInstalls.serverId))
    .where(and(
      eq(oauthClients.id, input.clientId), eq(oauthClientInstalls.serverId, input.serverId),
      eq(oauthClients.enabled, true), eq(oauthClientInstalls.status, "active"), isNull(servers.deletedAt),
      oauthClientIsUserManagedPredicate(),
    )).limit(1);
  return row ? projectAppSetup({
    setupUrl: row.client.setupUrl, setupDescription: row.client.setupDescription, setupRevision: row.client.setupRevision,
    installationId: asAppSetupInstallationId(row.installation.id), serverId: row.installation.serverId,
    completedRevision: row.installation.setupCompletedRevision, completedAt: row.installation.setupCompletedAt,
  }) : null;
}

/** App-authenticated, revision-bound and idempotent; never a permissions grant. */
export async function updateAppInstallationSetup(input: {
  clientId: string; installationId: AppSetupInstallationId; revision: number; status: "pending" | "complete";
}): Promise<AppSetupState | null> {
  return getDb().transaction(async (tx) => {
    // Same client-first lock order as declaration updates and install lifecycle.
    const [client] = await tx.select().from(oauthClients).where(and(
      eq(oauthClients.id, input.clientId), eq(oauthClients.enabled, true), oauthClientIsUserManagedPredicate(),
    )).limit(1).for("update");
    if (!client) return null;
    const [row] = await tx.select({ installation: oauthClientInstalls })
      .from(oauthClientInstalls).innerJoin(servers, eq(servers.id, oauthClientInstalls.serverId))
      .where(and(eq(oauthClientInstalls.id, input.installationId), eq(oauthClientInstalls.clientId, client.id),
        eq(oauthClientInstalls.status, "active"), isNull(servers.deletedAt)))
      .limit(1).for("update", { of: oauthClientInstalls });
    if (!row) return null;
    if (!client.setupUrl || input.revision !== client.setupRevision) throw new AppSetupConflictError("Setup declaration changed; read current setup state before reporting completion");
    const complete = input.status === "complete";
    const desiredRevision = complete ? client.setupRevision : null;
    let installation = row.installation;
    if (installation.setupCompletedRevision !== desiredRevision) {
      [installation] = await tx.update(oauthClientInstalls).set({
        setupCompletedRevision: desiredRevision,
        setupCompletedAt: complete ? new Date() : null,
        updatedAt: new Date(),
      }).where(eq(oauthClientInstalls.id, installation.id)).returning();
      await recordIntegrationAuditEvent({
        serverId: installation.serverId, clientId: client.id, eventType: "installation.setup_updated",
        outcome: "success", source: "api", actor: { type: "system" }, requester: { type: "app", id: client.id },
        subject: { type: "app", id: client.id }, target: { type: "installation", id: installation.id },
        metadata: { installationId: installation.id, setupRevision: client.setupRevision, status: input.status },
      }, tx);
    }
    return projectAppSetup({ setupUrl: client.setupUrl, setupDescription: client.setupDescription, setupRevision: client.setupRevision,
      installationId: input.installationId, serverId: installation.serverId,
      completedRevision: installation.setupCompletedRevision, completedAt: installation.setupCompletedAt });
  });
}
