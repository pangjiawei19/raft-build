import assert from "node:assert/strict";
import { normalizeExternalSubagentMarker } from "./externalSubagentMarker";

test("the subagent marker keeps ids and known enums only", () => {
  assert.equal(normalizeExternalSubagentMarker(undefined), null);
  assert.equal(normalizeExternalSubagentMarker("subagent"), null);
  assert.equal(normalizeExternalSubagentMarker([]), null);
  // Any object is the marker, even an unusable one: the event is still not the parent's.
  assert.deepEqual(normalizeExternalSubagentMarker({ phase: "unknown", parentToolUseId: 7 }), {});
  assert.deepEqual(
    normalizeExternalSubagentMarker({ parentToolUseId: " toolu_1 ", subagentType: "researcher", taskId: "t1", phase: "ended", outcome: "ceiling", reportChars: 0, report: "secret" }),
    { parentToolUseId: "toolu_1", subagentType: "researcher", taskId: "t1", phase: "ended", outcome: "ceiling", reportChars: 0 },
  );
  // outcome and reportChars only belong to the ended phase; bad values are dropped.
  assert.deepEqual(normalizeExternalSubagentMarker({ phase: "started", outcome: "done", reportChars: 10 }), { phase: "started" });
  assert.deepEqual(normalizeExternalSubagentMarker({ phase: "ended", outcome: "exploded", reportChars: -1 }), { phase: "ended" });
  assert.equal(normalizeExternalSubagentMarker({ taskId: "x".repeat(500) })?.taskId?.length, 160);
});
