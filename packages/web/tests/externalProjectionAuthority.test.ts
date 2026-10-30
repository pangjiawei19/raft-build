import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const messageItemSource = readFileSync(
  new URL("../src/components/message/MessageItem.tsx", import.meta.url),
  "utf8",
);

test("external Human projection has app attribution but no native Raft authority affordances", () => {
  assert.match(messageItemSource, /const isExternal = message\.senderType === "external_projection"/);
  // Read-only (public) projections render only their own display-only facts;
  // every member render of external text keeps the empty external map.
  assert.match(messageItemSource, /effectiveMentionMap = readOnlyProjection\s*\? structuredMentionMap\s*: isExternal \? EXTERNAL_MESSAGE_MENTION_MAP : mentionMap/);
  assert.match(messageItemSource, /if \(isExternal\) return null;/);
  assert.match(messageItemSource, /supportsMessageTasks && \([\s\S]*?!isExternal \?/);
  assert.match(messageItemSource, /showExternal=\{isExternal\}/);
});
