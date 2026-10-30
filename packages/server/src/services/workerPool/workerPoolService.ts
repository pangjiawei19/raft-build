import os from "node:os";
import type { Registry } from "prom-client";
import type { TraceContext } from "@botiverse/raft-shared";
import { register as defaultMetricsRegistry } from "../../metrics";
import { getCurrentTraceContext, withTraceChildSpan } from "../../tracing/semanticTrace";
import {
  WorkerCircuitOpen,
  WorkerCrashed,
  WorkerPoolBusy,
  WorkerPoolError,
  WorkerTaskTimeout,
} from "./errors";
import { createInProcessExecutor } from "./inProcessExecutor";
import { createWorkerPoolMetrics, type WorkerPoolMetrics } from "./metrics";
import { prepareTransferablePayload } from "./transferSlab";
import type { WorkerPoolTaskExecutor } from "./types";
import { createWorkerThreadExecutor } from "./workerExecutor";

export interface WorkerPoolLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface WorkerPoolServiceDeps {
  /**
   * Worker thread count. Default: RAFT_WORKER_POOL_SIZE env, else
   * max(1, min(2, os.cpus().length - 1)). 0 selects the in-process executor.
   */
  poolSize?: number;
  /** Bounded FIFO queue capacity. Default 8× the executor capacity. */
  queueBound?: number;
  /** Backstop per-task timeout. Default 30s; interactive kinds override per kind. */
  defaultTimeoutMs?: number;
  /** Per-kind timeout overrides (e.g. previews get 5–8s, not the 30s backstop). */
  kindTimeoutsMs?: Record<string, number>;
  /** V8 old-generation heap cap per worker. Default 512 MB. */
  maxOldGenerationSizeMb?: number;
  /** Concurrency of the in-process executor (poolSize 0 only). Default 1. */
  inProcessConcurrency?: number;
  /** prom-client registry. Default: the shared server registry from metrics.ts. */
  metricsRegistry?: Registry;
  /** Clock injection, REQUIRED for circuit-breaker tests. Default Date.now. */
  now?: () => number;
  logger?: WorkerPoolLogger;
  /** Executor injection for tests; overrides poolSize-based construction. */
  executor?: WorkerPoolTaskExecutor;
  /** Module imported inside each spawned worker to register consumer kinds. */
  bootstrapModule?: string;
}

export interface WorkerPoolSubmitOptions {
  /** One-off timeout override; beats kindTimeoutsMs and defaultTimeoutMs. */
  timeoutMs?: number;
}

export interface WorkerPoolSettled<T> {
  result: T;
  /** Wall time from enqueue to dispatch. */
  queueWaitMs: number;
  /** Handler run time measured at the execution site (worker or in-process). */
  runMs: number;
}

export interface WorkerPoolService {
  submit<T = unknown>(kind: string, payload: unknown, opts?: WorkerPoolSubmitOptions): Promise<T>;
  /** Same as submit, but resolves with queue/run timings (tests, diagnostics). */
  submitDetailed<T = unknown>(kind: string, payload: unknown, opts?: WorkerPoolSubmitOptions): Promise<WorkerPoolSettled<T>>;
  /** Eagerly spawn one worker (post-ready warmup; not wired into server.ts yet). */
  warmup(): void;
  /** Reject queued tasks, terminate workers. For tests and server shutdown. */
  close(): Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OLD_GENERATION_MB = 512;
const CRASH_THRESHOLD = 3;
const CRASH_WINDOW_MS = 60_000;
const CIRCUIT_COOLDOWN_MS = 60_000;

export function defaultWorkerPoolSize(cpuCount: number = os.cpus().length): number {
  return Math.max(1, Math.min(2, cpuCount - 1));
}

function poolSizeFromEnv(): number {
  const raw = process.env.RAFT_WORKER_POOL_SIZE;
  if (raw !== undefined && raw !== "") {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return defaultWorkerPoolSize();
}

type SpanOutcome = "ok" | "timeout" | "crash" | "busy" | "circuit_open" | "error";

function outcomeOfError(error: unknown): SpanOutcome {
  if (error instanceof WorkerTaskTimeout) return "timeout";
  if (error instanceof WorkerCrashed) return "crash";
  if (error instanceof WorkerPoolBusy) return "busy";
  if (error instanceof WorkerCircuitOpen) return "circuit_open";
  return "error";
}

interface CircuitState {
  /** Timestamps (from the injected clock) of consecutive crashes within the window. */
  crashTimes: number[];
  /** Non-null while the circuit is open: when it opened (injected clock). */
  openedAt: number | null;
  /** Half-open: one probe task is in flight; other submits fail fast. */
  probing: boolean;
}

interface SettledTask {
  result: unknown;
  runMs: number;
  queueWaitMs: number;
}

interface QueuedTask {
  taskId: string;
  kind: string;
  payload: unknown;
  traceContext: TraceContext | null;
  timeoutMs: number;
  enqueuedAt: number;
  isProbe: boolean;
  enqueueTimer: NodeJS.Timeout;
  resolve: (settled: SettledTask) => void;
  reject: (error: unknown) => void;
}

// Default-registry metrics are created once per registry so constructing the
// service twice (tests) does not re-register the same metric names.
const metricsCache = new WeakMap<Registry, WorkerPoolMetrics>();

function resolveMetrics(registry?: Registry): WorkerPoolMetrics {
  const target = registry ?? defaultMetricsRegistry;
  let metrics = metricsCache.get(target);
  if (!metrics) {
    metrics = createWorkerPoolMetrics(target);
    metricsCache.set(target, metrics);
  }
  return metrics;
}

export function createWorkerPoolService(deps: WorkerPoolServiceDeps = {}): WorkerPoolService {
  const now = deps.now ?? Date.now;
  const logger: WorkerPoolLogger = deps.logger ?? {
    warn: (message, meta) => console.warn(`[WorkerPool] ${message}`, meta ?? ""),
  };
  const metrics = resolveMetrics(deps.metricsRegistry);
  const defaultTimeoutMs = deps.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const kindTimeoutsMs = deps.kindTimeoutsMs ?? {};

  const poolSize = deps.poolSize ?? poolSizeFromEnv();
  const executor: WorkerPoolTaskExecutor = deps.executor ?? (poolSize === 0
    ? createInProcessExecutor({ concurrency: deps.inProcessConcurrency })
    : createWorkerThreadExecutor({
      poolSize,
      maxOldGenerationSizeMb: deps.maxOldGenerationSizeMb ?? DEFAULT_MAX_OLD_GENERATION_MB,
      bootstrapModule: deps.bootstrapModule,
      logger,
    }));
  const queueBound = Math.max(1, deps.queueBound ?? 8 * executor.capacity);

  const queue: QueuedTask[] = [];
  const circuits = new Map<string, CircuitState>();
  let activeCount = 0;
  let nextTaskId = 1;
  let closed = false;

  metrics.poolSize.set(executor.capacity);
  metrics.busyWorkers.set(0);
  metrics.queueDepth.set(0);

  // --- Per-kind crash circuit breaker ---------------------------------------
  // >=3 consecutive crashes of one kind within 60s opens that kind's circuit
  // (fail fast, no retries) for a 60s cooldown, then a single half-open probe
  // decides: any non-crash settlement closes it, a crash or probe timeout
  // re-opens it. One kind's circuit never blocks other kinds. All timestamps
  // come from the injected clock so tests avoid real waits.
  function circuitFor(kind: string): CircuitState {
    let circuit = circuits.get(kind);
    if (!circuit) {
      circuit = { crashTimes: [], openedAt: null, probing: false };
      circuits.set(kind, circuit);
    }
    return circuit;
  }

  /** Throws WorkerCircuitOpen when the kind must fail fast; returns true when this submit is the half-open probe. */
  function acquireSubmitPermission(kind: string): boolean {
    const circuit = circuits.get(kind);
    if (!circuit || circuit.openedAt === null) return false;
    if (now() - circuit.openedAt < CIRCUIT_COOLDOWN_MS || circuit.probing) {
      throw new WorkerCircuitOpen(kind);
    }
    circuit.probing = true;
    return true;
  }

  function releaseProbe(kind: string): void {
    const circuit = circuits.get(kind);
    if (circuit) circuit.probing = false;
  }

  function reopenCircuit(kind: string): void {
    const circuit = circuitFor(kind);
    circuit.probing = false;
    circuit.openedAt = now();
    metrics.circuitOpen.inc({ kind });
    logger.warn("worker pool circuit opened for kind", { kind, recentCrashes: circuit.crashTimes.length });
  }

  function onTaskCrash(kind: string, isProbe: boolean): void {
    const circuit = circuitFor(kind);
    circuit.crashTimes.push(now());
    const cutoff = now() - CRASH_WINDOW_MS;
    circuit.crashTimes = circuit.crashTimes.filter((time) => time >= cutoff);
    if (isProbe) {
      // Failed probe: stay open for another cooldown.
      reopenCircuit(kind);
    } else if (circuit.openedAt === null && circuit.crashTimes.length >= CRASH_THRESHOLD) {
      reopenCircuit(kind);
    }
  }

  function onTaskSettledWithoutCrash(kind: string, isProbe: boolean): void {
    const circuit = circuits.get(kind);
    if (!circuit) return;
    circuit.crashTimes = [];
    if (isProbe) {
      circuit.probing = false;
      circuit.openedAt = null;
    }
  }

  // --- Queue / dispatch ------------------------------------------------------

  function pump(): void {
    while (!closed && activeCount < executor.capacity && queue.length > 0) {
      const task = queue.shift()!;
      clearTimeout(task.enqueueTimer);
      activeCount += 1;
      metrics.busyWorkers.set(activeCount);
      metrics.queueDepth.set(queue.length);
      runTask(task);
    }
  }

  function runTask(task: QueuedTask): void {
    const queueWaitMs = now() - task.enqueuedAt;
    let settled = false;

    const finish = (): void => {
      activeCount -= 1;
      metrics.busyWorkers.set(activeCount);
      pump();
    };

    const runTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      executor.abandon(task.taskId);
      metrics.taskTimeouts.inc({ kind: task.kind });
      if (task.isProbe) {
        // A probe that hangs means the pool is still unhealthy: keep the circuit open.
        reopenCircuit(task.kind);
      }
      task.reject(new WorkerTaskTimeout(task.kind, task.timeoutMs));
      finish();
    }, task.timeoutMs);
    // Never let a backstop timer keep the process (or a vitest fork) alive.
    runTimer.unref();

    executor.execute({
      taskId: task.taskId,
      kind: task.kind,
      payload: task.payload,
      prepared: prepareTransferablePayload(task.payload),
      traceContext: task.traceContext,
    }).then(({ result, runMs }) => {
      if (settled) return;
      settled = true;
      clearTimeout(runTimer);
      onTaskSettledWithoutCrash(task.kind, task.isProbe);
      metrics.taskDuration.observe({ kind: task.kind }, runMs / 1000);
      task.resolve({ result, runMs, queueWaitMs });
      finish();
    }, (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(runTimer);
      if (error instanceof WorkerCrashed) {
        onTaskCrash(task.kind, task.isProbe);
        metrics.workerCrashes.inc({ kind: task.kind });
      } else {
        // A handler error means the worker survived: probe succeeded.
        onTaskSettledWithoutCrash(task.kind, task.isProbe);
      }
      task.reject(error);
      finish();
    });
  }

  function enqueue(kind: string, payload: unknown, timeoutMs: number): Promise<SettledTask> {
    const isProbe = acquireSubmitPermission(kind);
    const failFast = (error: WorkerPoolError): never => {
      // A probe that never reached a worker must not wedge the circuit half-open.
      if (isProbe) releaseProbe(kind);
      throw error;
    };
    if (queue.length >= queueBound) {
      metrics.queueRejections.inc({ kind, reason: "queue_full" });
      failFast(new WorkerPoolBusy(kind, "queue_full", `worker pool queue is full (${queueBound} tasks waiting)`));
    }
    return new Promise<SettledTask>((resolve, reject) => {
      const task: QueuedTask = {
        taskId: `wpt-${nextTaskId++}`,
        kind,
        payload,
        traceContext: getCurrentTraceContext(),
        timeoutMs,
        enqueuedAt: now(),
        isProbe,
        enqueueTimer: setTimeout(() => {
          const index = queue.indexOf(task);
          if (index === -1) return;
          queue.splice(index, 1);
          metrics.queueDepth.set(queue.length);
          metrics.queueRejections.inc({ kind, reason: "enqueue_timeout" });
          if (task.isProbe) releaseProbe(kind);
          reject(new WorkerPoolBusy(
            kind,
            "enqueue_timeout",
            `worker task kind "${kind}" waited longer than ${timeoutMs}ms for a slot`,
          ));
        }, timeoutMs),
        resolve,
        reject,
      };
      task.enqueueTimer.unref();
      queue.push(task);
      metrics.queueDepth.set(queue.length);
      pump();
    });
  }

  async function submitDetailed<T>(
    kind: string,
    payload: unknown,
    opts: WorkerPoolSubmitOptions = {},
  ): Promise<WorkerPoolSettled<T>> {
    if (closed) throw new WorkerPoolError("worker_pool_closed", "worker pool is closed");
    const timeoutMs = opts.timeoutMs ?? kindTimeoutsMs[kind] ?? defaultTimeoutMs;
    // One span per task, submit→settle, parented to the ambient request span.
    // The worker never emits spans; its measured run_ms arrives in the result.
    let queueWaitMs = 0;
    let runMs = 0;
    const result = await withTraceChildSpan(
      "server.worker.task",
      { surface: "server", kind: "internal", attrs: { kind } },
      async () => {
        const settled = await enqueue(kind, payload, timeoutMs);
        queueWaitMs = settled.queueWaitMs;
        runMs = settled.runMs;
        return settled.result as T;
      },
      {
        onSuccess: () => ({ outcome: "ok" satisfies SpanOutcome, queue_wait_ms: queueWaitMs, run_ms: runMs }),
        onError: (error) => ({ outcome: outcomeOfError(error), queue_wait_ms: queueWaitMs }),
      },
    );
    return { result, runMs, queueWaitMs };
  }

  async function submit<T>(kind: string, payload: unknown, opts: WorkerPoolSubmitOptions = {}): Promise<T> {
    const settled = await submitDetailed<T>(kind, payload, opts);
    return settled.result;
  }

  function warmup(): void {
    executor.warmup();
  }

  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    for (const task of queue.splice(0)) {
      clearTimeout(task.enqueueTimer);
      task.reject(new WorkerPoolError("worker_pool_closed", "worker pool is closed"));
    }
    metrics.queueDepth.set(0);
    await executor.close();
  }

  return { submit, submitDetailed, warmup, close };
}
