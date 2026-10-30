import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

// A raft-ui search field: the DS Search shape (`rf-search`), the glyph in an
// InputGroup addon and the bare InputGroupInput control, which carries the DS
// field type.
const SEARCH_FIELD = /<InputGroup\b[^>]*>\s*<InputGroupAddon align="inline-start">\s*<Search aria-hidden="true" \/>\s*<\/InputGroupAddon>\s*<InputGroupInput\b([^>]*)>/g;

function searchFields(source: string): string[] {
  return [...source.matchAll(SEARCH_FIELD)].map((match) => match[1] ?? "");
}

test("channel member searches use a real 16px font on coarse pointers without scale or viewport hacks", () => {
  const css = read("src/index.css");
  const members = [
    read("src/components/agent/ChannelMembers.tsx"),
    read("src/components/agent/MemberRoleActions.tsx"),
  ].join("\n");
  const createChannel = read("src/components/channel/CreateChannelDialog.tsx");
  const createJoint = read("src/components/channel/CreateJointChannelDialog.tsx");

  // iOS Safari zooms the viewport when a focused control renders below 16px.
  // raft-ui's field type is that real 16px on every pointer (DS TextField:
  // "input 16/24"), so no local font-size rule, transform or scale is needed.
  const foundation = readFileSync(createRequire(import.meta.url).resolve("@botiverse/raft-ui/foundation.css"), "utf8");
  assert.match(foundation, /--field-font-size:\s*16px;/, "raft-ui's field type must stay a real 16px control");
  assert.doesNotMatch(
    css,
    /input-member-search/,
    "the local member-search rule restated raft-ui's input from a lower layer and never applied; it must not come back",
  );

  const groups: Array<[string, string, number, string]> = [
    ["members page and add flow", members, 2, "members page and add flow must share the raft-ui search field"],
    ["ordinary channel member picker", createChannel, 1, "ordinary channel member picker must use the same raft-ui search field"],
    ["Joint channel member picker", createJoint, 1, "Joint channel member picker must use the same raft-ui search field"],
  ];
  for (const [name, source, count, message] of groups) {
    const fields = searchFields(source);
    assert.equal(fields.length, count, message);
    for (const props of fields) {
      assert.doesNotMatch(
        props,
        /className=|text-(?:sm|xs|callout|footnote|\[)/,
        `${name}: the search control keeps raft-ui's 16px field type (no class override)`,
      );
    }
    assert.doesNotMatch(source, /absolute left-3 top-1\/2/, `${name}: the search glyph sits in an InputGroup addon, not over the input`);
  }
});
