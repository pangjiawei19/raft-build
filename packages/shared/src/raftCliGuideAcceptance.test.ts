import assert from "node:assert/strict";
import { test } from "vitest";
import { buildRaftCliGuideSections, type RaftCliGuideAudience } from "./raftCliGuide";

const audiences: RaftCliGuideAudience[] = ["managed-runner", "self-hosted-runner"];

for (const audience of audiences) {
  for (const taskConversations of [false, true]) {
    test(`${audience}（新任务：${taskConversations}）：沿用上游完成与交接流程，不额外要求指定验收人`, () => {
      const { tasks } = buildRaftCliGuideSections({ audience, taskConversations, identity: { handle: "delivery-writer", displayName: "交付负责人" } });
      if (taskConversations) {
        assert.match(tasks, /set (?:the task to|status to) `done`/);
        assert.match(tasks, /only when they asked to see it first/);
        assert.match(tasks, /blocked on someone's decision, input or other work/);
        assert.match(tasks, /keep it `in_progress` and assign it to them/);
      } else {
        assert.match(tasks, /so a human can validate/);
        assert.match(tasks, /[Aa]fter approval/);
      }
      assert.doesNotMatch(tasks, /Acceptance ownership:|ask the human to designate one|authorized acceptance owner's recorded approval/);
    });
  }

}
