import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import {
  agentCredentials,
  agents,
  appBotBindings,
  oauthClientInstalls,
  oauthClients,
} from "../db/schema";
import type { DatabaseExecutor } from "../db/index";
import { getDb } from "../db/index";

// ─── Design-v3 contract ───────────────────────────────────────────────────────
// One App has at most one live Bot per installation; the binding (not the
// agent name) is the durable authority for identity, permission grants, and
// billing exclusion. Sender stays `sender_type=agent`; attribution is additive
// (agents.managed_by_app_install_id → oauth_client_installs.id).
//
// Handle derivation: the stable client-id-derived short handle of the owning
// App (e.g. "my-slack-app" from OAuth client "my-slack-app"). It is not the
// Raft-visible agent name — that stays display-name-driven and may collide.
// The binding.handle is what lifecycle/reattach uses.
// ────────────────────────────────────────────────────────────────────────────

export type AppBotState = "active" | "disabled" | "uninstalled";

/** Convert an OAuth client ID to a stable Bot handle (lowercase, URL-safe). */
export function deriveAppBotHandle(clientId: string): string {
  return clientId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export class AppBotHandleConflictError extends Error {
  readonly code = "app_bot_handle_conflict";

  constructor(handle: string, conflictingAgentId: string) {
    super(`App Bot handle "${handle}" conflicts with existing agent ${conflictingAgentId}`);
    this.name = "AppBotHandleConflictError";
  }
}

export class AppBotInstallNotGrantedError extends Error {
  readonly code = "app_bot_install_not_granted";

  constructor() {
    super("This installation has not granted the Bot capability");
    this.name = "AppBotInstallNotGrantedError";
  }
}

export class AppBotAlreadyBoundError extends Error {
  readonly code = "app_bot_already_bound";

  constructor(installId: string) {
    super(`Install ${installId} already has a live Bot binding`);
    this.name = "AppBotAlreadyBoundError";
  }
}

export interface ManagedAppBotView {
  bindingId: string;
  agentId: string;
  installId: string;
  serverId: string;
  state: AppBotState;
  handle: string;
  generation: number;
}

/**
 * Create the managed Bot agent and its binding for an install. Idempotent at
 * the activation point: concurrent or repeated activation returns the existing
 * live binding. Throws on handle conflict (a non-managed agent owns the
 * handle), missing grant, or already-bound live Bot.
 *
 * Caller must wrap in a transaction covering both the agent insert and the
 * binding insert.
 */
export async function createManagedAppBot(
  executor: DatabaseExecutor,
  input: {
    installId: string;
    serverId: string;
    requestedPermissions?: string[];
    now?: Date;
  },
): Promise<ManagedAppBotView> {
  const now = input.now ?? new Date();

  const [install] = await executor
    .select({
      id: oauthClientInstalls.id,
      serverId: oauthClientInstalls.serverId,
      clientId: oauthClientInstalls.clientId,
      status: oauthClientInstalls.status,
      botGrant: oauthClientInstalls.botGrant,
    })
    .from(oauthClientInstalls)
    .where(eq(oauthClientInstalls.id, input.installId))
    .limit(1);
  if (!install || install.serverId !== input.serverId) {
    throw new AppBotInstallNotGrantedError();
  }
  if (install.botGrant !== "granted") {
    throw new AppBotInstallNotGrantedError();
  }
  if (install.status !== "active") {
    throw new AppBotInstallNotGrantedError();
  }

  const [client] = await executor
    .select({
      id: oauthClients.id,
      clientId: oauthClients.clientId,
      name: oauthClients.name,
      enableBot: oauthClients.enableBot,
    })
    .from(oauthClients)
    .where(eq(oauthClients.id, install.clientId))
    .limit(1);
  if (!client?.enableBot) {
    throw new AppBotInstallNotGrantedError();
  }

  // Idempotent: a live binding on this install already exists.
  const [existing] = await executor
    .select()
    .from(appBotBindings)
    .where(and(
      eq(appBotBindings.installId, install.id),
      sql`${appBotBindings.state} != 'uninstalled'`,
    ))
    .limit(1);
  if (existing) {
    if (existing.state !== "active") {
      // A disabled tombstone exists — re-activate in place, new generation.
      const nextGen = await nextBotGeneration(executor, install.id);
      const [updated] = await executor
        .update(appBotBindings)
        .set({ state: "active", generation: nextGen, disabledAt: null, updatedAt: now })
        .where(eq(appBotBindings.id, existing.id))
        .returning();
      return toView(updated!);
    }
    return toView(existing);
  }

  const handle = deriveAppBotHandle(client.clientId);

  // Handle conflict: any non-managed agent already holding this handle is a
  // hard failure — the binding handle is the App's stable client-id-derived
  // identity and must not silently adopt or suffix.
  const [conflict] = await executor
    .select({ id: agents.id })
    .from(agents)
    .where(and(
      eq(agents.serverId, input.serverId),
      eq(agents.name, handle),
      isNull(agents.deletedAt),
      isNull(agents.managedByAppInstallId),
    ))
    .limit(1);
  if (conflict) {
    throw new AppBotHandleConflictError(handle, conflict.id);
  }

  const [agent] = await executor
    .insert(agents)
    .values({
      serverId: input.serverId,
      name: handle,
      displayName: client.name,
      status: "active",
      managedByAppInstallId: install.id,
      creatorType: null,
      creatorId: null,
      // External runtime so mintAgentCredential accepts it (sk_agent_* is
      // the App's credential path; a managed_bot is not a hosted-runtime agent).
      runtime: "external",
    })
    .returning({ id: agents.id });
  if (!agent) {
    throw new Error("app_bot agent insert failed");
  }

  const generation = await nextBotGeneration(executor, install.id);
  let binding;
  try {
    // In a savepoint: the caller may pass its transaction, and a failed insert
    // aborts it in Postgres, so the race recovery below could not run its
    // select (25P02). Rolling back to the savepoint keeps the transaction usable.
    const [row] = await executor.transaction((savepoint) => savepoint
      .insert(appBotBindings)
      .values({
        installId: install.id,
        serverId: input.serverId,
        agentId: agent.id,
        generation,
        state: "active",
        handle,
        requestedPermissions: input.requestedPermissions ?? [],
      })
      .returning());
    binding = row;
  } catch (err: unknown) {
    // 23505: concurrent activation raced the partial-unique index — return the
    // already-bound live row rather than failing the caller.
    if ((err as { code?: string })?.code === "23505") {
      const [raced] = await executor
        .select()
        .from(appBotBindings)
        .where(and(
          eq(appBotBindings.installId, install.id),
          sql`${appBotBindings.state} != 'uninstalled'`,
        ))
        .limit(1);
      if (raced) return toView(raced);
    }
    throw err;
  }
  if (!binding) {
    throw new Error("app_bot binding insert failed");
  }

  console.log(`[AppBot] activated install=${install.id} agent=${agent.id} server=${input.serverId} gen=${generation}`);
  return toView(binding);
}

async function nextBotGeneration(
  executor: DatabaseExecutor,
  installId: string,
): Promise<number> {
  const [row] = await executor
    .select({ max: sql<number>`coalesce(max(${appBotBindings.generation}), 0)` })
    .from(appBotBindings)
    .where(eq(appBotBindings.installId, installId));
  return (row?.max ?? 0) + 1;
}

/** Mark a binding disabled (e.g. install suspended or bot capability revoked). */
export async function disableManagedAppBot(
  executor: DatabaseExecutor,
  input: { installId: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  await executor
    .update(appBotBindings)
    .set({ state: "disabled", disabledAt: now, updatedAt: now })
    .where(and(
      eq(appBotBindings.installId, input.installId),
      eq(appBotBindings.state, "active"),
    ));
  await revokeManagedAppBotCredentials(executor, input.installId, "bot_disabled", now);
}

/** Permanently unbind the Bot (install deleted / explicit uninstall). */
export async function uninstallManagedAppBot(
  executor: DatabaseExecutor,
  input: { installId: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  const [row] = await executor
    .update(appBotBindings)
    .set({ state: "uninstalled", uninstalledAt: now, updatedAt: now })
    .where(and(
      eq(appBotBindings.installId, input.installId),
      sql`${appBotBindings.state} != 'uninstalled'`,
    ))
    .returning({ agentId: appBotBindings.agentId });
  if (row) {
    // Keep the agent row for history/attribution; mark it deleted so it no
    // longer counts or is usable.
    await executor
      .update(agents)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(agents.id, row.agentId));
    await revokeManagedAppBotCredentials(executor, input.installId, "bot_uninstalled", now);
  }
}

/** Revoke all live credentials for a managed bot's agent(s). */
async function revokeManagedAppBotCredentials(
  executor: DatabaseExecutor,
  installId: string,
  reason: string,
  now: Date,
): Promise<void> {
  const bindings = await executor
    .select({ agentId: appBotBindings.agentId })
    .from(appBotBindings)
    .where(eq(appBotBindings.installId, installId));
  if (bindings.length === 0) return;
  const agentIds = bindings.map((b) => b.agentId);
  await executor
    .update(agentCredentials)
    .set({ revokedAt: now, revokedReason: reason })
    .where(and(
      inArray(agentCredentials.agentId, agentIds),
      isNull(agentCredentials.revokedAt),
    ));
}

/** Read the live binding for an install, if any. */
export async function getManagedAppBot(
  executor: DatabaseExecutor,
  installId: string,
): Promise<ManagedAppBotView | null> {
  const [row] = await executor
    .select()
    .from(appBotBindings)
    .where(and(
      eq(appBotBindings.installId, installId),
      sql`${appBotBindings.state} != 'uninstalled'`,
    ))
    .limit(1);
  return row ? toView(row) : null;
}

/** Whether this agent is a managed App Bot. */
export async function isAppBotAgent(
  executor: DatabaseExecutor,
  agentId: string,
): Promise<boolean> {
  const [row] = await executor
    .select({ managedByAppInstallId: agents.managedByAppInstallId })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  return Boolean(row?.managedByAppInstallId);
}

function toView(row: typeof appBotBindings.$inferSelect): ManagedAppBotView {
  return {
    bindingId: row.id,
    agentId: row.agentId,
    installId: row.installId,
    serverId: row.serverId,
    state: row.state as AppBotState,
    handle: row.handle,
    generation: row.generation,
  };
}
