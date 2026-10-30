import type { Runtime } from "@botiverse/oar";
import type { RuntimeAccountUsageProvider } from "@botiverse/raft-shared";

/**
 * Loads one OAR runtime on first use, never OAR's root entry: the root loads
 * every runtime OAR supports (~49 MB of heap), while each runtime entry is
 * 1-2.4 MB and loads the ACP SDK only when it actually needs it (opening a
 * session or listing models for an ACP runtime, reading Grok's usage). The
 * daemon uses OAR for account-usage reads and the opencode model listing, so
 * a machine only pays for the runtimes it reads. Import OAR's values only
 * through this module; type imports are free.
 */
type OarRuntimeId = RuntimeAccountUsageProvider | "opencode";

const LOADERS = {
  claude: async () => (await import("@botiverse/oar/runtimes/claude")).claudeRuntime,
  codex: async () => (await import("@botiverse/oar/runtimes/codex")).codexRuntime,
  kimi: async () => (await import("@botiverse/oar/runtimes/kimi")).kimiRuntime,
  grok: async () => (await import("@botiverse/oar/runtimes/grok")).grokRuntime,
  opencode: async () => (await import("@botiverse/oar/runtimes/opencode")).opencodeRuntime,
} as const satisfies Record<OarRuntimeId, () => Promise<Runtime>>;

const loading = new Map<OarRuntimeId, Promise<Runtime>>();

export function loadOarRuntime(id: OarRuntimeId): Promise<Runtime> {
  let runtime = loading.get(id);
  if (!runtime) {
    runtime = LOADERS[id]();
    // A failed load is retried on the next call rather than cached.
    runtime.catch(() => { if (loading.get(id) === runtime) loading.delete(id); });
    loading.set(id, runtime);
  }
  return runtime;
}
