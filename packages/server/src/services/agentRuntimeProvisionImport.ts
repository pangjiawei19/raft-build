/**
 * Workspace import into a hosted agent (raft-agent-provider.v1 `.../import`).
 *
 * A provisioning row with an `import_source` is created with `awaitImport:
 * true`; once the provider accepted the POST, the worker imports the files
 * exactly once. The worker knows no source: it asks this module for the
 * payload by `import_source`, and each source builds its files when the
 * import runs (hosted Cindy's seed now; a migrated computer workspace later).
 */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { buildCindyMemoryMd, buildCindySeedFiles, type AgentMigrationHostedImportLimits } from "@botiverse/raft-shared";
import { getDb } from "../db/index";
import { agents } from "../db/schema";
import { PROVIDER_IMPORT_TIMEOUT_MS, providerImportCheckPath, providerImportLimitsPath, providerRequest } from "./agentRuntimeProviderService";

export interface ProvisionImportFile {
  /** Workspace-relative path, e.g. `MEMORY.md` or `notes/onboarding_playbook.md`. */
  path: string;
  content: string | Uint8Array;
}

export interface ProvisionImportPayload {
  /** Replaces the instructions sent on create; absent keeps them. */
  instructions?: string;
  files: ProvisionImportFile[];
}

export interface ProvisionImportTarget {
  agentId: string;
  serverId: string;
  importRef: string | null;
}

/**
 * A failure building the payload. Retryable ones back off and run again
 * (e.g. object storage unavailable); the rest fail the import.
 */
export class ProvisionImportSourceError extends Error {
  constructor(message: string, readonly code: string, readonly retryable: boolean) {
    super(message);
  }
}

export type ProvisionImportSource = (target: ProvisionImportTarget) => Promise<ProvisionImportPayload>;

/** Hosted Cindy: the same seed files and MEMORY.md a computer-hosted Cindy gets on first start. */
const cindySeedSource: ProvisionImportSource = async ({ agentId }) => {
  const [agent] = await getDb().select({ name: agents.name, displayName: agents.displayName })
    .from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) throw new ProvisionImportSourceError("The agent no longer exists", "agent_not_found", false);
  return {
    files: [
      { path: "MEMORY.md", content: buildCindyMemoryMd(agent.displayName?.trim() || agent.name) },
      // The hosted variant: no Computer, so her daily recap goes through the Reminder app.
      ...buildCindySeedFiles({ hosted: true }).map((file) => ({ path: file.relativePath, content: file.content })),
    ],
  };
};

const sources = new Map<string, ProvisionImportSource>([["cindy_seed", cindySeedSource]]);

/** Register a source (e.g. step 3's `migration`). A name can be registered once. */
export function registerProvisionImportSource(name: string, source: ProvisionImportSource): void {
  if (sources.has(name)) throw new Error(`Provision import source "${name}" is already registered`);
  sources.set(name, source);
}

export function getProvisionImportSource(name: string): ProvisionImportSource | undefined {
  return sources.get(name);
}

export interface ProvisionImportBody {
  migrationId: string;
  instructions?: string;
  files: Array<{ path: string; contentBase64: string; sha256: string }>;
  totalBytes: number;
}

/** The provider's request body: base64 content, a sha256 per file and the byte total it checks. */
export function buildProvisionImportBody(migrationId: string, payload: ProvisionImportPayload): ProvisionImportBody {
  let totalBytes = 0;
  const files = payload.files.map((file) => {
    const bytes = typeof file.content === "string" ? Buffer.from(file.content, "utf8") : Buffer.from(file.content);
    totalBytes += bytes.length;
    return { path: file.path, contentBase64: bytes.toString("base64"), sha256: createHash("sha256").update(bytes).digest("hex") };
  });
  return {
    migrationId,
    ...(payload.instructions !== undefined ? { instructions: payload.instructions } : {}),
    files,
    totalBytes,
  };
}

export interface ProvisionImportedEvent {
  agentId: string;
  serverId: string;
  importSource: string;
}

type ImportedListener = (event: ProvisionImportedEvent) => void | Promise<void>;
const importedListeners = new Set<ImportedListener>();

/** Run after an import commits (e.g. hosted Cindy's welcome). Returns an unsubscribe. */
export function onProvisionImported(listener: ImportedListener): () => void {
  importedListeners.add(listener);
  return () => importedListeners.delete(listener);
}

export async function notifyProvisionImported(event: ProvisionImportedEvent): Promise<void> {
  for (const listener of importedListeners) {
    try {
      await listener(event);
    } catch (error) {
      console.warn(`[AgentRuntimeProvision] import listener failed agent=${event.agentId}:`, error instanceof Error ? error.message : error);
    }
  }
}

export interface ProvisionImportFailedEvent extends ProvisionImportedEvent {
  code: string;
  httpStatus: number | null;
}

type ImportFailedListener = (event: ProvisionImportFailedEvent) => void | Promise<void>;
const importFailedListeners = new Set<ImportFailedListener>();

/** Run when an import stops for a manual retry (e.g. alert on hosted Cindy). Returns an unsubscribe. */
export function onProvisionImportFailed(listener: ImportFailedListener): () => void {
  importFailedListeners.add(listener);
  return () => importFailedListeners.delete(listener);
}

export async function notifyProvisionImportFailed(event: ProvisionImportFailedEvent): Promise<void> {
  for (const listener of importFailedListeners) {
    try {
      await listener(event);
    } catch (error) {
      console.warn(`[AgentRuntimeProvision] import-failed listener failed agent=${event.agentId}:`, error instanceof Error ? error.message : error);
    }
  }
}

const importLimitsSchema: z.ZodType<AgentMigrationHostedImportLimits> = z.object({
  maxTotalBytes: z.number().int().positive(),
  maxFiles: z.number().int().positive(),
  maxFileBytes: z.number().int().positive(),
});

export type ProvisionImportLimitsResult =
  | { ok: true; limits: AgentMigrationHostedImportLimits }
  | { ok: false; reason: string; httpStatus: number | null };

/**
 * The provider's limits for one workspace import. A migration fixes them at
 * preflight, so the file set is built against the limits the import will meet.
 * Extra fields from a newer provider are ignored.
 */
export async function fetchProvisionImportLimits(config: { baseUrl: string; token: string }): Promise<ProvisionImportLimitsResult> {
  const result = await providerRequest(config, "GET", providerImportLimitsPath());
  if (result.kind === "network") return { ok: false, reason: result.code, httpStatus: null };
  if (result.status < 200 || result.status >= 300) {
    return { ok: false, reason: result.error?.code ?? `http_${result.status}`, httpStatus: result.status };
  }
  const parsed = importLimitsSchema.safeParse(result.body);
  if (!parsed.success) return { ok: false, reason: "invalid_response", httpStatus: result.status };
  return { ok: true, limits: parsed.data };
}

const importCheckSchema = z.object({
  ok: z.boolean(),
  rejected: z.array(z.object({
    index: z.number().int().nonnegative(),
    // Null when the path itself looks like a credential: the provider never echoes it.
    path: z.string().nullable(),
    reason: z.string().min(1),
    param: z.string().nullable().optional(),
  })).default([]),
  // Refused files past the provider's list cap; drop the listed ones and check again to see them.
  more: z.number().int().nonnegative().default(0),
  totals: z.object({ files: z.number().int().nonnegative(), bytes: z.number().int().nonnegative() }),
  limits: importLimitsSchema,
});

export type ProvisionImportCheck = z.infer<typeof importCheckSchema>;

export type ProvisionImportCheckResult =
  | { ok: true; check: ProvisionImportCheck }
  | { ok: false; reason: string; httpStatus: number | null };

/**
 * Ask the provider which files of an import body it would refuse
 * (`POST /provision/import-check`). Nothing is written and the agent's one
 * import is not used, so a migration calls it before the user confirms. A 4xx
 * here is a problem with the body as a whole, not with single files.
 */
export async function checkProvisionImport(
  config: { baseUrl: string; token: string },
  serverId: string,
  body: ProvisionImportBody,
): Promise<ProvisionImportCheckResult> {
  const result = await providerRequest(config, "POST", providerImportCheckPath(serverId), {
    body,
    timeoutMs: PROVIDER_IMPORT_TIMEOUT_MS,
  });
  if (result.kind === "network") return { ok: false, reason: result.code, httpStatus: null };
  if (result.status < 200 || result.status >= 300) {
    return { ok: false, reason: result.error?.code ?? `http_${result.status}`, httpStatus: result.status };
  }
  const parsed = importCheckSchema.safeParse(result.body);
  if (!parsed.success) return { ok: false, reason: "invalid_response", httpStatus: result.status };
  return { ok: true, check: parsed.data };
}
