import { createHash, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { getBoundedAuthDb, getDb } from "../db/index";
import type Redis from "ioredis";
import { getBoundedRedis } from "../redis";

/**
 * Public server SEO, task #4 (#proj-public-server-seo, contract frozen by Ark):
 * the raft.build Pages Function calls the public search API with a service
 * credential so it gets ONE dedicated, finite traffic bucket instead of
 * sharing the anonymous per-IP limiter across Cloudflare egress addresses.
 *
 * The credential grants a bucket, never content: every request still runs the
 * full search predicate (master switch, rollout, server/channel/thread
 * authority). Nothing here reads or trusts crawler IPs, user agents, server
 * ids or visibility claims.
 *
 * Request shapes:
 *  - no `Authorization`, or another scheme: the anonymous limiter, unchanged;
 *  - `Authorization: Raft-Service v1 <keyId>.<token>`: verified against the
 *    SHA-256 digests in `public_search_service_keys`, read on every such
 *    request (constant-time compare), so removing or replacing a key takes
 *    effect on the next request without a deploy. Any malformed or unknown
 *    credential is a 401 and never falls back to the anonymous path. Every
 *    service-scheme request is first limited per client IP, before the key
 *    lookup (bounded: indexed, at most a few rows, 250ms statement timeout).
 *    Valid ones then take a slot from the
 *    shared per-minute bucket (`raft-landing-public-seo`, Redis, atomic) and
 *    the in-flight cap, both before any content query; the slot is released
 *    when the response finishes or closes. Over either limit: 429 with a
 *    bounded `Retry-After`.
 *  - The service path fails closed with 503 (anonymous unaffected) when its
 *    configuration is unusable: invalid limits, no usable current key, or the
 *    shared bucket unavailable, erroring or slower than its deadline.
 *
 * The header, token and digests never reach logs, traces, errors or bodies.
 */

export const PUBLIC_SEARCH_SERVICE_CLIENT_ID = "raft-landing-public-seo";
const SCHEME = "Raft-Service";
const KEY_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // 256 random bits, base64url without padding
const DIGEST_RE = /^[0-9a-f]{64}$/;
const MAX_RETRY_AFTER_SECONDS = 60;
const BUCKET_TTL_SECONDS = 120;
const BUCKET_DEADLINE_MS = 250;

export interface PublicSearchServiceKey {
  keyId: string;
  digest: Buffer;
  /** Only the previous key has one; past it the key is refused at once. */
  expiresAt: Date | null;
}

export interface PublicSearchServiceLimits {
  status: "ready" | "invalid";
  ratePerMinute: number;
  maxInFlight: number;
}

/**
 * Non-secret limits from the environment: `RAFT_LANDING_SERVICE_RATE_PER_MINUTE`
 * and `RAFT_LANDING_SERVICE_MAX_IN_FLIGHT` (provisional defaults until the
 * staging load test freezes them). 0, non-numeric or absurd values are invalid:
 * the service path is unavailable, the anonymous path is not affected.
 */
export function readPublicSearchServiceLimits(env: NodeJS.ProcessEnv = process.env): PublicSearchServiceLimits {
  const ratePerMinute = positiveInt(env.RAFT_LANDING_SERVICE_RATE_PER_MINUTE, 600, 100_000);
  const maxInFlight = positiveInt(env.RAFT_LANDING_SERVICE_MAX_IN_FLIGHT, 8, 1_000);
  if (ratePerMinute === null || maxInFlight === null) return { status: "invalid", ratePerMinute: 0, maxInFlight: 0 };
  return { status: "ready", ratePerMinute, maxInFlight };
}

function positiveInt(raw: string | undefined, fallback: number, max: number): number | null {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw);
  return value >= 1 && value <= max ? value : null;
}

type KeyRow = { keyId: string; sha256: string; expiresAt: Date | string | null };

/** Where the key digests live. Default: the database, read per request. */
export type PublicSearchServiceKeySource = () => Promise<KeyRow[]>;

const KEY_LOOKUP_TIMEOUT_MS = 250;

/**
 * The connection's own privileges on the key table: it may read the keys and
 * nothing else (Ark, task #4). Checked by `current_user`, so no production
 * role name is assumed; a role with any write, truncate, reference or trigger
 * right makes the service path unavailable.
 */
export const PUBLIC_SEARCH_KEY_PRIVILEGE_SQL = `
SELECT has_table_privilege(current_user, 'public.public_search_service_keys', 'SELECT') AS "select",
       has_table_privilege(current_user, 'public.public_search_service_keys', 'INSERT') AS "insert",
       has_table_privilege(current_user, 'public.public_search_service_keys', 'UPDATE') AS "update",
       has_table_privilege(current_user, 'public.public_search_service_keys', 'DELETE') AS "delete",
       has_table_privilege(current_user, 'public.public_search_service_keys', 'TRUNCATE') AS "truncate",
       has_table_privilege(current_user, 'public.public_search_service_keys', 'REFERENCES') AS "references",
       has_table_privilege(current_user, 'public.public_search_service_keys', 'TRIGGER') AS "trigger"
`;

export class PublicSearchKeySourceUnavailable extends Error {}

type TransactionalDb = Pick<ReturnType<typeof getDb>, "transaction">;

/**
 * Reads the client's keys in one short transaction: a 250ms statement
 * timeout (cancelled by the database), the privilege preflight, then at most
 * a few rows by indexed client id. By default it runs on the bounded
 * authentication pool (db/index `getBoundedAuthDb`: two connections, 250ms
 * to get one, no queue onto the content pool). `checkPrivileges: false` and a
 * `db` override exist only for tests.
 */
export function createDatabaseKeySource(options: { checkPrivileges: boolean; db?: () => TransactionalDb | null }): PublicSearchServiceKeySource {
  const db = options.db ?? (() => getBoundedAuthDb(KEY_LOOKUP_TIMEOUT_MS));
  return async () => {
    const executor = db();
    if (!executor) throw new PublicSearchKeySourceUnavailable("no bounded authentication database");
    return executor.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL statement_timeout = '${KEY_LOOKUP_TIMEOUT_MS}ms'`));
    if (options.checkPrivileges) {
      const privileges = (await tx.execute(sql.raw(PUBLIC_SEARCH_KEY_PRIVILEGE_SQL))).rows[0] as Record<string, boolean> | undefined;
      const readOnly = privileges?.select === true
        && ["insert", "update", "delete", "truncate", "references", "trigger"].every((right) => privileges[right] === false);
      if (!readOnly) throw new PublicSearchKeySourceUnavailable("runtime role is not read-only on the key table");
    }
    const result = await tx.execute(sql`
      SELECT key_id AS "keyId", sha256, expires_at AS "expiresAt"
      FROM public_search_service_keys
      WHERE client_id = ${PUBLIC_SEARCH_SERVICE_CLIENT_ID}
      LIMIT 3
    `);
    return result.rows as KeyRow[];
    });
  };
}

/** For tests on a single-connection database: the shared `getDb()`, no privilege preflight. */
export function createUncheckedTestKeySource(): PublicSearchServiceKeySource {
  return createDatabaseKeySource({ checkPrivileges: false, db: getDb });
}

const databaseKeySource = createDatabaseKeySource({ checkPrivileges: true });

/**
 * Validates what the source returned: one current key (no expiry) and at most
 * one previous key with an expiry, well-formed digests, distinct ids.
 * Exported for tests.
 */
export function validatePublicSearchServiceKeys(rows: KeyRow[]): { ok: true; keys: PublicSearchServiceKey[] } | { ok: false } {
  if (rows.length < 1 || rows.length > 2) return { ok: false };
  const keys: PublicSearchServiceKey[] = [];
  for (const row of rows) {
    if (!KEY_ID_RE.test(row.keyId) || !DIGEST_RE.test(row.sha256)) return { ok: false };
    const expiresAt = row.expiresAt === null ? null : new Date(row.expiresAt);
    if (expiresAt !== null && Number.isNaN(expiresAt.getTime())) return { ok: false };
    keys.push({ keyId: row.keyId, digest: Buffer.from(row.sha256, "hex"), expiresAt });
  }
  if (new Set(keys.map((key) => key.keyId)).size !== keys.length) return { ok: false };
  if (keys.filter((key) => key.expiresAt === null).length !== 1) return { ok: false };
  return { ok: true, keys };
}

/** Exported for tests. Reads only the Authorization header and the given keys. */
export function classifyPublicSearchRequest(
  authorization: string | undefined,
  keys: PublicSearchServiceKey[],
  now: Date,
): "anonymous" | "refused" | "service" {
  if (authorization === undefined) return "anonymous";
  const trimmed = authorization.trim();
  // Only our scheme is special; a different scheme is an anonymous caller.
  if (!/^Raft-Service(\s|$)/i.test(trimmed)) return "anonymous";
  const match = /^Raft-Service v1 ([^.\s]+)\.(\S+)$/.exec(trimmed);
  if (!match || trimmed.slice(0, SCHEME.length) !== SCHEME) return "refused";
  const [, keyId, token] = match;
  if (!KEY_ID_RE.test(keyId!) || !TOKEN_RE.test(token!)) return "refused";
  const key = keys.find((candidate) => candidate.keyId === keyId);
  if (!key || (key.expiresAt !== null && key.expiresAt.getTime() <= now.getTime())) return "refused";
  const digest = createHash("sha256").update(token!, "utf8").digest();
  return timingSafeEqual(digest, key.digest) ? "service" : "refused";
}

/**
 * The shared per-minute bucket: increments `key` and guarantees it a bounded
 * TTL in one step. Production uses Redis; the in-memory store exists only for
 * explicit injection (tests, local dev) and is never chosen automatically.
 */
export interface PublicSearchServiceBucketStore {
  incrementWithTtl(key: string, ttlSeconds: number): Promise<number>;
}

/**
 * INCR and TTL in one Lua call, so a crash cannot leave a bucket key without
 * an expiry; a key that lost its TTL gets it back on the next hit.
 */
export const PUBLIC_SEARCH_BUCKET_LUA = `
local count = redis.call('INCR', KEYS[1])
if redis.call('TTL', KEYS[1]) < 0 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return count
`;

/** The Redis adapter: one EVAL per increment, nothing else. */
export function createRedisPublicSearchBucketStore(
  client: () => Pick<Redis, "eval" | "status"> | null,
): PublicSearchServiceBucketStore {
  return {
    async incrementWithTtl(key, ttlSeconds) {
      const redis = client();
      if (!redis || redis.status !== "ready") throw new Error("shared bucket unavailable");
      const result = await redis.eval(PUBLIC_SEARCH_BUCKET_LUA, 1, key, ttlSeconds);
      return Number(result);
    },
  };
}

export const redisPublicSearchBucketStore = createRedisPublicSearchBucketStore(() => getBoundedRedis(BUCKET_DEADLINE_MS));

/** For explicit injection only. Shared by every gate given the same instance. */
export function createMemoryPublicSearchBucketStore(): PublicSearchServiceBucketStore & { ttl(key: string): number | null } {
  const entries = new Map<string, { count: number; expiresAt: number }>();
  return {
    async incrementWithTtl(key, ttlSeconds) {
      const now = Date.now();
      const entry = entries.get(key);
      if (!entry || entry.expiresAt <= now) {
        entries.set(key, { count: 1, expiresAt: now + ttlSeconds * 1000 });
        return 1;
      }
      entry.count += 1;
      return entry.count;
    },
    ttl(key) {
      const entry = entries.get(key);
      return entry ? Math.ceil((entry.expiresAt - Date.now()) / 1000) : null;
    },
  };
}

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("shared bucket deadline")), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

function unavailable(res: Response) {
  res.set("Cache-Control", "no-store");
  res.set("Retry-After", String(MAX_RETRY_AFTER_SECONDS));
  res.status(503).json({ error: "Service access unavailable" });
}

function tooMany(res: Response, retryAfter: number) {
  res.set("Cache-Control", "no-store");
  res.set("Retry-After", String(retryAfter));
  res.status(429).json({ error: "Too many requests" });
}

/**
 * The access gate in front of the public search router. `anonymousLimiter` is
 * the existing per-IP limiter; `verifyLimiter` is a per-IP limiter in front of
 * every service-scheme key lookup.
 */
export function createPublicSearchAccess(options: {
  anonymousLimiter: RequestHandler;
  /** Per client IP, in front of every service-scheme key lookup. */
  verifyLimiter: RequestHandler;
  limits?: PublicSearchServiceLimits;
  keySource?: PublicSearchServiceKeySource;
  bucketStore?: PublicSearchServiceBucketStore;
  bucketDeadlineMs?: number;
  keyLookupDeadlineMs?: number;
  now?: () => Date;
}): RequestHandler {
  const limits = options.limits ?? readPublicSearchServiceLimits();
  const keySource = options.keySource ?? databaseKeySource;
  const bucketStore = options.bucketStore ?? redisPublicSearchBucketStore;
  const bucketDeadlineMs = options.bucketDeadlineMs ?? BUCKET_DEADLINE_MS;
  // Above the pool's own 250ms connection wait and statement timeout, so the
  // database normally gives up first; this is the request's upper bound.
  const keyLookupDeadlineMs = options.keyLookupDeadlineMs ?? KEY_LOOKUP_TIMEOUT_MS + 100;
  const now = options.now ?? (() => new Date());
  let inFlight = 0;

  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    const isServiceScheme = typeof header === "string" && /^\s*Raft-Service(\s|$)/i.test(header);
    if (!isServiceScheme) {
      options.anonymousLimiter(req, res, next);
      return;
    }
    if (limits.status !== "ready") {
      unavailable(res);
      return;
    }
    const verify = async () => {
      // Authentication: the keys as they are now, so a removed key stops
      // working on the next request. An unusable key set makes only this path
      // unavailable.
      let keys: PublicSearchServiceKey[];
      try {
        const validated = validatePublicSearchServiceKeys(await withDeadline(keySource(), keyLookupDeadlineMs));
        if (!validated.ok) return unavailable(res);
        keys = validated.keys;
      } catch {
        return unavailable(res);
      }
      if (classifyPublicSearchRequest(header, keys, now()) !== "service") {
        res.set("Cache-Control", "no-store");
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      // The shared bucket, then the in-flight cap, before any content query.
      const at = now().getTime();
      const windowStart = Math.floor(at / 60_000);
      let count: number;
      try {
        count = await withDeadline(
          bucketStore.incrementWithTtl(`${PUBLIC_SEARCH_SERVICE_CLIENT_ID}:rate:${windowStart}`, BUCKET_TTL_SECONDS),
          bucketDeadlineMs,
        );
      } catch {
        return unavailable(res);
      }
      if (!Number.isFinite(count)) return unavailable(res);
      if (count > limits.ratePerMinute) {
        const retryAfter = Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, Math.ceil(((windowStart + 1) * 60_000 - at) / 1000)));
        return tooMany(res, retryAfter);
      }
      if (inFlight >= limits.maxInFlight) return tooMany(res, 1);
      inFlight += 1;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        inFlight -= 1;
      };
      res.once("finish", release);
      res.once("close", release);
      try {
        next();
      } catch (error) {
        release();
        throw error;
      }
    };

    // Every service-scheme request passes the per-IP verification limiter
    // before the key lookup, so well-formed but forged credentials cannot
    // drive unbounded reads of the key table.
    options.verifyLimiter(req, res, () => {
      verify().catch(() => {
        if (!res.headersSent) unavailable(res);
      });
    });
  };
}
