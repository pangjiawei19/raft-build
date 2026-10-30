import assert from "node:assert/strict";
import { isExactFitView, prepareTransferablePayload } from "./transferSlab";

test("exact-fit view transfers its underlying ArrayBuffer without a copy", () => {
  const view = new Uint8Array([1, 2, 3, 4]);
  assert.ok(isExactFitView(view));
  const prepared = prepareTransferablePayload(view);
  assert.equal(prepared.payloadKind, "buffer");
  assert.equal(prepared.payload, view.buffer);
  assert.deepEqual(prepared.transferList, [view.buffer]);
});

test("standalone ArrayBuffer transfers directly", () => {
  const buffer = new ArrayBuffer(8);
  const prepared = prepareTransferablePayload(buffer);
  assert.equal(prepared.payloadKind, "buffer");
  assert.equal(prepared.payload, buffer);
  assert.deepEqual(prepared.transferList, [buffer]);
});

test("shared-slab Buffer is sliced into a standalone copy, slab left untouched", () => {
  // Small Buffers come from Node's 8 KiB pool: a subarray shares the slab.
  const slab = Buffer.allocUnsafe(16);
  for (let i = 0; i < 16; i++) slab[i] = i + 1;
  const shared = slab.subarray(4, 12); // byteOffset 4 inside the slab
  assert.ok(!isExactFitView(shared));

  const prepared = prepareTransferablePayload(shared);
  assert.equal(prepared.payloadKind, "buffer");
  const copy = prepared.payload as ArrayBuffer;
  assert.notEqual(copy, slab.buffer);
  assert.equal(copy.byteLength, 8);
  assert.deepEqual([...new Uint8Array(copy)], [5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(prepared.transferList, [copy]);
  // The original slab (Node's 8 KiB pool ArrayBuffer) is not detached and
  // its other views are untouched.
  assert.notEqual(slab.buffer.byteLength, 0);
  assert.deepEqual([...slab], [...Array.from({ length: 16 }, (_, i) => i + 1)]);
});

test("offset view of a standalone ArrayBuffer is sliced, not transferred", () => {
  const backing = new ArrayBuffer(16);
  const view = new Uint8Array(backing, 8, 8);
  view.set([10, 20, 30, 40, 50, 60, 70, 80]);
  assert.ok(!isExactFitView(view));
  const prepared = prepareTransferablePayload(view);
  const copy = prepared.payload as ArrayBuffer;
  assert.notEqual(copy, backing);
  assert.equal(copy.byteLength, 8);
  assert.deepEqual([...new Uint8Array(copy)], [10, 20, 30, 40, 50, 60, 70, 80]);
  assert.equal(backing.byteLength, 16);
});

test("non-buffer payloads cross by structured clone with no transfer", () => {
  const value = { hello: "world", n: 42 };
  const prepared = prepareTransferablePayload(value);
  assert.equal(prepared.payloadKind, "value");
  assert.equal(prepared.payload, value);
  assert.deepEqual(prepared.transferList, []);
});
