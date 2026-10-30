import type { Root } from "mdast";
import { messageTokenNode, replaceTokensInTree, SKIP_CODE_AND_TOKENS } from "./remarkMessageTokens";
import type { Message } from "../../store/messageStore";

export interface ThreadSearchMessage {
  id: string;
  content?: string | null;
  senderName?: string | null;
}

export interface ThreadSearchMatch {
  messageId: string;
}

export interface ThreadSearchShortcutEvent {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

function isApplePlatform(platform: string | null | undefined): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform ?? "");
}

export function isThreadSearchShortcut(
  event: ThreadSearchShortcutEvent,
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
): boolean {
  if (event.key.toLowerCase() !== "f") return false;
  if (event.altKey || event.shiftKey) return false;
  return isApplePlatform(platform)
    ? !!event.metaKey && !event.ctrlKey
    : !!event.ctrlKey && !event.metaKey;
}

export function normalizeThreadSearchQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

export function normalizeThreadSearchSelectionText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Wrap every case-insensitive hit of the thread-search query in `<mark>`, on
 * the parsed message tree (task #762). Text inside refs, mentions and code is
 * left alone (inline code is highlighted by its own renderer); link labels are
 * marked like any other text.
 */
export function highlightThreadSearchInTree(tree: Root, query: string): void {
  const normalizedQuery = normalizeThreadSearchQuery(query);
  if (!normalizedQuery) return;
  const pattern = new RegExp(normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  replaceTokensInTree(
    tree,
    [{ pattern, replace: (match) => messageTokenNode("mark", match[0]) }],
    undefined,
    SKIP_CODE_AND_TOKENS,
  );
}

function getThreadSearchText(message: ThreadSearchMessage): string {
  return `${message.senderName ?? ""}\n${message.content ?? ""}`.toLocaleLowerCase();
}

export function buildThreadSearchMatches(
  messages: ThreadSearchMessage[],
  query: string,
): ThreadSearchMatch[] {
  const normalizedQuery = normalizeThreadSearchQuery(query);
  if (!normalizedQuery) return [];

  const matches: ThreadSearchMatch[] = [];
  for (const message of messages) {
    if (!message.id) continue;
    if (getThreadSearchText(message).includes(normalizedQuery)) {
      matches.push({ messageId: message.id });
    }
  }
  return matches;
}

export function getThreadSearchableMessages(
  parentMessage: Message | null,
  replies: Message[],
): ThreadSearchMessage[] {
  return parentMessage ? [parentMessage, ...replies] : replies;
}
