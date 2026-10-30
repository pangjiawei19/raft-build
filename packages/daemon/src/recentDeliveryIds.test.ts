import assert from "node:assert/strict";
import { test } from "vitest";
import { RecentDeliveryIds } from "./recentDeliveryIds";

test("RecentDeliveryIds forgets an id after the max age (task #1295)", () => {
  const ids = new RecentDeliveryIds(4096, 10 * 60_000);
  ids.remember("a", 0);
  assert.equal(ids.has("a", 10 * 60_000 - 1), true);
  assert.equal(ids.has("a", 10 * 60_000), false);
  assert.equal(ids.size, 0);
});

test("RecentDeliveryIds keeps at most the max entries, dropping the oldest first", () => {
  const ids = new RecentDeliveryIds(3, 10 * 60_000);
  for (const [i, id] of ["a", "b", "c", "d"].entries()) ids.remember(id, i);
  assert.equal(ids.size, 3);
  assert.equal(ids.has("a", 4), false);
  assert.equal(ids.has("b", 4), true);
  assert.equal(ids.has("d", 4), true);
});

test("RecentDeliveryIds re-remembering an id moves it to the newest end", () => {
  const ids = new RecentDeliveryIds(2, 10 * 60_000);
  ids.remember("a", 0);
  ids.remember("b", 1);
  ids.remember("a", 2);
  ids.remember("c", 3);
  assert.equal(ids.has("a", 3), true);
  assert.equal(ids.has("b", 3), false);
});
