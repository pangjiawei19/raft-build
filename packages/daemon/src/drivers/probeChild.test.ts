import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChildProcess, spawn } from "node:child_process";

import { killProbeTreeAndSettle, ProbeChildError, runProbeChild } from "./probeChild";

const node = process.execPath;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(predicate: () => boolean, label: string, timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("task #1277: a child that exits 0 resolves with its stdout, like execFileSync", async () => {
  const result = await runProbeChild(node, ["-e", "process.stdout.write('v1.2.3\\n')"], { timeoutMs: 5000 });
  assert.equal(result.stdout, "v1.2.3\n");
});

test("task #1277: a non-zero exit rejects with `status`, so the lookup classifiers see the locator's own verdict", async () => {
  await assert.rejects(
    runProbeChild(node, ["-e", "process.exit(3)"], { timeoutMs: 5000 }),
    (error: unknown) => error instanceof ProbeChildError && error.status === 3 && error.code === undefined,
  );
});

test("task #1277: a spawn failure rejects with the spawn error's `code`", async () => {
  await assert.rejects(
    runProbeChild(path.join(os.tmpdir(), "definitely-missing-probe-binary"), [], { timeoutMs: 5000 }),
    (error: unknown) => error instanceof ProbeChildError && error.code === "ENOENT" && error.status === undefined,
  );
});

test("task #1277: the output cap kills the child and rejects with ENOBUFS", async () => {
  await assert.rejects(
    runProbeChild(node, ["-e", "setInterval(() => process.stdout.write('x'.repeat(4096)), 1)"], { timeoutMs: 5000, maxBufferBytes: 16_384 }),
    (error: unknown) => error instanceof ProbeChildError && error.code === "ENOBUFS" && error.cleanup?.childExited === true,
  );
});

test("task #1277: a timeout kills the child AND its grandchild, and reports the observed cleanup apart from the timeout", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "probe-child-tree-"));
  const pidFile = path.join(root, "grandchild.pid");
  const script = path.join(root, "parent.js");
  // The parent spawns a grandchild that would outlive it, then idles: the kind
  // of tree `npm root -g` or a PowerShell host leaves behind.
  writeFileSync(script, `
    const { spawn } = require("node:child_process");
    const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(grandchild.pid));
    setInterval(() => {}, 1000);
  `);
  try {
    const startedAt = Date.now();
    const error = await runProbeChild(node, [script], { timeoutMs: 400, cleanupVerifyMs: 5000 }).then(
      () => null,
      (caught: unknown) => caught,
    );
    assert.ok(error instanceof ProbeChildError, "the probe must reject");
    assert.equal(error.code, "ETIMEDOUT");
    assert.ok(Date.now() - startedAt >= 400, "the budget elapsed before the kill");
    assert.ok(error.cleanup, "a killed tree reports its cleanup");
    assert.equal(error.cleanup.childExited, true, "the child's close was observed");
    assert.ok(error.cleanup.waitedMs < 5000, "an observed exit carries the measured wait, not the window");
    const grandchildPid = Number((await import("node:fs")).readFileSync(pidFile, "utf8"));
    await waitUntil(() => !isAlive(grandchildPid), "grandchild to be gone");
    assert.equal(isAlive(grandchildPid), false, "the grandchild was killed with the tree");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("task #1277: an abort signal kills the child and rejects with ABORT_ERR", async () => {
  const controller = new AbortController();
  const pending = runProbeChild(node, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 10_000, signal: controller.signal });
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(pending, (error: unknown) => error instanceof ProbeChildError && error.code === "ABORT_ERR" && error.cleanup?.childExited === true);
});

test("task #1277: a kill whose tree never closes reports childExited=false with the configured window, never a measured time", async () => {
  // A stub child that ignores the kill: no `close` ever arrives.
  const fake = Object.assign(new EventEmitter(), {
    pid: undefined,
    stdout: null,
    stderr: null,
    kill: () => true,
  }) as unknown as ChildProcess;
  const spawnFn = (() => fake) as unknown as typeof spawn;
  const error = await runProbeChild("stub", [], { timeoutMs: 20, cleanupVerifyMs: 300, spawnFn }).then(
    () => null,
    (caught: unknown) => caught,
  );
  assert.ok(error instanceof ProbeChildError);
  assert.equal(error.code, "ETIMEDOUT");
  assert.deepEqual(error.cleanup, { childExited: false, waitedMs: 300 });
});

test("task #1277 (review): the output cap counts bytes, so multi-byte output cannot exceed it while staying under it in characters", async () => {
  // 3 000 characters of "é" are 3 000 chars but 6 000 bytes: a character count
  // would pass a 4 096-byte cap, a byte count must not.
  await assert.rejects(
    runProbeChild(node, ["-e", "process.stdout.write('\\u00e9'.repeat(3000))"], { timeoutMs: 5000, maxBufferBytes: 4096 }),
    (error: unknown) => error instanceof ProbeChildError && error.code === "ENOBUFS",
  );
  // The same character count in ASCII is under the cap and succeeds.
  const ok = await runProbeChild(node, ["-e", "process.stdout.write('e'.repeat(3000))"], { timeoutMs: 5000, maxBufferBytes: 4096 });
  assert.equal(ok.stdout.length, 3000);
});

test("reviewer counterexample (Huaihuai, #9791): maxBufferBytes counts UTF8 bytes, as the sync probe does", async () => {
  await assert.rejects(runProbeChild(process.execPath, ["-e", "process.stdout.write('界'.repeat(500))"], {
    timeoutMs: 5000, maxBufferBytes: 1000,
  }), (e: unknown) => e instanceof ProbeChildError && e.code === "ENOBUFS");
});

test("task #1277 (review): output written after settlement is not retained", async () => {
  // A stub child whose stdout keeps emitting after the runner settled on a timeout
  // with an unconfirmed cleanup: the retained text must not grow.
  const { PassThrough } = await import("node:stream");
  const out = new PassThrough();
  const fake = Object.assign(new EventEmitter(), { pid: undefined, stdout: out, stderr: null, kill: () => true }) as unknown as ChildProcess;
  const spawnFn = (() => fake) as unknown as typeof spawn;
  out.write("before");
  const error = await runProbeChild("stub", [], { timeoutMs: 20, cleanupVerifyMs: 50, spawnFn }).then(() => null, (caught: unknown) => caught);
  assert.ok(error instanceof ProbeChildError);
  assert.equal(error.cleanup?.childExited, false);
  assert.equal(error.stdout, "before");
  out.write("x".repeat(4096));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(error.stdout, "before", "late output is dropped, not accumulated");
});

test("task #1277 (review): killProbeTreeAndSettle ends a child and its grandchild and reports the observed exit", async () => {
  const { spawn: realSpawn } = await import("node:child_process");
  const root = mkdtempSync(path.join(os.tmpdir(), "probe-kill-settle-"));
  const pidFile = path.join(root, "grandchild.pid");
  const script = path.join(root, "parent.js");
  writeFileSync(script, `
    const { spawn } = require("node:child_process");
    const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(grandchild.pid));
    setInterval(() => {}, 1000);
  `);
  try {
    const child = realSpawn(node, [script], { stdio: ["ignore", "pipe", "ignore"], detached: process.platform !== "win32" });
    await waitUntil(() => { try { return (require("node:fs") as typeof import("node:fs")).existsSync(pidFile); } catch { return false; } }, "grandchild pid file");
    const cleanup = await killProbeTreeAndSettle(child, { cleanupVerifyMs: 5000 });
    assert.equal(cleanup.childExited, true);
    assert.ok(cleanup.waitedMs < 5000);
    const grandchildPid = Number((await import("node:fs")).readFileSync(pidFile, "utf8"));
    await waitUntil(() => !isAlive(grandchildPid), "grandchild to be gone");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
