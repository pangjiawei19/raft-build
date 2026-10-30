import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { shutdownService } from "./lib/serviceShutdown";
import type { RunnerRecord } from "./lib/runnerStateMachine";
import { takeResidentStopIntent, writeResidentStopIntent } from "./residentStopIntent";

test("a stop intent is read once and only by the runner it names", async () => {
  const dir = await mkdtemp(join(tmpdir(), "computer-stop-intent-"));
  const intentPath = join(dir, "runner.stop-intent");
  try {
    assert.equal(takeResidentStopIntent(intentPath, 4242), null, "no intent reads as an external signal");

    writeResidentStopIntent(intentPath, { pid: 4242, source: "service_unmanaged" });
    assert.equal(takeResidentStopIntent(intentPath, 4242), "service_unmanaged");
    assert.equal(existsSync(intentPath), false, "the intent is consumed");
    assert.equal(takeResidentStopIntent(intentPath, 4242), null);

    // An intent left for a previous runner does not explain this one's signal.
    writeResidentStopIntent(intentPath, { pid: 1111, source: "service_shutdown" });
    assert.equal(takeResidentStopIntent(intentPath, 4242), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("service shutdown records its intent before signalling each runner", async () => {
  const order: string[] = [];
  const child = Object.assign(new EventEmitter(), {
    pid: 4242,
    kill: (signal: NodeJS.Signals) => {
      order.push(`kill:${signal}`);
      rec.child = undefined;
      return true;
    },
  }) as unknown as ChildProcess;
  const rec: RunnerRecord = { serverId: "server-1", lifecycle: "running", stopping: false, child };
  await shutdownService({
    runners: new Map([["server-1", rec]]),
    beforeSignal: (r, pid) => order.push(`intent:${r.serverId}:${pid}`),
    closeIpc: () => undefined,
    isProcessAlive: () => false,
    clearServicePidfile: async () => {},
    restartRequested: false,
    sleep: async () => {},
    exit: () => {},
  });
  assert.deepEqual(order, ["intent:server-1:4242", "kill:SIGTERM"]);
});
