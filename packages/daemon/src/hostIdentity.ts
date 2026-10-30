import { execFile } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

import { ambientProcessEnv } from "./processEnvPatch";

/**
 * "Several Computers on one physical machine", per server. The machine's own
 * hardware ID (system-wide, readable by any OS user, so every OS user on the
 * machine reads the same one) never leaves it: the Server gets only
 * HMAC(key = hardware ID, "raft-host-id-v1:" + serverId), which matches across
 * Computers of one server and is unrelated between servers. Neither the raw ID
 * nor any server-independent value is logged, traced or stored.
 */

const HOST_ID_DOMAIN = "raft-host-id-v1:";
const HOST_ID_HASH_CHARS = 32;

export function hostIdHashForServer(hardwareId: string, serverId: string): string {
  return createHmac("sha256", hardwareId).update(`${HOST_ID_DOMAIN}${serverId}`).digest("hex").slice(0, HOST_ID_HASH_CHARS);
}

/** Accept only something that looks like a real machine ID (≥ 16 hex digits once dashes are dropped). */
export function normalizeHardwareId(raw: string | undefined): string | undefined {
  const value = (raw ?? "").trim().toLowerCase().replace(/-/g, "");
  if (!/^[0-9a-f]{16,64}$/.test(value)) return undefined;
  if (/^0+$/.test(value)) return undefined;
  return value;
}

/** `ioreg -rd1 -c IOPlatformExpertDevice` → IOPlatformUUID. */
export function parseIoregPlatformUuid(output: string): string | undefined {
  return /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(output)?.[1];
}

/** `reg query HKLM\SOFTWARE\Microsoft\Cryptography /v MachineGuid` → the GUID. */
export function parseRegMachineGuid(output: string): string | undefined {
  return /MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/.exec(output)?.[1];
}

const COMMAND_TIMEOUT_MS = 5_000;

function run(file: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 1024 * 1024, windowsHide: true, env: ambientProcessEnv() }, (error, stdout) => {
      resolve(error ? undefined : stdout);
    });
  });
}

function readOptional(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

export interface HardwareIdIo {
  readFile?: (file: string) => string | undefined;
  run?: (file: string, args: string[]) => Promise<string | undefined>;
}

export async function readHardwareId(
  platform: NodeJS.Platform = process.platform,
  io: HardwareIdIo = {},
): Promise<string | undefined> {
  const read = io.readFile ?? readOptional;
  const exec = io.run ?? run;
  try {
    if (platform === "linux") {
      return normalizeHardwareId(read("/etc/machine-id")) ?? normalizeHardwareId(read("/var/lib/dbus/machine-id"));
    }
    if (platform === "darwin") {
      const output = await exec("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"]);
      return normalizeHardwareId(output === undefined ? undefined : parseIoregPlatformUuid(output));
    }
    if (platform === "win32") {
      const output = await exec("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"]);
      return normalizeHardwareId(output === undefined ? undefined : parseRegMachineGuid(output));
    }
  } catch {
    // Unknown: nothing is sent and the Computer is simply not grouped.
  }
  return undefined;
}

let cached: Promise<string | undefined> | undefined;

/** This machine's hash for one server; undefined when the hardware ID can't be read. */
export async function hostIdHash(serverId: string): Promise<string | undefined> {
  cached ??= readHardwareId();
  const hardwareId = await cached;
  return hardwareId === undefined ? undefined : hostIdHashForServer(hardwareId, serverId);
}
