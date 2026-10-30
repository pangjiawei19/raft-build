import { describe, expect, it } from "vitest";
import { getEffectiveLimits } from "@botiverse/raft-shared";
import { agentsOverFreeLimit } from "./downgradeEnforcement";

const oldestFirst = ["a1", "a2", "a3"];

describe("agentsOverFreeLimit", () => {
  it("stops nothing when the free plan has no agent limit (-1)", () => {
    expect(agentsOverFreeLimit(oldestFirst, -1)).toEqual([]);
  });

  it("the free plan's current agent limit stops nothing", () => {
    expect(agentsOverFreeLimit(oldestFirst, getEffectiveLimits("free").maxAgents)).toEqual([]);
  });

  it("stops the newest agents beyond a positive limit, keeping the oldest", () => {
    expect(agentsOverFreeLimit(oldestFirst, 1)).toEqual(["a2", "a3"]);
    expect(agentsOverFreeLimit(oldestFirst, 3)).toEqual([]);
    expect(agentsOverFreeLimit(oldestFirst, 0)).toEqual(["a1", "a2", "a3"]);
  });
});
