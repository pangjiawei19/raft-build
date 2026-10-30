import type { TraceContext } from "@botiverse/raft-shared";
import type { PreparedTransferPayload } from "./transferSlab";

export interface WorkerPoolTaskRequest {
  taskId: string;
  kind: string;
  /** The caller's original payload (used by the in-process executor). */
  payload: unknown;
  /** Slab-guarded transfer form (used by the thread executor). */
  prepared: PreparedTransferPayload;
  traceContext: TraceContext | null;
}

export interface WorkerPoolTaskResult {
  result: unknown;
  runMs: number;
}

/**
 * Execution backend for the pool. The core (queue, timeouts, circuit
 * breaker, tracing, metrics) is executor-agnostic; the executor owns how a
 * task actually runs (worker thread slots, or direct in-process calls).
 *
 * Concurrency contract: the core never runs more than `capacity` execute()
 * calls concurrently.
 */
export interface WorkerPoolTaskExecutor {
  readonly capacity: number;
  /**
   * Run one task. Rejects with WorkerCrashed when the underlying worker died
   * (only the thread executor can do this), with the handler's error when the
   * task itself failed.
   */
  execute(request: WorkerPoolTaskRequest): Promise<WorkerPoolTaskResult>;
  /**
   * A task hit its timeout: discard the execution slot behind it. The thread
   * executor terminates the worker (a timed-out worker is never reused) and
   * eagerly spawns a replacement. The in-process executor cannot cancel a
   * running handler: this is a no-op, the orphaned handler keeps running and
   * its eventual settlement is ignored by the core.
   */
  abandon(taskId: string): void;
  /** Eagerly spawn one worker so the first real task skips the spawn+compile cost. */
  warmup(): void;
  close(): Promise<void>;
}
