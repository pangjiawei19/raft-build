import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import ts from "typescript";

// Every `raft` call is a fresh process that parses the whole CLI bundle, so
// the shared code the CLI pulls in is paid on every call. The shared root
// index re-exports ~80 modules the CLI does not use; the CLI takes values from
// `@botiverse/raft-shared/src/agentCliSurface` instead, which re-exports them
// from their defining modules. Types may still come from the root index:
// `import type` is erased from the bundle.

const SHARED_ROOT = "@botiverse/raft-shared";
const sourceRoot = import.meta.dirname;
const sharedSrc = resolve(sourceRoot, "../../shared/src");
const sharedIndex = join(sharedSrc, "index.ts");

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) files.push(...walk(fullPath));
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) files.push(fullPath);
  }
  return files;
}

function parse(file: string, source = readFileSync(file, "utf8")): ts.SourceFile {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/** Module specifiers a file loads at runtime: type-only imports and re-exports are skipped. */
function runtimeSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.importClause?.isTypeOnly) specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.isTypeOnly) specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

function cliRootIndexImports(file: string, source?: string): string[] {
  return runtimeSpecifiers(parse(file, source))
    .filter((specifier) => specifier === SHARED_ROOT)
    .map(() => relative(sourceRoot, file));
}

const sharedExports = JSON.parse(readFileSync(resolve(sharedSrc, "../package.json"), "utf8")).exports as Record<
  string,
  { default?: string }
>;

/** Shared file a specifier loads: relative imports, or shared imported by its own package name. */
function resolveSharedModule(fromFile: string, specifier: string): string | null {
  if (specifier === SHARED_ROOT || specifier.startsWith(`${SHARED_ROOT}/`)) {
    const target = sharedExports[`.${specifier.slice(SHARED_ROOT.length)}`]?.default;
    return target ? resolve(sharedSrc, "..", target) : null;
  }
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [`${base}.ts`, join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Shared modules agentCliSurface loads at runtime, following relative and package-name imports. */
function surfaceRuntimeGraph(): Set<string> {
  const seen = new Set<string>();
  const queue = [join(sharedSrc, "agentCliSurface.ts")];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of runtimeSpecifiers(parse(file))) {
      const resolved = resolveSharedModule(file, specifier);
      if (resolved) queue.push(resolved);
    }
  }
  return seen;
}

test("CLI source imports shared values through agentCliSurface, not the shared root index", () => {
  const offenders = walk(sourceRoot).flatMap((file) => cliRootIndexImports(file));
  assert.deepEqual(
    offenders,
    [],
    `import values from "${SHARED_ROOT}/src/agentCliSurface" (re-export them there from their defining module); ` +
      `only \`import type\` may use "${SHARED_ROOT}"`,
  );
});

test("agentCliSurface does not load the shared root index", () => {
  const graph = surfaceRuntimeGraph();
  assert.ok(graph.size > 1, "agentCliSurface re-exports at least one module");
  const path = [...graph].find((file) => file === sharedIndex);
  assert.equal(path, undefined, "a module agentCliSurface loads imports a value from the shared root index");
});

test("the root-index guard ignores type-only imports and catches value imports", () => {
  const file = join(sourceRoot, "synthetic.ts");
  assert.deepEqual(cliRootIndexImports(file, `import type { A } from "${SHARED_ROOT}";\nexport type { B } from "${SHARED_ROOT}";\n`), []);
  for (const source of [
    `import { a } from "${SHARED_ROOT}";`,
    `import { type A, b } from "${SHARED_ROOT}";`,
    `import { type A } from "${SHARED_ROOT}";`,
    `import "${SHARED_ROOT}";`,
    `export { a } from "${SHARED_ROOT}";`,
    `const m = await import("${SHARED_ROOT}");`,
  ]) {
    assert.deepEqual(cliRootIndexImports(file, source), ["synthetic.ts"], source);
  }
});

test("the surface walk follows shared imported by its own package name", () => {
  const from = join(sharedSrc, "agentText", "tasks.ts");
  assert.equal(resolveSharedModule(from, SHARED_ROOT), sharedIndex);
  assert.equal(resolveSharedModule(from, `${SHARED_ROOT}/src/agentApiContract`), join(sharedSrc, "agentApiContract.ts"));
  assert.equal(resolveSharedModule(from, "../agentApiContract"), join(sharedSrc, "agentApiContract.ts"));
  assert.equal(resolveSharedModule(from, "zod"), null);
});
