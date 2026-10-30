import assert from "node:assert/strict";
import { test } from "vitest";
import { AGENT_NAME_ADJECTIVES, AGENT_NAME_NOUNS, suggestAgentName } from "./agentNameGenerator";
import { validateAgentName } from "./index";

test("every adjective-noun pair is a valid agent name", () => {
  for (const adjective of AGENT_NAME_ADJECTIVES) {
    for (const noun of AGENT_NAME_NOUNS) {
      const name = `${adjective}-${noun}`;
      assert.equal(validateAgentName(name), null, name);
    }
  }
});

test("the word lists have no duplicates and give thousands of names", () => {
  assert.equal(new Set(AGENT_NAME_ADJECTIVES).size, AGENT_NAME_ADJECTIVES.length);
  assert.equal(new Set(AGENT_NAME_NOUNS).size, AGENT_NAME_NOUNS.length);
  assert.ok(AGENT_NAME_ADJECTIVES.length * AGENT_NAME_NOUNS.length >= 5_000);
});

test("suggestAgentName never returns a taken name while any pair is free", () => {
  const all = AGENT_NAME_ADJECTIVES.flatMap((adjective) => AGENT_NAME_NOUNS.map((noun) => `${adjective}-${noun}`));
  // Everything taken except one pair (in another case): whatever the random
  // value, that pair is the answer.
  const onlyFree = all[1234]!;
  const taken = all.filter((name) => name !== onlyFree).map((name) => name.toUpperCase());
  for (const value of [0, 0.25, 0.5, 0.999999]) {
    assert.equal(suggestAgentName(taken, () => value), onlyFree);
  }
  // All taken: still a well-formed pair, and the server's uniqueness check decides.
  assert.ok(all.includes(suggestAgentName(all, () => 0.5)));
  // Nothing taken: the random value indexes the full list.
  assert.equal(suggestAgentName([], () => 0), all[0]);
  assert.equal(suggestAgentName([], () => 0.999999), all.at(-1));
});
