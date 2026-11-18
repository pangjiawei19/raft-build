import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const stampName = ".build-fingerprint.json";
const ignoredDirectories = new Set(["node_modules", "dist", ".git", ".cache", ".gradle", "build", "coverage"]);

/** 从 workspace 依赖递归收集输入，包含新增依赖和未提交文件，不依赖提交时间或文件时间。 */
export function computerSourceFingerprint(root: string): string {
  const packages = new Map<string, string>();
  for (const entry of readdirSync(join(root, "packages"), { withFileTypes: true })) {
    const dir = join("packages", entry.name);
    const manifest = join(root, dir, "package.json");
    if (entry.isDirectory() && existsSync(manifest)) {
      packages.set(JSON.parse(readFileSync(manifest, "utf8")).name, dir);
    }
  }
  const files: string[] = [];
  const visited = new Set<string>();
  function visit(name: string): void {
    if (visited.has(name)) return;
    visited.add(name);
    const dir = packages.get(name);
    if (!dir) throw new Error(`缺少 Computer 的 workspace 依赖：${name}`);
    const manifest = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));
    const dependencies = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies };
    for (const [dependency, version] of Object.entries(dependencies)) {
      if (String(version).startsWith("workspace:")) visit(dependency);
    }
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && ["src", "scripts", "assets", "contracts", "agent-api", "openapi"].includes(entry.name)) {
        files.push(...treeFiles(root, path, true));
      } else if (entry.isFile() && /\.(?:[cm]?[jt]sx?|json)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) {
        files.push(path);
      }
    }
  }
  visit("@botiverse/raft-computer");
  for (const file of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc", ".node-version", "tsconfig.json", "scripts/dev/raftdev-computer-build.ts"]) {
    if (existsSync(join(root, file))) files.push(file);
  }
  return fingerprint(root, files);
}

function treeFiles(root: string, dir: string, source = false): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return ignoredDirectories.has(entry.name) ? [] : treeFiles(root, path, source);
    if (!entry.isFile() || entry.name === stampName) return [];
    if (source && /\.(?:test|spec)\./.test(entry.name)) return [];
    return [path];
  });
}

function fingerprint(root: string, files: string[]): string {
  const hash = createHash("sha256");
  for (const file of files.sort()) {
    const content = createHash("sha256").update(readFileSync(join(root, file))).digest("hex");
    hash.update(JSON.stringify([file.replaceAll("\\", "/"), content]));
  }
  return hash.digest("hex");
}

function computerOutputFingerprint(root: string): string {
  for (const file of ["packages/computer/dist/raft-computer.js", "packages/daemon/dist/core.js", "packages/daemon/dist/cli/raft.js"]) {
    if (!existsSync(join(root, file))) throw new Error(`Computer 构建产物缺失：${file}`);
  }
  return fingerprint(root, ["packages/computer/dist", "packages/daemon/dist"].flatMap(dir => treeFiles(root, dir)));
}

export function computerBuildIsCurrent(root: string): boolean {
  try {
    const stamp = JSON.parse(readFileSync(join(root, "packages/computer/dist", stampName), "utf8"));
    return stamp.version === 1 && stamp.sources === computerSourceFingerprint(root) && stamp.outputs === computerOutputFingerprint(root);
  } catch { /* 缺失、旧格式或损坏的记录均需要重新构建。 */ }
  return false;
}

export function assertComputerBuildCurrent(root: string): void {
  if (computerBuildIsCurrent(root)) return;
  throw new Error(
    "Computer 构建已过期、产物不完整或缺少构建记录。请先在仓库根目录执行：\n" +
    "  NODE_OPTIONS=--max-old-space-size=1536 RAYON_NUM_THREADS=2 UV_THREADPOOL_SIZE=2 pnpm --filter @botiverse/raft-computer build\n" +
    "构建成功后重试 start／restart。",
  );
}

/** 限制整条构建链继承的堆和线程参数；更低的用户限制保持有效。 */
export function computerBuildEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const options = env.NODE_OPTIONS ?? "";
  const heapOption = /(?:^|\s)--max[-_]old[-_]space[-_]size(?:=|\s+)(\d+)(?=\s|$)/g;
  const limits = [...options.matchAll(heapOption)].map(match => Number(match[1])).filter(value => value > 0);
  const remaining = options.replace(heapOption, " ")
    .replace(/(?:^|\s)--max[-_]old[-_]space[-_]size[-_]percentage(?:=|\s+)\S+/g, " ").trim();
  const threads = (value: string | undefined): string => {
    const count = Number(value);
    return String(Number.isSafeInteger(count) && count > 0 ? Math.min(count, 2) : 2);
  };
  return {
    ...env,
    NODE_OPTIONS: `${remaining} --max-old-space-size=${Math.min(1536, ...limits)}`.trim(),
    RAYON_NUM_THREADS: threads(env.RAYON_NUM_THREADS),
    UV_THREADPOOL_SIZE: threads(env.UV_THREADPOOL_SIZE),
    GOMAXPROCS: threads(env.GOMAXPROCS),
  };
}

/** 只有整条构建链成功且输入未变化时，才记录源码和产物指纹。 */
export function buildComputer(root: string): number {
  const manager = process.env.npm_execpath;
  if (!manager) throw new Error("请使用 pnpm --filter @botiverse/raft-computer build 构建。");
  const stamp = join(root, "packages/computer/dist", stampName);
  rmSync(stamp, { force: true });
  const sources = computerSourceFingerprint(root);
  // pnpm 既可能是 Node 脚本，也可能是独立原生程序，不能一律交给 Node 解释。
  const script = /\.[cm]?js$/i.test(manager);
  const command = script ? process.execPath : manager;
  const args = [...(script ? [manager] : []), "run", "build:dist"];
  const result = spawnSync(process.platform === "win32" ? command : "nice", process.platform === "win32" ? args : ["-n", "10", command, ...args], {
    cwd: join(root, "packages/computer"), stdio: "inherit", env: computerBuildEnvironment(process.env),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) return result.status ?? 1;
  if (computerSourceFingerprint(root) !== sources) throw new Error("构建过程中源码发生变化，请重新构建 Computer。");
  const outputs = computerOutputFingerprint(root);
  const temporary = `${stamp}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ version: 1, sources, outputs }) + "\n");
  renameSync(temporary, stamp);
  console.log("Computer 构建记录已更新。");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  process.exitCode = buildComputer(root);
}
