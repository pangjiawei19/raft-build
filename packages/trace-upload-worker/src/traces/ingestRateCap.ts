// Per-machine ingest cap: at most N spans per (span name, UTC minute) are
// forwarded from one trace bundle; the rest are dropped before OTLP. Standalone
// events have their own cap, off by default (see below).
//
// Why: 10-16, six Computers on 1.0.16 were stuck in a reminder catch-up loop,
// each reporting up to 2,580 `daemon.app_source.fire` spans a minute (about a
// quarter of all daemon spans). Baseline the same day, per machine x span name
// x minute: p50 2, p99 53, highest healthy value 194. 500 is about 10x p99.
//
// The cap is applied per bundle, so it is deterministic: replaying a bundle
// drops exactly the same records, and it needs no shared counter across tasks.
// A minute split across two bundles can let through up to 2N; that is fine.
//
// The upload itself is always accepted; nothing is returned to the client
// that could start another round of retries in an old daemon. Each dropped
// (name, minute) bucket becomes one `trace_ingest.records_dropped` summary
// log record carrying the counts, never the dropped records.
import type { TraceUploadWorkerEnv } from "../env";

export const TRACE_INGEST_PER_MINUTE_CAP = 500;
// Standalone events are not capped by default: their 7-day peak (10-16) shows
// healthy current-version machines well above 500 a minute (activity and
// runtime progress events during busy turns, up to ~2,900 on 1.0.47), so a
// span-sized cap would cut real data. Set a value once a baseline is agreed.
export const TRACE_INGEST_EVENT_PER_MINUTE_CAP = 0;
export const TRACE_INGEST_DROPPED_EVENT_NAME = "trace_ingest.records_dropped";
export const TRACE_INGEST_DROP_REASON = "per_machine_rate";

export interface RateCapDrop {
  recordType: "span" | "event";
  name: string;
  /** UTC minute, `YYYY-MM-DDTHH:MM`. */
  minute: string;
  kept: number;
  dropped: number;
}

export function readIngestPerMinuteCap(env: Pick<TraceUploadWorkerEnv, "TRACE_INGEST_PER_MINUTE_CAP">): number {
  return readCap(env.TRACE_INGEST_PER_MINUTE_CAP, TRACE_INGEST_PER_MINUTE_CAP);
}

export function readIngestEventPerMinuteCap(env: Pick<TraceUploadWorkerEnv, "TRACE_INGEST_EVENT_PER_MINUTE_CAP">): number {
  return readCap(env.TRACE_INGEST_EVENT_PER_MINUTE_CAP, TRACE_INGEST_EVENT_PER_MINUTE_CAP);
}

function readCap(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Keeps the first `cap` records of each (name, minute) in bundle order.
 * `cap <= 0` disables the cap. A record whose time does not parse is kept,
 * so the existing timestamp validation still reports it.
 */
export function capRecordsPerMinute<T>(
  records: readonly T[],
  recordType: RateCapDrop["recordType"],
  describe: (record: T) => { name: string; time: string },
  cap: number,
): { kept: T[]; drops: RateCapDrop[] } {
  if (cap <= 0) return { kept: [...records], drops: [] };
  const counts = new Map<string, { name: string; minute: string; kept: number; dropped: number }>();
  const kept: T[] = [];
  for (const record of records) {
    const { name, time } = describe(record);
    const minute = utcMinute(time);
    if (minute === null) {
      kept.push(record);
      continue;
    }
    const key = `${name}\u0000${minute}`;
    let bucket = counts.get(key);
    if (!bucket) {
      bucket = { name, minute, kept: 0, dropped: 0 };
      counts.set(key, bucket);
    }
    if (bucket.kept < cap) {
      bucket.kept += 1;
      kept.push(record);
    } else {
      bucket.dropped += 1;
    }
  }
  const drops = [...counts.values()]
    .filter((bucket) => bucket.dropped > 0)
    .map((bucket) => ({ recordType, ...bucket }))
    .sort((a, b) => (a.minute === b.minute ? a.name.localeCompare(b.name) : a.minute.localeCompare(b.minute)));
  return { kept, drops };
}

function utcMinute(time: string): string | null {
  const ms = Date.parse(time);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 16);
}
