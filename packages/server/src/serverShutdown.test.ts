import assert from "node:assert/strict";

import { shutdownServerRuntime } from "./serverShutdown";

test("HTTP acceptance stops before machine ownership is released; traces flush after workers settle", async () => {
  const events: string[] = [];
  let finishHttpDrain!: () => void;
  const httpDrain = new Promise<void>((resolve) => {
    finishHttpDrain = resolve;
  });
  let finishWorkers!: () => void;
  const workers = new Promise<void>((resolve) => {
    finishWorkers = resolve;
  });

  const shutdown = shutdownServerRuntime({
    stopAcceptingHttp: () => {
      events.push("http_stop_started");
      return httpDrain;
    },
    releaseMachineOwnership: async () => {
      events.push("owner_release_started");
    },
    settleWorkers: () => {
      events.push("workers_settle_started");
      return workers;
    },
    flushTraces: async () => {
      events.push("trace_flush_started");
    },
    shutdownSharedState: async () => {
      events.push("shared_state_stopped");
    },
    warn: () => {},
  });

  assert.deepEqual(events, [
    "http_stop_started",
    "owner_release_started",
    "workers_settle_started",
  ]);
  finishWorkers();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.at(-1), "trace_flush_started", "a worker's last span is flushed");
  assert.equal(events.includes("shared_state_stopped"), false);

  finishHttpDrain();
  await shutdown;
  assert.equal(events.at(-1), "shared_state_stopped");
});

test("a synchronous HTTP stop failure does not release machine ownership", async () => {
  let ownerReleased = false;
  let sharedStateStopped = false;

  await assert.rejects(
    shutdownServerRuntime({
      stopAcceptingHttp: () => {
        throw new Error("cannot stop acceptance");
      },
      releaseMachineOwnership: async () => {
        ownerReleased = true;
      },
      settleWorkers: async () => {},
      flushTraces: async () => {},
      shutdownSharedState: async () => {
        sharedStateStopped = true;
      },
      warn: () => {},
    }),
    /cannot stop acceptance/,
  );

  assert.equal(ownerReleased, false);
  assert.equal(sharedStateStopped, false);
});
