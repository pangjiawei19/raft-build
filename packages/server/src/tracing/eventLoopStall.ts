import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { PerformanceObserver, performance } from "node:perf_hooks";
import type { ActiveSpan, StartSpanOptions, Tracer } from "@botiverse/raft-shared";
import { matchedRouteTemplate } from "../middleware/requestRoutePattern";

// When the event loop runs late by >= 1 s, one `server.event_loop.stall` event
// names what was on the process at that moment: in-flight HTTP routes, the
// background spans still open, requests that finished during the stall, and
// memory. `server.event_loop.delay` (every 10 s) shows that a task stalled;
// this says what it was doing (10-13: a 10 s stall on one prod task, and three
// tasks stalling together at 09:50Z, could not be attributed from spans).
//
// Cheap when nothing stalls: a 200 ms timer and two Map updates per request or
// span. No CPU profile: opening the inspector costs the most exactly when the
// process is already struggling (Tenny). At most one event per process per minute.

export const STALL_TICK_MS = 200;
export const STALL_THRESHOLD_MS = 1_000;
export const STALL_EVENT_MIN_INTERVAL_MS = 60_000;
const MAX_LISTED = 15;
const RECENT_KEEP_MS = 30_000;
const RECENT_MAX = 500;

// Spans already covered by the HTTP registry or too fine-grained to name a job.
const IGNORED_SPANS = new Set(["server.http.request", "server.db.connection", "server.db.query"]);

interface InflightRequest {
  req: IncomingMessage;
  startMs: number;
}

interface FinishedRequest {
  route: string;
  startMs: number;
  endMs: number;
}

const inflightRequests = new Set<InflightRequest>();
const recentlyFinished: FinishedRequest[] = [];
// Per span name: one object per open span (O(1) delete on end), capped per
// name; beyond the cap spans are only counted (`untracked`). A span whose end()
// is never called shows up as hours old in the stall event, which is how such
// leaks get found (Arkbriar, Tenny).
const MAX_TRACKED_PER_NAME = 1_000;
interface OpenSpan { startMs: number }
const activeSpans = new Map<string, { open: Set<OpenSpan>; untracked: number }>();

// GC entries from the last minute, so a stall can be told apart: a long GC
// pause vs synchronous code (Tenny).
const GC_KEEP_MS = 60_000;
const recentGc: Array<{ startMs: number; durationMs: number }> = [];

/** Route template only (`/api/channels/:id`), never the raw URL: no ids or query strings. */
function routeOf(req: IncomingMessage): string {
  const r = req as IncomingMessage & { route?: { path?: unknown }; baseUrl?: string; originalUrl?: string };
  return `${req.method ?? "?"} ${matchedRouteTemplate(r) ?? "unmatched"}`;
}

export function trackHttpServer(server: Server): void {
  server.on("request", (req: IncomingMessage, res: ServerResponse) => {
    const entry: InflightRequest = { req, startMs: performance.now() };
    inflightRequests.add(entry);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      inflightRequests.delete(entry);
      recentlyFinished.push({ route: routeOf(req), startMs: entry.startMs, endMs: performance.now() });
      if (recentlyFinished.length > RECENT_MAX) recentlyFinished.splice(0, recentlyFinished.length - RECENT_MAX);
    };
    res.once("finish", finish);
    res.once("close", finish);
  });
}

/** Wraps a tracer so the names of open spans (background jobs) can be listed during a stall. */
export function trackActiveSpans(tracer: Tracer): Tracer {
  return {
    emitEvent: (name, options) => tracer.emitEvent(name, options),
    startSpan(name: string, options: StartSpanOptions): ActiveSpan {
      const span = tracer.startSpan(name, options);
      if (IGNORED_SPANS.has(name)) return span;
      const entry = activeSpans.get(name) ?? { open: new Set<OpenSpan>(), untracked: 0 };
      activeSpans.set(name, entry);
      let own: OpenSpan | null = null;
      if (entry.open.size < MAX_TRACKED_PER_NAME) {
        own = { startMs: performance.now() };
        entry.open.add(own);
      } else {
        entry.untracked += 1;
      }
      let ended = false;
      return {
        context: span.context,
        addEvent: (eventName, attrs) => span.addEvent(eventName, attrs),
        end(status, endOptions) {
          if (!ended) {
            ended = true;
            const current = activeSpans.get(name);
            if (current) {
              if (own) current.open.delete(own);
              else current.untracked = Math.max(0, current.untracked - 1);
              if (current.open.size === 0 && current.untracked === 0) activeSpans.delete(name);
            }
          }
          span.end(status, endOptions);
        },
      };
    },
  };
}

function summarize(entries: Array<{ key: string; ageMs: number }>): string {
  const byKey = new Map<string, { n: number; maxAgeMs: number }>();
  for (const { key, ageMs } of entries) {
    const cur = byKey.get(key) ?? { n: 0, maxAgeMs: 0 };
    cur.n += 1;
    cur.maxAgeMs = Math.max(cur.maxAgeMs, ageMs);
    byKey.set(key, cur);
  }
  return [...byKey.entries()]
    .sort((a, b) => b[1].maxAgeMs - a[1].maxAgeMs)
    .slice(0, MAX_LISTED)
    .map(([key, { n, maxAgeMs }]) => `${key} x${n} ${Math.round(maxAgeMs)}ms`)
    .join("; ");
}

export interface StallSnapshot {
  stall_ms: number;
  inflight_requests: number;
  inflight_routes: string;
  finished_during_stall: string;
  background_spans: string;
  background_spans_open: number;
  gc_count: number;
  gc_max_pause_ms: number;
  rss_mb: number;
  heap_used_mb: number;
  heap_total_mb: number;
  external_mb: number;
}

export function snapshotStall(stallMs: number, nowMs: number = performance.now()): StallSnapshot {
  const stallStart = nowMs - stallMs;
  const inflight = [...inflightRequests].map((r) => ({ key: routeOf(r.req), ageMs: nowMs - r.startMs }));
  // Requests that ended inside the stall window: the culprit often finishes
  // its synchronous work and its response just before the loop catches up.
  while (recentlyFinished.length && recentlyFinished[0]!.endMs < nowMs - RECENT_KEEP_MS) recentlyFinished.shift();
  const finished = recentlyFinished
    .filter((f) => f.endMs >= stallStart)
    .map((f) => ({ key: f.route, ageMs: f.endMs - f.startMs }));
  // One line per name: open count and age of the oldest tracked start.
  const spanLines = [...activeSpans.entries()]
    .map(([name, e]) => {
      let oldest = Infinity;
      for (const o of e.open) if (o.startMs < oldest) oldest = o.startMs;
      return { name, count: e.open.size + e.untracked, maxAgeMs: Number.isFinite(oldest) ? nowMs - oldest : 0 };
    })
    .sort((a, b) => b.maxAgeMs - a.maxAgeMs)
    .slice(0, MAX_LISTED)
    .map((e) => `${e.name} x${e.count} ${Math.round(e.maxAgeMs)}ms`)
    .join("; ");
  let openSpans = 0;
  for (const e of activeSpans.values()) openSpans += e.open.size + e.untracked;
  // GC that ran inside the stall window (plus 1 s before it).
  while (recentGc.length && recentGc[0]!.startMs < nowMs - GC_KEEP_MS) recentGc.shift();
  const gcInStall = recentGc.filter((g) => g.startMs + g.durationMs >= stallStart - 1_000);
  const mem = process.memoryUsage();
  const mb = (n: number) => Math.round(n / 1_048_576);
  return {
    stall_ms: Math.round(stallMs),
    inflight_requests: inflight.length,
    inflight_routes: summarize(inflight),
    finished_during_stall: summarize(finished),
    background_spans: spanLines,
    background_spans_open: openSpans,
    gc_count: gcInStall.length,
    gc_max_pause_ms: Math.round(gcInStall.reduce((m, g) => Math.max(m, g.durationMs), 0)),
    rss_mb: mb(mem.rss),
    heap_used_mb: mb(mem.heapUsed),
    heap_total_mb: mb(mem.heapTotal),
    external_mb: mb(mem.external),
  };
}

export function startEventLoopStallDetector(
  tracer: Tracer,
  options: {
    tickMs?: number;
    thresholdMs?: number;
    minIntervalMs?: number;
    now?: () => number;
    /** Subscribe to real GC entries (default true). Tests turn it off so only injected entries count. */
    observeGc?: boolean;
  } = {},
): () => void {
  const tickMs = options.tickMs ?? STALL_TICK_MS;
  const thresholdMs = options.thresholdMs ?? STALL_THRESHOLD_MS;
  const minIntervalMs = options.minIntervalMs ?? STALL_EVENT_MIN_INTERVAL_MS;
  const now = options.now ?? (() => performance.now());
  let last = now();
  let lastEmit = -Infinity;
  let gcObserver: PerformanceObserver | null = null;
  if (options.observeGc !== false) {
    try {
      gcObserver = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          recentGc.push({ startMs: e.startTime, durationMs: e.duration });
          if (recentGc.length > 1_000) recentGc.shift();
        }
      });
      gcObserver.observe({ entryTypes: ["gc"] });
    } catch {
      gcObserver = null; // GC entries unavailable: gc_* stay 0
    }
  }
  const timer = setInterval(() => {
    try {
      const t = now();
      const lateMs = t - last - tickMs;
      last = t;
      if (lateMs < thresholdMs || t - lastEmit < minIntervalMs) return;
      lastEmit = t;
      // Snapshot one turn later. After a long GC the loop resumes in the timers
      // phase, so this callback runs before the PerformanceObserver has
      // delivered that GC's entry; snapshotting now would report gc_count=0
      // and blame synchronous code (Tenny). setImmediate runs after the queued
      // observer callback; the window is still measured from `t`.
      setImmediate(() => {
        try {
          tracer.emitEvent("server.event_loop.stall", { surface: "server", attrs: { ...snapshotStall(lateMs, t) } });
        } catch {
          // Detection must never affect the process.
        }
      });
    } catch {
      // Detection must never affect the process.
    }
  }, tickMs);
  timer.unref?.();
  return () => {
    clearInterval(timer);
    gcObserver?.disconnect();
  };
}

/** Test helper: clears the module registries. */
export function __resetStallRegistriesForTest(): void {
  inflightRequests.clear();
  recentlyFinished.length = 0;
  activeSpans.clear();
  recentGc.length = 0;
}

/** Test helper: records a GC entry as if observed. */
export function __recordGcForTest(startMs: number, durationMs: number): void {
  recentGc.push({ startMs, durationMs });
}
