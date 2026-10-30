import { ambientProcessEnv } from "../processEnvPatch";
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";

import { killRuntimeDetectionTree } from "../runtimeDetectionRound";

/**
 * task #1277 — a bounded, killable child for probes that used to run through
 * execFileSync on the daemon's event loop.
 *
 * The result and error shapes mirror execFileSync's (`stdout`; a thrown error
 * carries `code` for spawn failures and timeouts, `status` for a non-zero
 * exit) so the classifiers written for the synchronous probes
 * (`classifyCommandLookupFailure`, `classifyProbeExecFailure`, `timingOutcome`)
 * apply unchanged. Two differences are deliberate:
 *  - the child is its own process group (POSIX) and a timeout kills the whole
 *    tree (`taskkill /T` on Windows), not only the direct child;
 *  - a kill is reported apart from the tree's actual end. `cleanup.childExited`
 *    says whether `close` was observed within `cleanupVerifyMs`;
 *    `cleanup.waitedMs` is the measured wait when it was and the configured
 *    window when it was not (the #9730 convention), so a caller that stopped
 *    waiting is never mistaken for a tree that is gone.
 */
export interface ProbeChildOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Wall-clock budget; the tree is killed when it elapses. */
  timeoutMs: number;
  shell?: boolean;
  platform?: NodeJS.Platform;
  /** Cancels the probe: the tree is killed and the call rejects with code `ABORT_ERR`. */
  signal?: AbortSignal;
  /** How long to wait for a killed tree to close before reporting the cleanup unconfirmed. */
  cleanupVerifyMs?: number;
  /**
   * execFileSync's default maxBuffer, counted in bytes as received; the tree is
   * killed when either stream exceeds it.
   */
  maxBufferBytes?: number;
  stderr?: "pipe" | "ignore";
  spawnFn?: typeof nodeSpawn;
}

export interface ProbeChildCleanup {
  childExited: boolean;
  waitedMs: number;
}

export interface ProbeChildResult {
  stdout: string;
  stderr: string;
}

export class ProbeChildError extends Error {
  /** `ETIMEDOUT` (budget), `ABORT_ERR` (signal), `ENOBUFS` (output cap) or the spawn error's own code. */
  code?: string;
  /** Exit status when the child ended on its own with a non-zero status. */
  status?: number | null;
  signal?: NodeJS.Signals | null;
  stdout = "";
  stderr = "";
  /** Present when this runner killed the tree. */
  cleanup?: ProbeChildCleanup;

  constructor(
    message: string,
    fields: Partial<Pick<ProbeChildError, "code" | "status" | "signal" | "stdout" | "stderr" | "cleanup">> = {},
  ) {
    super(message);
    this.name = "ProbeChildError";
    Object.assign(this, fields);
  }
}

export const PROBE_CHILD_CLEANUP_VERIFY_MS = 5000;
const DEFAULT_MAX_BUFFER_BYTES = 1024 * 1024;

/**
 * Output of one stream, retained as raw bytes so the cap is a byte count (as
 * execFileSync's maxBuffer is) and decoding happens once, at the end, never
 * across a chunk boundary. Retention stops at settlement: a tree whose
 * cleanup was not confirmed may keep writing, and that output is dropped.
 */
class RetainedOutput {
  private readonly chunks: Buffer[] = [];
  private bytes = 0;
  private retaining = true;

  constructor(private readonly maxBytes: number) {}

  /** Returns true when this chunk pushed the stream over the cap. */
  push(chunk: Buffer | string): boolean {
    if (!this.retaining) return false;
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
    this.chunks.push(bytes);
    this.bytes += bytes.byteLength;
    return this.bytes > this.maxBytes;
  }

  stop(): void {
    this.retaining = false;
  }

  text(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

export function runProbeChild(command: string, args: readonly string[], options: ProbeChildOptions): Promise<ProbeChildResult> {
  return new Promise((resolve, reject) => {
    const platform = options.platform ?? process.platform;
    const spawnFn = options.spawnFn ?? nodeSpawn;
    const verifyMs = options.cleanupVerifyMs ?? PROBE_CHILD_CLEANUP_VERIFY_MS;
    const maxBuffer = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
    if (options.signal?.aborted) {
      reject(new ProbeChildError(`${command} probe aborted before start`, { code: "ABORT_ERR" }));
      return;
    }

    let child: ChildProcess;
    try {
      child = spawnFn(command, [...args], {
        cwd: options.cwd,
        // Never inherit a Pi session-create patch in flight (task #28).
        env: options.env ?? ambientProcessEnv(),
        stdio: ["ignore", "pipe", options.stderr ?? "pipe"],
        shell: options.shell ?? false,
        detached: platform !== "win32",
        windowsHide: true,
      });
    } catch (error) {
      reject(toSpawnError(command, error));
      return;
    }

    const stdout = new RetainedOutput(maxBuffer);
    const stderr = new RetainedOutput(maxBuffer);
    let settled = false;
    let closed = false;
    let killing = false;
    let killTimer: NodeJS.Timeout | undefined;
    let verifyTimer: NodeJS.Timeout | undefined;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      stdout.stop();
      stderr.stop();
      if (killTimer) clearTimeout(killTimer);
      if (verifyTimer) clearTimeout(verifyTimer);
      options.signal?.removeEventListener("abort", onAbort);
      fn();
    };

    const killTree = (code: "ETIMEDOUT" | "ABORT_ERR" | "ENOBUFS", message: string) => {
      if (settled || killing) return;
      killing = true;
      // Nothing written after the kill decision is kept, confirmed cleanup or not.
      stdout.stop();
      stderr.stop();
      if (typeof child.pid === "number") killRuntimeDetectionTree(child.pid, platform);
      else child.kill("SIGKILL");
      const killedAt = process.hrtime.bigint();
      const finish = (childExited: boolean) => settle(() => reject(new ProbeChildError(message, {
        code,
        stdout: stdout.text(),
        stderr: stderr.text(),
        cleanup: {
          childExited,
          waitedMs: childExited ? Number(process.hrtime.bigint() - killedAt) / 1e6 : verifyMs,
        },
      })));
      if (closed) {
        finish(true);
        return;
      }
      child.once("close", () => finish(true));
      verifyTimer = setTimeout(() => finish(false), verifyMs);
    };

    const onAbort = () => killTree("ABORT_ERR", `${command} probe aborted`);
    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk: Buffer | string) => {
      if (stdout.push(chunk)) killTree("ENOBUFS", `${command} probe exceeded ${maxBuffer} bytes of stdout`);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      if (stderr.push(chunk)) killTree("ENOBUFS", `${command} probe exceeded ${maxBuffer} bytes of stderr`);
    });
    child.once("error", (error) => settle(() => reject(toSpawnError(command, error, stdout.text(), stderr.text()))));
    child.once("close", (status, signal) => {
      closed = true;
      // A tree this runner is killing reports through the kill path, which
      // waits for this same event and records the cleanup.
      if (settled || killing) return;
      settle(() => {
        if (status === 0) resolve({ stdout: stdout.text(), stderr: stderr.text() });
        else reject(new ProbeChildError(`${command} exited with ${status ?? signal}`, { status, signal, stdout: stdout.text(), stderr: stderr.text() }));
      });
    });

    killTimer = setTimeout(
      () => killTree("ETIMEDOUT", `${command} probe did not finish within ${options.timeoutMs} ms`),
      options.timeoutMs,
    );
  });
}

/**
 * Kills a child's process group and reports whether the child was seen to
 * end: `close` observed within `verifyMs` → `childExited: true` with the
 * measured wait; otherwise `childExited: false` with the configured window
 * (not a measurement). `childExited` is the observed exit of the direct child;
 * it is not proof that every possible descendant is gone. For callers that
 * own a long-lived child (an ACP or app-server exchange) and must stop it on
 * cancel without mistaking "kill sent" for "exit observed".
 */
export function killProbeTreeAndSettle(
  child: ChildProcess,
  options: { platform?: NodeJS.Platform; cleanupVerifyMs?: number } = {},
): Promise<ProbeChildCleanup> {
  const platform = options.platform ?? process.platform;
  const verifyMs = options.cleanupVerifyMs ?? PROBE_CHILD_CLEANUP_VERIFY_MS;
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ childExited: true, waitedMs: 0 });
      return;
    }
    if (typeof child.pid === "number") {
      if (platform === "win32") {
        killRuntimeDetectionTree(child.pid, platform);
      } else {
        // The group kill covers descendants when the child leads its own group
        // (spawned detached); a child in the daemon's own group has no such
        // group, so it is killed directly.
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    } else {
      child.kill("SIGKILL");
    }
    const killedAt = process.hrtime.bigint();
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ childExited: false, waitedMs: verifyMs });
    }, verifyMs);
    child.once("close", () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ childExited: true, waitedMs: Number(process.hrtime.bigint() - killedAt) / 1e6 });
    });
  });
}

function toSpawnError(command: string, error: unknown, stdout = "", stderr = ""): ProbeChildError {
  const details = error as { code?: unknown; message?: unknown } | null;
  const message = typeof details?.message === "string" ? details.message : String(error);
  return new ProbeChildError(`${command} could not be spawned: ${message}`, {
    code: typeof details?.code === "string" ? details.code : undefined,
    stdout,
    stderr,
  });
}
