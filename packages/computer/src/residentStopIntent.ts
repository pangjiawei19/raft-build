import { readFileSync, unlinkSync, writeFileSync } from "node:fs";

// Why the service is about to SIGTERM a runner. The service writes this just
// before the signal; the runner reads it on the signal so the daemon's stop
// span can say who stopped it. No intent for the runner's pid means the
// signal came from outside the service (OS shutdown, WSL idle stop, a user's
// `kill`, an external process manager).
export type ResidentStopSource = "service_shutdown" | "service_unmanaged";

export interface ResidentStopIntent {
  readonly pid: number;
  readonly source: ResidentStopSource;
}

export function writeResidentStopIntent(intentPath: string, intent: ResidentStopIntent): void {
  try {
    writeFileSync(intentPath, JSON.stringify(intent), { mode: 0o600 });
  } catch {
    /* best-effort: a missing intent only reads as an external signal */
  }
}

/** Reads and removes the intent; only an intent addressed to `pid` counts. */
export function takeResidentStopIntent(intentPath: string, pid = process.pid): ResidentStopSource | null {
  let source: ResidentStopSource | null = null;
  try {
    const parsed = JSON.parse(readFileSync(intentPath, "utf8")) as Partial<ResidentStopIntent>;
    if (parsed.pid === pid && (parsed.source === "service_shutdown" || parsed.source === "service_unmanaged")) {
      source = parsed.source;
    }
  } catch {
    return null;
  }
  try {
    unlinkSync(intentPath);
  } catch {
    /* already gone */
  }
  return source;
}
