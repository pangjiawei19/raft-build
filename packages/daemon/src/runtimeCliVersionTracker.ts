/**
 * Which runtime CLI version this Computer detected last, kept across restarts,
 * so a restart that quietly picks a different CLI is visible (Tenny, 10-18).
 *
 * The case it exists for: after a restart the service's PATH found an older
 * `codex` first (0.151.0 instead of the user's 0.163.0), and every Codex turn
 * then failed with nothing pointing at the cause. Each detection is compared
 * with the last recorded version per runtime: every change becomes a trace
 * event, and a downgrade is also kept as a notice that `raft-computer status`
 * shows until a later detection is back at (or above) the earlier version.
 *
 * Machine-level, one file for all runners on this Raft home: runtime CLIs are
 * found the same way by every runner of the service.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const RUNTIME_CLI_VERSIONS_FILE = "runtime-cli-versions.json";

export interface RuntimeCliDowngrade {
  from: string;
  to: string;
  at: string;
}

export interface RuntimeCliVersionState {
  schemaVersion: 1;
  versions: Record<string, string>;
  downgrades: Record<string, RuntimeCliDowngrade>;
}

export interface RuntimeCliVersionChange {
  runtime: string;
  from: string;
  to: string;
  direction: "upgrade" | "downgrade" | "changed";
}

export function runtimeCliVersionsPath(slockHome: string): string {
  return path.join(slockHome, "computer", RUNTIME_CLI_VERSIONS_FILE);
}

function emptyState(): RuntimeCliVersionState {
  return { schemaVersion: 1, versions: {}, downgrades: {} };
}

export async function readRuntimeCliVersionState(slockHome: string): Promise<RuntimeCliVersionState> {
  try {
    const parsed = JSON.parse(await readFile(runtimeCliVersionsPath(slockHome), "utf8")) as Partial<RuntimeCliVersionState>;
    if (!parsed || typeof parsed !== "object" || parsed.schemaVersion !== 1) return emptyState();
    return {
      schemaVersion: 1,
      versions: isStringRecord(parsed.versions) ? parsed.versions : {},
      downgrades: parsed.downgrades && typeof parsed.downgrades === "object" ? parsed.downgrades as Record<string, RuntimeCliDowngrade> : {},
    };
  } catch {
    return emptyState();
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(value) && typeof value === "object" && Object.values(value as object).every((v) => typeof v === "string");
}

/** The dotted numbers in a version string such as `codex-cli 0.163.0` or `2.1.301 (Claude Code)`. */
function versionNumbers(version: string): number[] | null {
  const match = /(\d+(?:\.\d+)+)/.exec(version);
  return match ? match[1]!.split(".").map(Number) : null;
}

export function compareRuntimeCliVersions(a: string, b: string): number | null {
  const left = versionNumbers(a);
  const right = versionNumbers(b);
  if (!left || !right) return null;
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Compare a detection with the recorded state. Pure: returns the changes and
 * the next state. A runtime not detected this round keeps its record (it may
 * be a probe that did not finish), and a downgrade notice clears once the
 * detected version is back at or above the version it fell from.
 */
export function observeRuntimeCliVersions(
  state: RuntimeCliVersionState,
  detected: Record<string, string>,
  now: Date,
): { changes: RuntimeCliVersionChange[]; next: RuntimeCliVersionState } {
  const changes: RuntimeCliVersionChange[] = [];
  const versions = { ...state.versions };
  const downgrades = { ...state.downgrades };
  for (const [runtime, to] of Object.entries(detected)) {
    if (!to) continue;
    const from = versions[runtime];
    versions[runtime] = to;
    const notice = downgrades[runtime];
    if (notice && (compareRuntimeCliVersions(to, notice.from) ?? -1) >= 0) delete downgrades[runtime];
    if (!from || from === to) continue;
    const cmp = compareRuntimeCliVersions(to, from);
    const direction = cmp === null ? "changed" : cmp > 0 ? "upgrade" : cmp < 0 ? "downgrade" : "changed";
    changes.push({ runtime, from, to, direction });
    if (direction === "downgrade") {
      // Keep the version it first fell from, so a second step down still points at the good one.
      downgrades[runtime] = { from: notice?.from ?? from, to, at: now.toISOString() };
    }
  }
  return { changes, next: { schemaVersion: 1, versions, downgrades } };
}

export async function writeRuntimeCliVersionState(slockHome: string, state: RuntimeCliVersionState): Promise<void> {
  const file = runtimeCliVersionsPath(slockHome);
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, file);
}
