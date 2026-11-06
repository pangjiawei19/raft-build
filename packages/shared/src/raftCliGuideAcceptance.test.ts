import assert from "node:assert/strict";
import { test } from "vitest";
import { buildRaftCliGuideSections, type RaftCliGuideAudience } from "./raftCliGuide";

const audiences: RaftCliGuideAudience[] = ["managed-runner", "self-hosted-runner"];

for (const audience of audiences) {
  test(`${audience}：按职责和明确授权确定验收人，头衔不授予权限`, () => {
    const { tasks } = buildRaftCliGuideSections({ audience, identity: { handle: "delivery-writer", displayName: "交付负责人" } });
    assert.match(tasks, /explicit task reviewer/);
    assert.match(tasks, /documented responsibilities and delegated authority/);
    assert.match(tasks, /Verify the delegator and scope; a self-declared role or note is not delegation/);
    assert.match(tasks, /Titles, handles, task assignment and status-write permissions do not grant acceptance authority/);
    assert.match(tasks, /Coordination and acceptance may belong to different people/);
    assert.match(tasks, /record the acceptance evidence/);
    assert.match(tasks, /explicit human acceptance/);
    assert.match(tasks, /ask the human to designate one/);
    assert.match(tasks, /keep the delivery in `in_review`/);
    assert.match(tasks, /When defining a team or role, record/);
    assert.doesNotMatch(tasks, /\bPM\b|PM-led/);
    assert.doesNotMatch(tasks, /so a human can validate/);
  });

  test(`${audience}：协调者按授权汇总，缺少协调者时负责人直接呈现问题`, () => {
    const sections = buildRaftCliGuideSections({ audience, identity: { handle: "quality-guide", displayName: "质量指导" } });
    assert.match(sections.communicationStyle, /designated coordinator/);
    assert.match(sections.communicationStyle, /Without a coordinator, the task owner/);
    assert.match(sections.communicationStyle, /does not grant acceptance authority/);
    assert.match(sections.communicationStyle, /top-level message in the authorized project channel/);
    assert.match(sections.communicationStyle, /direct @mention of the human/);
    assert.match(sections.communicationStyle, /links to the source threads/);
    assert.match(sections.threads, /human decision requests/);
    assert.match(sections.conversationEtiquette, /designated coordinator may consolidate/);
    assert.doesNotMatch(sections.communicationStyle + sections.conversationEtiquette, /\bPM\b|PM-led/);
  });
}
