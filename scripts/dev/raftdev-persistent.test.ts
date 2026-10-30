import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "vitest";
import { fileURLToPath } from "node:url";

const sourceRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function fixture(t: TestContext) {
  // 在独立仓库目录测试，nuke/destroy 永远不能看到用户真实的本地配置。
  const root = realpathSync(mkdtempSync(join(tmpdir(), "raft-persistent-")));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  const bin = join(root, "bin");
  mkdirSync(bin);
  mkdirSync(join(repo, "packages/server/src/db"), { recursive: true });
  cpSync(join(sourceRoot, "scripts/dev"), join(repo, "scripts/dev"), { recursive: true });
  for (const file of ["raftdev", "package.json", ".node-version", "packages/server/src/db/schema.ts"]) {
    cpSync(join(sourceRoot, file), join(repo, file));
  }
  symlinkSync(join(sourceRoot, "node_modules"), join(repo, "node_modules"), "dir");
  const state = join(root, "resources.json");
  const log = join(root, "commands.jsonl");
  writeFileSync(state, JSON.stringify({ containers: {}, volumes: [], sessions: [], payload: "用户数据" }));
  const tool = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const tool = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const [cmd, ...rest] = args;
const file = process.env.RAFTDEV_TEST_STATE;
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const save = () => fs.writeFileSync(file, JSON.stringify(state));
const out = value => process.stdout.write(String(value) + '\\n');
fs.appendFileSync(process.env.RAFTDEV_TEST_LOG, JSON.stringify({tool, args}) + '\\n');
if (tool === 'docker') {
  if (cmd === 'ps') {
    const names = Object.keys(state.containers).filter(name => args.includes('-a') || state.containers[name].running);
    for (const name of names) out(args.join(' ').includes('Status') ? name + '\\t' + (state.containers[name].running ? 'Up' : 'Exited') + '\\t' : name);
  } else if (cmd === 'inspect') {
    const container = state.containers[args.at(-1)];
    if (!container) process.exit(1);
    out(args.join(' ').includes('Mounts') ? JSON.stringify(container.mounts) : 'true');
  } else if (cmd === 'run' && args.includes('--name')) {
    const mounts = [];
    args.forEach((arg, i) => { if (arg === '-v') { const [Name, Destination] = args[i+1].split(':'); mounts.push({Name, Destination}); } });
    state.containers[args[args.indexOf('--name')+1]] = {running: true, mounts}; save();
  } else if (cmd === 'start' || cmd === 'stop') {
    if (!state.containers[args.at(-1)]) process.exit(1);
    state.containers[args.at(-1)].running = cmd === 'start'; save();
  } else if (cmd === 'rm') {
    delete state.containers[args.at(-1)]; save();
  } else if (cmd === 'volume') {
    const name = args.at(-1);
    if (rest[0] === 'inspect') { if (!state.volumes.includes(name)) process.exit(1); out('true'); }
    if (rest[0] === 'create') { if (!state.volumes.includes(name)) state.volumes.push(name); save(); }
    if (rest[0] === 'ls') state.volumes.forEach(out);
    if (rest[0] === 'rm') { state.volumes = state.volumes.filter(value => value !== name); save(); }
  } else if (cmd === 'network' && rest[0] === 'inspect') process.exit(1);
} else if (tool === 'tmux') {
  if (cmd === 'has-session') process.exit(state.sessions.includes(args.at(-1)) ? 0 : 1);
  if (cmd === 'list-sessions') state.sessions.forEach(out);
  if (cmd === 'new-session') { state.sessions.push(args[args.indexOf('-s')+1]); save(); }
  if (cmd === 'list-windows') out('server\\nweb\\ndaemon');
  if (cmd === 'kill-session') { state.sessions = state.sessions.filter(value => value !== args.at(-1)); save(); }
} else if (tool === 'lsof') {
  if (!state.sessions.length) process.exit(1);
  out('listener');
} else if (tool === 'npx' && cmd === 'drizzle-kit' && rest[0] === 'push') {
  process.exit(99);
} else if (tool === 'pnpm') {
  if (process.env.RAFTDEV_TEST_FAIL_BUILD === '1' && cmd === '--filter') process.exit(23);
  if (args.includes('scripts/init-local.ts')) {
    fs.writeFileSync(args[args.indexOf('--output')+1], JSON.stringify({user: {id: 'user'}, server: {id: 'server'}, machine: {apiKey: 'key-' + Date.now()}}));
  }
}
`;
  for (const name of ["docker", "tmux", "lsof", "curl", "npx", "pnpm"]) {
    writeFileSync(join(bin, name), tool);
    chmodSync(join(bin, name), 0o755);
  }
  const name = "daily";
  const environment = join(repo, ".slockdev", name);
  const credentials = join(repo, `.dev-env-${name}.json`);
  const env = {
    ...process.env, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    SLOCKDEV_PERSISTENT: "0", SLOCKDEV_TUNNEL: "0", SLOCKDEV_TRACE_WORKER: "0",
    SLOCKDEV_TRACE_OBSERVE: "0", SLOCKDEV_IDLE_TTL_SECONDS: "",
    RAFTDEV_TEST_STATE: state, RAFTDEV_TEST_LOG: log,
  };
  const run = (args: string[], extra: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath,
    ["--import", "@oxc-node/core/register", join(repo, "scripts/dev/raftdev.ts"), ...args],
    { cwd: repo, env: { ...env, ...extra }, encoding: "utf8", timeout: 20_000 });
  const ok = (args: string[]) => {
    const result = run(args);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout;
  };
  return { name, environment, credentials, state, log, run, ok,
    resources: () => JSON.parse(readFileSync(state, "utf8")),
    commands: () => readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line) as {tool: string; args: string[]}),
  };
}

test("持久环境默认常驻，重复 start 无副作用，stop/start 保留数据和身份", (t) => {
  const f = fixture(t);
  f.ok(["start", f.name, "--persistent"]);
  const before = readFileSync(f.credentials, "utf8");
  const resources = readFileSync(f.state, "utf8");
  assert.equal(readFileSync(join(f.environment, "idle-ttl-seconds"), "utf8").trim(), "0");
  assert.match(f.ok(["start", f.name]), /已在运行/);
  assert.equal(readFileSync(f.state, "utf8"), resources);
  assert.equal(readFileSync(f.credentials, "utf8"), before);
  f.ok(["stop", f.name]);
  assert.match(f.ok(["status"]), /stopped（服务已停止，持久数据保留）/);
  assert.equal(f.resources().volumes.length, 3);
  assert.equal(Object.keys(f.resources().containers).length, 3);
  assert.equal(f.resources().payload, "用户数据");
  f.ok(["start", f.name]);
  assert.equal(readFileSync(f.credentials, "utf8"), before);
  assert.equal(f.commands().filter(c => c.tool === "pnpm" && c.args.includes("scripts/init-local.ts")).length, 1);
  assert.equal(f.commands().filter(c => c.tool === "npx" && c.args.includes("migrate")).length, 1);
  assert.ok(!f.commands().some(c => c.args.includes("scripts/seed.ts") || c.args.includes("--force")));
  assert.ok(!f.commands().some(c => c.tool === "tmux" && c.args.includes("janitor")));
  assert.ok(f.commands().some(c => c.tool === "docker" && c.args.includes("--appendonly")));
});

test("持久环境启动失败会停止服务，但不会删除既有数据和凭据", (t) => {
  const f = fixture(t);
  f.ok(["init", f.name]);
  const before = readFileSync(f.credentials, "utf8");
  const result = f.run(["start", f.name], { RAFTDEV_TEST_FAIL_BUILD: "1" });
  assert.equal(result.status, 23, result.stdout + result.stderr);
  assert.equal(f.resources().volumes.length, 3);
  assert.equal(Object.keys(f.resources().containers).length, 3);
  assert.ok(Object.values(f.resources().containers).every((c: any) => !c.running));
  assert.equal(readFileSync(f.credentials, "utf8"), before);
  assert.ok(!f.commands().some(c => c.tool === "docker" && c.args.includes("rm")));
});

test("持久环境拒绝 seed/nuke，destroy 必须显式确认", (t) => {
  const f = fixture(t);
  f.ok(["init", f.name]);
  for (const args of [["seed", f.name], ["nuke"], ["destroy", f.name]]) {
    assert.equal(f.run(args).status, 1, args.join(" "));
    assert.equal(f.resources().volumes.length, 3);
    assert.ok(existsSync(f.credentials));
  }
  f.ok(["destroy", f.name, "--yes"]);
  assert.equal(f.resources().volumes.length, 0);
  assert.equal(Object.keys(f.resources().containers).length, 0);
  assert.equal(existsSync(f.credentials), false);
  assert.equal(existsSync(f.environment), false);
});

test("缺失凭据、配置或数据卷时拒绝初始化空环境替代旧数据", (t) => {
  const f = fixture(t);
  f.ok(["init", f.name]);
  const credentials = readFileSync(f.credentials, "utf8");
  rmSync(f.credentials);
  assert.match(f.run(["start", f.name]).stderr, /凭据缺失/);
  writeFileSync(f.credentials, credentials);
  const configPath = join(f.environment, "environment.json");
  const config = readFileSync(configPath, "utf8");
  rmSync(configPath);
  assert.match(f.run(["start", f.name, "--persistent"]).stderr, /配置缺失/);
  writeFileSync(configPath, config);
  const state = f.resources();
  state.volumes = state.volumes.filter((name: string) => !name.endsWith("-pg-data"));
  writeFileSync(f.state, JSON.stringify(state));
  assert.match(f.run(["start", f.name]).stderr, /持久卷.*缺失/);
  assert.equal(f.resources().volumes.length, 2);
});

test("并发 start 不会重复初始化或启动容器", (t) => {
  const f = fixture(t);
  f.ok(["init", f.name]);
  const before = readFileSync(f.state, "utf8");
  writeFileSync(join(f.environment, "lifecycle.lock"), String(process.pid));
  assert.match(f.ok(["start", f.name]), /正在执行启停操作/);
  assert.equal(readFileSync(f.state, "utf8"), before);
});

test("手动启用空闲停止时仍保留持久数据", async (t) => {
  const f = fixture(t);
  const result = f.run(["start", f.name, "--persistent"], { SLOCKDEV_IDLE_TTL_SECONDS: "1" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const before = readFileSync(f.credentials, "utf8");
  writeFileSync(join(f.environment, "last-activity"), `${Math.floor(Date.now() / 1000) - 10}\n`);
  f.ok(["janitor", f.name, "1"]);
  const deadline = Date.now() + 10_000;
  while (Object.values(f.resources().containers).some((c: any) => c.running) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(Object.values(f.resources().containers).every((c: any) => !c.running));
  assert.equal(f.resources().volumes.length, 3);
  assert.equal(readFileSync(f.credentials, "utf8"), before);
});
