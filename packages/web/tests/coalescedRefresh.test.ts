import assert from "node:assert/strict";
import { test } from "vitest";

import { createCoalescedRefresh } from "../src/utils/coalescedRefresh";

function harness(initiallyVisible = true) {
  let visible = initiallyVisible;
  let runs = 0;
  const timers: Array<{ callback: () => void; cleared: boolean }> = [];
  const refresh = createCoalescedRefresh({
    run: () => { runs += 1; },
    delayMs: 1500,
    isVisible: () => visible,
    schedule: (callback) => {
      const timer = { callback, cleared: false };
      timers.push(timer);
      return timer;
    },
    clear: (handle) => { (handle as { cleared: boolean }).cleared = true; },
  });
  const fire = () => {
    for (const timer of timers.splice(0)) if (!timer.cleared) timer.callback();
  };
  return {
    refresh,
    fire,
    runs: () => runs,
    pendingTimers: () => timers.filter((timer) => !timer.cleared).length,
    setVisible: (next: boolean) => { visible = next; },
  };
}

test("coalescedRefresh: a burst of requests inside the window runs one reload", () => {
  const h = harness();
  for (let i = 0; i < 20; i += 1) h.refresh.request();
  assert.equal(h.pendingTimers(), 1);
  assert.equal(h.runs(), 0);
  h.fire();
  assert.equal(h.runs(), 1);

  h.refresh.request();
  h.fire();
  assert.equal(h.runs(), 2);
});

test("coalescedRefresh: a hidden page defers the reload until it is visible again", () => {
  const h = harness(false);
  h.refresh.request();
  h.refresh.request();
  assert.equal(h.pendingTimers(), 0);

  h.refresh.flushIfPending();
  assert.equal(h.pendingTimers(), 0, "still hidden: nothing scheduled");

  h.setVisible(true);
  h.refresh.flushIfPending();
  h.fire();
  assert.equal(h.runs(), 1);

  h.refresh.flushIfPending();
  h.fire();
  assert.equal(h.runs(), 1, "nothing left to flush");
});

test("coalescedRefresh: hidden when the window ends defers instead of fetching", () => {
  const h = harness();
  h.refresh.request();
  h.setVisible(false);
  h.fire();
  assert.equal(h.runs(), 0);

  h.setVisible(true);
  h.refresh.flushIfPending();
  h.fire();
  assert.equal(h.runs(), 1);
});

test("coalescedRefresh: cancel drops scheduled and deferred reloads", () => {
  const h = harness();
  h.refresh.request();
  h.refresh.cancel();
  h.fire();
  assert.equal(h.runs(), 0);

  h.setVisible(false);
  h.refresh.request();
  h.refresh.cancel();
  h.setVisible(true);
  h.refresh.flushIfPending();
  h.fire();
  assert.equal(h.runs(), 0);
});
