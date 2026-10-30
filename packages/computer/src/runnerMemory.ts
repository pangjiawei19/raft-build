import { readFile } from "node:fs/promises";

// A runner's or the service's latest memory sample, written every few minutes
// (packages/daemon/src/processMemory.ts, serviceMemory.ts). Counters only;
// doctor prints them so a user or agent can paste one line instead of taking a
// heap snapshot.

export interface RunnerMemorySample {
  sampledAt: string;
  pid: number;
  uptimeMs: number;
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  externalBytes: number;
  swapBytes?: number;
  heapSpaceUsedBytes: Record<string, number>;
}

export async function readRunnerMemorySample(samplePath: string): Promise<RunnerMemorySample | null> {
  try {
    const parsed = JSON.parse(await readFile(samplePath, "utf8")) as Partial<RunnerMemorySample>;
    if (
      typeof parsed.sampledAt !== "string" ||
      typeof parsed.pid !== "number" ||
      typeof parsed.rssBytes !== "number" ||
      typeof parsed.heapUsedBytes !== "number" ||
      typeof parsed.heapTotalBytes !== "number"
    ) {
      return null;
    }
    return {
      sampledAt: parsed.sampledAt,
      pid: parsed.pid,
      uptimeMs: typeof parsed.uptimeMs === "number" ? parsed.uptimeMs : 0,
      rssBytes: parsed.rssBytes,
      heapUsedBytes: parsed.heapUsedBytes,
      heapTotalBytes: parsed.heapTotalBytes,
      externalBytes: typeof parsed.externalBytes === "number" ? parsed.externalBytes : 0,
      ...(typeof parsed.swapBytes === "number" ? { swapBytes: parsed.swapBytes } : {}),
      heapSpaceUsedBytes: parsed.heapSpaceUsedBytes && typeof parsed.heapSpaceUsedBytes === "object" ? parsed.heapSpaceUsedBytes : {},
    };
  } catch {
    return null;
  }
}

const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

function duration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 1) return "<1 min";
  if (minutes < 120) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}

/**
 * One doctor line. `runnerPid` is the live runner's pid; a sample written by a
 * different pid belongs to an earlier runner and is not shown as current.
 */
export function describeRunnerMemory(
  sample: RunnerMemorySample | null,
  runnerPid: number,
  nowMs: number,
  processName: "runner" | "service" = "runner",
): string {
  if (!sample) return `no sample yet (the ${processName} writes one about a minute after it starts)`;
  if (sample.pid !== runnerPid) return `no sample from the current ${processName} yet (it writes one about a minute after it starts)`;
  const code = sample.heapSpaceUsedBytes.code_space;
  return (
    `rss ${mb(sample.rssBytes)}` +
    (typeof sample.swapBytes === "number" && sample.swapBytes > 0 ? ` (+${mb(sample.swapBytes)} swapped out)` : "") +
    `, JS heap ${mb(sample.heapUsedBytes)} used of ${mb(sample.heapTotalBytes)}` +
    (typeof code === "number" ? ` (code ${mb(code)})` : "") +
    `, external ${mb(sample.externalBytes)}; ${processName} up ${duration(sample.uptimeMs)}, sampled ${duration(nowMs - Date.parse(sample.sampledAt))} ago`
  );
}
