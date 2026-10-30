import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface PersistentEnvironment {
  version: 1;
  mode: "persistent";
  initialized: boolean;
  schemaHash: string;
}

export function readPersistentEnvironment(path: string): PersistentEnvironment | null {
  if (!existsSync(path)) return null;
  const value = JSON.parse(readFileSync(path, "utf8")) as PersistentEnvironment;
  if (value.version !== 1 || value.mode !== "persistent" ||
      typeof value.initialized !== "boolean" || typeof value.schemaHash !== "string") {
    throw new Error(`持久环境配置无效，请修复配置，不能自动重新初始化：${path}`);
  }
  return value;
}

export function writePersistentEnvironment(path: string, value: PersistentEnvironment): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
}

export function persistentSchemaHash(schemaPath: string): string {
  return createHash("sha256").update(readFileSync(schemaPath)).digest("hex");
}
