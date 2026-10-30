// Importing the kind constant also registers the handler in THIS thread (the
// module is a pure registration module): the in-process executor dispatches
// through the same registry, so local/test runs need it here too.
import { XLSX_PREVIEW_WORKER_KIND } from "../attachmentPreviews/workerBootstrap";
import { createWorkerPoolService, type WorkerPoolService } from "./index";

/** Xlsx previews degrade fast (a user is waiting); the pool's 30s default stays as the backstop for batch kinds. */
const XLSX_PREVIEW_TIMEOUT_MS = 8_000;

let serverWorkerPool: WorkerPoolService | null = null;

/**
 * The server's shared worker pool, created on first use (or by
 * warmupServerWorkerPool after listen). Lazy so importing a route module
 * never spawns workers.
 */
export function getServerWorkerPool(): WorkerPoolService {
  if (!serverWorkerPool) {
    serverWorkerPool = createWorkerPoolService({
      // Tests run the same handlers in-process (no thread spawn+compile in a
      // vitest fork); an explicit RAFT_WORKER_POOL_SIZE always wins.
      poolSize: process.env.NODE_ENV === "test" && !process.env.RAFT_WORKER_POOL_SIZE ? 0 : undefined,
      kindTimeoutsMs: { [XLSX_PREVIEW_WORKER_KIND]: XLSX_PREVIEW_TIMEOUT_MS },
      bootstrapModule: new URL("../attachmentPreviews/workerBootstrap.ts", import.meta.url).href,
    });
  }
  return serverWorkerPool;
}

/**
 * Pre-warm one worker right after the server reports ready so the first
 * preview request does not pay the spawn+compile cost. Fire-and-forget: a
 * failure here must never take startup down.
 */
export function warmupServerWorkerPool(): void {
  getServerWorkerPool().warmup();
}

/** Test seam: swap in a fake or in-process pool; null restores lazy creation. */
export function setServerWorkerPoolForTests(pool: WorkerPoolService | null): void {
  serverWorkerPool = pool;
}
