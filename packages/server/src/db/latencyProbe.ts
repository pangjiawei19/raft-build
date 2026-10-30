import pg from "pg";
import type { Tracer } from "@botiverse/raft-shared";
import { dbProbeDuration, dbProbeErrorsTotal, dbProbeReconnectsTotal, dbProbeTimeoutsTotal } from "../metrics";
import { attachPoolClientErrorHandler } from "./pgPoolErrorHandler";

// Background `SELECT 1` against the primary, once per second, on the pooled
// endpoint (DATABASE_URL) and, when configured, the direct endpoint
// (DB_PROBE_DIRECT_URL). It measures the Neon path itself: about 0.3% of
// production queries take 0.5-1.6 s between send and first byte while Neon
// reports ~2 ms per query, and the fleet sees ~1.4 s pauses about once a
// minute (task #442, Neon ticket). Comparing the two endpoints second by
// second tells proxy/PrivateLink from compute.
//
// Deliberately separate from the app pools: its own pg.Pool per endpoint with
// max 1, no connect gate (#9510), no instrumentPool, so it never takes a
// handshake permit, never appears in slock_db_pool_* or server.db.connection,
// and never feeds /health or /livez.

export const DB_PROBE_INTERVAL_MS = 1_000;
export const DB_PROBE_TIMEOUT_MS = 5_000;
// Slow or failed probes also become one trace event each, so a pause can be
// matched to the exact second and task (the histogram only says how often).
export const DB_PROBE_SLOW_EVENT_MS = 300;
const MAX_BACKOFF_MS = 30_000;

export type DbProbeEndpoint = "pooled" | "direct";
export type DbProbeOutcome = "ok" | "timeout" | "error";

export interface DbProbeTarget {
  endpoint: DbProbeEndpoint;
  connectionString: string;
}

export interface DbProbeClient {
  /** `freshConnection`: the probe had to open a new connection first (TCP + TLS). */
  query(sql: string): Promise<{ freshConnection: boolean }>;
  end(): Promise<void>;
}

export interface DbProbeOptions {
  intervalMs?: number;
  timeoutMs?: number;
  slowEventMs?: number;
  now?: () => number;
  createClient?: (target: DbProbeTarget, timeoutMs: number) => DbProbeClient;
}

/**
 * DB_LATENCY_PROBE=1/true/on or 0/false/off decides; unset means on only in
 * production (DEPLOYMENT_ENV=production). Staging, preview and dev Neon
 * computes may auto-suspend, and a probe every second would keep them awake
 * (Ray). PGlite URLs never probe.
 */
export function resolveDbProbeTargets(env: NodeJS.ProcessEnv): DbProbeTarget[] {
  const flag = (env.DB_LATENCY_PROBE ?? "").trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return [];
  const forced = flag === "1" || flag === "true" || flag === "on";
  if (!forced && env.DEPLOYMENT_ENV?.trim() !== "production") return [];
  const targets: DbProbeTarget[] = [];
  const pooled = env.DATABASE_URL?.trim();
  if (pooled && !pooled.startsWith("pglite")) targets.push({ endpoint: "pooled", connectionString: pooled });
  // No direct URL is configured in production yet; skip that leg instead of
  // failing startup so the pooled leg can ship first.
  const direct = env.DB_PROBE_DIRECT_URL?.trim();
  if (direct && !direct.startsWith("pglite")) targets.push({ endpoint: "direct", connectionString: direct });
  return targets;
}

function createPgProbeClient(target: DbProbeTarget, timeoutMs: number): DbProbeClient {
  const pool = new pg.Pool({
    connectionString: target.connectionString,
    max: 1,
    connectionTimeoutMillis: timeoutMs,
    // Client-side deadline: covers a stalled network path, not only a slow
    // statement on the server.
    query_timeout: timeoutMs,
    idleTimeoutMillis: 0,
    ssl: target.connectionString.includes("neon.tech") ? { rejectUnauthorized: false } : undefined,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });
  pool.on("error", () => {
    // An idle probe connection dropped; the next probe reconnects.
  });
  attachPoolClientErrorHandler(pool, `probe:${target.endpoint}`);
  // pg-pool destroys the client after any query error (timeouts too), so the
  // next probe opens a new connection. Its handshake (0.3-1 s to Neon) must
  // not be measured as a slow SELECT 1 (Ray).
  let opened = false;
  pool.on("connect", () => {
    opened = true;
  });
  return {
    async query(sql) {
      opened = false;
      await pool.query(sql);
      return { freshConnection: opened };
    },
    end: () => pool.end(),
  };
}

function isTimeout(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /timeout|timed out/i.test(message);
}

export function startDbLatencyProbe(
  tracer: Tracer,
  targets: DbProbeTarget[] = resolveDbProbeTargets(process.env),
  options: DbProbeOptions = {},
): () => void {
  const intervalMs = options.intervalMs ?? DB_PROBE_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DB_PROBE_TIMEOUT_MS;
  const slowEventMs = options.slowEventMs ?? DB_PROBE_SLOW_EVENT_MS;
  const now = options.now ?? (() => performance.now());
  const createClient = options.createClient ?? createPgProbeClient;
  const stops = targets.map((target) => startEndpointProbe(target));
  return () => {
    for (const stop of stops) stop();
  };

  function startEndpointProbe(target: DbProbeTarget): () => void {
    const client = createClient(target, timeoutMs);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    const schedule = () => {
      if (stopped) return;
      // After consecutive failures back off (2 s, 4 s, ... 30 s) so a probe
      // never adds to a reconnect storm while Neon is refusing connections.
      const delay = failures === 0 ? intervalMs : Math.min(MAX_BACKOFF_MS, intervalMs * 2 ** failures);
      timer = setTimeout(tick, delay);
      timer.unref?.();
    };

    const tick = async () => {
      const start = now();
      let outcome: DbProbeOutcome = "ok";
      let freshConnection = false;
      try {
        ({ freshConnection } = await client.query("SELECT 1"));
      } catch (err) {
        outcome = isTimeout(err) ? "timeout" : "error";
      }
      const durationMs = Math.round(now() - start);
      try {
        if (outcome === "ok") {
          failures = 0;
          // The histogram answers "does an established connection stall?";
          // a probe that had to reconnect is counted, not observed.
          if (freshConnection) dbProbeReconnectsTotal.labels(target.endpoint).inc();
          else dbProbeDuration.labels(target.endpoint).observe(durationMs / 1000);
        } else {
          failures += 1;
          (outcome === "timeout" ? dbProbeTimeoutsTotal : dbProbeErrorsTotal).labels(target.endpoint).inc();
        }
        if (outcome !== "ok" || durationMs >= slowEventMs) {
          tracer.emitEvent("server.db.probe.slow", {
            surface: "server",
            attrs: { endpoint: target.endpoint, duration_ms: durationMs, outcome, fresh_connection: freshConnection },
          });
        }
      } catch {
        // Measurement must never affect the process.
      }
      schedule();
    };

    schedule();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      void client.end().catch(() => undefined);
    };
  }
}
