import assert from "node:assert/strict";
import type { execFileSync, spawnSync } from "node:child_process";

import {
  detectOpenCodeModelSource,
  detectOpenCodeModelSourceAsync,
  runOpenCodeModelsCommand,
  runOpenCodeModelsCommandAsync,
} from "./opencode";
import { ProbeChildError, type runProbeChild } from "./probeChild";

// task #1277, PR 3 — the Windows models listing through probe children. Every
// child is injected, so this file runs the same on every platform, including
// the native Windows contract job.

type Script = (command: string, args: readonly string[]) => { stdout: string } | { status: number } | { code: "ETIMEDOUT" | "ENOENT" };

const RESOLVED_EXE = "C:\\Users\\tester\\AppData\\Local\\opencode\\bin\\opencode.exe";

/** One scripted environment for both twins: PowerShell lookup, --version, models. */
function windowsScript(version: string, listing: Script = () => ({ stdout: "opencode/gpt-5-nano\n" })): Script {
  return (command, args) => {
    if (command === "powershell.exe") return { stdout: `${RESOLVED_EXE}\r\n` };
    if (args.includes("--version")) return { stdout: `${version}\n` };
    if (args[0] === "models") return listing(command, args);
    throw new Error(`unexpected child ${command} ${args.join(" ")}`);
  };
}

function asSync(script: Script, calls?: Array<{ command: string; args: string[]; shell?: unknown }>): { execFileSyncFn: typeof execFileSync; spawnSyncFn: typeof spawnSync } {
  const play = (command: string, args: readonly string[]) => {
    const out = script(command, args);
    if ("stdout" in out) return out.stdout;
    if ("status" in out) throw Object.assign(new Error(`${command} exited`), { status: out.status });
    throw Object.assign(new Error(`${command} failed`), { code: out.code });
  };
  return {
    execFileSyncFn: ((command: string, args: readonly string[]) => Buffer.from(play(command, args))) as unknown as typeof execFileSync,
    spawnSyncFn: ((command: string, args: readonly string[], options?: { shell?: unknown }) => {
      calls?.push({ command, args: [...args], shell: options?.shell });
      const out = script(command, args);
      if ("stdout" in out) return { status: 0, stdout: out.stdout, stderr: "", pid: 1, output: [], signal: null };
      if ("status" in out) return { status: out.status, stdout: "", stderr: "", pid: 1, output: [], signal: null };
      return { status: null, stdout: "", stderr: "", pid: 1, output: [], signal: null, error: Object.assign(new Error(`${command} failed`), { code: out.code }) };
    }) as unknown as typeof spawnSync,
  };
}

function asAsync(script: Script, calls?: Array<{ command: string; args: string[]; shell?: unknown }>): typeof runProbeChild {
  return async (command, args, options) => {
    if (args[0] === "models") calls?.push({ command, args: [...args], shell: options.shell });
    const out = script(command, args);
    if ("stdout" in out) return { stdout: out.stdout, stderr: "" };
    if ("status" in out) throw new ProbeChildError(`${command} exited`, { status: out.status });
    throw new ProbeChildError(`${command} failed`, { code: out.code });
  };
}

const winDeps = { platform: "win32" as const, windowsEnvironmentReaderFn: () => ({}) };

test("task #1277: the async Windows models command resolves the same executable, args and result as the synchronous one (1.x and 2.x)", async () => {
  for (const [version, expectedArgs] of [["1.18.35", ["models"]], ["2.0.27", ["models", "--standalone"]], ["2.0.26", ["models"]]] as const) {
    const script = windowsScript(version);
    const syncCalls: Array<{ command: string; args: string[]; shell?: unknown }> = [];
    const asyncCalls: Array<{ command: string; args: string[]; shell?: unknown }> = [];
    const viaSync = runOpenCodeModelsCommand("/tmp/opencode-home", { ...winDeps, ...asSync(script, syncCalls) });
    const viaAsync = await runOpenCodeModelsCommandAsync("/tmp/opencode-home", { ...winDeps, runProbeChildFn: asAsync(script, asyncCalls) });
    assert.deepEqual({ status: viaAsync.status, stdout: viaAsync.stdout }, { status: viaSync.status, stdout: viaSync.stdout }, version);
    assert.deepEqual(asyncCalls, syncCalls, `${version}: same listing child`);
    assert.deepEqual(asyncCalls, [{ command: RESOLVED_EXE, args: [...expectedArgs], shell: false }]);
  }
});

test("task #1277: listing failures map alike — non-zero exit keeps its status, a timeout or spawn failure carries an error", async () => {
  for (const [label, failure] of [
    ["exit 1", { status: 1 }],
    ["timeout", { code: "ETIMEDOUT" }],
    ["spawn failure", { code: "ENOENT" }],
  ] as const) {
    const script = windowsScript("1.18.35", () => failure);
    const viaSync = runOpenCodeModelsCommand("/tmp/opencode-home", { ...winDeps, ...asSync(script) });
    const viaAsync = await runOpenCodeModelsCommandAsync("/tmp/opencode-home", { ...winDeps, runProbeChildFn: asAsync(script) });
    assert.equal(viaAsync.status, viaSync.status, label);
    assert.equal(Boolean(viaAsync.error), Boolean(viaSync.error), label);
    // And the detection outcome is the same closed value on both paths.
    assert.deepEqual(
      await detectOpenCodeModelSourceAsync("/tmp/opencode-home", async () => viaAsync),
      detectOpenCodeModelSource("/tmp/opencode-home", () => viaSync),
      label,
    );
  }
});

test("task #1277: detectOpenCodeModelSourceAsync keeps command failure, empty success and a live listing distinct, like the synchronous detection", async () => {
  assert.deepEqual(await detectOpenCodeModelSourceAsync("/tmp/h", async () => ({ status: 1, stdout: "", error: new Error("failed") })), { kind: "error", retryable: true });
  assert.deepEqual(await detectOpenCodeModelSourceAsync("/tmp/h", async () => ({ status: 0, stdout: "" })), { kind: "no_models" });
  const live = await detectOpenCodeModelSourceAsync("/tmp/h", async () => ({ status: 0, stdout: "opencode/gpt-5-nano\n" }));
  assert.equal(live.kind, "live");
  assert.deepEqual(live, detectOpenCodeModelSource("/tmp/h", () => ({ status: 0, stdout: "opencode/gpt-5-nano\n" })));
});

test("task #1277: a Windows resolution failure is returned as the command's error on both paths, never thrown", async () => {
  // No executable resolves: PowerShell finds nothing and no package entry exists.
  const script: Script = (command, args) => {
    if (command === "powershell.exe") return { status: 3 };
    throw new Error(`unexpected child ${command} ${args.join(" ")}`);
  };
  const viaSync = runOpenCodeModelsCommand("/tmp/opencode-home", { ...winDeps, existsSyncFn: () => false, ...asSync(script) });
  const viaAsync = await runOpenCodeModelsCommandAsync("/tmp/opencode-home", { ...winDeps, existsSyncFn: () => false, runProbeChildFn: asAsync(script) });
  assert.equal(viaSync.status, null);
  assert.equal(viaAsync.status, null);
  assert.match(String(viaSync.error?.message), /Cannot resolve OpenCode CLI entry point on Windows/);
  assert.equal(viaAsync.error?.message, viaSync.error?.message);
});

test("task #1277 (cancel): a pre-aborted signal rejects the async models command with the abort, not a result", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runOpenCodeModelsCommandAsync("/tmp/opencode-home", { ...winDeps, signal: controller.signal, runProbeChildFn: async () => { throw new ProbeChildError("aborted", { code: "ABORT_ERR" }); } }),
    (error: unknown) => error instanceof ProbeChildError && error.code === "ABORT_ERR",
  );
});

test("task #1277 (cancel): an abort during the listing child rejects with the abort and its cleanup, never a mapped failure", async () => {
  const controller = new AbortController();
  const script = windowsScript("1.18.35");
  const runChild: typeof runProbeChild = async (command, args, options) => {
    if (args[0] === "models") {
      controller.abort();
      throw new ProbeChildError("listing aborted", { code: "ABORT_ERR", cleanup: { childExited: true, waitedMs: 3 } });
    }
    return asAsync(script)(command, args, options);
  };
  await assert.rejects(
    runOpenCodeModelsCommandAsync("/tmp/opencode-home", { ...winDeps, signal: controller.signal, runProbeChildFn: runChild }),
    (error: unknown) => error instanceof ProbeChildError && error.code === "ABORT_ERR" && error.cleanup?.childExited === true,
  );
  // The detection wrapper lets the abort through unchanged.
  await assert.rejects(
    detectOpenCodeModelSourceAsync("/tmp/opencode-home", () => runOpenCodeModelsCommandAsync("/tmp/opencode-home", { ...winDeps, signal: controller.signal, runProbeChildFn: runChild })),
    (error: unknown) => error instanceof ProbeChildError && error.code === "ABORT_ERR",
  );
});

test("task #1277: the async listing passes the 5 s budget, the models environment and no shell to the child", async () => {
  const seen: Array<{ timeoutMs: number; shell?: boolean; home?: string; noColor?: string }> = [];
  const script = windowsScript("1.18.35");
  const runChild: typeof runProbeChild = async (command, args, options) => {
    if (args[0] === "models") seen.push({ timeoutMs: options.timeoutMs, shell: options.shell, home: options.env?.HOME, noColor: options.env?.NO_COLOR });
    return asAsync(script)(command, args, options);
  };
  await runOpenCodeModelsCommandAsync("/tmp/opencode-home", { ...winDeps, runProbeChildFn: runChild });
  assert.deepEqual(seen, [{ timeoutMs: 5000, shell: false, home: "/tmp/opencode-home", noColor: "1" }]);
});
