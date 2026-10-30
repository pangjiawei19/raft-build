import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// The Computer test files CI must find, as a sorted list (same file-list shape
// as packages/cli/test-execution-manifest.json, without per-case entries).
// A list instead of a count: two PRs that each add a test file add two
// different lines, so the merge is either right or a visible conflict, never a
// silently stale number. The count is the list's length on purpose; a stored
// count would be one shared line again.
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestPath = resolve(packageRoot, "test-file-manifest.json");
const manifestName = "packages/computer/test-file-manifest.json";
const updateCommand = "pnpm --filter @botiverse/raft-computer test:update-manifest";
const updateManifest = process.argv.includes("--update-manifest");

function listTestFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTestFiles(absolute));
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      files.push(relative(packageRoot, absolute).split(sep).join("/"));
    }
  }
  return files;
}

const files = listTestFiles(resolve(packageRoot, "src")).sort();
const observed = {
  schemaVersion: 1,
  package: "@botiverse/raft-computer",
  testFileGlob: "src/**/*.test.ts",
  files,
};

if (updateManifest) {
  writeFileSync(manifestPath, `${JSON.stringify(observed, null, 2)}\n`);
  console.log(`Updated ${manifestName}: ${files.length} Computer test files`);
  process.exit(0);
}

if (!existsSync(manifestPath)) {
  console.error(`Missing ${manifestName}; run ${updateCommand}`);
  process.exit(1);
}

const expected = JSON.parse(readFileSync(manifestPath, "utf8"));
const missing = expected.files.filter((file) => !files.includes(file));
const extra = files.filter((file) => !expected.files.includes(file));

if (missing.length === 0 && extra.length === 0 && expected.files.length === files.length) {
  console.log(`Computer test files selected: ${files.length} (matches ${manifestName})`);
  process.exit(0);
}

const details = [
  `${manifestName} lists ${expected.files.length} test files; found ${files.length}.`,
  missing.length ? `missing (listed, not found): ${missing.join(", ")}` : null,
  extra.length ? `extra (found, not listed): ${extra.join(", ")}` : null,
  missing.length
    ? "Test files disappeared. Do not update the manifest to silence this; confirm the removal was intended first."
    : `If the change is intended, run ${updateCommand} and commit ${manifestName}.`,
].filter(Boolean);
console.error(details.join("\n"));
process.exit(1);
