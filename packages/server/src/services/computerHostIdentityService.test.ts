import assert from "node:assert/strict";
import { test } from "vitest";

import { isHostIdHash, sameMachineGroupLabels } from "./computerHostIdentityService";

const A = "a".repeat(32);
const B = "b".repeat(32);

test("Computers sharing a host hash get one label; a Computer alone on its machine gets none", () => {
  const labels = sameMachineGroupLabels(
    ["m1", "m2", "m3", "m4", "m5"],
    new Map([["m1", A], ["m2", B], ["m3", A], ["m4", B]]),
  );
  assert.deepEqual(Object.fromEntries(labels), { m1: "machine-1", m3: "machine-1", m2: "machine-2", m4: "machine-2" });
  assert.equal(labels.has("m5"), false, "no hash reported");
});

test("a single Computer per machine is never labelled, and labels never carry the hash", () => {
  const labels = sameMachineGroupLabels(["m1", "m2"], new Map([["m1", A], ["m2", B]]));
  assert.equal(labels.size, 0);
  const grouped = sameMachineGroupLabels(["m1", "m2"], new Map([["m1", A], ["m2", A]]));
  assert.equal([...grouped.values()].some((label) => label.includes(A.slice(0, 8))), false);
});

test("only a 32-char lowercase hex hash is accepted", () => {
  assert.equal(isHostIdHash(A), true);
  assert.equal(isHostIdHash("A".repeat(32)), false);
  assert.equal(isHostIdHash("a".repeat(31)), false);
  assert.equal(isHostIdHash("a".repeat(64)), false);
  assert.equal(isHostIdHash(42), false);
});
