import type { Tracer } from "@botiverse/raft-shared";

// Every minute, one `server.process.memory` event per process: the process's
// own memory (RSS, V8 heap, external). Before this, memory was only recorded on
// `server.event_loop.stall`, i.e. sampled at the worst moments and absent when
// nothing stalled (10-17: 28 samples in 7 days, none since v1.21.19), so a
// task's memory headroom or an unexplained stop could not be judged.
// Process-level numbers only; nothing about users or content.
export const PROCESS_MEMORY_SAMPLE_INTERVAL_MS = 60_000;

export interface ProcessMemorySample {
  interval_ms: number;
  rss_mb: number;
  heap_used_mb: number;
  heap_total_mb: number;
  external_mb: number;
  array_buffers_mb: number;
}

export function toMemorySample(mem: NodeJS.MemoryUsage, intervalMs: number): ProcessMemorySample {
  const mb = (n: number) => (Number.isFinite(n) ? Math.round(n / 1_048_576) : 0);
  return {
    interval_ms: intervalMs,
    rss_mb: mb(mem.rss),
    heap_used_mb: mb(mem.heapUsed),
    heap_total_mb: mb(mem.heapTotal),
    external_mb: mb(mem.external),
    array_buffers_mb: mb(mem.arrayBuffers),
  };
}

export function startProcessMemorySampler(
  tracer: Tracer,
  intervalMs: number = PROCESS_MEMORY_SAMPLE_INTERVAL_MS,
): () => void {
  const timer = setInterval(() => {
    try {
      tracer.emitEvent("server.process.memory", { surface: "server", attrs: { ...toMemorySample(process.memoryUsage(), intervalMs) } });
    } catch {
      // Sampling must never affect the process.
    }
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
