import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test, vi, type TestContext } from "vitest";
import { assertComputerBuildCurrent, buildComputer, computerBuildEnvironment } from "./raftdev-computer-build";

afterEach(() => vi.unstubAllEnvs());

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "computer-freshness-"));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  for (const [dir, name, dependency] of [
    ["computer", "@botiverse/raft-computer", "@botiverse/raft-daemon"],
    ["daemon", "@botiverse/raft-daemon", "@botiverse/raft"],
    ["cli", "@botiverse/raft", "@botiverse/raft-shared"],
    ["shared", "@botiverse/raft-shared", "@botiverse/raft-sync-core"],
    ["sync-core", "@botiverse/raft-sync-core", "@botiverse/raft-trace-client"],
    ["trace-client", "@botiverse/raft-trace-client", "@botiverse/raft-shared"],
  ]) {
    write(`packages/${dir}/package.json`, JSON.stringify({ name, dependencies: { [dependency!]: "workspace:*" } }));
    write(`packages/${dir}/src/index.ts`, "export const version = 1;\n");
  }
  write("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  write("packages/shared/assets/prompt.md", "运行时提示\n");
  const builder = join(root, "builder.cjs");
  write("builder.cjs", `
const fs = require('node:fs');
const path = require('node:path');
if (process.argv.slice(2).join(' ') !== 'run build:dist') process.exit(9);
for (const file of ['dist/raft-computer.js', '../daemon/dist/core.js', '../daemon/dist/cli/raft.js']) {
  fs.mkdirSync(path.dirname(file), {recursive:true});
  fs.writeFileSync(file, '// 模拟成功构建产物\\n');
}
`);
  vi.stubEnv("npm_execpath", builder);
  return { root, write, build: () => buildComputer(root), check: () => assertComputerBuildCurrent(root) };
}

test("成功构建生成记录，未构建或记录损坏时提示完整命令", (t) => {
  const f = fixture(t);
  assert.throws(f.check, /pnpm --filter @botiverse\/raft-computer build/);
  assert.equal(f.build(), 0);
  assert.doesNotThrow(f.check);
  f.write("packages/computer/dist/.build-fingerprint.json", "损坏的记录");
  assert.throws(f.check, /缺少构建记录/);
});

test("所有传递依赖、锁文件和运行时资源变化都会要求重建", (t) => {
  const f = fixture(t);
  assert.equal(f.build(), 0);
  for (const path of [
    ...["computer", "daemon", "cli", "shared", "sync-core", "trace-client"].map(dir => `packages/${dir}/src/index.ts`),
    "pnpm-lock.yaml", "packages/shared/assets/prompt.md", "packages/computer/package.json",
  ]) {
    const original = readFileSync(join(f.root, path), "utf8");
    f.write(path, original + "\n");
    assert.throws(f.check, /构建已过期/, path);
    f.write(path, original);
    assert.doesNotThrow(f.check);
  }
});

test("新增、删除源码可识别，改回内容、时间戳和无关文档不触发重建", (t) => {
  const f = fixture(t);
  assert.equal(f.build(), 0);
  f.write("packages/computer/src/new.ts", "export const added = true;\n");
  assert.throws(f.check, /构建已过期/);
  rmSync(join(f.root, "packages/computer/src/new.ts"));
  f.write("README.md", "更新说明\n");
  f.write("packages/computer/README.md", "文档调整\n");
  f.write("packages/computer/src/index.test.ts", "// 调整测试\n");
  utimesSync(join(f.root, "packages/computer/src/index.ts"), new Date(0), new Date(0));
  assert.doesNotThrow(f.check);
  rmSync(join(f.root, "packages/computer/src/index.ts"));
  assert.throws(f.check, /构建已过期/);
});

test("新增 workspace 依赖自动纳入后续检查", (t) => {
  const f = fixture(t);
  f.write("packages/extra/package.json", JSON.stringify({ name: "@botiverse/extra" }));
  f.write("packages/extra/src/index.ts", "export const extra = 1;\n");
  f.write("packages/shared/package.json", JSON.stringify({ name: "@botiverse/raft-shared", dependencies: { "@botiverse/extra": "workspace:*" } }));
  assert.equal(f.build(), 0);
  f.write("packages/extra/src/index.ts", "export const extra = 2;\n");
  assert.throws(f.check, /构建已过期/);
});

test("构建失败即使源码未变也不能沿用旧成功记录", (t) => {
  const f = fixture(t);
  assert.equal(f.build(), 0);
  f.write("builder.cjs", "process.exit(7);\n");
  assert.equal(f.build(), 7);
  assert.throws(f.check, /缺少构建记录/);
});

test("构建中途编辑源码不会被误记为最新构建", (t) => {
  const f = fixture(t);
  f.write("builder.cjs", "require('node:fs').appendFileSync('src/index.ts', '\\n// 构建时编辑');\n");
  assert.throws(f.build, /源码发生变化/);
  assert.throws(f.check, /缺少构建记录/);
});

test("缺少或改变运行产物时，即使源码相同也要求重建", (t) => {
  const f = fixture(t);
  assert.equal(f.build(), 0);
  f.write("packages/daemon/dist/core.js", "// 不匹配的构建产物\n");
  assert.throws(f.check, /构建已过期/);
  assert.equal(f.build(), 0);
  rmSync(join(f.root, "packages/daemon/dist/cli/raft.js"));
  assert.throws(f.check, /产物不完整/);
});

test("构建资源上限覆盖过大配置，并保留更低限制和其他 Node 参数", () => {
  const capped = computerBuildEnvironment({ NODE_OPTIONS: "--trace-warnings --max-old-space-size=8192 --max-old-space-size-percentage=90", RAYON_NUM_THREADS: "16", UV_THREADPOOL_SIZE: "8", GOMAXPROCS: "16" });
  assert.equal(capped.NODE_OPTIONS, "--trace-warnings --max-old-space-size=1536");
  for (const key of ["RAYON_NUM_THREADS", "UV_THREADPOOL_SIZE", "GOMAXPROCS"]) assert.equal(capped[key], "2");
  const lower = computerBuildEnvironment({ NODE_OPTIONS: "--max_old_space_size 512", RAYON_NUM_THREADS: "1", UV_THREADPOOL_SIZE: "1", GOMAXPROCS: "1" });
  assert.equal(lower.NODE_OPTIONS, "--max-old-space-size=512");
  for (const key of ["RAYON_NUM_THREADS", "UV_THREADPOOL_SIZE", "GOMAXPROCS"]) assert.equal(lower[key], "1");
});

test("实际构建子进程继承资源限制和较低 CPU 优先级", (t) => {
  const f = fixture(t);
  const builder = readFileSync(join(f.root, "builder.cjs"), "utf8");
  f.write("builder.cjs", builder + `
fs.writeFileSync('../../resources.json',JSON.stringify({
  node:process.env.NODE_OPTIONS, rayon:process.env.RAYON_NUM_THREADS,
  uv:process.env.UV_THREADPOOL_SIZE, go:process.env.GOMAXPROCS,
  priority:require('node:os').getPriority(0)
}));
`);
  vi.stubEnv("NODE_OPTIONS", "--max-old-space-size=8192");
  assert.equal(f.build(), 0);
  const resources = JSON.parse(readFileSync(join(f.root, "resources.json"), "utf8"));
  assert.equal(resources.node, "--max-old-space-size=1536");
  for (const key of ["rayon", "uv", "go"]) assert.ok(Number(resources[key]) <= 2);
  if (process.platform !== "win32") assert.ok(resources.priority >= 10);
});

test.skipIf(process.platform === "win32")("支持原生包管理器，不会将可执行文件交给 Node 解释", (t) => {
  const f = fixture(t);
  const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
  f.write("packages/computer/run", `exec ${quote(process.execPath)} ${quote(join(f.root, "builder.cjs"))} run build:dist\n`);
  vi.stubEnv("npm_execpath", "/bin/sh");
  assert.equal(f.build(), 0);
  assert.doesNotThrow(f.check);
});
