// Task #762: where a message's code and links are, as the markdown parser
// sees them. The web renders messages with this parser (react-markdown, i.e.
// mdast + GFM), so asking the same parser keeps "shown as code" and "skipped
// when looking for @mentions" the same thing. It replaces hand-written fence
// and backtick regexes that missed `~~~` fences, longer backtick runs and
// unclosed fences.

import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import type { Nodes, Parent } from "mdast";

export interface SourceRange {
  start: number;
  end: number;
}

export interface MarkdownLinkInfo extends SourceRange {
  /** The destination as the parser read it (angle brackets removed). */
  url: string;
  /** `[label](<target>)` or `<target>`: the forms Raft treats as refs. */
  angleBracketed: boolean;
}

export interface MarkdownStructure {
  /** Fenced, indented and inline code. */
  code: SourceRange[];
  /** Links (label and destination), autolinks, link references, images, definitions. */
  links: MarkdownLinkInfo[];
}

const CODE_TYPES = new Set(["code", "inlineCode"]);
const LINK_TYPES = new Set(["link", "linkReference", "image", "imageReference", "definition"]);

function isParent(node: Nodes): node is Parent & Nodes {
  return Array.isArray((node as Parent).children);
}

const cache = new Map<string, MarkdownStructure>();
const CACHE_LIMIT = 64;

/**
 * Code and link ranges of `source`, by source offset. Messages are parsed
 * more than once on the send path, so the last few results are kept.
 */
export function markdownStructure(source: string): MarkdownStructure {
  const cached = cache.get(source);
  if (cached) return cached;

  const structure: MarkdownStructure = { code: [], links: [] };
  const tree = fromMarkdown(source, {
    // Same as the web's message renderer (remarkDisableIndentedCode): an
    // indented line in chat is prose, not a code block.
    extensions: [gfm(), { disable: { null: ["codeIndented"] } }],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const visit = (node: Nodes) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) {
      if (CODE_TYPES.has(node.type)) {
        structure.code.push({ start, end });
        return;
      }
      if (LINK_TYPES.has(node.type)) {
        const raw = source.slice(start, end);
        const url = node.type === "link" || node.type === "definition" ? node.url : "";
        structure.links.push({
          start,
          end,
          url,
          angleBracketed: node.type === "link" && (raw === `<${url}>` || /\]\(<[^<>\n]+>\)$/.test(raw)),
        });
        return;
      }
    }
    if (isParent(node)) for (const child of node.children as Nodes[]) visit(child);
  };
  visit(tree);

  cache.set(source, structure);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  return structure;
}

/**
 * Call `visitor` for each stretch of `source` outside `ranges`, with its
 * offset. Ranges come from the parser, so they are disjoint and in order.
 */
export function visitOutsideRanges(
  source: string,
  ranges: readonly SourceRange[],
  visitor: (chunk: string, offset: number) => void,
): void {
  let cursor = 0;
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    if (range.end <= cursor) continue;
    if (range.start > cursor) visitor(source.slice(cursor, range.start), cursor);
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < source.length) visitor(source.slice(cursor), cursor);
}
