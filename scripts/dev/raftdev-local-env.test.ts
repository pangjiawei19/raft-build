import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { loadLocalEnvironment } from "./raftdev-local-env";
import { tmuxShellCommand } from "./raftdev";

test("未指定本机配置时保持原环境不变", () => {
  const env = { EXISTING: "value" };
  assert.deepEqual(loadLocalEnvironment(undefined, env), {});
  assert.deepEqual(env, { EXISTING: "value" });
});

test("本机配置传入独立服务 shell，保留显式覆盖和字面值且不执行命令", () => {
  const dir = mkdtempSync(join(tmpdir(), "raftdev-local-env-"));
  try {
    const file = join(dir, "local.env");
    const marker = join(dir, "must-not-exist");
    const value = `空格 ' 引号 ; $(touch ${marker})`;
    writeFileSync(file, `# 本机配置\nLOCAL_VALUE="${value}"\nOVERRIDE=file\nEMPTY=file\n`);
    const env: NodeJS.ProcessEnv = { OVERRIDE: "shell", EMPTY: "" };
    const carry = loadLocalEnvironment(file, env);
    assert.equal(env.LOCAL_VALUE, value);
    assert.equal(carry.OVERRIDE, "shell");
    assert.equal(carry.EMPTY, "");
    // 模拟早已启动的 tmux 服务：新窗口没有继承启动器的配置。
    const result = spawnSync("bash", ["-c", tmuxShellCommand(`exec printf '%s\\n' "$LOCAL_VALUE" "$OVERRIDE" "$EMPTY"`, carry, "/bin/bash")], {
      env: { PATH: "/usr/bin:/bin" }, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${value}\nshell\n\n`);
    assert.equal(existsSync(marker), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("显式配置路径缺失或变量名无效时拒绝加载", () => {
  const dir = mkdtempSync(join(tmpdir(), "raftdev-local-env-"));
  try {
    const file = join(dir, "local.env");
    assert.throws(() => loadLocalEnvironment(file, {}), { code: "ENOENT" });
    writeFileSync(file, "BAD-NAME=value\n");
    assert.throws(() => loadLocalEnvironment(file, {}), /无效变量名/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
