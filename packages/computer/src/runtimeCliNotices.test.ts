import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import { readRuntimeCliNotices } from "./runtimeCliNotices";

async function homeWith(content: string | null): Promise<string> {
  const home = await mkdtemp(path.join(process.env.TMPDIR ?? tmpdir(), "cli-notices-"));
  if (content !== null) {
    await mkdir(path.join(home, "computer"), { recursive: true });
    await writeFile(path.join(home, "computer", "runtime-cli-versions.json"), content);
  }
  return home;
}

test("a recorded downgrade becomes a status line that names the fix", async () => {
  const home = await homeWith(JSON.stringify({
    schemaVersion: 1,
    versions: { codex: "codex-cli 0.151.0" },
    downgrades: { codex: { from: "codex-cli 0.163.0", to: "codex-cli 0.151.0", at: "2026-10-18T06:52:00.000Z" } },
  }));
  const [line, ...rest] = await readRuntimeCliNotices(home);
  assert.equal(rest.length, 0);
  assert.match(line!, /codex on this Computer is now codex-cli 0\.151\.0, but it was codex-cli 0\.163\.0 before/);
  assert.match(line!, /Restart the Computer from a normal login terminal, or set CODEX_BIN/);
  assert.match(line!, /If you went back to codex-cli 0\.151\.0 on purpose, ignore this\./);
});

test("no file, a bad file or no downgrades means no lines", async () => {
  assert.deepEqual(await readRuntimeCliNotices(await homeWith(null)), []);
  assert.deepEqual(await readRuntimeCliNotices(await homeWith("{not json")), []);
  assert.deepEqual(await readRuntimeCliNotices(await homeWith(JSON.stringify({ schemaVersion: 1, versions: {}, downgrades: {} }))), []);
  assert.deepEqual(await readRuntimeCliNotices(await homeWith(JSON.stringify({ schemaVersion: 2, downgrades: { codex: { from: "1", to: "0", at: "x" } } }))), []);
});
