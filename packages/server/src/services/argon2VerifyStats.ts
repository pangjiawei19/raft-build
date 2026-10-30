import argon2 from "argon2";

/**
 * Wall time spent in argon2 verification for one auth attempt. argon2 runs on
 * the libuv thread pool (4 threads by default), so wall time includes the wait
 * for a free thread: under a reconnect burst it grows while event-loop lag
 * stays flat (v1.21.19 cutover, #proj-o11y:283f3ab1).
 */
export type Argon2VerifyStats = {
  count: number;
  totalMs: number;
  maxMs: number;
  /** Keys proven by the HMAC fast path instead of argon2. */
  hmacMatches?: number;
  /** Stored HMACs found stale (older secret) and rewritten after argon2 accepted the key. */
  hmacRewrites?: number;
};

export function newArgon2VerifyStats(): Argon2VerifyStats {
  return { count: 0, totalMs: 0, maxMs: 0 };
}

/** `argon2.verify`, recording its wall time into `stats` when given (also when it throws). */
export async function timedArgon2Verify(
  hash: string,
  plain: string,
  stats?: Argon2VerifyStats,
): Promise<boolean> {
  if (!stats) return argon2.verify(hash, plain);
  const start = performance.now();
  try {
    return await argon2.verify(hash, plain);
  } finally {
    const ms = performance.now() - start;
    stats.count += 1;
    stats.totalMs += ms;
    if (ms > stats.maxMs) stats.maxMs = ms;
  }
}

/** Root-span attrs for an auth attempt (ms rounded to integers). */
export function argon2VerifyTraceAttrs(stats: Argon2VerifyStats): Record<string, number> {
  return {
    argon2_verify_count: stats.count,
    argon2_verify_ms_total: Math.round(stats.totalMs),
    argon2_verify_ms_max: Math.round(stats.maxMs),
    hmac_verify_count: stats.hmacMatches ?? 0,
    hmac_rewrite_count: stats.hmacRewrites ?? 0,
  };
}
