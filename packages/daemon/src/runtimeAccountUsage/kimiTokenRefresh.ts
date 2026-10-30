import { ambientProcessEnv } from "../processEnvPatch";
import { randomBytes } from "node:crypto";
import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { dirname } from "node:path";

import { KIMI_CODE_OAUTH_CLIENT_ID, kimiDeviceHeaders, type KimiCodeAuth } from "./kimiAuth";
import { withKimiRefreshLock, type KimiLockOptions } from "./kimiCredentialLock";

/**
 * task #1282 — keep the Kimi Code access token fresh before the usage probe,
 * exactly as the client keeps it fresh for itself (kimi-code `OAuthManager`,
 * identical in 0.31.1 and 2.1.1), so a 15-minute token that expired while no
 * client was running does not turn the usage panel into a false "re-login".
 *
 * Contract mirrored from the client:
 *  - refresh when `expires_at - now < max(300, expires_in * 0.5)`;
 *  - under the client's own proper-lockfile lock: re-read; if another writer
 *    already rotated the token, adopt it and do not request;
 *  - `POST <oauthHost>/api/oauth/token` (form: client_id, grant_type, refresh_token);
 *    401 / 403 / `invalid_grant` are a rejection; 429 / 5xx retry with backoff;
 *  - the response must carry a new refresh_token (rotation is enforced), the
 *    whole token is replaced on disk with the client's atomic write
 *    (tmp.<pid>.<rand> + fsync + chmod 600 + rename, 2-space JSON);
 *  - on a rejection, re-read once after 100 ms; a changed refresh_token means
 *    another writer rotated and the file is adopted.
 *
 * Deliberate differences:
 *  - this daemon NEVER writes the client's revoked tombstone (empty tokens):
 *    a rejection is reported, not persisted, so the daemon can never sign the
 *    user out of their CLI;
 *  - no refresh on win32 or with `KIMI_DISABLE_OAUTH_LOCK=1` (the client runs
 *    unlocked there);
 *  - the lock wait is bounded and a lock we cannot take is a bounded failure.
 *
 * Known residual window (the client's login/logout write without the lock):
 * a login that lands between this daemon's last in-lock comparison and its
 * rename is overwritten. Pinned by a test marked as an expected failure.
 */

export const KIMI_MIN_REFRESH_THRESHOLD_SECONDS = 300;
export const KIMI_REFRESH_THRESHOLD_RATIO = 0.5;
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export interface KimiStoredToken {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in: number;
  scope: string;
  token_type: string;
}

export type KimiFreshness =
  | { kind: "fresh"; expiresAt: number }
  | { kind: "refreshed"; expiresAt: number }
  | { kind: "adopted"; expiresAt: number }
  | { kind: "rejected"; reason: "refresh_rejected" }
  | { kind: "revoked" }
  | { kind: "missing"; reason: "no_file" | "unreadable" | "malformed" | "no_refresh_token" }
  | { kind: "transient"; reason: "network" | "server" | "lock_unavailable" | "lock_compromised" | "write_failed" | "rotation_missing" | "malformed_response"; expired: boolean }
  | { kind: "platform_unsupported"; reason: "win32" | "lock_disabled" | "storage_not_file" };

export interface KimiRefreshDeps {
  now?: () => number;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  lock?: KimiLockOptions;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  identity?: { platform: string; version: string };
  /** Test seam: runs between the last in-lock comparison and the rename (the residual window). */
  beforeWrite?: () => Promise<void> | void;
  maxRetries?: number;
  backoffMs?: (attempt: number) => number;
  timeoutMs?: number;
}

export function kimiRefreshThresholdSeconds(expiresIn: number): number {
  return expiresIn > 0 ? Math.max(KIMI_MIN_REFRESH_THRESHOLD_SECONDS, expiresIn * KIMI_REFRESH_THRESHOLD_RATIO) : KIMI_MIN_REFRESH_THRESHOLD_SECONDS;
}

/**
 * The client's `revokedTombstone`: empty access and refresh tokens with
 * `expires_at` 0 (scope / token_type carried over). Only this exact shape is
 * a revocation. The client itself reads any record without an access token as
 * revoked (`tokenFromWire` → `classifyToken`); this daemon is stricter on
 * purpose: a file with missing or mistyped fields (`{}`, a partial write, a
 * foreign shape) is `malformed`, which lets the probe speak, and never a
 * verdict that sends the user to log in again (review on #9802).
 */
export function isKimiRevokedTombstone(record: Record<string, unknown>): boolean {
  return record.access_token === "" && record.refresh_token === "" && record.expires_at === 0;
}

export function readKimiStoredToken(path: string): { kind: "ok"; token: KimiStoredToken } | { kind: "missing"; reason: "no_file" | "unreadable" | "malformed" } | { kind: "revoked" } {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { kind: "missing", reason: "no_file" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "missing", reason: "unreadable" };
  }
  if (typeof parsed !== "object" || parsed === null) return { kind: "missing", reason: "unreadable" };
  if (Array.isArray(parsed)) return { kind: "missing", reason: "unreadable" };
  const record = parsed as Record<string, unknown>;
  if (isKimiRevokedTombstone(record)) return { kind: "revoked" };
  // A usable token needs a non-empty access token; a present refresh_token
  // must be a string (an empty one is reported as no_refresh_token later).
  if (typeof record.access_token !== "string" || record.access_token.length === 0) return { kind: "missing", reason: "malformed" };
  if (record.refresh_token !== undefined && typeof record.refresh_token !== "string") return { kind: "missing", reason: "malformed" };
  return {
    kind: "ok",
    token: {
      access_token: record.access_token,
      refresh_token: typeof record.refresh_token === "string" ? record.refresh_token : "",
      expires_at: typeof record.expires_at === "number" ? record.expires_at : 0,
      expires_in: typeof record.expires_in === "number" ? record.expires_in : 0,
      scope: typeof record.scope === "string" ? record.scope : "",
      token_type: typeof record.token_type === "string" ? record.token_type : "Bearer",
    },
  };
}

/** The client's FileTokenStorage.save, byte for byte in shape. */
export function writeKimiStoredToken(path: string, token: KimiStoredToken): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp.${process.pid}.${randomBytes(4).toString("hex")}`;
  const data = Buffer.from(`${JSON.stringify(token, null, 2)}\n`, "utf8");
  const fd = openSync(tmp, "w", 0o600);
  try {
    let written = 0;
    while (written < data.length) written += writeSync(fd, data, written, data.length - written);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
  } catch (error) {
    try { unlinkSync(tmp); } catch { /* already gone */ }
    throw error;
  }
}

function needsRefresh(token: KimiStoredToken, nowSeconds: number): boolean {
  if (token.expires_at === 0) return false;
  return token.expires_at - nowSeconds < kimiRefreshThresholdSeconds(token.expires_in);
}

type RefreshOutcome =
  | { kind: "ok"; token: KimiStoredToken }
  | { kind: "unauthorized" }
  | { kind: "network" }
  | { kind: "server" }
  | { kind: "rotation_missing" }
  | { kind: "malformed_response" };

/**
 * A 200 that is not a usable token is never written: a non-empty string
 * access_token is required first (an empty one would have put the client's
 * tombstone shape on disk and signed the user out — review on #9802); then
 * rotation (a non-empty refresh_token and a positive expires_in).
 */
export function parseKimiRefreshResponse(data: Record<string, unknown>, nowSeconds: number): RefreshOutcome {
  const accessToken = data.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) return { kind: "malformed_response" };
  const refreshed = data.refresh_token;
  const expiresIn = Number(data.expires_in);
  if (typeof refreshed !== "string" || refreshed.length === 0 || !Number.isFinite(expiresIn) || expiresIn <= 0) return { kind: "rotation_missing" };
  return {
    kind: "ok",
    token: {
      access_token: accessToken,
      refresh_token: refreshed,
      expires_at: nowSeconds + expiresIn,
      expires_in: expiresIn,
      scope: typeof data.scope === "string" ? data.scope : "",
      token_type: typeof data.token_type === "string" ? data.token_type : "Bearer",
    },
  };
}

async function requestRefresh(auth: KimiCodeAuth, refreshToken: string, deps: KimiRefreshDeps): Promise<RefreshOutcome> {
  const fetchFn = deps.fetchFn ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxRetries = deps.maxRetries ?? 3;
  const backoff = deps.backoffMs ?? ((attempt: number) => 2 ** attempt * 1_000);
  const url = `${auth.oauthHost.replace(/\/$/, "")}/api/oauth/token`;
  const headers = {
    ...kimiDeviceHeaders(auth.home, deps.identity ?? { platform: "raft_computer", version: "unknown" }),
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  const body = new URLSearchParams({ client_id: KIMI_CODE_OAUTH_CLIENT_ID, grant_type: "refresh_token", refresh_token: refreshToken }).toString();
  let last: RefreshOutcome = { kind: "network" };
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    let status: number;
    let data: Record<string, unknown> = {};
    try {
      const response = await fetchFn(url, { method: "POST", headers, body, signal: AbortSignal.timeout(deps.timeoutMs ?? 15_000) });
      status = response.status;
      try {
        const parsed: unknown = await response.json();
        if (typeof parsed === "object" && parsed !== null) data = parsed as Record<string, unknown>;
      } catch { /* non-JSON body */ }
    } catch {
      last = { kind: "network" };
      if (attempt < maxRetries - 1) { await sleep(backoff(attempt)); continue; }
      return last;
    }
    if (status === 200) return parseKimiRefreshResponse(data, Math.floor((deps.now ?? Date.now)() / 1_000));
    const errorCode = typeof data.error === "string" ? data.error : "";
    if (status === 401 || status === 403 || errorCode === "invalid_grant") return { kind: "unauthorized" };
    if (RETRYABLE_STATUSES.has(status)) {
      last = { kind: "server" };
      if (attempt < maxRetries - 1) { await sleep(backoff(attempt)); continue; }
      return last;
    }
    return { kind: "server" };
  }
  return last;
}

/**
 * Ensures the stored access token is fresh enough for a probe. Never throws;
 * every outcome is a `KimiFreshness` the collector maps onto the wire.
 */
export async function ensureFreshKimiToken(auth: KimiCodeAuth, deps: KimiRefreshDeps = {}): Promise<KimiFreshness> {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? ambientProcessEnv();
  const now = () => Math.floor((deps.now ?? Date.now)() / 1_000);
  if (auth.storage !== "file") return { kind: "platform_unsupported", reason: "storage_not_file" };
  if (platform === "win32") return { kind: "platform_unsupported", reason: "win32" };
  if (env.KIMI_DISABLE_OAUTH_LOCK === "1") return { kind: "platform_unsupported", reason: "lock_disabled" };

  const initial = readKimiStoredToken(auth.credentialPath);
  if (initial.kind === "missing") return { kind: "missing", reason: initial.reason };
  if (initial.kind === "revoked") return { kind: "revoked" };
  if (!needsRefresh(initial.token, now())) return { kind: "fresh", expiresAt: initial.token.expires_at };
  if (initial.token.refresh_token.length === 0) return { kind: "missing", reason: "no_refresh_token" };
  const expiredBefore = initial.token.expires_at <= now();

  const locked = await withKimiRefreshLock(auth.lockTarget, async (lock): Promise<KimiFreshness> => {
    const afterLock = readKimiStoredToken(auth.credentialPath);
    if (afterLock.kind === "revoked") return { kind: "revoked" };
    if (afterLock.kind === "missing") return { kind: "missing", reason: afterLock.reason };
    const active = afterLock.token;
    if (!needsRefresh(active, now())) return { kind: "adopted", expiresAt: active.expires_at };
    if (active.refresh_token.length === 0) return { kind: "missing", reason: "no_refresh_token" };

    const outcome = await requestRefresh(auth, active.refresh_token, deps);
    if (outcome.kind === "ok") {
      // The last in-lock comparison: a writer that does not take the lock (the
      // client's login/logout) may have replaced the file meanwhile; its token
      // is kept and ours is dropped. (The window between this read and the
      // rename below remains; see the expected-failure test.)
      const beforeWrite = readKimiStoredToken(auth.credentialPath);
      if (beforeWrite.kind !== "ok" || beforeWrite.token.refresh_token !== active.refresh_token) {
        if (beforeWrite.kind === "ok") return { kind: "adopted", expiresAt: beforeWrite.token.expires_at };
        if (beforeWrite.kind === "revoked") return { kind: "revoked" };
        return { kind: "missing", reason: beforeWrite.reason };
      }
      await deps.beforeWrite?.();
      // A lock that was reclaimed or removed while we worked no longer
      // protects this write: drop the result rather than race the new holder.
      if (lock.isCompromised()) return { kind: "transient", reason: "lock_compromised", expired: expiredBefore };
      try {
        writeKimiStoredToken(auth.credentialPath, outcome.token);
      } catch {
        return { kind: "transient", reason: "write_failed", expired: expiredBefore };
      }
      return { kind: "refreshed", expiresAt: outcome.token.expires_at };
    }
    if (outcome.kind === "unauthorized") {
      await (deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(100);
      const recovery = readKimiStoredToken(auth.credentialPath);
      if (recovery.kind === "ok" && recovery.token.refresh_token !== active.refresh_token) {
        return { kind: "adopted", expiresAt: recovery.token.expires_at };
      }
      // The client would write its revoked tombstone here; this daemon reports and leaves the file alone.
      return { kind: "rejected", reason: "refresh_rejected" };
    }
    return { kind: "transient", reason: outcome.kind, expired: expiredBefore };
  }, deps.lock);

  if (locked.kind === "unavailable") return { kind: "transient", reason: "lock_unavailable", expired: expiredBefore };
  return locked.value;
}
