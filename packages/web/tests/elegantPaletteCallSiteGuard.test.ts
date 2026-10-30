import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const srcRoot = resolve(import.meta.dirname, "../src");

/**
 * Elegant palette call-site guard (task #623).
 *
 * `--brand-50..950` and `--attention-50..950` and `--color-palette-yellow` only
 * exist as the brutal palette (the numeric scales are defined in the default
 * / brutal scope only). Any call site that renders them without a
 * `theme-brutal:` guard paints brutal yellow/pink inside the elegant family —
 * that is the bug this task cleaned up, and this guard is the ratchet that
 * keeps it out:
 *
 *   - a `theme-brutal:`-prefixed token is always fine (that IS the guard);
 *   - a line evaluating an `isBrutal` / `=== "brutal"` / `data-theme="brutal"`
 *     branch is fine (the miniature previews pick the brutal palette on
 *     purpose, per family);
 *   - comments are ignored;
 *   - the files below keep their brutal palette on purpose and are listed
 *     with the ruling or reason next to them.
 *
 * Replacements go to the semantic pair instead: `*-soft` / `*-strong`
 * (buttons/faces) and the `theme-brutal:` override keeps the old look.
 */

const INTENTIONAL: ReadonlyArray<readonly [file: string, reason: string]> = [
  ["components/layout/LeftRail.tsx", "brand signature strip — intentional across all themes (Grace ruling)"],
  ["components/settings/ThemePresetCard.tsx", "Brutal theme card preview: must look Brutal under every theme (task #247)"],
  ["components/ConfirmDialog.tsx", "legacy class-string → rui variant map (keys are identifiers, not rendered)"],
  ["index.css", "token table (definitions + global ::selection now on the semantic pair)"],
];

// raft-ui 0.7.0 renamed `primary-*` → `brand-*`, `accent-*` → `attention-*`
// and `soft-signal` → `palette-yellow`; the former names stay as deprecated
// aliases, so both spellings are scanned.
const TOKEN = /(?:^|[\s"'`({[])((?:[a-z-]+(?:\/[a-z-]+)?:)*)((?:bg|text|border|ring|fill|stroke|outline|shadow|decoration|divide|from|to|via|caret|accent|placeholder)-)(palette-yellow|soft-signal|(?:brand|primary|attention|accent)-(?:50|[1-9]00|950))/g;

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

function isBrutalScoped(line: string): boolean {
  return (
    /\bisBrutal\b/.test(line) ||
    /===\s*"brutal"/.test(line) ||
    /data-theme="brutal"/.test(line) ||
    /data-theme='brutal'/.test(line)
  );
}

/** Returns the offending `prefix+utility+family` tokens on one line. */
export function findElegantPaletteOffenders(line: string): string[] {
  if (isCommentLine(line) || isBrutalScoped(line)) return [];
  const offenders: string[] = [];
  for (const match of line.matchAll(TOKEN)) {
    const prefix = match[1] ?? "";
    if (prefix.includes("theme-brutal:")) continue;
    offenders.push(`${prefix}${match[2]}${match[3]}`);
  }
  return offenders;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx|css)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

test("CONTROL: the scanner flags an unguarded palette token", () => {
  assert.deepEqual(findElegantPaletteOffenders('className="bg-palette-yellow/30"'), [
    "bg-palette-yellow",
  ]);
  assert.deepEqual(findElegantPaletteOffenders('className="hover:bg-brand-400"'), [
    "hover:bg-brand-400",
  ]);
  assert.deepEqual(findElegantPaletteOffenders('className="text-brand-950/70"'), [
    "text-brand-950",
  ]);
  // The deprecated aliases still render the same palette.
  assert.deepEqual(
    findElegantPaletteOffenders('className="bg-soft-signal hover:bg-primary-400 text-accent-700"'),
    ["bg-soft-signal", "hover:bg-primary-400", "text-accent-700"],
  );
  assert.deepEqual(findElegantPaletteOffenders('className="bg-attention-400"'), [
    "bg-attention-400",
  ]);
  // …and clears every allowed shape.
  assert.deepEqual(findElegantPaletteOffenders('className="theme-brutal:bg-brand-400"'), []);
  assert.deepEqual(findElegantPaletteOffenders("// historic: bg-palette-yellow/30 hover"), []);
  assert.deepEqual(
    findElegantPaletteOffenders('className={`${isBrutal ? "bg-brand-400" : "bg-brand-soft"}`}'),
    [],
  );
});

test("no unguarded brutal-palette call sites outside the intentional surfaces", () => {
  const allowed = new Set(INTENTIONAL.map(([file]) => file));
  const offenders: string[] = [];
  for (const file of walk(srcRoot)) {
    const rel = relative(srcRoot, file);
    if (allowed.has(rel)) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const token of findElegantPaletteOffenders(line)) {
        offenders.push(`${rel}:${index + 1}: ${token}`);
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `Unguarded brutal-palette call sites found. Use the semantic pair (*-soft / *-strong), or prefix the token with theme-brutal: when the brutal look is intended:\n${offenders.join("\n")}`,
  );
});
