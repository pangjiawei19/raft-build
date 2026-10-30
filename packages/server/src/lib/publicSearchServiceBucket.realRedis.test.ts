// Real-Redis teeth for the public search service bucket (public server SEO
// task #4). The default suite proves the gate against an injected store and
// that the production adapter makes exactly one EVAL; only a real Redis runs
// the Lua script itself. CI runs this in the probe-concurrency job with a
// Redis service; local runs need PUBLIC_SEARCH_BUCKET_REAL_REDIS_URL.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import Redis from "ioredis";
import type { Request, RequestHandler, Response } from "express";
import {
  createPublicSearchAccess,
  createRedisPublicSearchBucketStore,
  readPublicSearchServiceLimits,
} from "./publicSearchServiceAccess";

const REAL_REDIS_URL = process.env.PUBLIC_SEARCH_BUCKET_REAL_REDIS_URL;
const REAL_REDIS_REQUIRED = process.env.PUBLIC_SEARCH_BUCKET_REAL_REDIS_REQUIRED === "1";

function skipUnlessRealRedis(): boolean {
  if (REAL_REDIS_URL) return false;
  if (REAL_REDIS_REQUIRED) throw new Error("PUBLIC_SEARCH_BUCKET_REAL_REDIS_REQUIRED=1 but PUBLIC_SEARCH_BUCKET_REAL_REDIS_URL is unset");
  return true;
}

async function withClient(run: (client: Redis) => Promise<void>) {
  const client = new Redis(REAL_REDIS_URL!, { maxRetriesPerRequest: 0, enableOfflineQueue: false, lazyConnect: true });
  await client.connect();
  try {
    await run(client);
  } finally {
    await client.quit();
  }
}

test.skipIf(skipUnlessRealRedis())("real Redis: the bucket script increments and gives every key a bounded TTL, repairing one that lost it", async () => {
  await withClient(async (client) => {
    const store = createRedisPublicSearchBucketStore(() => client);
    const fresh = `raft-landing-public-seo:test:${randomBytes(6).toString("hex")}`;
    assert.equal(await store.incrementWithTtl(fresh, 120), 1);
    const freshTtl = await client.ttl(fresh);
    assert.ok(freshTtl > 0 && freshTtl <= 120, `a new key gets the TTL, got ${freshTtl}`);
    assert.equal(await store.incrementWithTtl(fresh, 120), 2);

    // A key left without a TTL (what INCR-then-EXPIRE could leave after a crash).
    const orphan = `raft-landing-public-seo:test:${randomBytes(6).toString("hex")}`;
    await client.set(orphan, "5");
    assert.equal(await client.ttl(orphan), -1, "fixture: no TTL");
    assert.equal(await store.incrementWithTtl(orphan, 120), 6, "the count continues");
    const repaired = await client.ttl(orphan);
    assert.ok(repaired > 0 && repaired <= 120, `the lost TTL is repaired, got ${repaired}`);
    await client.del(fresh, orphan);
  });
});

test.skipIf(skipUnlessRealRedis())("real Redis: two gates (two replicas) share one bucket through the production adapter", async () => {
  await withClient(async (client) => {
    const token = randomBytes(32).toString("base64url");
    const sha256 = createHash("sha256").update(token).digest("hex");
    const stale = await client.keys("raft-landing-public-seo:rate:*");
    if (stale.length > 0) await client.del(...stale);
    const FIXED_MID_MINUTE = new Date("2026-01-01T00:00:30.000Z");
    const passThrough: RequestHandler = (_req, _res, next) => next();
    const gate = () => createPublicSearchAccess({
      anonymousLimiter: passThrough,
      verifyLimiter: passThrough,
      keySource: async () => [{ keyId: "k", sha256, expiresAt: null }],
      bucketStore: createRedisPublicSearchBucketStore(() => client),
      limits: readPublicSearchServiceLimits({ RAFT_LANDING_SERVICE_RATE_PER_MINUTE: "2" }),
      // The bucket is a fixed per-minute window keyed by the clock. On the real
      // clock the three sends (~300ms) can straddle a minute boundary, and the
      // third then lands in a fresh window and passes (red twice on CI).
      now: () => FIXED_MID_MINUTE,
    });
    const send = async (access: RequestHandler) => {
      const res = new EventEmitter() as EventEmitter & { statusCode: number; set: () => unknown; status: (c: number) => unknown; json: () => unknown };
      res.statusCode = 200;
      res.set = () => res;
      res.status = (code: number) => { res.statusCode = code; return res; };
      res.json = () => { res.emit("finish"); return res; };
      let passed = false;
      access({ headers: { authorization: `Raft-Service v1 k.${token}` } } as unknown as Request, res as unknown as Response, () => { passed = true; res.emit("finish"); });
      await new Promise((resolve) => setTimeout(resolve, 100));
      return passed ? 200 : res.statusCode;
    };
    const [replicaA, replicaB] = [gate(), gate()];
    assert.deepEqual([await send(replicaA), await send(replicaB), await send(replicaA)], [200, 200, 429]);
    const keys = await client.keys("raft-landing-public-seo:rate:*");
    assert.equal(keys.length, 1, "one shared key");
    const ttl = await client.ttl(keys[0]!);
    assert.ok(ttl > 0 && ttl <= 120, `bounded TTL, got ${ttl}`);
    await client.del(...keys);
  });
});

test.skipIf(skipUnlessRealRedis())("real Redis: shutdownRedis closes the bounded client once, and a re-init never hands back the closed one", async () => {
  const { initRedis, getBoundedRedis, shutdownRedis } = await import("../redis");
  initRedis(REAL_REDIS_URL!);
  const first = getBoundedRedis(250)!;
  assert.ok(first, "a bounded client after init");
  assert.ok(getBoundedRedis(250) === first, "the same client while running");
  let quits = 0;
  const quit = first.quit.bind(first);
  first.quit = (async (...args: Parameters<typeof quit>) => { quits += 1; return quit(...args); }) as typeof first.quit;
  await new Promise<void>((resolve) => (first.status === "ready" ? resolve() : first.once("ready", () => resolve())));
  await shutdownRedis();
  assert.equal(quits, 1, "closed exactly once");
  // quit() resolves on the server's OK; the client reports "end" when the socket closes.
  const ended = await new Promise<boolean>((resolve) => {
    if (first.status === "end") return resolve(true);
    const timer = setTimeout(() => resolve(false), 2_000);
    first.once("end", () => { clearTimeout(timer); resolve(true); });
  });
  assert.ok(ended, `the bounded client's connection ends, status ${first.status}`);
  assert.ok(getBoundedRedis(250) === null, "after shutdown nothing is handed out");

  initRedis(REAL_REDIS_URL!);
  const second = getBoundedRedis(250)!;
  assert.ok(second && second !== first, "a re-init builds a new client");
  const store = createRedisPublicSearchBucketStore(() => second);
  await new Promise<void>((resolve) => (second.status === "ready" ? resolve() : second.once("ready", () => resolve())));
  const key = `raft-landing-public-seo:test:${randomBytes(6).toString("hex")}`;
  assert.equal(await store.incrementWithTtl(key, 120), 1, "and it works");
  await second.del(key);
  await shutdownRedis();
});
