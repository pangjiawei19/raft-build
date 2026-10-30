import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { execFileSync } from "node:child_process";

import {
  lookupCommandOnPath,
  lookupCommandOnPathAsync,
  POSIX_WHICH_TIMEOUT_MS,
  readCommandVersionAsync,
  WINDOWS_COMMAND_RESOLVE_TIMEOUT_MS,
  type CommandLookup,
  type ProbeDeps,
} from "./probe";
import { ProbeChildError, runProbeChild } from "./probeChild";

type RunChild = typeof runProbeChild;
type ExecSync = typeof execFileSync;

/** One scripted child outcome, playable through either twin. */
type Scripted =
  | { stdout: string }
  | { status: number }
  | { code: "ETIMEDOUT" | "ENOENT" | "EACCES" };

function asyncRunner(script: Scripted): RunChild {
  return async (command) => {
    if ("stdout" in script) return { stdout: script.stdout, stderr: "" };
    if ("status" in script) throw new ProbeChildError(`${command} exited`, { status: script.status });
    throw new ProbeChildError(`${command} failed`, {
      code: script.code,
      ...(script.code === "ETIMEDOUT" ? { cleanup: { childExited: true, waitedMs: 12 } } : {}),
    });
  };
}

function syncRunner(script: Scripted): ExecSync {
  return ((command: string) => {
    if ("stdout" in script) return script.stdout;
    if ("status" in script) throw Object.assign(new Error(`${command} exited`), { status: script.status });
    throw Object.assign(new Error(`${command} failed`), { code: script.code });
  }) as unknown as ExecSync;
}

function verdict(lookup: CommandLookup): Pick<CommandLookup, "command" | "missReason"> {
  return { command: lookup.command, ...(lookup.missReason ? { missReason: lookup.missReason } : {}) };
}

const posixDeps: ProbeDeps = { platform: "linux", homeDir: "/nonexistent-home", existsSyncFn: () => false };
const windowsDeps: ProbeDeps = {
  platform: "win32",
  env: { PATH: "C:\\Windows\\System32" },
  windowsEnvironmentReaderFn: () => null,
  existsSyncFn: () => false,
};

test("task #1277: the async and sync lookups give the same verdict for every scripted locator outcome (POSIX and Windows)", async () => {
  const cases: Array<[string, Scripted]> = [
    ["found", { stdout: "/usr/local/bin/grok\n" }],
    ["empty output", { stdout: "\n" }],
    ["not found exit", { status: 1 }],
    ["locator error exit", { status: 2 }],
    ["timeout", { code: "ETIMEDOUT" }],
    ["locator missing", { code: "ENOENT" }],
    ["denied", { code: "EACCES" }],
  ];
  for (const [label, script] of cases) {
    const viaSync = verdict(lookupCommandOnPath("grok", { ...posixDeps, execFileSyncFn: syncRunner(script) }));
    const viaAsync = verdict(await lookupCommandOnPathAsync("grok", { ...posixDeps, runProbeChildFn: asyncRunner(script) }));
    assert.deepEqual(viaAsync, viaSync, `posix ${label}`);
  }
  const windowsCases: Array<[string, Scripted]> = [
    ["found", { stdout: "C:\\tools\\grok.exe\r\n" }],
    ["empty output", { stdout: "" }],
    ["not found exit", { status: 3 }],
    ["script error exit", { status: 1 }],
    ["timeout", { code: "ETIMEDOUT" }],
  ];
  for (const [label, script] of windowsCases) {
    const viaSync = verdict(lookupCommandOnPath("grok", { ...windowsDeps, execFileSyncFn: syncRunner(script) }));
    const viaAsync = verdict(await lookupCommandOnPathAsync("grok", { ...windowsDeps, runProbeChildFn: asyncRunner(script) }));
    assert.deepEqual(viaAsync, viaSync, `windows ${label}`);
  }
});

test("task #1277: a POSIX `which` that exceeds its new budget is probe_timeout with its timing, never not_installed", async () => {
  const lookup = await lookupCommandOnPathAsync("grok", { ...posixDeps, runProbeChildFn: asyncRunner({ code: "ETIMEDOUT" }) });
  assert.equal(lookup.command, null);
  assert.equal(lookup.missReason, "probe_timeout");
  assert.deepEqual(lookup.timing, [
    { phase: "posix_which", ms: lookup.timing![0]!.ms, budgetMs: POSIX_WHICH_TIMEOUT_MS, outcome: "timeout", truncated: true, cleanup: { childExited: true, waitedMs: 12 } },
  ]);
});

test("task #1277: the async POSIX lookup passes its budget to the child and keeps the user-local bin fallback", async () => {
  const seen: Array<{ command: string; timeoutMs: number }> = [];
  const runChild: RunChild = async (command, _args, options) => {
    seen.push({ command, timeoutMs: options.timeoutMs });
    throw new ProbeChildError("which exited 1", { status: 1 });
  };
  const home = mkdtempSync(path.join(os.tmpdir(), "probe-async-home-"));
  try {
    const localBin = path.join(home, ".local", "bin");
    mkdirSync(localBin, { recursive: true });
    writeFileSync(path.join(localBin, "grok"), "#!/bin/sh\n");
    const lookup = await lookupCommandOnPathAsync("grok", { platform: "linux", homeDir: home, runProbeChildFn: runChild });
    assert.equal(lookup.command, path.posix.join(home, ".local", "bin", "grok"));
    assert.deepEqual(seen, [{ command: "which", timeoutMs: POSIX_WHICH_TIMEOUT_MS }]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("task #1277: the async Windows lookup runs the environment read and Get-Command as probe children with their budgets", async () => {
  const children: Array<{ command: string; firstArgs: string; timeoutMs: number }> = [];
  const runChild: RunChild = async (command, args, options) => {
    children.push({ command, firstArgs: String(args[0]), timeoutMs: options.timeoutMs });
    if (args.includes("-Command") && String(args[3]).includes("GetEnvironmentVariables")) {
      return { stdout: JSON.stringify({ Machine: { Path: "C:\\machine\\bin" }, User: { Path: "C:\\user\\bin" } }), stderr: "" };
    }
    return { stdout: "C:\\user\\bin\\grok.cmd\r\n", stderr: "" };
  };
  const lookup = await lookupCommandOnPathAsync("grok", {
    platform: "win32",
    env: { PATH: "C:\\Windows\\System32" },
    existsSyncFn: () => false,
    runProbeChildFn: runChild,
  });
  assert.equal(lookup.command, "C:\\user\\bin\\grok.cmd");
  assert.deepEqual(children.map((c) => [c.command, c.timeoutMs]), [
    ["powershell.exe", WINDOWS_COMMAND_RESOLVE_TIMEOUT_MS],
    ["powershell.exe", WINDOWS_COMMAND_RESOLVE_TIMEOUT_MS],
  ]);
  assert.deepEqual(lookup.timing?.map((t) => [t.phase, t.outcome]), [["windows_environment", "ok"], ["windows_get_command", "ok"]]);
});

test("task #1277: a Windows environment read that times out is recorded as a truncated timeout and the lookup still runs", async () => {
  const runChild: RunChild = async (_command, args) => {
    if (String(args[3]).includes("GetEnvironmentVariables")) {
      throw new ProbeChildError("env read", { code: "ETIMEDOUT", cleanup: { childExited: false, waitedMs: 5000 } });
    }
    throw new ProbeChildError("not found", { status: 3 });
  };
  const lookup = await lookupCommandOnPathAsync("grok", { platform: "win32", env: {}, existsSyncFn: () => false, warn: () => {}, runProbeChildFn: runChild });
  assert.deepEqual(verdict(lookup), { command: null, missReason: "not_installed" });
  assert.deepEqual(lookup.timing?.map((t) => [t.phase, t.outcome, t.truncated]), [["windows_environment", "timeout", true], ["windows_get_command", "exit", false]]);
});

test("task #1277: the async lookup resolves a real binary through the real `which` and does not block the event loop meanwhile", async () => {
  if (process.platform === "win32") return;
  const root = mkdtempSync(path.join(os.tmpdir(), "probe-async-real-"));
  try {
    const binDir = path.join(root, "bin");
    mkdirSync(binDir);
    // A `which` that answers slowly stands in for a cold PATH scan.
    const slowWhich = path.join(binDir, "which");
    writeFileSync(slowWhich, `#!/bin/sh\nsleep 0.4\necho ${binDir}/grok\n`);
    chmodSync(slowWhich, 0o755);
    writeFileSync(path.join(binDir, "grok"), "#!/bin/sh\n");
    chmodSync(path.join(binDir, "grok"), 0o755);
    let ticks = 0;
    const ticker = setInterval(() => { ticks += 1; }, 20);
    try {
      const lookup = await lookupCommandOnPathAsync("grok", { platform: "linux", env: { PATH: `${binDir}:${process.env.PATH ?? ""}` }, homeDir: root });
      assert.equal(lookup.command, `${binDir}/grok`);
      assert.ok(ticks >= 5, `the event loop ran ${ticks} ticks during a 400 ms lookup; a blocking lookup would run none`);
      assert.equal(lookup.timing?.[0]?.phase, "posix_which");
      assert.equal(lookup.timing?.[0]?.outcome, "ok");
    } finally {
      clearInterval(ticker);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("task #1277: readCommandVersionAsync returns the first line of --version and null on any failure", async () => {
  assert.equal(await readCommandVersionAsync(process.execPath, [], { platform: process.platform }), process.version);
  assert.equal(await readCommandVersionAsync("grok", [], { platform: "linux", runProbeChildFn: asyncRunner({ status: 1 }) }), null);
  assert.equal(await readCommandVersionAsync("grok", [], { platform: "linux", runProbeChildFn: asyncRunner({ code: "ETIMEDOUT" }) }), null);
});

test("task #1277 (review): an aborted POSIX lookup rejects with the abort and never returns the user-local fallback binary", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "probe-async-abort-"));
  try {
    const localBin = path.join(home, ".local", "bin");
    mkdirSync(localBin, { recursive: true });
    writeFileSync(path.join(localBin, "grok"), "#!/bin/sh\n");
    const controller = new AbortController();
    const runChild: RunChild = async (_command, _args, options) => {
      // The locator is cancelled mid-flight, as the runner reports it.
      controller.abort();
      assert.equal(options.signal, controller.signal);
      throw new ProbeChildError("which aborted", { code: "ABORT_ERR", cleanup: { childExited: true, waitedMs: 1 } });
    };
    await assert.rejects(
      lookupCommandOnPathAsync("grok", { platform: "linux", homeDir: home, runProbeChildFn: runChild, signal: controller.signal }),
      (error: unknown) => error instanceof ProbeChildError && error.code === "ABORT_ERR",
    );
    // Without the abort the same failure falls through to the fallback: the
    // difference is the signal, not the error shape.
    const plainFailure: RunChild = async () => { throw new ProbeChildError("which failed", { code: "EACCES" }); };
    const lookup = await lookupCommandOnPathAsync("grok", { platform: "linux", homeDir: home, runProbeChildFn: plainFailure });
    assert.equal(lookup.command, path.posix.join(home, ".local", "bin", "grok"));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("task #1277 (review): an aborted Windows environment read or Get-Command rejects with the abort instead of a verdict", async () => {
  for (const abortAt of ["environment", "get-command"] as const) {
    const controller = new AbortController();
    const runChild: RunChild = async (_command, args) => {
      const isEnvRead = String(args[3]).includes("GetEnvironmentVariables");
      if ((abortAt === "environment") === isEnvRead) {
        controller.abort();
        throw new ProbeChildError("aborted", { code: "ABORT_ERR" });
      }
      return { stdout: isEnvRead ? "{}" : "C:\\tools\\grok.exe\r\n", stderr: "" };
    };
    await assert.rejects(
      lookupCommandOnPathAsync("grok", { platform: "win32", env: {}, existsSyncFn: () => false, warn: () => {}, runProbeChildFn: runChild, signal: controller.signal }),
      (error: unknown) => error instanceof ProbeChildError && error.code === "ABORT_ERR",
      abortAt,
    );
  }
});

test("task #1277 (review): an aborted version read rejects instead of reporting null", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    readCommandVersionAsync("grok", [], { platform: "linux", signal: controller.signal, runProbeChildFn: async () => { throw new ProbeChildError("aborted", { code: "ABORT_ERR" }); } }),
    (error: unknown) => error instanceof ProbeChildError && error.code === "ABORT_ERR",
  );
});

test("reviewer counterexample (Huaihuai, #9791): aborted lookup must not return a launchable fallback path", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(lookupCommandOnPathAsync("grok", {
    platform: "linux", homeDir: "/fake-home", signal: controller.signal,
    existsSyncFn: () => true,
  }), (e: unknown) => e instanceof Error && "code" in e && (e as { code?: unknown }).code === "ABORT_ERR");
});
