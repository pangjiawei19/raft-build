import { Counter, Gauge, Histogram, type Registry } from "prom-client";

/**
 * Worker pool metrics, created against an injected prom-client registry
 * (the shared server registry in prod, a fresh `new Registry()` in tests).
 * Naming follows packages/server/src/metrics.ts conventions. All label sets
 * are closed: `reason` is queue_full|enqueue_timeout.
 */
export function createWorkerPoolMetrics(registry: Registry) {
  const poolSize = new Gauge({
    name: "slock_worker_pool_size",
    help: "Worker pool execution slots (worker threads, or in-process concurrency)",
    registers: [registry],
  });

  const busyWorkers = new Gauge({
    name: "slock_worker_pool_busy_workers",
    help: "Worker pool slots currently running a task",
    registers: [registry],
  });

  const queueDepth = new Gauge({
    name: "slock_worker_pool_queue_depth",
    help: "Tasks currently waiting in the bounded worker pool queue",
    registers: [registry],
  });

  const taskDuration = new Histogram({
    name: "slock_worker_pool_task_duration_seconds",
    help: "Worker pool task run duration by kind (successful tasks only)",
    labelNames: ["kind"] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [registry],
  });

  const taskTimeouts = new Counter({
    name: "slock_worker_pool_task_timeouts_total",
    help: "Worker pool tasks that hit their per-kind timeout, by kind",
    labelNames: ["kind"] as const,
    registers: [registry],
  });

  const workerCrashes = new Counter({
    name: "slock_worker_pool_worker_crashes_total",
    help: "Worker deaths (error event or unexpected exit) with a task in flight, by kind",
    labelNames: ["kind"] as const,
    registers: [registry],
  });

  const circuitOpen = new Counter({
    name: "slock_worker_pool_circuit_open_total",
    help: "Times the per-kind crash circuit opened, by kind",
    labelNames: ["kind"] as const,
    registers: [registry],
  });

  const queueRejections = new Counter({
    name: "slock_worker_pool_queue_rejections_total",
    help: "Submissions rejected by queue backpressure, by kind and closed reason",
    labelNames: ["kind", "reason"] as const, // queue_full, enqueue_timeout
    registers: [registry],
  });

  return {
    poolSize,
    busyWorkers,
    queueDepth,
    taskDuration,
    taskTimeouts,
    workerCrashes,
    circuitOpen,
    queueRejections,
  };
}

export type WorkerPoolMetrics = ReturnType<typeof createWorkerPoolMetrics>;
