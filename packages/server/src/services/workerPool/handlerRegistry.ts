export type WorkerPoolHandler = (payload: unknown) => unknown | Promise<unknown>;

const handlers = new Map<string, WorkerPoolHandler>();

/**
 * Registry mapping a task kind to its pure handler. Shared by the worker
 * entry (which registers built-in kinds and, via workerData.bootstrapModule,
 * consumer kinds) and by the in-process executor. Handlers live in ordinary
 * modules with normal imports; only the dispatch seam lives in workerEntry.
 *
 * Register returns an unregister function (tests). Registering the same kind
 * twice throws so consumer kind collisions surface at startup, not at
 * dispatch time.
 */
export function registerWorkerPoolHandler(kind: string, handler: WorkerPoolHandler): () => void {
  if (handlers.has(kind)) {
    throw new Error(`worker pool handler already registered for kind "${kind}"`);
  }
  handlers.set(kind, handler);
  return () => {
    if (handlers.get(kind) === handler) handlers.delete(kind);
  };
}

export function getWorkerPoolHandler(kind: string): WorkerPoolHandler | undefined {
  return handlers.get(kind);
}
