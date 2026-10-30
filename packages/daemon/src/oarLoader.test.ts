import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadOarRuntime } from "./oarLoader";

const SRC = fileURLToPath(new URL(".", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [full] : [];
  });
}

test("source guard: the daemon loads OAR one runtime at a time, never its root entry", () => {
  // OAR's root entry loads every runtime it supports (~49 MB of heap); a
  // runtime entry is 1-2.4 MB. Values go through loadOarRuntime(); types are free.
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, "utf8");
    const rel = path.relative(SRC, file);
    for (const [statement, typeOnly] of source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"@botiverse\/oar[^"]*";/gms)) {
      if (!typeOnly) offenders.push(`${rel}: static ${statement.split("\n")[0]}`);
    }
    for (const [call] of source.matchAll(/import\("@botiverse\/oar"\)/g)) offenders.push(`${rel}: root ${call}`);
    if (rel !== "oarLoader.ts") {
      for (const [call] of source.matchAll(/import\("@botiverse\/oar\/[^"]+"\)/g)) offenders.push(`${rel}: outside oarLoader ${call}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("each account-usage provider and opencode load their own OAR runtime, once", async () => {
  for (const [id, name] of [["claude", "claude"], ["codex", "codex"], ["kimi", "kimi"], ["grok", "grok"], ["opencode", "opencode"]] as const) {
    const [first, second] = await Promise.all([loadOarRuntime(id), loadOarRuntime(id)]);
    assert.equal(first, second);
    assert.equal(first.id, name);
  }
  assert.equal(typeof (await loadOarRuntime("kimi")).accountUsage, "function");
  assert.equal(typeof (await loadOarRuntime("opencode")).listModels, "function");
});
