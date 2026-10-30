import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// #proj-frontend task #741: a divider line is rui's `Separator`, not a
// hand-drawn element. Hand-drawn lines drift per site (1px vs 2px, black vs
// black/15), which is what the seam audit kept finding.
// Covers the stand-alone shapes: <hr>, an empty bordered <div />, and 1px/2px
// filled bars beside a label or between toolbar items.

const srcRoot = resolve(import.meta.dirname, "../src");

const HAND_DRAWN: Array<[string, RegExp]> = [
  ["<hr>", /<hr\b/g],
  // (an empty div with its own height is a skeleton block, not a line)
  ["empty bordered div", /<div className="(?![^"\n]*\bh-)[^"\n]*\bborder-[tb](?:-2)?\b[^"\n]*"\s*\/>/g],
  ["filled bar line", /<(?:div|span) className="[^"\n]*\b(?:h-px|w-px|h-0\.5)\b[^"\n]*\bbg-line-[a-z]+[^"\n]*"[^>\n]*\/>/g],
];

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (/\.tsx$/.test(name) && !/\.test\./.test(name)) yield path;
  }
}

test("divider lines use rui's Separator, not hand-drawn elements", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(srcRoot)) {
    const text = readFileSync(file, "utf8");
    for (const [kind, pattern] of HAND_DRAWN) {
      for (const match of text.matchAll(pattern)) {
        const line = text.slice(0, match.index).split("\n").length;
        offenders.push(`${relative(srcRoot, file)}:${line} ${kind}`);
      }
    }
  }
  assert.deepEqual(offenders, [], "render `<Separator />` from raft-ui instead");
});
