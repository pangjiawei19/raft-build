import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getHeapSpaceStatistics } from "node:v8";

// The Computer service's own memory sample: the same counters and file shape
// as a runner's (packages/daemon/src/processMemory.ts), written to
// run/service.memory.json. The service runs the lite bundle and cannot import
// daemon code, hence this small copy. Doctor prints it, and each runner adds
// the latest one to its daemon.process.memory event, which is how it reaches
// telemetry (the service's own traces stay local).

export const SERVICE_MEMORY_FIRST_SAMPLE_MS = 60_000;
export const SERVICE_MEMORY_SAMPLE_MS = 5 * 60_000;

// Linux only (VmSwap); an idle service can be mostly swapped out, so RSS alone
// reads far too low.
function serviceSwapBytes(): number | undefined {
  if (process.platform !== "linux") return undefined;
  try {
    const match = /^VmSwap:\s+(\d+)\s+kB$/m.exec(readFileSync("/proc/self/status", "utf8"));
    return match ? Number(match[1]) * 1024 : undefined;
  } catch {
    return undefined;
  }
}

export function writeServiceMemorySample(samplePath: string, nowMs = Date.now()): void {
  const usage = process.memoryUsage();
  const swap = serviceSwapBytes();
  const heapSpaceUsedBytes: Record<string, number> = {};
  for (const space of getHeapSpaceStatistics()) heapSpaceUsedBytes[space.space_name] = space.space_used_size;
  const sample = {
    sampledAt: new Date(nowMs).toISOString(),
    pid: process.pid,
    uptimeMs: Math.round(process.uptime() * 1000),
    rssBytes: usage.rss,
    heapUsedBytes: usage.heapUsed,
    heapTotalBytes: usage.heapTotal,
    externalBytes: usage.external,
    arrayBuffersBytes: usage.arrayBuffers,
    ...(swap === undefined ? {} : { swapBytes: swap }),
    heapSpaceUsedBytes,
  };
  mkdirSync(dirname(samplePath), { recursive: true });
  const tmp = `${samplePath}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(sample)}\n`, { mode: 0o600 });
  renameSync(tmp, samplePath);
}

/** Samples on unref'd timers: never keeps the service alive on its own. */
export function startServiceMemorySampler(samplePath: string): { stop(): void } {
  let timer: NodeJS.Timeout | null = null;
  const tick = () => {
    try {
      writeServiceMemorySample(samplePath);
    } catch {
      /* best-effort: doctor and telemetry show "no sample" */
    }
    timer = setTimeout(tick, SERVICE_MEMORY_SAMPLE_MS);
    timer.unref();
  };
  timer = setTimeout(tick, SERVICE_MEMORY_FIRST_SAMPLE_MS);
  timer.unref();
  return {
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
