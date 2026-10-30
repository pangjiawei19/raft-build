// Map a parsed mdast text node back onto the markdown source (task #762).

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;

export interface SourceAlignment {
  /** Source offset of each value index (and of the end, at `value.length`). */
  offsets: number[];
  /** Value indices whose character was written as a backslash escape. */
  escaped: Set<number>;
}

// Map a text node's value back onto its source. The value lost what the
// parser consumed: backslash escapes, entity references, and line prefixes
// such as a blockquote's `> `. Walking both strings side by side recovers,
// per character, where it came from and whether it was escaped.
export function alignWithSource(value: string, source: string, base: number): SourceAlignment {
  const offsets: number[] = [];
  const escaped = new Set<number>();
  let j = 0;
  for (let i = 0; i < value.length; i += 1) {
    while (j < source.length) {
      if (source[j] === "\\" && source[j + 1] === value[i] && ASCII_PUNCTUATION.test(value[i])) {
        escaped.add(i);
        offsets.push(base + j);
        j += 2;
        break;
      }
      if (source[j] === value[i]) {
        offsets.push(base + j);
        j += 1;
        break;
      }
      if (source[j] === "&") {
        const end = source.indexOf(";", j);
        if (end !== -1 && end - j <= 32) {
          offsets.push(base + j);
          j = end + 1;
          break;
        }
      }
      j += 1;
    }
    if (offsets.length === i) offsets.push(base + j);
  }
  offsets.push(base + j);
  return { offsets, escaped };
}

export function pointAt(source: string, offset: number) {
  const before = source.slice(0, offset);
  const line = before.split("\n").length;
  return { line, column: offset - before.lastIndexOf("\n"), offset };
}
