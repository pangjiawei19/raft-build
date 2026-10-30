/**
 * Typed errors for the worker pool. Callers distinguish backpressure
 * (WorkerPoolBusy → degraded result or 503, caller's choice) from task
 * failure (WorkerTaskTimeout / WorkerCrashed) and circuit-open fail-fast
 * (WorkerCircuitOpen).
 */
export class WorkerPoolError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkerPoolError";
    this.code = code;
  }
}

/** Queue backpressure: the bounded queue was full, or the enqueue wait deadline expired. */
export class WorkerPoolBusy extends WorkerPoolError {
  readonly kind: string;
  readonly reason: "queue_full" | "enqueue_timeout";

  constructor(kind: string, reason: "queue_full" | "enqueue_timeout", message: string) {
    super("worker_pool_busy", message);
    this.name = "WorkerPoolBusy";
    this.kind = kind;
    this.reason = reason;
  }
}

/** Task exceeded its per-kind timeout. The worker that ran it was terminated and never reused. */
export class WorkerTaskTimeout extends WorkerPoolError {
  readonly kind: string;
  readonly timeoutMs: number;

  constructor(kind: string, timeoutMs: number) {
    super("worker_task_timeout", `worker task kind "${kind}" exceeded timeout of ${timeoutMs}ms`);
    this.name = "WorkerTaskTimeout";
    this.kind = kind;
    this.timeoutMs = timeoutMs;
  }
}

/** The worker process died (error event or non-zero exit) while running a task. */
export class WorkerCrashed extends WorkerPoolError {
  constructor(message: string, options?: ErrorOptions) {
    super("worker_crashed", message, options);
    this.name = "WorkerCrashed";
  }
}

/** Per-kind circuit is open (or half-open with a probe already in flight): fail fast, no retries. */
export class WorkerCircuitOpen extends WorkerPoolError {
  readonly kind: string;

  constructor(kind: string) {
    super("worker_circuit_open", `worker pool circuit is open for kind "${kind}"`);
    this.name = "WorkerCircuitOpen";
    this.kind = kind;
  }
}
