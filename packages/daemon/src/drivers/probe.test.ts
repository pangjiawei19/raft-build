import assert from "node:assert/strict";
import type { execFileSync } from "node:child_process";

import {
  WINDOWS_COMMAND_RESOLVE_TIMEOUT_MS,
  WINDOWS_ENVIRONMENT_READ_TIMEOUT_MS,
  classifyProbeExecFailure,
  formatCommandLookupTiming,
  lookupCommandOnPath,
  readCommandVersion,
  resolveCommandOnPath,
  withWindowsUserEnvironment,
} from "./probe";

const noWindowsEnvironment = () => null;

test("Windows environment reader executes newline-separated PowerShell and parses its scopes", () => {
  let capturedArgs: readonly string[] = [];
  const warnings: string[] = [];
  const execFileSyncFn: typeof execFileSync = ((_command: string, args?: readonly string[]) => {
    capturedArgs = args ?? [];
    return Buffer.from(JSON.stringify({
      Machine: { Path: "C:\\MachineBin", MACHINE_ONLY: "machine" },
      User: { Path: "C:\\UserBin", USER_ONLY: "user" },
    }));
  }) as typeof execFileSync;

  const merged = withWindowsUserEnvironment(
    { Path: "C:\\ExplicitBin", BASE_ONLY: "base" },
    {
      platform: "win32",
      execFileSyncFn,
      warn: (message) => warnings.push(message),
    },
  );

  assert.equal(capturedArgs[0], "-NoProfile");
  assert.equal(capturedArgs[3]?.includes("\n  foreach ($scope"), true);
  assert.equal(capturedArgs[3]?.includes("{}   foreach"), false);
  assert.equal(merged.Path, "C:\\ExplicitBin;C:\\MachineBin;C:\\UserBin");
  assert.equal(merged.MACHINE_ONLY, "machine");
  assert.equal(merged.USER_ONLY, "user");
  assert.equal(merged.BASE_ONLY, "base");
  assert.deepEqual(warnings, []);
});

test("Windows environment reader fallback emits bounded child failure evidence", () => {
  const env = { Path: "C:\\ExplicitBin", BASE_ONLY: "base" };
  const warnings: string[] = [];
  const execFileSyncFn: typeof execFileSync = (() => {
    const error = new Error("PowerShell failed") as Error & {
      status: number;
      stderr: Buffer;
    };
    error.status = 1;
    error.stderr = Buffer.from(`Unexpected token 'foreach' ${"x".repeat(400)}`);
    throw error;
  }) as typeof execFileSync;

  const merged = withWindowsUserEnvironment(env, {
    platform: "win32",
    execFileSyncFn,
    warn: (message) => warnings.push(message),
  });

  assert.equal(merged, env);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /Windows environment refresh failed \(exit=1, code=unknown, signal=none\)/);
  assert.match(warnings[0] ?? "", /Unexpected token 'foreach'/);
  assert.ok((warnings[0]?.length ?? 0) < 400);
});

test(
  "Windows environment reader executes and parses on Windows PowerShell 5.1",
  { skip: process.platform !== "win32" },
  () => {
    const warnings: string[] = [];
    const merged = withWindowsUserEnvironment(
      { ...process.env, TASK305_SENTINEL: "present" },
      { platform: "win32", warn: (message) => warnings.push(message) },
    );

    assert.equal(merged.TASK305_SENTINEL, "present");
    assert.ok(merged.Path ?? merged.PATH);
    assert.deepEqual(warnings, []);
  },
);

test("Windows environment reader leaves non-Windows environments untouched", () => {
  const env = { PATH: "/usr/local/bin", BASE_ONLY: "base" };
  let executed = false;
  let warned = false;

  const result = withWindowsUserEnvironment(env, {
    platform: "darwin",
    execFileSyncFn: ((_command: string) => {
      executed = true;
      return Buffer.from("");
    }) as typeof execFileSync,
    warn: () => {
      warned = true;
    },
  });

  assert.equal(result, env);
  assert.equal(executed, false);
  assert.equal(warned, false);
});

test("resolveCommandOnPath falls back to user-local bin dirs when a minimal service PATH misses them", () => {
  const whichMisses: typeof execFileSync = (() => {
    throw new Error("not on path");
  }) as typeof execFileSync;
  const deps = {
    platform: "linux" as const,
    env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/home/tester" },
    execFileSyncFn: whichMisses,
  };

  assert.equal(
    resolveCommandOnPath("claude", { ...deps, existsSyncFn: (p) => p === "/home/tester/.local/bin/claude" }),
    "/home/tester/.local/bin/claude",
  );
  assert.equal(
    resolveCommandOnPath("kimi", { ...deps, existsSyncFn: (p) => p === "/home/tester/.kimi-code/bin/kimi" }),
    "/home/tester/.kimi-code/bin/kimi",
  );
  assert.equal(resolveCommandOnPath("claude", { ...deps, existsSyncFn: () => false }), null);
  assert.equal(
    resolveCommandOnPath("claude", { ...deps, env: { PATH: "/usr/bin" }, existsSyncFn: () => true }),
    null,
  );
});

test("resolveCommandOnPath builds POSIX fallback paths from the injected platform on every host", () => {
  const candidates: string[] = [];
  const resolved = resolveCommandOnPath("claude", {
    platform: "linux",
    env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/home/tester" },
    execFileSyncFn: (() => {
      throw new Error("not on path");
    }) as typeof execFileSync,
    existsSyncFn: (candidate) => {
      candidates.push(candidate);
      return false;
    },
  });

  assert.equal(resolved, null);
  assert.deepEqual(candidates, [
    "/home/tester/.local/bin/claude",
    "/home/tester/.kimi-code/bin/claude",
  ]);
});

test("resolveCommandOnPath passes the runtime name directly to powershell on Windows", () => {
  let capturedCommand: string | null = null;
  let capturedArgs: readonly string[] | null = null;

  const execFileSyncFn: typeof execFileSync = ((command: string, argsOrOptions?: readonly string[] | object) => {
    const args = Array.isArray(argsOrOptions) ? argsOrOptions : [];
    capturedCommand = command;
    capturedArgs = args;
    return Buffer.from("C:\\Program Files\\Codex\\codex.exe\r\n");
  }) as typeof execFileSync;

  const resolved = resolveCommandOnPath("codex", {
    platform: "win32",
    env: { PATH: "C:\\Windows\\System32" },
    execFileSyncFn,
    windowsEnvironmentReaderFn: noWindowsEnvironment,
  });

  assert.equal(resolved, "C:\\Program Files\\Codex\\codex.exe");
  assert.equal(capturedCommand, "powershell.exe");
  assert.deepEqual(capturedArgs, [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "& {try { $cmd = Get-Command -Name $args[0] -ErrorAction Stop | Select-Object -First 1 } catch [System.Management.Automation.CommandNotFoundException] { exit 3 }; if ($cmd.Path) { $cmd.Path } elseif ($cmd.Source) { $cmd.Source } elseif ($cmd.Definition) { $cmd.Definition } }",
    "codex",
  ]);
});

test("resolveCommandOnPath isolates both Windows PowerShell probes from inherited PSModulePath", () => {
  const sourceEnv: NodeJS.ProcessEnv = {
    Path: "C:\\ExplicitBin",
    PSModulePath: "C:\\Program Files\\PowerShell\\7\\Modules",
    TASK_ENV: "present",
  };
  const capturedEnvs: NodeJS.ProcessEnv[] = [];
  let callCount = 0;
  const execFileSyncFn: typeof execFileSync = ((
    command: string,
    _args?: readonly string[],
    options?: { env?: NodeJS.ProcessEnv },
  ) => {
    assert.equal(command, "powershell.exe");
    assert.ok(options?.env);
    capturedEnvs.push(options.env);
    callCount += 1;
    if (callCount === 1) {
      return Buffer.from(JSON.stringify({
        Machine: {
          Path: "C:\\MachineBin",
          PSModulePath: "C:\\WindowsPowerShell\\Modules",
        },
        User: {
          Path: "C:\\UserBin",
          pSmOdUlEpAtH: "C:\\UserPowerShell\\Modules",
        },
      }));
    }
    return Buffer.from("C:\\Program Files\\Codex\\codex.exe\r\n");
  }) as typeof execFileSync;

  assert.equal(
    resolveCommandOnPath("codex", {
      platform: "win32",
      env: sourceEnv,
      execFileSyncFn,
    }),
    "C:\\Program Files\\Codex\\codex.exe",
  );
  assert.equal(capturedEnvs.length, 2);
  for (const childEnv of capturedEnvs) {
    assert.equal(
      Object.keys(childEnv).some((key) => key.toLowerCase() === "psmodulepath"),
      false,
    );
    assert.equal(childEnv.TASK_ENV, "present");
  }
  assert.equal(capturedEnvs[0]?.Path, "C:\\ExplicitBin");
  assert.equal(capturedEnvs[1]?.Path, "C:\\ExplicitBin;C:\\MachineBin;C:\\UserBin");
  assert.equal(sourceEnv.PSModulePath, "C:\\Program Files\\PowerShell\\7\\Modules");
});

test("resolveCommandOnPath preserves PSModulePath for non-Windows child processes", () => {
  const sourceEnv: NodeJS.ProcessEnv = {
    PATH: "/usr/local/bin:/usr/bin",
    PSModulePath: "/opt/microsoft/powershell/7/Modules",
  };
  let capturedEnv: NodeJS.ProcessEnv | undefined;
  const execFileSyncFn: typeof execFileSync = ((
    command: string,
    _args?: readonly string[],
    options?: { env?: NodeJS.ProcessEnv },
  ) => {
    assert.equal(command, "which");
    capturedEnv = options?.env;
    return Buffer.from("/usr/local/bin/codex\n");
  }) as typeof execFileSync;

  assert.equal(
    resolveCommandOnPath("codex", {
      platform: "linux",
      env: sourceEnv,
      execFileSyncFn,
    }),
    "/usr/local/bin/codex",
  );
  assert.strictEqual(capturedEnv, sourceEnv);
  assert.equal(capturedEnv?.PSModulePath, "/opt/microsoft/powershell/7/Modules");
});

test("resolveCommandOnPath bounds a slow Windows probe and retries fresh after a timeout", () => {
  const capturedTimeouts: Array<number | undefined> = [];
  let callCount = 0;
  const execFileSyncFn: typeof execFileSync = ((_command: string, _args?: readonly string[], options?: { timeout?: number }) => {
    capturedTimeouts.push(options?.timeout);
    callCount += 1;
    if (callCount === 1) {
      const error = new Error("probe timed out") as NodeJS.ErrnoException;
      error.code = "ETIMEDOUT";
      throw error;
    }
    return Buffer.from("C:\\Program Files\\Codex\\codex.exe\r\n");
  }) as typeof execFileSync;

  const deps = {
    platform: "win32" as const,
    env: { PATH: "C:\\Windows\\System32" },
    execFileSyncFn,
    windowsEnvironmentReaderFn: noWindowsEnvironment,
  };

  assert.equal(resolveCommandOnPath("codex", deps), null);
  assert.equal(resolveCommandOnPath("codex", deps), "C:\\Program Files\\Codex\\codex.exe");
  assert.deepEqual(capturedTimeouts, [WINDOWS_COMMAND_RESOLVE_TIMEOUT_MS, WINDOWS_COMMAND_RESOLVE_TIMEOUT_MS]);
});

// task #1240: the Windows lookup must say *why* it has no command. Only the
// locator's reserved exit (3, CommandNotFoundException) is "not installed";
// a timeout, a denied spawn, or any other exit is an undecided lookup.
function windowsLookupDeps(failure: { code?: string; status?: number }) {
  const execFileSyncFn: typeof execFileSync = (() => {
    throw Object.assign(new Error(`lookup failed: ${JSON.stringify(failure)}`), failure);
  }) as typeof execFileSync;
  return {
    platform: "win32" as const,
    env: { PATH: "C:\\Windows\\System32" },
    execFileSyncFn,
    windowsEnvironmentReaderFn: noWindowsEnvironment,
  };
}

test("lookupCommandOnPath on Windows reports a timed-out lookup as probe_timeout, never as not_installed", () => {
  const lookup = lookupCommandOnPath("codex", windowsLookupDeps({ code: "ETIMEDOUT" }));
  assert.equal(lookup.command, null);
  assert.equal(lookup.missReason, "probe_timeout");
  assert.notEqual(lookup.missReason, "not_installed");
});

test("lookupCommandOnPath on Windows distinguishes not_installed (exit 3) from probe_failed and permission_denied", () => {
  assert.equal(lookupCommandOnPath("codex", windowsLookupDeps({ status: 3 })).missReason, "not_installed");
  assert.equal(lookupCommandOnPath("codex", windowsLookupDeps({ status: 1 })).missReason, "probe_failed");
  assert.equal(lookupCommandOnPath("codex", windowsLookupDeps({ code: "EACCES" })).missReason, "permission_denied");
  assert.equal(lookupCommandOnPath("codex", windowsLookupDeps({ code: "ENOENT" })).missReason, "probe_failed", "a missing powershell.exe is not evidence the runtime is missing");
  const empty = lookupCommandOnPath("codex", {
    ...windowsLookupDeps({}),
    execFileSyncFn: (() => Buffer.from("\r\n")) as unknown as typeof execFileSync,
  });
  assert.equal(empty.command, null);
  assert.equal(empty.missReason, "probe_failed", "a lookup that prints nothing is undecided, not a miss");
});

test("the Windows lookup budget is the exported constant the launch message quotes", () => {
  // task #1240: raised from 1000 to match the environment read's budget; a
  // launch-gating lookup that is too short never starts the runtime on a slow
  // machine, while a longer one costs nothing when the child answers in time.
  assert.equal(WINDOWS_COMMAND_RESOLVE_TIMEOUT_MS, 5000);
  assert.equal(WINDOWS_ENVIRONMENT_READ_TIMEOUT_MS, 5000);
});

// task #1240 acceptance — the budget is what the lookup hands to execFileSync,
// so a child is simulated by how long it needs against the budget it is given.
function windowsChildNeeding(neededMs: number, resolvedPath = "C:\\Users\\someone\\AppData\\Roaming\\npm\\claude.cmd") {
  const budgets: Array<number | undefined> = [];
  const execFileSyncFn: typeof execFileSync = ((_command: string, _args?: readonly string[], options?: { timeout?: number }) => {
    budgets.push(options?.timeout);
    if (typeof options?.timeout === "number" && neededMs > options.timeout) {
      throw Object.assign(new Error("spawnSync powershell.exe ETIMEDOUT"), { code: "ETIMEDOUT", killed: true, signal: "SIGTERM" });
    }
    return Buffer.from(`${resolvedPath}\r\n`);
  }) as typeof execFileSync;
  return { budgets, deps: { platform: "win32" as const, env: { PATH: "C:\\Windows\\System32" }, execFileSyncFn, windowsEnvironmentReaderFn: noWindowsEnvironment } };
}

test("task #1240: a Get-Command that needs more than the old 1000 ms but less than the budget resolves (red if the budget change is reverted)", () => {
  const child = windowsChildNeeding(1500);
  const lookup = lookupCommandOnPath("claude", child.deps);
  assert.equal(lookup.command, "C:\\Users\\someone\\AppData\\Roaming\\npm\\claude.cmd");
  assert.equal(lookup.missReason, undefined);
  assert.deepEqual(child.budgets, [WINDOWS_COMMAND_RESOLVE_TIMEOUT_MS]);
  const getCommand = lookup.timing?.find((entry) => entry.phase === "windows_get_command");
  assert.equal(getCommand?.outcome, "ok");
  assert.equal(getCommand?.truncated, false);
  assert.equal(getCommand?.budgetMs, WINDOWS_COMMAND_RESOLVE_TIMEOUT_MS);
});

test("task #1240: a Get-Command that exceeds the budget is still probe_timeout, recorded as truncated at the budget, never not_installed", () => {
  const child = windowsChildNeeding(WINDOWS_COMMAND_RESOLVE_TIMEOUT_MS + 1000);
  const lookup = lookupCommandOnPath("claude", child.deps);
  assert.equal(lookup.command, null);
  assert.equal(lookup.missReason, "probe_timeout");
  const getCommand = lookup.timing?.find((entry) => entry.phase === "windows_get_command");
  assert.equal(getCommand?.outcome, "timeout");
  assert.equal(getCommand?.truncated, true);
  assert.equal(getCommand?.budgetMs, WINDOWS_COMMAND_RESOLVE_TIMEOUT_MS);
  assert.match(formatCommandLookupTiming(lookup.timing) ?? "", /get-command \d+ ms timeout \(truncated\) \(budget 5000 ms\)/);
});

test("task #1240: lookup timing records phase, duration, budget and outcome only — no values, output or paths", () => {
  const child = windowsChildNeeding(10, "C:\\Users\\secret-user\\AppData\\Roaming\\npm\\claude.cmd");
  const deps = {
    ...child.deps,
    windowsEnvironmentReaderFn: (() => ({ machine: { PATH: "C:\\Windows" }, user: { PATH: "C:\\Users\\secret-user\\bin", SECRET_TOKEN: "sk-should-never-appear" } })) as any,
  };
  const lookup = lookupCommandOnPath("claude", deps);
  assert.ok(lookup.command);
  assert.deepEqual(lookup.timing?.map((entry) => entry.phase), ["windows_environment", "windows_get_command"]);
  for (const entry of lookup.timing ?? []) {
    assert.deepEqual(Object.keys(entry).sort(), ["budgetMs", "ms", "outcome", "phase", "truncated"]);
    assert.equal(typeof entry.ms, "number");
  }
  const rendered = formatCommandLookupTiming(lookup.timing) ?? "";
  assert.match(rendered, /^environment \d+ ms ok \(budget 5000 ms\), get-command \d+ ms ok \(budget 5000 ms\)$/);
  assert.doesNotMatch(JSON.stringify(lookup.timing) + rendered, /secret-user|sk-should-never-appear|AppData|claude\.cmd/);
  assert.equal(formatCommandLookupTiming(undefined), undefined);
  assert.equal(formatCommandLookupTiming([]), undefined);
});

test("task #1240: missing (exit 3), execution error and permission denied keep their classification and carry timing", () => {
  for (const [failure, reason, outcome] of [
    [{ status: 3 }, "not_installed", "exit"],
    [{ status: 1 }, "probe_failed", "exit"],
    [{ code: "EACCES" }, "permission_denied", "spawn_error"],
  ] as const) {
    const lookup = lookupCommandOnPath("codex", windowsLookupDeps(failure));
    assert.equal(lookup.missReason, reason);
    const getCommand = lookup.timing?.find((entry) => entry.phase === "windows_get_command");
    assert.equal(getCommand?.outcome, outcome, JSON.stringify(failure));
    assert.equal(getCommand?.truncated, false);
  }
});

// Real child cleanup at the budget (Windows CI only): a PowerShell child that
// would run far past the budget must be killed at the budget — execFileSync
// returns ETIMEDOUT at about the budget, not after the child's own runtime,
// and the process is gone afterwards.
test.skipIf(process.platform !== "win32")("task #1240: a Windows child exceeding the lookup budget is killed at the budget and classified probe_timeout", async () => {
  const { execFileSync: realExecFileSync } = await import("node:child_process");
  const { performance } = await import("node:perf_hooks");
  const started = performance.now();
  let thrown: (Error & { code?: string; pid?: number }) | null = null;
  try {
    realExecFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Start-Sleep -Seconds 60"], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: WINDOWS_COMMAND_RESOLVE_TIMEOUT_MS,
    });
  } catch (error) {
    thrown = error as Error & { code?: string; pid?: number };
  }
  const elapsed = performance.now() - started;
  assert.ok(thrown, "the child must not be allowed to finish its 60 s sleep");
  assert.equal(thrown!.code, "ETIMEDOUT");
  assert.equal(classifyProbeExecFailure(thrown), "probe_timeout");
  assert.ok(elapsed < WINDOWS_COMMAND_RESOLVE_TIMEOUT_MS + 3000, `killed near the budget, elapsed ${Math.round(elapsed)} ms`);
  // The absence check must not be skippable: a missing pid is a failure of this test's evidence.
  assert.ok(typeof thrown!.pid === "number" && thrown!.pid > 0, `execFileSync must report the child's pid, got ${String(thrown!.pid)}`);
  const listed = realExecFileSync("tasklist", ["/FI", `PID eq ${thrown!.pid}`, "/NH"], { encoding: "utf8" });
  assert.doesNotMatch(listed, new RegExp(`\\b${thrown!.pid}\\b`), "the timed-out child process must be gone");
});

// task #1240 review: the environment-read child's outcome must survive the
// reader (which tolerates failure and warns), so a 5 s killed environment read
// followed by a successful Get-Command is reported as a truncated timeout, not
// as an untruncated spawn error.
function windowsEnvChildThen(envFailure: { code?: string; status?: number } | null, resolvedPath = "C:\\tools\\claude.cmd") {
  const execFileSyncFn: typeof execFileSync = ((_command: string, args?: readonly string[]) => {
    const isGetCommand = Array.isArray(args) && args.some((arg) => typeof arg === "string" && arg.includes("Get-Command"));
    if (!isGetCommand && envFailure) {
      throw Object.assign(new Error(`env read failed: ${JSON.stringify(envFailure)}`), envFailure);
    }
    if (!isGetCommand) return Buffer.from(JSON.stringify({ Machine: { PATH: "C:\\Windows" }, User: {} }));
    return Buffer.from(`${resolvedPath}\r\n`);
  }) as typeof execFileSync;
  return { platform: "win32" as const, env: { PATH: "C:\\Windows\\System32" }, execFileSyncFn, warn: () => {} };
}

test("task #1240: a timed-out environment read is recorded as a truncated timeout and the Get-Command still runs", () => {
  const lookup = lookupCommandOnPath("claude", windowsEnvChildThen({ code: "ETIMEDOUT" }));
  assert.equal(lookup.command, "C:\\tools\\claude.cmd", "the lookup falls back to the process environment and still resolves");
  assert.deepEqual(lookup.timing?.map((entry) => [entry.phase, entry.outcome, entry.truncated, entry.budgetMs]), [
    ["windows_environment", "timeout", true, 5000],
    ["windows_get_command", "ok", false, 5000],
  ]);
});

test("task #1240: environment read exit and spawn failures keep their own outcomes; a successful read is ok", () => {
  const envEntry = (failure: { code?: string; status?: number } | null) => {
    const entry = lookupCommandOnPath("claude", windowsEnvChildThen(failure)).timing?.[0];
    return entry ? { phase: entry.phase, outcome: entry.outcome, truncated: entry.truncated } : entry;
  };
  assert.deepEqual(envEntry({ status: 1 }), { phase: "windows_environment", outcome: "exit", truncated: false });
  assert.deepEqual(envEntry({ code: "ENOENT" }), { phase: "windows_environment", outcome: "spawn_error", truncated: false });
  assert.deepEqual(envEntry(null), { phase: "windows_environment", outcome: "ok", truncated: false });
});

// Cold-start measurement for task #1240 (Windows CI only; never asserts a
// budget). Logs how long powershell.exe takes to answer Get-Command for a
// command that exists and for one that does not, so the budget can be set
// from a measured number rather than guessed. Read the values in the job log
// under "windows-command-probe-timing".
test.skipIf(process.platform !== "win32")("measures real powershell.exe Get-Command latency on this Windows host", async () => {
  const { execFileSync: realExecFileSync } = await import("node:child_process");
  const { performance } = await import("node:perf_hooks");
  const script =
    "& {try { $cmd = Get-Command -Name $args[0] -ErrorAction Stop | Select-Object -First 1 } " +
    "catch [System.Management.Automation.CommandNotFoundException] { exit 3 }; " +
    "if ($cmd.Path) { $cmd.Path } elseif ($cmd.Source) { $cmd.Source } elseif ($cmd.Definition) { $cmd.Definition } }";
  const timings: Array<{ target: string; run: number; ms: number; outcome: string }> = [];
  for (const target of ["powershell", "raft-task-1240-definitely-missing"]) {
    for (let run = 1; run <= 4; run += 1) {
      const started = performance.now();
      let outcome = "ok";
      try {
        realExecFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script, target], {
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 30_000,
        });
      } catch (error) {
        const details = error as { status?: unknown; code?: unknown };
        outcome = details.status === 3 ? "not_found_exit_3" : `error:${String(details.code ?? details.status)}`;
      }
      timings.push({ target, run, ms: Math.round(performance.now() - started), outcome });
    }
  }
  for (const row of timings) {
    console.log(`windows-command-probe-timing target=${row.target} run=${row.run} ms=${row.ms} outcome=${row.outcome} budget_ms=${WINDOWS_COMMAND_RESOLVE_TIMEOUT_MS}`);
  }
  assert.equal(timings.length, 8);
});

test("resolveCommandOnPath on Windows prefers .cmd over .ps1 from Get-Command", () => {
  const execFileSyncFn: typeof execFileSync = ((_command: string, _argsOrOptions?: readonly string[] | object) => {
    return Buffer.from("C:\\Users\\test\\AppData\\Roaming\\npm\\claude.ps1\r\n");
  }) as typeof execFileSync;

  const existsSyncFn = (filePath: string) => filePath === "C:\\Users\\test\\AppData\\Roaming\\npm\\claude.cmd";

  const resolved = resolveCommandOnPath("claude", {
    platform: "win32",
    env: {},
    execFileSyncFn,
    existsSyncFn,
    windowsEnvironmentReaderFn: noWindowsEnvironment,
  });

  assert.equal(resolved, "C:\\Users\\test\\AppData\\Roaming\\npm\\claude.cmd");
});

test("resolveCommandOnPath on Windows prefers .bat over .exe when .cmd is absent", () => {
  const execFileSyncFn: typeof execFileSync = ((_command: string, _argsOrOptions?: readonly string[] | object) => {
    return Buffer.from("C:\\Users\\test\\AppData\\Roaming\\npm\\claude.ps1\r\n");
  }) as typeof execFileSync;

  const existsSyncFn = (filePath: string) => filePath === "C:\\Users\\test\\AppData\\Roaming\\npm\\claude.bat";

  const resolved = resolveCommandOnPath("claude", {
    platform: "win32",
    env: {},
    execFileSyncFn,
    existsSyncFn,
    windowsEnvironmentReaderFn: noWindowsEnvironment,
  });

  assert.equal(resolved, "C:\\Users\\test\\AppData\\Roaming\\npm\\claude.bat");
});

test("resolveCommandOnPath on Windows prefers .exe when .cmd and .bat are absent", () => {
  const execFileSyncFn: typeof execFileSync = ((_command: string, _argsOrOptions?: readonly string[] | object) => {
    return Buffer.from("C:\\Users\\test\\AppData\\Roaming\\npm\\claude.ps1\r\n");
  }) as typeof execFileSync;

  const existsSyncFn = (filePath: string) => filePath === "C:\\Users\\test\\AppData\\Roaming\\npm\\claude.exe";

  const resolved = resolveCommandOnPath("claude", {
    platform: "win32",
    env: {},
    execFileSyncFn,
    existsSyncFn,
    windowsEnvironmentReaderFn: noWindowsEnvironment,
  });

  assert.equal(resolved, "C:\\Users\\test\\AppData\\Roaming\\npm\\claude.exe");
});

test("resolveCommandOnPath on Windows falls back to extensionless when .ps1 alternatives are absent", () => {
  const execFileSyncFn: typeof execFileSync = ((_command: string, _argsOrOptions?: readonly string[] | object) => {
    return Buffer.from("C:\\Users\\test\\AppData\\Roaming\\npm\\claude.ps1\r\n");
  }) as typeof execFileSync;

  const existsSyncFn = (filePath: string) => filePath === "C:\\Users\\test\\AppData\\Roaming\\npm\\claude";

  const resolved = resolveCommandOnPath("claude", {
    platform: "win32",
    env: {},
    execFileSyncFn,
    existsSyncFn,
    windowsEnvironmentReaderFn: noWindowsEnvironment,
  });

  assert.equal(resolved, "C:\\Users\\test\\AppData\\Roaming\\npm\\claude");
});

test("resolveCommandOnPath on Windows returns null when Get-Command returns .ps1 and no alternative exists", () => {
  const execFileSyncFn: typeof execFileSync = ((_command: string, _argsOrOptions?: readonly string[] | object) => {
    return Buffer.from("C:\\Users\\test\\AppData\\Roaming\\npm\\claude.ps1\r\n");
  }) as typeof execFileSync;

  const existsSyncFn = () => false;

  const resolved = resolveCommandOnPath("claude", {
    platform: "win32",
    env: {},
    execFileSyncFn,
    existsSyncFn,
    windowsEnvironmentReaderFn: noWindowsEnvironment,
  });

  assert.equal(resolved, null);
});

test("resolveCommandOnPath on Windows returns non-.ps1 result as-is", () => {
  const execFileSyncFn: typeof execFileSync = ((_command: string, _argsOrOptions?: readonly string[] | object) => {
    return Buffer.from("C:\\Program Files\\Claude\\claude.exe\r\n");
  }) as typeof execFileSync;

  const resolved = resolveCommandOnPath("claude", {
    platform: "win32",
    env: {},
    execFileSyncFn,
    windowsEnvironmentReaderFn: noWindowsEnvironment,
  });

  assert.equal(resolved, "C:\\Program Files\\Claude\\claude.exe");
});

test("resolveCommandOnPath on Windows merges Machine and User environment before probing", () => {
  const capturedEnvs: NodeJS.ProcessEnv[] = [];

  const execFileSyncFn: typeof execFileSync = ((_command: string, _args?: readonly string[], options?: { env?: NodeJS.ProcessEnv }) => {
    if (options?.env) capturedEnvs.push(options.env);
    return Buffer.from("C:\\Users\\test\\AppData\\Local\\cursor-agent\\cursor-agent.exe\r\n");
  }) as typeof execFileSync;

  const resolved = resolveCommandOnPath("cursor-agent", {
    platform: "win32",
    env: {
      Path: "C:\\ExplicitBin",
      SHARED_VALUE: "base",
    },
    execFileSyncFn,
    windowsEnvironmentReaderFn: () => ({
      machine: {
        Path: "C:\\MachineBin",
        MACHINE_ONLY: "machine",
        SHARED_VALUE: "machine",
      },
      user: {
        Path: "C:\\Users\\test\\AppData\\Local\\cursor-agent",
        USER_ONLY: "user",
        SHARED_VALUE: "user",
      },
    }),
  });

  assert.equal(resolved, "C:\\Users\\test\\AppData\\Local\\cursor-agent\\cursor-agent.exe");
  const capturedEnv = capturedEnvs[0];
  assert.ok(capturedEnv);
  assert.equal(capturedEnv?.Path, "C:\\ExplicitBin;C:\\MachineBin;C:\\Users\\test\\AppData\\Local\\cursor-agent");
  assert.equal(capturedEnv?.MACHINE_ONLY, "machine");
  assert.equal(capturedEnv?.USER_ONLY, "user");
  assert.equal(capturedEnv?.SHARED_VALUE, "base");
});

test("readCommandVersion on Windows uses merged Machine and User environment", () => {
  const capturedEnvs: NodeJS.ProcessEnv[] = [];

  const execFileSyncFn: typeof execFileSync = ((_command: string, _args?: readonly string[], options?: { env?: NodeJS.ProcessEnv }) => {
    if (options?.env) capturedEnvs.push(options.env);
    return Buffer.from("cursor-agent 1.2.3\r\n");
  }) as typeof execFileSync;

  const version = readCommandVersion("cursor-agent", [], {
    platform: "win32",
    env: { Path: "C:\\ExplicitBin" },
    execFileSyncFn,
    windowsEnvironmentReaderFn: () => ({
      machine: { Path: "C:\\MachineBin" },
      user: { Path: "C:\\Users\\test\\AppData\\Local\\cursor-agent" },
    }),
  });

  assert.equal(version, "cursor-agent 1.2.3");
  const capturedEnv = capturedEnvs[0];
  assert.ok(capturedEnv);
  assert.equal(capturedEnv?.Path, "C:\\ExplicitBin;C:\\MachineBin;C:\\Users\\test\\AppData\\Local\\cursor-agent");
});
