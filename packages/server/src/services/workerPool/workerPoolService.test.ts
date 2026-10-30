import assert from "node:assert/strict";
import { Registry } from "prom-client";
import {
  WorkerCircuitOpen,
  WorkerCrashed,
  WorkerPoolBusy,
  WorkerTaskTimeout,
} from "./errors";
import type { WorkerPoolTaskExecutor } from "./types";
import { registerWorkerPoolHandler } from "./handlerRegistry";
import { createWorkerPoolService } from "./workerPoolService";

test("in-process executor: submit resolves the handler result with timings", async () => {
  const unregister = registerWorkerPoolHandler("test.double", (payload) => (payload as number) * 2);
  const service = createWorkerPoolService({ poolSize: 0, metricsRegistry: new Registry() });
  try {
    const settled = await service.submitDetailed<number>("test.double", 21);
    assert.equal(settled.result, 42);
    assert.ok(settled.runMs >= 0);
    assert.ok(settled.queueWaitMs >= 0);
  } finally {
    await service.close();
    unregister();
  }
});

test("queue bound: submissions past the bound reject with WorkerPoolBusy", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const unregister = registerWorkerPoolHandler("test.block", () => gate.then(() => "done"));
  const service = createWorkerPoolService({
    poolSize: 0,
    inProcessConcurrency: 1,
    queueBound: 1,
    metricsRegistry: new Registry(),
  });
  try {
    const first = service.submit("test.block", null); // occupies the single slot
    const second = service.submit("test.block", null); // fills the queue (bound 1)
    await assert.rejects(
      service.submit("test.block", null),
      (error: unknown) => error instanceof WorkerPoolBusy && error.reason === "queue_full",
    );
    release();
    assert.equal(await first, "done");
    assert.equal(await second, "done");
  } finally {
    await service.close();
    unregister();
  }
});

test("timeout: a never-resolving in-process handler rejects with WorkerTaskTimeout and the pool stays usable", async () => {
  // In-process handlers cannot be terminated; the timed-out handler keeps
  // running orphaned and its later settlement is ignored. The slot is freed
  // immediately, so the pool serves the next task.
  const unregisterHang = registerWorkerPoolHandler("test.never", () => new Promise(() => {}));
  const unregisterOk = registerWorkerPoolHandler("test.ok", () => "fine");
  const service = createWorkerPoolService({
    poolSize: 0,
    inProcessConcurrency: 1,
    metricsRegistry: new Registry(),
  });
  try {
    await assert.rejects(
      service.submit("test.never", null, { timeoutMs: 50 }),
      (error: unknown) => error instanceof WorkerTaskTimeout && error.kind === "test.never" && error.timeoutMs === 50,
    );
    assert.equal(await service.submit("test.ok", null), "fine");
  } finally {
    await service.close();
    unregisterHang();
    unregisterOk();
  }
});

test("per-kind timeout override beats the default", async () => {
  const unregister = registerWorkerPoolHandler("test.slowkind", () => new Promise(() => {}));
  const service = createWorkerPoolService({
    poolSize: 0,
    kindTimeoutsMs: { "test.slowkind": 40 },
    defaultTimeoutMs: 60_000,
    metricsRegistry: new Registry(),
  });
  try {
    await assert.rejects(
      service.submit("test.slowkind", null),
      (error: unknown) => error instanceof WorkerTaskTimeout && error.timeoutMs === 40,
    );
  } finally {
    await service.close();
    unregister();
  }
});

test("circuit breaker: 3 crashes in 60s open the kind's circuit, half-open probe after cooldown", async () => {
  let fakeNow = 1_000_000;
  let executeCalls = 0;
  let behavior: () => Promise<{ result: unknown; runMs: number }> = () =>
    Promise.reject(new WorkerCrashed("boom"));
  const executor: WorkerPoolTaskExecutor = {
    capacity: 1,
    execute: () => { executeCalls += 1; return behavior(); },
    abandon: () => {},
    warmup: () => {},
    close: async () => {},
  };
  const service = createWorkerPoolService({
    executor,
    now: () => fakeNow,
    metricsRegistry: new Registry(),
  });
  try {
    // Three consecutive crashes within the 60s window open the circuit.
    for (let i = 0; i < 3; i++) {
      await assert.rejects(service.submit("test.crashy", null), (e: unknown) => e instanceof WorkerCrashed);
    }
    assert.equal(executeCalls, 3);

    // Open: fail fast, executor not touched. Other kinds are unaffected.
    await assert.rejects(service.submit("test.crashy", null), (e: unknown) => e instanceof WorkerCircuitOpen);
    assert.equal(executeCalls, 3);
    behavior = () => Promise.resolve({ result: "healthy", runMs: 1 });
    assert.equal(await service.submit("test.other", null), "healthy");
    assert.equal(executeCalls, 4);

    // Before cooldown expires the circuit stays open.
    fakeNow += 30_000;
    behavior = () => Promise.reject(new WorkerCrashed("boom"));
    await assert.rejects(service.submit("test.crashy", null), (e: unknown) => e instanceof WorkerCircuitOpen);
    assert.equal(executeCalls, 4);

    // After cooldown, one half-open probe runs; a crashing probe re-opens.
    fakeNow += 30_001;
    await assert.rejects(service.submit("test.crashy", null), (e: unknown) => e instanceof WorkerCrashed);
    assert.equal(executeCalls, 5);
    await assert.rejects(service.submit("test.crashy", null), (e: unknown) => e instanceof WorkerCircuitOpen);
    assert.equal(executeCalls, 5);

    // Next cooldown, a successful probe closes the circuit and traffic flows.
    fakeNow += 60_001;
    behavior = () => Promise.resolve({ result: "recovered", runMs: 1 });
    assert.equal(await service.submit("test.crashy", null), "recovered");
    assert.equal(await service.submit("test.crashy", null), "recovered");
    assert.equal(executeCalls, 7);
  } finally {
    await service.close();
  }
});

test("crash counter resets on success: isolated crashes never open the circuit", async () => {
  let fakeNow = 5_000;
  let calls = 0;
  const executor: WorkerPoolTaskExecutor = {
    capacity: 1,
    execute: () => {
      calls += 1;
      return calls % 2 === 0
        ? Promise.resolve({ result: "ok", runMs: 1 })
        : Promise.reject(new WorkerCrashed("boom"));
    },
    abandon: () => {},
    warmup: () => {},
    close: async () => {},
  };
  const service = createWorkerPoolService({ executor, now: () => fakeNow, metricsRegistry: new Registry() });
  try {
    for (let i = 0; i < 4; i++) {
      await assert.rejects(service.submit("test.flaky", null), (e: unknown) => e instanceof WorkerCrashed);
      assert.equal(await service.submit("test.flaky", null), "ok");
      fakeNow += 5_000;
    }
    // Alternating crash/success never reaches 3 consecutive crashes.
    assert.equal(calls, 8);
  } finally {
    await service.close();
  }
});
