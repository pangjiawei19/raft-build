import assert from "node:assert/strict";

import {
  buildThreadSearchMatches,
  getThreadSearchableMessages,
  highlightThreadSearchInTree,
  isThreadSearchShortcut,
  normalizeThreadSearchQuery,
  normalizeThreadSearchSelectionText,
} from "../src/components/message/threadSearch";

test("thread search shortcut uses Command+F on Apple platforms", () => {
  assert.equal(isThreadSearchShortcut({ key: "f", metaKey: true }, "MacIntel"), true);
  assert.equal(isThreadSearchShortcut({ key: "F", metaKey: true }, "MacIntel"), true);
  assert.equal(isThreadSearchShortcut({ key: "f", ctrlKey: true }, "MacIntel"), false);
  assert.equal(isThreadSearchShortcut({ key: "f", metaKey: true, shiftKey: true }, "MacIntel"), false);
});

test("thread search shortcut uses Ctrl+F on non-Apple platforms", () => {
  assert.equal(isThreadSearchShortcut({ key: "f", ctrlKey: true }, "Win32"), true);
  assert.equal(isThreadSearchShortcut({ key: "f", ctrlKey: true }, "Linux x86_64"), true);
  assert.equal(isThreadSearchShortcut({ key: "f", metaKey: true }, "Win32"), false);
  assert.equal(isThreadSearchShortcut({ key: "k", ctrlKey: true }, "Win32"), false);
});

test("thread search matches content and sender names in thread order", () => {
  const matches = buildThreadSearchMatches(
    [
      { id: "parent", senderName: "Alice", content: "Initial design note" },
      { id: "reply-1", senderName: "Bob", content: "Follow-up about keyboard search" },
      { id: "reply-2", senderName: "Cindy", content: "Lazy loading should be handled" },
    ],
    "search",
  );

  assert.deepEqual(matches, [{ messageId: "reply-1" }]);

  const senderMatches = buildThreadSearchMatches(
    [
      { id: "parent", senderName: "Alice", content: "Initial design note" },
      { id: "reply-1", senderName: "Bob", content: "Follow-up" },
    ],
    "alice",
  );
  assert.deepEqual(senderMatches, [{ messageId: "parent" }]);
});

test("thread search normalizes whitespace and combines parent with replies", () => {
  assert.equal(normalizeThreadSearchQuery("  NeedLe  "), "needle");
  assert.equal(normalizeThreadSearchSelectionText("  selected\n thread\ttext  "), "selected thread text");
  assert.deepEqual(buildThreadSearchMatches([{ id: "a", content: "needle" }], "   "), []);

  const searchable = getThreadSearchableMessages(
    {
      id: "parent",
      channelId: "channel",
      senderType: "user",
      senderId: "user",
      content: "Parent",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    [
      {
        id: "reply",
        channelId: "thread",
        senderType: "user",
        senderId: "user",
        content: "Reply",
        createdAt: "2026-01-01T00:00:01.000Z",
      },
    ],
  );

  assert.deepEqual(searchable.map((message) => message.id), ["parent", "reply"]);
});

function paragraph(...children: unknown[]) {
  return { type: "root", children: [{ type: "paragraph", children }] } as never;
}
function marked(tree: { children: Array<{ children: unknown[] }> }) {
  return JSON.stringify(tree.children[0].children);
}

test("thread search highlighting marks visible text on the markdown tree", () => {
  const plain = paragraph({ type: "text", value: "Before Needle after needle" });
  highlightThreadSearchInTree(plain, " needle ");
  assert.equal(marked(plain), JSON.stringify([
    { type: "text", value: "Before " },
    { type: "messageToken", data: { hName: "mark" }, children: [{ type: "text", value: "Needle" }] },
    { type: "text", value: " after " },
    { type: "messageToken", data: { hName: "mark" }, children: [{ type: "text", value: "needle" }] },
  ]));

  const ref = paragraph(
    { type: "messageToken", data: { hName: "a", hProperties: { dataChannel: "general" } }, children: [{ type: "text", value: "#general" }] },
    { type: "text", value: " plain" },
  );
  const before = marked(ref);
  highlightThreadSearchInTree(ref, "general");
  assert.equal(marked(ref), before, "refs and mentions are never split by a highlight");

  const code = paragraph({ type: "inlineCode", value: "needle" });
  highlightThreadSearchInTree(code, "needle");
  assert.equal(marked(code), JSON.stringify([{ type: "inlineCode", value: "needle" }]), "inline code has its own highlighter");

  const symbols = paragraph({ type: "text", value: "safe & <needle>" });
  highlightThreadSearchInTree(symbols, "<needle>");
  assert.match(marked(symbols), /"hName":"mark"\},"children":\[\{"type":"text","value":"<needle>"\}\]/);
});

test("thread search highlighting marks a link label and keeps the link", () => {
  const tree = paragraph({ type: "link", url: "https://example.com", children: [{ type: "text", value: "link here" }] });
  highlightThreadSearchInTree(tree, "link");
  assert.equal(marked(tree), JSON.stringify([{
    type: "link",
    url: "https://example.com",
    children: [
      { type: "messageToken", data: { hName: "mark" }, children: [{ type: "text", value: "link" }] },
      { type: "text", value: " here" },
    ],
  }]));
});
