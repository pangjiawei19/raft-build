import assert from "node:assert/strict";
import { Registry } from "prom-client";
import { WorkerCrashed, WorkerTaskTimeout } from "./errors";
import { createWorkerPoolService } from "./workerPoolService";

// Real-worker integration test: spawns the actual workerEntry.ts via
// worker_threads. The thread executor builds execArgv as prod does
// (packages/server/entrypoint.sh: `node --import @oxc-node/core/register`),
// prepending that register under vitest, so the worker resolves modules with
// prod's extensionless-import semantics. Uses the built-in
// __echo/__fail/__hang/__crash test kinds plus the __fixture_echo kind
// registered from testFixtureHandlers.ts via workerData.bootstrapModule.
// Kept to one file and small timeouts so it stays <10s.
test("real worker: round trip, slab-guarded transfer, handler error, crash and timeout recovery", { timeout: 30000 }, async () => {
  const service = createWorkerPoolService({
    poolSize: 1,
    metricsRegistry: new Registry(),
    bootstrapModule: new URL("./testFixtureHandlers.ts", import.meta.url).href,
  });
  try {
    service.warmup();

    // Structured-clone round trip, with worker-measured runMs.
    const echo = await service.submitDetailed("__echo", { hello: "world" });
    assert.deepEqual(echo.result, { hello: "world" });
    assert.ok(echo.runMs >= 0);

    // Cross-module handler: registered in the worker from a bootstrap module
    // whose handler imports a helper from yet another module (normal
    // extensionless relative import, exactly like the future xlsx consumer).
    const crossModule = await service.submit("__fixture_echo", { a: 1 });
    assert.deepEqual(crossModule, { echoed: { a: 1 }, transformedBy: "testFixtureHelper.fixtureTransform" });

    // Exact-fit buffer transfers zero-copy: the main-thread buffer is detached.
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const echoedBytes = await service.submit("__echo", bytes);
    assert.ok(Buffer.from(echoedBytes as Uint8Array).equals(Buffer.from([1, 2, 3, 4, 5])));
    assert.equal(bytes.buffer.byteLength, 0, "exact-fit buffer should have been transferred (detached)");

    // Shared-slab buffer: the slab guard slices before transfer, so sibling
    // views in the main thread are NOT corrupted by the transfer.
    const slab = Buffer.allocUnsafe(16);
    for (let i = 0; i < 16; i++) slab[i] = i + 1;
    const head = slab.subarray(0, 8);
    const tail = slab.subarray(8, 16);
    const echoedHead = await service.submit("__echo", head);
    assert.ok(Buffer.from(echoedHead as Uint8Array).equals(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])));
    assert.notEqual(slab.buffer.byteLength, 0, "shared slab must not have been transferred (detached)");
    assert.deepEqual([...tail], [9, 10, 11, 12, 13, 14, 15, 16]);

    // Handler error: rejects with the handler's error; the worker survives.
    await assert.rejects(service.submit("__fail", null), /worker pool test failure/);
    assert.equal(await service.submit("__echo", "still alive"), "still alive");

    // Worker crash (process.exit): in-flight task rejects WorkerCrashed; the
    // next task runs on a lazily spawned replacement worker.
    await assert.rejects(
      service.submit("__crash", null),
      (error: unknown) => error instanceof WorkerCrashed,
    );
    assert.equal(await service.submit("__echo", "revived"), "revived");

    // Worker 'error' (uncaught exception): the slot detaches the dying worker
    // immediately, so a task submitted before its 'exit' event arrives spawns
    // a fresh worker instead of posting into the dying one (which would lose
    // the message and hang until timeout — the 5s bound makes that a fast,
    // deterministic failure instead of a suite timeout).
    await assert.rejects(
      service.submit("__uncaught", null),
      (error: unknown) => error instanceof WorkerCrashed,
    );
    assert.equal(await service.submit("__echo", "after uncaught", { timeoutMs: 5000 }), "after uncaught");

    // Timeout: the hanging worker is terminated and eagerly replaced; the
    // next task succeeds on the replacement.
    await assert.rejects(
      service.submit("__hang", null, { timeoutMs: 1000 }),
      (error: unknown) => error instanceof WorkerTaskTimeout,
    );
    assert.equal(await service.submit("__echo", "after timeout"), "after timeout");
  } finally {
    await service.close();
  }
});
