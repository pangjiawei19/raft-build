import assert from "node:assert/strict";
import { createRequire } from "node:module";
import vm from "node:vm";
import { test } from "vitest";

import {
  assertLatin1Source,
  countNonLatin1,
  escapeNonLatin1,
  insideRanges,
  regexLiteralRanges,
} from "./latin1Source.mjs";

const ts = createRequire(import.meta.url)("typescript");

function evaluate(source) {
  return vm.runInThisContext(source);
}

function rewrite(source) {
  return escapeNonLatin1(source, "probe", insideRanges(regexLiteralRanges(source, ts)));
}

test("regex literals keep their meaning after the rewrite", () => {
  const source = [
    "({",
    // Strings are already escaped by esbuild; only the regex literals are raw.
    "  bullet: /[*•…]/u.test('\\u2022') && !/[*•…]/u.test('-'),",
    "  emojiU: /^😀$/u.test('\\ud83d\\ude00'),",
    "  emojiLegacy: /^😀$/.test('\\ud83d\\ude00'),",
    "  classU: /[√≤]/u.test('\\u2264') && !/[√≤]/u.test('<'),",
    "  words: /^(广告|Реклама)$/iu.test('\\u0440\\u0435\\u043a\\u043b\\u0430\\u043c\\u0430'),",
    "  division: 4 / 2,",
    "  latin1: 'café',",
    "})",
  ].join("\n");
  const { source: escaped, escaped: count } = rewrite(source);
  assert.ok(count > 0);
  assert.equal(countNonLatin1(escaped), 0);
  assert.deepEqual(evaluate(escaped), evaluate(source));
  // Every probe must actually match, or equal results would prove nothing.
  for (const [key, value] of Object.entries(evaluate(escaped))) {
    if (typeof value === "boolean") assert.equal(value, true, key);
  }
  // Latin-1 characters (é) are left alone; only what forces UTF-16 is rewritten.
  assert.ok(escaped.includes("café"));
});

test("a character outside a regex literal is refused, not rewritten", () => {
  // String.raw reads the template's raw text: `→` would change its value.
  assert.throws(() => rewrite("String.raw`a→b`"), /probe: character U\+2192 .* outside a regular-expression literal/);
  assert.throws(() => rewrite("const s = 'a→b';"), /outside a regular-expression literal/);
  assert.throws(() => rewrite("// → comment\n1"), /outside a regular-expression literal/);
});

test("a character right after a backslash is refused, not rewritten", () => {
  assert.throws(() => rewrite("/\\•/"), /probe: escaped non-Latin-1 character U\+2022/);
  // An escaped backslash before it is fine: the character itself is not escaped.
  const { source } = rewrite("/\\\\•/.source");
  assert.equal(evaluate(source), "\\\\\\u2022");
});

test("a source that is already Latin-1 is returned unchanged", () => {
  const source = "const s = 'naïve';";
  const result = escapeNonLatin1(source, "probe", () => false);
  assert.equal(result.escaped, 0);
  assert.equal(result.source, source);
});

test("the build gate fails on anything above U+00FF", () => {
  assert.doesNotThrow(() => assertLatin1Source("ascii and ÿ"));
  assert.throws(() => assertLatin1Source("one → arrow", "computer.cjs"), /computer\.cjs: 1 character/);
});
