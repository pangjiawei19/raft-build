// Task #762: three repairs for markdown that LLMs commonly emit, done on the
// parsed tree instead of by rewriting the source before parsing. Working on
// the tree means code is never touched (the old string version ran its
// blockquote fix before protecting code) and links are never split (a URL
// containing `\n` stays one link).

import type { Blockquote, Nodes, Paragraph, Parent, PhrasingContent, Root, Text } from "mdast";
import type { VFile } from "vfile";
import { replaceTokensInTree } from "./remarkMessageTokens";

function isParent(node: Nodes): node is Parent & Nodes {
  return Array.isArray((node as Parent).children);
}

/**
 * A literal backslash-n (`\n` typed as two characters, as some LLM output
 * arrives) becomes a real newline, which remark-breaks then renders as a line
 * break. Outside code and links only.
 */
function literalNewlinesToNewlines(tree: Root, file: VFile): void {
  replaceTokensInTree(tree, [{ pattern: /\\n/g, replace: () => "\n" }], file);
}

/**
 * `- **Registration: **203 users`: CommonMark does not let the space before
 * `**` close the strong span, so the parser leaves both pairs as literal text.
 * Make it the strong span the writer meant; the space moves outside it.
 */
function strongWithClosingWhitespace(tree: Root, file: VFile): void {
  replaceTokensInTree(tree, [{
    pattern: /\*\*([^*\n]*?\S)([ \t]+)\*\*/g,
    replace: (match, { escaped }) => {
      if (escaped) return false;
      const [, content, whitespace] = match;
      const strong: PhrasingContent = { type: "strong", children: [{ type: "text", value: content }] };
      return [strong, { type: "text", value: whitespace }];
    },
  }], file);
}

/**
 * `> quote` followed by an unquoted line: CommonMark's lazy continuation
 * pulls that line into the quote. Writers (and LLMs) mean a new paragraph, so
 * the unquoted lines move out to a paragraph after the quote. Runs before
 * remark-breaks, while each source line still ends in a `\n` inside text.
 */
function splitLazyBlockquoteContinuation(tree: Root, file: VFile): void {
  const lines = String(file.value ?? "").split("\n");
  const isQuotedLine = (line: number) => /^\s*>/.test(lines[line - 1] ?? "");

  const visit = (parent: Parent) => {
    for (let index = 0; index < parent.children.length; index += 1) {
      const child = parent.children[index] as Nodes;
      if (child.type === "blockquote") {
        const outside = takeLazyLines(child, isQuotedLine);
        if (outside) parent.children.splice(index + 1, 0, outside as never);
      } else if (isParent(child)) {
        visit(child);
      }
    }
  };
  visit(tree);
}

function takeLazyLines(quote: Blockquote, isQuotedLine: (line: number) => boolean): Paragraph | null {
  const last = quote.children.at(-1);
  if (last?.type !== "paragraph") return null;
  const startLine = last.position?.start.line;
  if (startLine === undefined) return null;
  let line = startLine;
  const children = last.children;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child.type !== "text") {
      if (child.type === "break") line += 1;
      continue;
    }
    let newline = child.value.indexOf("\n");
    while (newline !== -1) {
      line += 1;
      if (!isQuotedLine(line)) {
        const before: Text = { type: "text", value: child.value.slice(0, newline) };
        const after: Text = { type: "text", value: child.value.slice(newline + 1) };
        last.children = [...children.slice(0, index), ...(before.value ? [before] : [])];
        return { type: "paragraph", children: [...(after.value ? [after] : []), ...children.slice(index + 1)] };
      }
      newline = child.value.indexOf("\n", newline + 1);
    }
  }
  return null;
}

export function repairGeneratedMarkdown(tree: Root, file: VFile): void {
  splitLazyBlockquoteContinuation(tree, file);
  literalNewlinesToNewlines(tree, file);
  strongWithClosingWhitespace(tree, file);
}

/**
 * `dm:@Twin~agent and dm:@Twin~human`: GFM reads the two single tildes as a
 * strikethrough. A `~` right after a `dm:@name` is a peer-kind suffix, so put
 * the tildes back as text before refs are matched.
 */
export function unwrapDmKindStrikethrough(tree: Root, file: VFile): void {
  const source = String(file.value ?? "");
  const visit = (parent: Parent) => {
    const next: Nodes[] = [];
    for (const child of parent.children as Nodes[]) {
      const previous = next.at(-1);
      const start = child.position?.start.offset;
      const end = child.position?.end.offset;
      if (
        child.type === "delete"
        && previous?.type === "text"
        && /dm:@[\w.-]+$/u.test(previous.value)
        && start !== undefined && end !== undefined
        && source[start] === "~" && source[start + 1] !== "~"
      ) {
        next.push({ type: "text", value: "~" }, ...(child.children as Nodes[]), { type: "text", value: "~" });
        continue;
      }
      if (isParent(child)) visit(child);
      next.push(child);
    }
    parent.children = next as Parent["children"];
  };
  visit(tree);
}
