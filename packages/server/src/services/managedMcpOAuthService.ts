import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import {
  currentDate,
  setClockTimeout,
  type ManagedMcpToolCatalogEntry,
} from "@botiverse/raft-shared";
import { getDb } from "../db/index";
import { actorHasServerCapabilityInServer } from "../lib/actorPermissions";
import {
  managedMcpCredentials,
  managedMcpOAuthAttempts,
  managedMcpServers,
} from "../db/schema";
import {
  decryptManagedMcpSecret,
  encryptManagedMcpSecret,
  ManagedMcpCredentialError,
} from "./managedMcpCredentialService";
import {
  completeManagedMcpOAuth,
  listManagedMcpOAuthTools,
  ManagedMcpGatewayError,
  startManagedMcpOAuth,
  validateManagedMcpEndpoint,
} from "./managedMcpGateway";
import {
  ManagedMcpOAuthProvider,
  type ManagedMcpOAuthStorage,
} from "./managedMcpOAuthProvider";

const OAUTH_ATTEMPT_TTL_MS = 10 * 60_000;
const OAUTH_LEASE_TTL_MS = 60_000;
const OAUTH_LEASE_ATTEMPTS = 20;
const OAUTH_LEASE_RETRY_MS = 100;

type CredentialRow = typeof managedMcpCredentials.$inferSelect;
type ServerRow = typeof managedMcpServers.$inferSelect;
const managedMcpServerUpdate = () => getDb().update(managedMcpServers);
type ManagedMcpServerUpdateValues = Parameters<
  ReturnType<typeof managedMcpServerUpdate>["set"]
>[0];

export class ManagedMcpOAuthError extends Error {
  constructor(
    message: string,
    readonly code:
      | "managed_mcp_oauth_required"
      | "managed_mcp_oauth_invalid_state"
      | "managed_mcp_oauth_busy"
      | "managed_mcp_oauth_persist_failed",
  ) {
    super(message);
    this.name = "ManagedMcpOAuthError";
  }
}

function hashState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setClockTimeout(resolve, durationMs));
}

export async function replacePendingManagedMcpOAuthAttempt(input: {
  serverId: string;
  userId: string;
  mcpServerId: string;
  configVersion: number;
  state: string;
}): Promise<void> {
  const now = currentDate();
  await getDb().transaction(async (tx) => {
    await tx
      .update(managedMcpOAuthAttempts)
      .set({ status: "failed" })
      .where(
        and(
          eq(managedMcpOAuthAttempts.serverId, input.serverId),
          eq(managedMcpOAuthAttempts.mcpServerId, input.mcpServerId),
          eq(managedMcpOAuthAttempts.status, "pending"),
        ),
      );
    await tx.insert(managedMcpOAuthAttempts).values({
      serverId: input.serverId,
      mcpServerId: input.mcpServerId,
      userId: input.userId,
      configVersion: input.configVersion,
      stateHash: hashState(input.state),
      expiresAt: new Date(now.getTime() + OAUTH_ATTEMPT_TTL_MS),
    });
  });
}

function parseStorage(
  payload: string | null,
  redirectUrl?: string,
): ManagedMcpOAuthStorage {
  if (!payload) {
    return {
      redirectUrl:
        redirectUrl ?? "https://invalid.invalid/api/mcp/oauth/callback",
    };
  }
  const value = decryptManagedMcpSecret(payload);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ManagedMcpCredentialError(
      "Stored managed MCP OAuth state is invalid",
      "managed_mcp_credential_invalid",
    );
  }
  const storage = value as Partial<ManagedMcpOAuthStorage>;
  if (typeof storage.redirectUrl !== "string" || !storage.redirectUrl) {
    throw new ManagedMcpCredentialError(
      "Stored managed MCP OAuth redirect is invalid",
      "managed_mcp_credential_invalid",
    );
  }
  return storage as ManagedMcpOAuthStorage;
}

async function loadServer(
  serverId: string,
  mcpServerId: string,
): Promise<ServerRow> {
  const [server] = await getDb()
    .select()
    .from(managedMcpServers)
    .where(
      and(
        eq(managedMcpServers.serverId, serverId),
        eq(managedMcpServers.id, mcpServerId),
      ),
    )
    .limit(1);
  if (!server || server.authMode !== "oauth") {
    throw new ManagedMcpOAuthError(
      "MCP server does not use OAuth",
      "managed_mcp_oauth_required",
    );
  }
  return server;
}

async function acquireCredentialLease(
  serverId: string,
  mcpServerId: string,
): Promise<{ credential: CredentialRow; owner: string }> {
  const owner = randomUUID();
  for (let attempt = 0; attempt < OAUTH_LEASE_ATTEMPTS; attempt += 1) {
    const now = currentDate();
    const [credential] = await getDb()
      .update(managedMcpCredentials)
      .set({
        leaseOwner: owner,
        leaseExpiresAt: new Date(now.getTime() + OAUTH_LEASE_TTL_MS),
        updatedAt: now,
      })
      .where(
        and(
          eq(managedMcpCredentials.serverId, serverId),
          eq(managedMcpCredentials.mcpServerId, mcpServerId),
          or(
            isNull(managedMcpCredentials.leaseOwner),
            isNull(managedMcpCredentials.leaseExpiresAt),
            lt(managedMcpCredentials.leaseExpiresAt, now),
          ),
        ),
      )
      .returning();
    if (credential) return { credential, owner };
    await sleep(OAUTH_LEASE_RETRY_MS);
  }
  throw new ManagedMcpOAuthError(
    "MCP OAuth credentials are busy; retry shortly",
    "managed_mcp_oauth_busy",
  );
}

async function releaseCredentialLease(
  credentialId: string,
  owner: string,
): Promise<void> {
  await getDb()
    .update(managedMcpCredentials)
    .set({
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: currentDate(),
    })
    .where(
      and(
        eq(managedMcpCredentials.id, credentialId),
        eq(managedMcpCredentials.leaseOwner, owner),
      ),
    );
}

function sameConnectionIdentity(left: ServerRow, right: ServerRow): boolean {
  return left.id === right.id
    && left.serverId === right.serverId
    && left.configVersion === right.configVersion
    && left.provider === right.provider
    && left.authMode === right.authMode
    && left.endpointUrl === right.endpointUrl;
}

function serverConnectionFence(server: ServerRow) {
  return and(
    eq(managedMcpServers.id, server.id),
    eq(managedMcpServers.serverId, server.serverId),
    eq(managedMcpServers.configVersion, server.configVersion),
    eq(managedMcpServers.provider, server.provider),
    eq(managedMcpServers.authMode, server.authMode),
    eq(managedMcpServers.endpointUrl, server.endpointUrl),
  );
}

function credentialConnectionExists(server: ServerRow) {
  return sql`exists (
    select 1 from ${managedMcpServers}
    where ${managedMcpServers.id} = ${server.id}
      and ${managedMcpServers.serverId} = ${server.serverId}
      and ${managedMcpServers.configVersion} = ${server.configVersion}
      and ${managedMcpServers.provider} = ${server.provider}
      and ${managedMcpServers.authMode} = ${server.authMode}
      and ${managedMcpServers.endpointUrl} = ${server.endpointUrl}
  )`;
}

async function updateFrozenConnection(
  server: ServerRow,
  values: ManagedMcpServerUpdateValues,
): Promise<boolean> {
  const rows = await getDb()
    .update(managedMcpServers)
    .set(values)
    .where(serverConnectionFence(server))
    .returning({ id: managedMcpServers.id });
  return rows.length === 1;
}

async function withOAuthLease<T>(
  serverId: string,
  mcpServerId: string,
  redirectUrl: string | undefined,
  fixedState: string | undefined,
  expectedConfigVersion: number | undefined,
  operation: (
    server: ServerRow,
    provider: ManagedMcpOAuthProvider,
    storage: ManagedMcpOAuthStorage,
    lease: { credentialId: string; owner: string },
  ) => Promise<T>,
): Promise<T> {
  const initialServer = await loadServer(serverId, mcpServerId);
  if (
    expectedConfigVersion !== undefined
    && initialServer.configVersion !== expectedConfigVersion
  ) {
    throw new ManagedMcpOAuthError(
      "MCP OAuth connection changed before the operation began",
      "managed_mcp_oauth_invalid_state",
    );
  }
  const { credential, owner } = await acquireCredentialLease(
    serverId,
    mcpServerId,
  );
  try {
    const server = await loadServer(serverId, mcpServerId);
    if (!sameConnectionIdentity(initialServer, server)) {
      throw new ManagedMcpOAuthError(
        "MCP OAuth connection changed while acquiring credentials",
        "managed_mcp_oauth_invalid_state",
      );
    }
    const storage = parseStorage(credential.encryptedOAuth, redirectUrl);
    const persist = async () => {
      const [updated] = await getDb()
        .update(managedMcpCredentials)
        .set({
          encryptedOAuth: encryptManagedMcpSecret(storage),
          credentialVersion: sql`${managedMcpCredentials.credentialVersion} + 1`,
          updatedAt: currentDate(),
        })
        .where(
          and(
            eq(managedMcpCredentials.id, credential.id),
            eq(managedMcpCredentials.leaseOwner, owner),
            credentialConnectionExists(server),
          ),
        )
        .returning({ id: managedMcpCredentials.id });
      if (!updated) {
        throw new ManagedMcpOAuthError(
          "MCP OAuth connection changed before credentials were saved",
          "managed_mcp_oauth_persist_failed",
        );
      }
    };
    const provider = new ManagedMcpOAuthProvider(storage, persist, fixedState);
    return await operation(server, provider, storage, {
      credentialId: credential.id,
      owner,
    });
  } finally {
    await releaseCredentialLease(credential.id, owner);
  }
}

async function updateCatalog(
  server: ServerRow,
  toolCatalog: ManagedMcpToolCatalogEntry[],
): Promise<void> {
  const updated = await updateFrozenConnection(server, {
    oauthStatus: "connected",
    toolCatalog,
    catalogVersion: sql`${managedMcpServers.catalogVersion} + 1`,
    lastCheckedAt: currentDate(),
    lastCheckError: null,
    updatedAt: currentDate(),
  });
  if (!updated) {
    throw new ManagedMcpOAuthError(
      "MCP OAuth connection changed before its catalog was saved",
      "managed_mcp_oauth_persist_failed",
    );
  }
}

export async function startManagedMcpOAuthConnection(input: {
  serverId: string;
  userId: string;
  mcpServerId: string;
  redirectUrl: string;
}): Promise<{ authorizationUrl: string }> {
  const initialServer = await loadServer(input.serverId, input.mcpServerId);
  const state = randomBytes(32).toString("base64url");
  try {
    const authorizationUrl = await withOAuthLease(
      input.serverId,
      input.mcpServerId,
      input.redirectUrl,
      state,
      initialServer.configVersion,
      async (server, provider, storage) => {
        await replacePendingManagedMcpOAuthAttempt({
          ...input,
          configVersion: server.configVersion,
          state,
        });
        delete storage.tokens;
        delete storage.codeVerifier;
        storage.redirectUrl = input.redirectUrl;
        const metadataUrl = new URL(
          "client-metadata",
          input.redirectUrl,
        ).toString();
        storage.clientMetadataUrl = metadataUrl.startsWith("https://")
          ? metadataUrl
          : undefined;
        if (
          storage.clientInformation?.client_id.startsWith("https://")
          && storage.clientInformation.client_id !== storage.clientMetadataUrl
        ) {
          delete storage.clientInformation;
        }
        const result = await startManagedMcpOAuth(server.endpointUrl, provider);
        if (result !== "REDIRECT" || !provider.authorizationUrl) {
          throw new ManagedMcpOAuthError(
            "MCP OAuth did not provide an authorization URL",
            "managed_mcp_oauth_required",
          );
        }
        if (!(await updateFrozenConnection(server, {
          oauthStatus: "pending",
          lastCheckError: null,
          updatedAt: currentDate(),
        }))) {
          throw new ManagedMcpOAuthError(
            "MCP OAuth connection changed before authorization was saved",
            "managed_mcp_oauth_persist_failed",
          );
        }
        return validateManagedMcpEndpoint(provider.authorizationUrl).toString();
      },
    );
    return { authorizationUrl };
  } catch (error) {
    await getDb()
      .update(managedMcpOAuthAttempts)
      .set({ status: "failed" })
      .where(eq(managedMcpOAuthAttempts.stateHash, hashState(state)));
    await updateFrozenConnection(initialServer, {
      oauthStatus: "error",
      updatedAt: currentDate(),
    });
    throw error;
  }
}

export async function completeManagedMcpOAuthConnection(input: {
  state: string;
  authorizationCode: string;
}): Promise<{ serverId: string; mcpServerId: string }> {
  const attempt = await consumeManagedMcpOAuthAttempt(input.state);

  try {
    if (
      !(await actorHasServerCapabilityInServer(
        attempt.serverId,
        "user",
        attempt.userId,
        "manageExternalAuth",
      ))
    ) {
      throw new ManagedMcpOAuthError(
        "MCP OAuth authorization is no longer permitted",
        "managed_mcp_oauth_invalid_state",
      );
    }
    await withOAuthLease(
      attempt.serverId,
      attempt.mcpServerId,
      undefined,
      input.state,
      attempt.configVersion,
      async (server, provider) => {
        await completeManagedMcpOAuth(
          server.endpointUrl,
          provider,
          input.authorizationCode,
        );
        const toolCatalog = await listManagedMcpOAuthTools(
          server.endpointUrl,
          provider,
        );
        await updateCatalog(server, toolCatalog);
      },
    );
    return { serverId: attempt.serverId, mcpServerId: attempt.mcpServerId };
  } catch (error) {
    await getDb()
      .update(managedMcpOAuthAttempts)
      .set({ status: "failed" })
      .where(eq(managedMcpOAuthAttempts.id, attempt.id));
    const [frozenServer] = await getDb()
      .select()
      .from(managedMcpServers)
      .where(
        and(
          eq(managedMcpServers.id, attempt.mcpServerId),
          eq(managedMcpServers.serverId, attempt.serverId),
          eq(managedMcpServers.configVersion, attempt.configVersion),
        ),
      )
      .limit(1);
    if (frozenServer) await updateFrozenConnection(frozenServer, {
      oauthStatus: "error",
      lastCheckedAt: currentDate(),
      lastCheckError: "OAuth connection failed",
      updatedAt: currentDate(),
    });
    throw error;
  }
}

export async function consumeManagedMcpOAuthAttempt(
  state: string,
): Promise<typeof managedMcpOAuthAttempts.$inferSelect> {
  const now = currentDate();
  const [attempt] = await getDb()
    .update(managedMcpOAuthAttempts)
    .set({
      status: "consumed",
      consumedAt: now,
    })
    .where(
      and(
        eq(managedMcpOAuthAttempts.stateHash, hashState(state)),
        eq(managedMcpOAuthAttempts.status, "pending"),
        gt(managedMcpOAuthAttempts.expiresAt, now),
      ),
    )
    .returning();
  if (!attempt) {
    throw new ManagedMcpOAuthError(
      "MCP OAuth state is invalid, expired, or already used",
      "managed_mcp_oauth_invalid_state",
    );
  }
  return attempt;
}

export async function failManagedMcpOAuthAttempt(state: string): Promise<void> {
  if (!state) return;
  const [attempt] = await getDb()
    .update(managedMcpOAuthAttempts)
    .set({ status: "failed" })
    .where(
      and(
        eq(managedMcpOAuthAttempts.stateHash, hashState(state)),
        eq(managedMcpOAuthAttempts.status, "pending"),
      ),
    )
    .returning({
      serverId: managedMcpOAuthAttempts.serverId,
      mcpServerId: managedMcpOAuthAttempts.mcpServerId,
      configVersion: managedMcpOAuthAttempts.configVersion,
    });
  if (!attempt) return;
  const [server] = await getDb()
    .select()
    .from(managedMcpServers)
    .where(
      and(
        eq(managedMcpServers.id, attempt.mcpServerId),
        eq(managedMcpServers.serverId, attempt.serverId),
        eq(managedMcpServers.configVersion, attempt.configVersion),
      ),
    )
    .limit(1);
  if (server) await updateFrozenConnection(server, {
    oauthStatus: "error",
    lastCheckedAt: currentDate(),
    lastCheckError: "OAuth authorization was not completed",
    updatedAt: currentDate(),
  });
}

export async function disconnectManagedMcpOAuthConnection(
  serverId: string,
  mcpServerId: string,
): Promise<void> {
  await loadServer(serverId, mcpServerId);
  await withOAuthLease(
    serverId,
    mcpServerId,
    undefined,
    undefined,
    undefined,
    async (server, _provider, _storage, lease) => {
      await getDb()
        .update(managedMcpOAuthAttempts)
        .set({ status: "failed" })
        .where(
          and(
            eq(managedMcpOAuthAttempts.serverId, serverId),
            eq(managedMcpOAuthAttempts.mcpServerId, mcpServerId),
            eq(managedMcpOAuthAttempts.status, "pending"),
          ),
        );
      const [cleared] = await getDb()
        .update(managedMcpCredentials)
        .set({
          encryptedOAuth: null,
          credentialVersion: sql`${managedMcpCredentials.credentialVersion} + 1`,
          updatedAt: currentDate(),
        })
        .where(
          and(
            eq(managedMcpCredentials.id, lease.credentialId),
            eq(managedMcpCredentials.leaseOwner, lease.owner),
            credentialConnectionExists(server),
          ),
        )
        .returning({ id: managedMcpCredentials.id });
      if (!cleared) {
        throw new ManagedMcpOAuthError(
          "MCP OAuth lease was lost before credentials were disconnected",
          "managed_mcp_oauth_persist_failed",
        );
      }
      if (!(await updateFrozenConnection(server, {
        oauthStatus: "disconnected",
        toolCatalog: [],
        catalogVersion: sql`${managedMcpServers.catalogVersion} + 1`,
        lastCheckedAt: null,
        lastCheckError: null,
        updatedAt: currentDate(),
      }))) {
        throw new ManagedMcpOAuthError(
          "MCP OAuth connection changed before disconnect completed",
          "managed_mcp_oauth_persist_failed",
        );
      }
    },
  );
}

/**
 * The provider a tool call runs with. Every write still goes through the
 * credential lease (`persistToolCallStorage`), so it records which kind of
 * write the SDK is making: a token save from a refresh it just won, an
 * invalidation after a refresh it lost, or bookkeeping (discovery, client
 * information, verifier).
 */
class ToolCallOAuthProvider extends ManagedMcpOAuthProvider {
  writeKind: "tokens" | "invalidate" | "other" = "other";

  override async saveTokens(...args: Parameters<ManagedMcpOAuthProvider["saveTokens"]>): Promise<void> {
    this.writeKind = "tokens";
    try {
      await super.saveTokens(...args);
    } finally {
      this.writeKind = "other";
    }
  }

  override async invalidateCredentials(
    ...args: Parameters<ManagedMcpOAuthProvider["invalidateCredentials"]>
  ): Promise<void> {
    this.writeKind = "invalidate";
    try {
      await super.invalidateCredentials(...args);
    } finally {
      this.writeKind = "other";
    }
  }
}

/** What one tool call read, and whether another call saved newer credentials under it. */
interface ToolCallSnapshot {
  credentialId: string;
  version: number;
  supersededByConcurrentSave: boolean;
}

async function loadCredentialSnapshot(
  serverId: string,
  mcpServerId: string,
): Promise<CredentialRow> {
  const [credential] = await getDb()
    .select()
    .from(managedMcpCredentials)
    .where(
      and(
        eq(managedMcpCredentials.serverId, serverId),
        eq(managedMcpCredentials.mcpServerId, mcpServerId),
      ),
    )
    .limit(1);
  if (!credential) {
    throw new ManagedMcpOAuthError(
      "MCP OAuth is not connected",
      "managed_mcp_oauth_required",
    );
  }
  return credential;
}

/**
 * A tool call's write-back: the only part of a tool call that holds the
 * credential lease. When another call saved credentials since this one read
 * them (`credential_version` moved):
 * - an invalidation is dropped: the refresh it lost was raced by one that
 *   won, and wiping the winner's tokens would force a needless reconnect;
 * - a token save is written: it is the newest grant the provider issued;
 * - bookkeeping keeps the newer stored tokens instead of this call's stale ones.
 */
async function persistToolCallStorage(
  server: ServerRow,
  storage: ManagedMcpOAuthStorage,
  snapshot: ToolCallSnapshot,
  writeKind: ToolCallOAuthProvider["writeKind"],
): Promise<void> {
  const { credential, owner } = await acquireCredentialLease(
    server.serverId,
    server.id,
  );
  try {
    if (credential.id !== snapshot.credentialId) {
      throw new ManagedMcpOAuthError(
        "MCP OAuth connection changed before credentials were saved",
        "managed_mcp_oauth_persist_failed",
      );
    }
    if (credential.credentialVersion !== snapshot.version) {
      snapshot.supersededByConcurrentSave = true;
      const stored = parseStorage(credential.encryptedOAuth, storage.redirectUrl);
      if (writeKind === "invalidate") {
        Object.assign(storage, stored);
        if (!stored.tokens) delete storage.tokens;
        snapshot.version = credential.credentialVersion;
        return;
      }
      if (writeKind === "other") {
        if (stored.tokens) storage.tokens = stored.tokens;
        else delete storage.tokens;
      }
    }
    const [updated] = await getDb()
      .update(managedMcpCredentials)
      .set({
        encryptedOAuth: encryptManagedMcpSecret(storage),
        credentialVersion: sql`${managedMcpCredentials.credentialVersion} + 1`,
        updatedAt: currentDate(),
      })
      .where(
        and(
          eq(managedMcpCredentials.id, credential.id),
          eq(managedMcpCredentials.leaseOwner, owner),
          credentialConnectionExists(server),
        ),
      )
      .returning({ credentialVersion: managedMcpCredentials.credentialVersion });
    if (!updated) {
      throw new ManagedMcpOAuthError(
        "MCP OAuth connection changed before credentials were saved",
        "managed_mcp_oauth_persist_failed",
      );
    }
    snapshot.version = updated.credentialVersion;
    if (writeKind === "tokens") {
      // A newly issued grant proves the connection works. A concurrent call
      // that lost the same refresh may already have marked the connection
      // "reconnect required" (its invalidation landed first); undo that so a
      // good grant never sits behind an error status.
      await updateFrozenConnection(server, {
        oauthStatus: "connected",
        lastCheckError: null,
        updatedAt: currentDate(),
      });
    }
  } finally {
    await releaseCredentialLease(credential.id, owner);
  }
}

/** Mark the connection expired, fenced on the credential row still being at `snapshot.version`. */
async function markReconnectRequiredUnlessSuperseded(
  server: ServerRow,
  snapshot: ToolCallSnapshot,
): Promise<boolean> {
  const rows = await getDb()
    .update(managedMcpServers)
    .set({
      oauthStatus: "error",
      lastCheckedAt: currentDate(),
      lastCheckError: "OAuth authorization expired; reconnect required",
      updatedAt: currentDate(),
    })
    .where(and(
      serverConnectionFence(server),
      sql`exists (
        select 1 from ${managedMcpCredentials}
        where ${managedMcpCredentials.id} = ${snapshot.credentialId}
          and ${managedMcpCredentials.credentialVersion} = ${snapshot.version}
      )`,
    ))
    .returning({ id: managedMcpServers.id });
  return rows.length === 1;
}

function requiresReconnect(error: unknown): boolean {
  return error instanceof ManagedMcpGatewayError
    && error.code === "managed_mcp_oauth_required";
}

/**
 * Run one MCP tool call (or catalog read) with the connection's OAuth
 * credentials. The call itself runs on a snapshot of the stored credentials,
 * outside the credential lease, so calls on one connector run concurrently;
 * only a write-back the SDK makes mid-call (a refresh, discovery) takes the
 * lease (`persistToolCallStorage`). A call that needed reconnecting only
 * because a concurrent call refreshed a rotating refresh token first is run
 * once more on the newer credentials instead of marking the connection
 * expired. A call that failed any other way is not repeated: it may have
 * reached the tool.
 */
export async function withManagedMcpOAuth<T>(
  serverId: string,
  mcpServerId: string,
  operation: (
    server: ServerRow,
    provider: ManagedMcpOAuthProvider,
  ) => Promise<T>,
  expectedConfigVersion?: number,
): Promise<T> {
  const server = await loadServer(serverId, mcpServerId);
  if (
    expectedConfigVersion !== undefined
    && server.configVersion !== expectedConfigVersion
  ) {
    throw new ManagedMcpOAuthError(
      "MCP OAuth connection changed before the operation began",
      "managed_mcp_oauth_invalid_state",
    );
  }
  for (let attempt = 0; ; attempt += 1) {
    const credential = await loadCredentialSnapshot(serverId, mcpServerId);
    const storage = parseStorage(credential.encryptedOAuth);
    if (!storage.tokens)
      throw new ManagedMcpOAuthError(
        "MCP OAuth is not connected",
        "managed_mcp_oauth_required",
      );
    const snapshot: ToolCallSnapshot = {
      credentialId: credential.id,
      version: credential.credentialVersion,
      supersededByConcurrentSave: false,
    };
    const provider: ToolCallOAuthProvider = new ToolCallOAuthProvider(storage, () =>
      persistToolCallStorage(server, storage, snapshot, provider.writeKind));
    try {
      return await operation(server, provider);
    } catch (error) {
      if (attempt === 0 && requiresReconnect(error)) {
        const latest = await loadCredentialSnapshot(serverId, mcpServerId);
        // Our own write-backs move `snapshot.version`; only someone else's save
        // makes the stored version differ from it.
        if (snapshot.supersededByConcurrentSave || latest.credentialVersion !== snapshot.version) {
          continue;
        }
      }
      const reconnectRequired = requiresReconnect(error);
      if (reconnectRequired) {
        // Only while the stored credentials are still the ones this call last
        // saw: a concurrent call that saved a newer grant in between (and set
        // the connection back to connected) must not be overwritten by this
        // call's stale verdict.
        await markReconnectRequiredUnlessSuperseded(server, snapshot);
      } else {
        await updateFrozenConnection(server, {
          oauthStatus: "connected",
          lastCheckedAt: currentDate(),
          lastCheckError: "MCP request failed; retry without reconnecting",
          updatedAt: currentDate(),
        });
      }
      throw error;
    }
  }
}
