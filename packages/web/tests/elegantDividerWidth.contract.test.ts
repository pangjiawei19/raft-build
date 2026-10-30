import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// #proj-frontend task #741: divider lines are one width per theme — 1px in
// Elegant, 2px in Brutal. A bare `border-t-2 border-line-hairline` (or -b-/-r-)
// draws a 2px muted line in Elegant too, twice every other Elegant divider.
// The 2px weight must be scoped behind `theme-brutal:`.
// (Left-side `border-l-2` quote bars are accents, not dividers, and are not
// covered here.)

const srcRoot = resolve(import.meta.dirname, "../src");

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (/\.(tsx?|css)$/.test(name) && !/\.test\./.test(name)) yield path;
  }
}

test("Elegant dividers are 1px: a 2px muted divider is scoped to Brutal", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(srcRoot)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/(\S*)border-([tbr])-2 border-line-hairline/g)) {
      if (match[1].endsWith("theme-brutal:")) continue;
      const line = text.slice(0, match.index).split("\n").length;
      offenders.push(`${relative(srcRoot, file)}:${line} ${match[0]}`);
    }
  }
  assert.deepEqual(offenders, [], "use `border-X theme-brutal:border-X-2 border-line-hairline` so Elegant keeps a 1px line");
});
