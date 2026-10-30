import { WorkerPoolError } from "./errors";
import { getWorkerPoolHandler } from "./handlerRegistry";
import type { WorkerPoolTaskExecutor } from "./types";

export interface InProcessExecutorDeps {
  /** Max concurrent handler invocations. Default 1 (matches the prod default of one worker). */
  concurrency?: number;
}

/**
 * In-process executor (RAFT_WORKER_POOL_SIZE=0, local/test): handlers are
 * called directly in this process — the same code path as the thread pool
 * minus the thread boundary.
 *
 * Timeout semantics differ from the thread executor by necessity: an
 * in-process handler cannot be terminated, so on timeout the core rejects
 * the submit promise and frees the slot while the orphaned handler keeps
 * running to its own settlement (which is ignored). The pool stays usable.
 */
export function createInProcessExecutor(deps: InProcessExecutorDeps = {}): WorkerPoolTaskExecutor {
  const capacity = Math.max(1, Math.floor(deps.concurrency ?? 1));

  return {
    capacity,
    async execute(request) {
      const handler = getWorkerPoolHandler(request.kind);
      if (!handler) {
        throw new WorkerPoolError(
          "unknown_worker_task_kind",
          `no worker pool handler registered for kind "${request.kind}"`,
        );
      }
      const started = Date.now();
      const result = await handler(request.payload);
      return { result, runMs: Date.now() - started };
    },
    abandon() {
      // Cannot cancel an in-process handler; see the docblock above.
    },
    warmup() {
      // Nothing to pre-warm in-process.
    },
    async close() {
      // Nothing to dispose.
    },
  };
}
