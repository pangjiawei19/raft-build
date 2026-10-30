import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

// The thread's origin message is the first thing in the thread's scroller.
// raft-ui's hover toolbar rides above a message's top edge; the origin's top
// padding must hold that overhang, or the scroller clips the toolbar under the
// thread head.
test("the thread origin leaves room above it for the hover toolbar", () => {
  const root = resolve(import.meta.dirname, "..");
  const panel = readFileSync(resolve(root, "src/components/message/ThreadPanel.tsx"), "utf8");
  const parentClass = /const THREAD_PANEL_PARENT_CLASS_NAME = "([^"]+)"/.exec(panel)?.[1];
  assert.ok(parentClass, "ThreadPanel names the origin wrapper class");
  const step = /(?:^| )pt-(\d+(?:\.\d+)?)(?: |$)/.exec(parentClass)?.[1];
  assert.ok(step, "the origin wrapper sets its top padding on the spacing scale");
  const padTop = Number(step) * 4;

  const require = createRequire(import.meta.url);
  const dist = readFileSync(resolve(dirname(require.resolve("@botiverse/raft-ui")), "index.mjs"), "utf8");
  const overhang = /absolute z-20 flex items-center[^"]*"[\s\S]{0,400}?top-\[-(\d+)px\]/.exec(dist)?.[1];
  assert.ok(overhang, "raft-ui's message toolbar still rides above the message by a px offset");
  // The toolbar also draws a 1px ring outside its box.
  assert.ok(padTop >= Number(overhang) + 1, `origin top padding ${padTop}px does not hold the ${overhang}px toolbar overhang and its ring`);
});
