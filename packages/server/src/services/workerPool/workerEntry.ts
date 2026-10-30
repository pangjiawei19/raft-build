/**
 * Worker-thread entry point for the worker pool. Dispatches tasks by kind to
 * handlers from the registry; it contains no handler logic itself.
 *
 * Module resolution: spawned workers always run under the same TypeScript
 * loader as the server process — prod starts as
 * `node --import @oxc-node/core/register` (packages/server/entrypoint.sh) and
 * the thread executor prepends that register when process.execArgv has no
 * loader (vitest) — so this file and everything it loads use the repo's
 * normal extensionless relative imports.
 *
 * Importing this module in the main thread is safe: the parentPort wiring is
 * guarded by `isMainThread`.
 */
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import type { TraceContext } from "@botiverse/raft-shared";
import { getWorkerPoolHandler, registerWorkerPoolHandler } from "./handlerRegistry";

export interface WorkerTaskMessage {
  taskId: string;
  kind: string;
  /** ArrayBuffer when payloadKind is "buffer"; otherwise a structured-cloned value. */
  payload: unknown;
  payloadKind: "buffer" | "value";
  traceContext: TraceContext | null;
}

export interface WorkerResultMessage {
  taskId: string;
  ok: boolean;
  result?: unknown;
  error?: { name: string; message: string };
  runMs: number;
}

// Built-in kinds used only by the pool's own colocated tests. Prefixed with
// `__` so they can never collide with a consumer kind. `__crash` kills the
// worker process so the real-worker integration test can exercise the
// crash/replacement path.
registerWorkerPoolHandler("__echo", (payload) => payload);
registerWorkerPoolHandler("__fail", () => {
  throw new Error("worker pool test failure");
});
registerWorkerPoolHandler("__hang", () => new Promise(() => {}));
registerWorkerPoolHandler("__crash", () => process.exit(1));
// Kills the worker via an UNCAUGHT exception (worker 'error' event), not a
// clean process.exit: exercises the error-path slot detachment.
registerWorkerPoolHandler("__uncaught", () => {
  setTimeout(() => {
    throw new Error("worker pool uncaught test error");
  }, 0);
  return new Promise(() => {});
});

async function runWorkerTask(message: WorkerTaskMessage): Promise<WorkerResultMessage> {
  const handler = getWorkerPoolHandler(message.kind);
  if (!handler) {
    return {
      taskId: message.taskId,
      ok: false,
      error: { name: "WorkerPoolUnknownKind", message: `no worker pool handler registered for kind "${message.kind}"` },
      runMs: 0,
    };
  }
  const payload = message.payloadKind === "buffer"
    ? Buffer.from(message.payload as ArrayBuffer)
    : message.payload;
  const started = performance.now();
  try {
    const result = await handler(payload);
    return { taskId: message.taskId, ok: true, result, runMs: performance.now() - started };
  } catch (error) {
    return {
      taskId: message.taskId,
      ok: false,
      error: {
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
      },
      runMs: performance.now() - started,
    };
  }
}

if (!isMainThread && parentPort) {
  const port = parentPort;
  // Extension point for consumer kinds (e.g. attachment previews): a module
  // (absolute path or file URL) whose side effect is registering handlers in
  // THIS worker process. worker_threads buffers messages posted before the
  // listener attaches, so an async bootstrap loses no tasks.
  const bootstrapModule = (workerData as { bootstrapModule?: string } | null)?.bootstrapModule;
  const ready = bootstrapModule ? import(bootstrapModule) : Promise.resolve();
  ready.then(() => {
    port.on("message", (message: WorkerTaskMessage) => {
      void runWorkerTask(message).then((result) => port.postMessage(result));
    });
  }, (error) => {
    console.error("[WorkerPool] worker bootstrap failed:", error);
    process.exit(1);
  });
}
