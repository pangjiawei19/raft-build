import Redis, { type RedisOptions } from "ioredis";
import { redisErrors, redisConnected } from "./metrics";
import { recordExternalSinkInsideTransaction } from "./db/ambientTransaction";

let _redis: Redis | null = null;
let _redisSub: Redis | null = null;
let _redisPub: Redis | null = null;
let _redisReplicaSub: Redis | null = null;
let _redisUrl: string | null = null;
let _redisOpts: RedisOptions | null = null;
let _redisBounded: Redis | null = null;
let _redisShutDown = false;

function attachRedisClientMetrics(name: string, client: Redis) {
  client.on("error", (err) => {
    redisErrors.labels(name).inc();
    console.error(`[${name}] error:`, err.message);
  });
  client.on("connect", () => {
    redisConnected.labels(name).set(1);
    console.log(`[${name}] connected`);
  });
  client.on("close", () => redisConnected.labels(name).set(0));
}

/**
 * Initialize Redis connections. Call once at startup.
 * Creates 3 connections: general, pub, sub (Socket.io adapter needs dedicated pub/sub pair).
 */
export function initRedis(redisUrl: string) {
  // Fly.io internal networking uses IPv6 (6PN). When the Redis URL points to a
  // *.internal host, force IPv6 so ioredis doesn't try IPv4 and fail/timeout.
  const needsIPv6 = /\.internal[:/]/.test(redisUrl) || redisUrl.endsWith(".internal");
  const opts: RedisOptions = { maxRetriesPerRequest: null };
  if (needsIPv6) opts.family = 6;
  _redisUrl = redisUrl;
  _redisOpts = opts;
  // A bounded client from an earlier init must not be reused against the new one.
  if (_redisBounded) void _redisBounded.quit().catch(() => {});
  _redisBounded = null;
  _redisShutDown = false;

  _redis = new Redis(redisUrl, opts);
  _redisPub = new Redis(redisUrl, opts);
  _redisSub = new Redis(redisUrl, opts);
  _redisReplicaSub = new Redis(redisUrl, opts);

  for (const [name, client] of [["redis", _redis], ["redis_pub", _redisPub], ["redis_sub", _redisSub], ["redis_replica_sub", _redisReplicaSub]] as const) {
    attachRedisClientMetrics(name, client);
  }
}

/**
 * Dedicated client for short, latency-bound commands (the public search
 * service bucket, task #4). Its own connection, so a slow command never holds
 * the shared one; a command past `commandTimeoutMs` is rejected by the client,
 * and while disconnected commands fail at once instead of queueing. Null when
 * Redis is not configured.
 */
export function getBoundedRedis(commandTimeoutMs: number): Redis | null {
  if (!_redisUrl || !_redisOpts || _redisShutDown) return null;
  if (!_redisBounded) {
    _redisBounded = new Redis(_redisUrl, {
      ..._redisOpts,
      commandTimeout: commandTimeoutMs,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
    });
    attachRedisClientMetrics("redis_bounded", _redisBounded);
  }
  return _redisBounded;
}

/** General-purpose Redis client (commands, pub, locks, caches) */
export function getRedis(): Redis {
  // Check BEFORE the null check: the hazard is "code reached for a Redis client
  // while a transaction is open", not "the command actually ran". In production
  // Redis is up, so this call would fire; the null check below is only the
  // uninitialized path. Mark armed + record any in-transaction hit first.
  recordExternalSinkInsideTransaction("redis");
  if (!_redis) throw new Error("Redis not initialized — call initRedis() first");
  return _redis;
}

/** Dedicated publisher for Socket.io Redis adapter */
export function getRedisPub(): Redis {
  recordExternalSinkInsideTransaction("redis");
  if (!_redisPub) throw new Error("Redis not initialized");
  return _redisPub;
}

/** Dedicated subscriber for Socket.io Redis adapter */
export function getRedisSub(): Redis {
  recordExternalSinkInsideTransaction("redis");
  if (!_redisSub) throw new Error("Redis not initialized");
  return _redisSub;
}

/** Dedicated subscriber for ReplicaRouter cross-replica pub/sub */
export function getRedisReplicaSub(): Redis {
  recordExternalSinkInsideTransaction("redis");
  if (!_redisReplicaSub) throw new Error("Redis not initialized");
  return _redisReplicaSub;
}

/** Recreate the dedicated ReplicaRouter subscriber after subscriber-mode drift. */
export function resetRedisReplicaSub(): Redis {
  if (!_redisUrl || !_redisOpts) throw new Error("Redis not initialized");
  try {
    _redisReplicaSub?.disconnect();
  } catch {
    // best effort: the replacement client below is authoritative
  }
  _redisReplicaSub = new Redis(_redisUrl, _redisOpts);
  attachRedisClientMetrics("redis_replica_sub", _redisReplicaSub);
  return _redisReplicaSub;
}

/** Returns true if Redis is configured and available */
export function isRedisAvailable(): boolean {
  // This is the universal "does this path intend to use Redis?" gate: callers
  // check it before ever reaching getRedis(). Record it so a path that intends
  // to use Redis inside a transaction is surfaced even when Redis is absent
  // (the default test suite has no Redis, so getRedis() is often never reached).
  recordExternalSinkInsideTransaction("redis");
  return _redis !== null;
}

export async function shutdownRedis() {
  // The bounded client is closed with the others and never handed out again
  // until the next initRedis (a closed client would only fail every command).
  const bounded = _redisBounded;
  _redisBounded = null;
  _redisShutDown = true;
  await Promise.all([
    _redis?.quit(),
    _redisPub?.quit(),
    _redisSub?.quit(),
    _redisReplicaSub?.quit(),
    bounded?.quit(),
  ]);
}
