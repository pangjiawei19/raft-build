import { readFileSync } from "node:fs";

/**
 * Linux flavours the Server should not lump in with plain `linux`. WSL reports
 * `os.platform() === "linux"`, but its lifecycle is the Windows host's (the
 * distro is shut down when idle, SIGTERMing everything in it), so restart and
 * upgrade telemetry needs to tell it apart.
 */
export type OsVariant = "wsl1" | "wsl2";

/**
 * Classify a kernel release string. WSL2 kernels end in
 * `-microsoft-standard-WSL2` (older builds: `-microsoft-standard`); WSL1
 * reports the Windows build, e.g. `4.4.0-19041-Microsoft`.
 */
export function classifyKernelRelease(release: string): OsVariant | undefined {
  if (/microsoft-standard|wsl2/i.test(release)) return "wsl2";
  if (/microsoft/i.test(release)) return "wsl1";
  return undefined;
}

let cached: { value: OsVariant | undefined } | undefined;

/** The variant of this host, read once; undefined off Linux or when unreadable. */
export function detectOsVariant(
  platform: NodeJS.Platform = process.platform,
  readRelease: () => string = () => readFileSync("/proc/sys/kernel/osrelease", "utf8"),
): OsVariant | undefined {
  if (platform !== "linux") return undefined;
  try {
    return classifyKernelRelease(readRelease());
  } catch {
    return undefined;
  }
}

export function hostOsVariant(): OsVariant | undefined {
  cached ??= { value: detectOsVariant() };
  return cached.value;
}
