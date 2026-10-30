import assert from "node:assert/strict";
import { test } from "vitest";
import { buildCindySeedFiles, buildOnboardingObjectivesMd } from "./cindyOnboardingContent";

// A hosted (Antiproton) Cindy has no Computer: no local setup scan (tygg) and no
// `raft reminder` for a daily recap. The computer-hosted text stays as it was.
test("hosted Cindy's objectives drop the local setup scan and use the Reminder app for a daily recap", () => {
  const hosted = buildOnboardingObjectivesMd({ hosted: true });
  for (const gone of ["setup scan", "Setup-Scan Toolbox", "setup-scan", "~/.claude", "raft reminder list", "schedule a daily 10:00 reminder in the same anchor"]) {
    assert.ok(!hosted.includes(gone), `hosted text still mentions ${gone}`);
  }
  assert.match(hosted, /Continue from what they tell you about their workflows\./);
  assert.match(hosted, /with\s+the Reminder app/);
  assert.match(hosted, /## Seeded Practices/);
});

test("the computer-hosted objectives keep the setup scan and raft reminder scheduling", () => {
  const computer = buildOnboardingObjectivesMd();
  assert.match(computer, /## Setup-Scan Toolbox/);
  assert.match(computer, /Consent before setup scan/);
  assert.match(computer, /schedule a daily 10:00 reminder in the same anchor/);
  assert.equal(buildCindySeedFiles().find((f) => f.relativePath === "notes/onboarding_objectives.md")!.content, computer);
});
