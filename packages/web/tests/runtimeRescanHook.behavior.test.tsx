import assert from "node:assert/strict";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, test } from "vitest";
import { describeRescanError, useRuntimeRescan } from "../src/components/machine/useRuntimeRescan";

afterEach(() => cleanup());

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test("task #1268: an allowed rescan runs then returns to idle", async () => {
  const d = deferred<void>();
  const calls: string[] = [];
  const { result } = renderHook(() => useRuntimeRescan("machine-1", async (id) => { calls.push(id); return d.promise; }));
  assert.deepEqual(result.current.state, { status: "idle" });
  act(() => { result.current.rescan(); });
  assert.deepEqual(result.current.state, { status: "running" });
  assert.deepEqual(calls, ["machine-1"]);
  await act(async () => { d.resolve(); await d.promise; });
  assert.deepEqual(result.current.state, { status: "idle" });
});

test("task #1268: a rejected rescan (403) is surfaced as failed/forbidden, other failures as network/http", async () => {
  const d = deferred<void>();
  const { result } = renderHook(() => useRuntimeRescan("machine-1", async () => d.promise));
  act(() => { result.current.rescan(); });
  await act(async () => { d.reject({ response: { status: 403 } }); await d.promise.catch(() => {}); });
  assert.deepEqual(result.current.state, { status: "failed", error: "forbidden" });
  assert.equal(describeRescanError(new Error("offline")), "network");
  assert.equal(describeRescanError({ response: { status: 500 } }), "http_500");
});

test("task #1268: a rescan that settles after unmount writes no state", async () => {
  const d = deferred<void>();
  const { result, unmount } = renderHook(() => useRuntimeRescan("machine-1", async () => d.promise));
  act(() => { result.current.rescan(); });
  const before = result.current.state;
  unmount();
  const warnings: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { warnings.push(args); };
  try {
    await act(async () => { d.reject({ response: { status: 403 } }); await d.promise.catch(() => {}); });
  } finally {
    console.error = original;
  }
  assert.deepEqual(result.current.state, before, "no state transition after unmount");
  assert.equal(warnings.length, 0, "no React act/unmounted-update warning");
});
