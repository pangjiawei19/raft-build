import { describe, expect, it } from "vitest";

import { renderThreadWindow, THREAD_WINDOW_PREVIEW_CHARS } from "./passiveResources";

describe("renderThreadWindow", () => {
  it("anchors the skipped line on the lowest shown seq and names the command for older messages", () => {
    expect(renderThreadWindow({
      target: "#ops:1a2b3c4d",
      start: { seq: 5, sender: "richard", content: "root" },
      omittedCount: 2,
      messages: [
        { seq: 9, sender: "scout", timestamp: "2026-10-15T09:01:00.000Z", content: "b" },
        { seq: 8, sender: "scout", timestamp: "2026-10-15T09:00:00.000Z", content: "a" },
      ],
    })).toEqual([
      `  ┌ Thread start ${"─".repeat(28)}`,
      "  │ @richard  root",
      "  ├ ⋯ 2 earlier messages skipped in this notice. Older exist: raft message read --target \"#ops:1a2b3c4d\" --before 8. ⋯",
      `  ├ Latest 2 ${"─".repeat(28)}`,
      "  │ @scout 09:01  b",
      "  │ @scout 09:00  a",
      "  └ Previews are truncated. Full text: raft message read --target \"#ops:1a2b3c4d\"",
    ]);
  });

  it("prints no skipped line when no shown message has a seq to anchor on", () => {
    const lines = renderThreadWindow({
      target: "#general",
      omittedCount: 3,
      messages: [{ sender: "scout", content: "no seq" }],
    });
    expect(lines.join("\n")).not.toContain("skipped");
    expect(lines.join("\n")).not.toContain("Infinity");
  });

  it("truncates previews by code point and says how much is hidden", () => {
    const [, preview] = renderThreadWindow({
      target: "#general",
      omittedCount: 0,
      messages: [{ seq: 1, content: "字".repeat(THREAD_WINDOW_PREVIEW_CHARS + 7) }],
    });
    expect(preview).toBe(`  │ ${"字".repeat(THREAD_WINDOW_PREVIEW_CHARS)}…⟨7 more chars⟩`);
  });
});
