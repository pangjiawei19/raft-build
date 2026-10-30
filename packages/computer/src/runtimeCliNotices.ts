/**
 * `raft-computer status` lines for a runtime CLI that went down a version
 * since an earlier start. The daemon writes the record
 * (`packages/daemon/src/runtimeCliVersionTracker.ts`); this reads it without
 * loading the daemon. A missing or unreadable file means no notices.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

interface Downgrade {
  from: string;
  to: string;
  at: string;
}

const OVERRIDE_HINT: Record<string, string> = {
  codex: "CODEX_BIN",
};

export function runtimeCliNotice(runtime: string, notice: Downgrade): string {
  const override = OVERRIDE_HINT[runtime] ? `set ${OVERRIDE_HINT[runtime]} to the ${runtime} you want` : `put the ${runtime} you want first on your PATH`;
  return `${runtime} on this Computer is now ${notice.to}, but it was ${notice.from} before (changed ${notice.at}). ` +
    `An older copy is probably earlier on the PATH the Computer started with. ` +
    `Restart the Computer from a normal login terminal, or ${override}. ` +
    `If you went back to ${notice.to} on purpose, ignore this.`;
}

export async function readRuntimeCliNotices(slockHome: string): Promise<string[]> {
  try {
    const parsed = JSON.parse(await readFile(path.join(slockHome, "computer", "runtime-cli-versions.json"), "utf8")) as {
      schemaVersion?: unknown;
      downgrades?: Record<string, Partial<Downgrade>>;
    };
    if (parsed?.schemaVersion !== 1 || !parsed.downgrades || typeof parsed.downgrades !== "object") return [];
    return Object.entries(parsed.downgrades)
      .filter((entry): entry is [string, Downgrade] =>
        typeof entry[1]?.from === "string" && typeof entry[1]?.to === "string" && typeof entry[1]?.at === "string")
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([runtime, notice]) => runtimeCliNotice(runtime, notice));
  } catch {
    return [];
  }
}
