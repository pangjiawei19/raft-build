// V8 keeps a script's source string alive for as long as the script lives
// (lazy compilation and Function#toString read it). A source made only of
// Latin-1 characters is stored one byte per character; a single character
// above U+00FF makes V8 store the WHOLE source as UTF-16, two bytes per
// character. The SEA bundles are tens of millions of characters, so one stray
// "→" doubles their resident size in every runner, service and CLI process.
//
// esbuild already escapes non-ASCII in strings and identifiers, and
// `minifyWhitespace` drops comments; what it leaves is a few characters inside
// regular-expression literals. This rewrites every remaining character above
// U+00FF as `\uXXXX` (one escape per UTF-16 code unit). That is the same value
// in a string, template, identifier or regex literal: in a `u` regex an escaped
// surrogate pair is still one code point, and without `u` the literal was two
// code units to begin with. It is NOT the same in a tagged template that reads
// `.raw` (esbuild leaves those alone for exactly that reason), nor right after
// a backslash. So the build only rewrites characters it has located inside a
// regular-expression literal (regexLiteralRanges) and refuses anything else.

const LATIN1_MAX = 0xff;

/** Number of UTF-16 code units above U+00FF. */
export function countNonLatin1(source) {
  let count = 0;
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) > LATIN1_MAX) count++;
  }
  return count;
}

/**
 * [start, end) offsets of every regular-expression literal, from a real parse
 * (TypeScript's parser, passed in as `ts`; the bundle is plain JS).
 */
export function regexLiteralRanges(source, ts) {
  const file = ts.createSourceFile("bundle.cjs", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  if (file.parseDiagnostics.length > 0) {
    throw new Error(`bundle does not parse: ${file.parseDiagnostics[0].messageText}`);
  }
  const ranges = [];
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) ranges.push([node.getStart(file), node.end]);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return ranges.sort((a, b) => a[0] - b[0]);
}

/** Predicate: is `index` inside one of the sorted, non-overlapping ranges? */
export function insideRanges(ranges) {
  return (index) => {
    let lo = 0;
    let hi = ranges.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const [start, end] = ranges[mid];
      if (index < start) hi = mid - 1;
      else if (index >= end) lo = mid + 1;
      else return true;
    }
    return false;
  };
}

/**
 * Returns the source with every code unit above U+00FF written as `\uXXXX`.
 * `mayRewrite(index)` says whether the character at `index` sits where the
 * rewrite keeps its meaning (inside a regex literal); anything else throws.
 */
export function escapeNonLatin1(source, label, mayRewrite) {
  let out = "";
  let start = 0;
  let escaped = 0;
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (code <= LATIN1_MAX) continue;
    if (!mayRewrite(i)) {
      throw new Error(
        `${label}: character U+${code.toString(16).toUpperCase().padStart(4, "0")} at offset ${i} is outside a ` +
          `regular-expression literal, where \\u would change its value; near: ${JSON.stringify(source.slice(Math.max(0, i - 40), i + 10))}`,
      );
    }
    let backslashes = 0;
    for (let j = i - 1; j >= 0 && source.charCodeAt(j) === 0x5c; j--) backslashes++;
    if (backslashes % 2 === 1) {
      throw new Error(
        `${label}: escaped non-Latin-1 character U+${code.toString(16).toUpperCase().padStart(4, "0")} ` +
          `at offset ${i} cannot be rewritten as \\u; near: ${JSON.stringify(source.slice(Math.max(0, i - 40), i + 10))}`,
      );
    }
    out += source.slice(start, i) + "\\u" + code.toString(16).padStart(4, "0");
    start = i + 1;
    escaped++;
  }
  return { source: escaped === 0 ? source : out + source.slice(start), escaped };
}

/** Throws unless the source is Latin-1 only (the build gate). */
export function assertLatin1Source(source, label = "bundle") {
  const count = countNonLatin1(source);
  if (count !== 0) {
    throw new Error(`${label}: ${count} character(s) above U+00FF; V8 would keep the whole source as UTF-16`);
  }
}
