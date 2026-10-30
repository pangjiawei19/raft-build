import assert from "node:assert/strict";

import { ambientProcessEnv, withProcessEnvPatch } from "./processEnvPatch";

test("ambientProcessEnv undoes an active patch: replaced keys get their old value, added keys are absent", async () => {
  process.env.TASK28_REPLACED = "daemon";
  delete process.env.TASK28_ADDED;
  try {
    await withProcessEnvPatch({ TASK28_REPLACED: "agent", TASK28_ADDED: "agent" }, async () => {
      await Promise.resolve(); // across an await, as Pi's session creation is
      assert.equal(process.env.TASK28_REPLACED, "agent");
      const ambient = ambientProcessEnv();
      assert.equal(ambient.TASK28_REPLACED, "daemon");
      assert.equal("TASK28_ADDED" in ambient, false);
    });
    // Outside a patch it is a plain copy of process.env.
    assert.equal(ambientProcessEnv().TASK28_REPLACED, "daemon");
    assert.notEqual(ambientProcessEnv(), process.env);
  } finally {
    delete process.env.TASK28_REPLACED;
  }
});

test("removeFirst keys are hidden from the patched process but stay visible in the ambient env", async () => {
  process.env.TASK28_REMOVED = "daemon";
  try {
    await withProcessEnvPatch(null, async () => {
      assert.equal(process.env.TASK28_REMOVED, undefined);
      assert.equal(ambientProcessEnv().TASK28_REMOVED, "daemon");
    }, { removeFirst: ["TASK28_REMOVED"] });
    assert.equal(process.env.TASK28_REMOVED, "daemon");
  } finally {
    delete process.env.TASK28_REMOVED;
  }
});

// ── task #28: every child the daemon starts gets the daemon's own env ────────

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { runProbeChild } from "./drivers/probeChild";

const SRC = fileURLToPath(new URL(".", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [full] : [];
  });
}

const CHILD_PROCESS_CALLS = new Set(["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync", "fork"]);
/** Not daemon code: test infrastructure that runs build commands. */
const CHILD_ENV_ALLOWLIST = new Set(["testing/seaHostHarness.ts"]);

test("source guard: every node:child_process call passes an explicit env", () => {
  // A call without `env` inherits process.env as it is at that moment, which
  // inside a Pi session-create window is another agent's (task #28). Pass
  // ambientProcessEnv(), or an env built from it.
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file);
    if (CHILD_ENV_ALLOWLIST.has(rel)) continue;
    const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const local = new Map<string, string>();
    const namespaces = new Set<string>();
    for (const statement of sf.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      if (!/^(node:)?child_process$/.test(statement.moduleSpecifier.text)) continue;
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const original = (element.propertyName ?? element.name).text;
          if (CHILD_PROCESS_CALLS.has(original)) local.set(element.name.text, original);
        }
      }
      if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
      if (statement.importClause?.name) namespaces.add(statement.importClause.name.text);
    }
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const called = ts.isIdentifier(callee) && local.has(callee.text)
          ? local.get(callee.text)
          : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && namespaces.has(callee.expression.text) && CHILD_PROCESS_CALLS.has(callee.name.text)
            ? callee.name.text
            : undefined;
        if (called) {
          const options = node.arguments.find((argument, index) => index > 0 && ts.isObjectLiteralExpression(argument));
          const hasEnv = options !== undefined && ts.isObjectLiteralExpression(options) && options.properties.some((property) =>
            (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) && property.name.getText(sf) === "env");
          // `{ ...options, env: ... }` and an opaque options variable are only
          // accepted when the object literal names env itself.
          if (!hasEnv) offenders.push(`${rel}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} ${called}()`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  assert.deepEqual(offenders, []);
});

test("source guard: runtime code builds child envs from ambientProcessEnv(), never process.env", () => {
  // drivers/pi.ts is exempt: it runs inside the patch and reads it on purpose.
  const offenders: string[] = [];
  for (const dir of ["drivers", "runtimeAccountUsage"]) {
    for (const file of sourceFiles(path.join(SRC, dir))) {
      const rel = path.relative(SRC, file);
      if (rel === path.join("drivers", "pi.ts")) continue;
      readFileSync(file, "utf8").split("\n").forEach((line, index) => {
        if (/(\?\?|\|\|)\s*process\.env\b(?![.[])|\benv:\s*process\.env\b(?![.[])|\.\.\.process\.env\b/.test(line)) {
          offenders.push(`${rel}:${index + 1} ${line.trim()}`);
        }
      });
    }
  }
  assert.deepEqual(offenders, []);
});

test("a probe child started inside a patch window gets the daemon's env, not the patch", async () => {
  delete process.env.TASK28_PROBE_LEAK;
  let stdout = "";
  await withProcessEnvPatch({ TASK28_PROBE_LEAK: "agent" }, async () => {
    ({ stdout } = await runProbeChild(process.execPath, ["-e", "process.stdout.write(String(process.env.TASK28_PROBE_LEAK))"], { timeoutMs: 10_000 }));
  });
  assert.equal(stdout, "undefined");
});
