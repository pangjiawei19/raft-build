import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import "./helpers/domSetup";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SkillInfo } from "@botiverse/raft-shared";
import api from "../src/api/client";
import AgentSkills from "../src/components/agent/AgentSkills";
import { TestIntlProvider } from "./helpers/intl";

const originalApiGet = api.get;

afterEach(() => {
  api.get = originalApiGet;
  cleanup();
});

function skill(name: string, description: string, userInvocable = false): SkillInfo {
  return { name, displayName: name, description, userInvocable, sourcePath: "~/.claude/skills" };
}

test("long skill lists render as compact rows inside one scrolling box, expanding on click", async () => {
  // Agents carry dozens of skills; one card each ran to several screens.
  const workspace = Array.from({ length: 40 }, (_, index) => skill(`skill-${index}`, `Description of skill ${index}.`));
  workspace[0] = skill("architect", "Sketch types before code.", true);
  api.get = (async () => ({ data: { global: [], workspace } })) as unknown as typeof api.get;

  render(
    <TestIntlProvider locale="en">
      <AgentSkills agentId="agent-1" embedded />
    </TestIntlProvider>,
  );

  const list = await screen.findByTestId("agent-skills-list");
  assert.match(list.className, /max-h-80/);
  assert.match(list.className, /overflow-y-auto/);
  const rows = list.querySelectorAll(":scope > li > button");
  assert.equal(rows.length, 40);

  const first = rows[0] as HTMLButtonElement;
  assert.equal(first.getAttribute("aria-expanded"), "false");
  assert.match(first.textContent ?? "", /architect/);
  assert.match(first.textContent ?? "", /\/architect/i);
  const collapsedDescription = first.querySelector(".truncate");
  assert.ok(collapsedDescription !== null, "collapsed rows show a one-line description");

  fireEvent.click(first);
  assert.equal(first.getAttribute("aria-expanded"), "true");
  assert.ok(first.querySelector(".truncate") === null, "the expanded row shows the full description");
  assert.match(first.textContent ?? "", /Sketch types before code\./);
  assert.ok(screen.queryByRole("textbox") === null, "no search box");
});
