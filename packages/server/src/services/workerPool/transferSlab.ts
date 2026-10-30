/**
 * Buffer transfer slab guard.
 *
 * Small Node Buffers usually share one 8 KiB slab: their underlying
 * ArrayBuffer covers many unrelated Buffers (`byteOffset !== 0`, or
 * `buffer.byteLength` larger than the view). Passing `buf.buffer` to
 * postMessage's transferList neuters the WHOLE slab in this process and
 * corrupts every sibling Buffer. Transfer only views that exactly cover
 * their ArrayBuffer; slice everything else into a standalone copy first.
 */
export interface PreparedTransferPayload {
  payloadKind: "buffer" | "value";
  /** For "buffer": a standalone ArrayBuffer safe to transfer. For "value": the original value. */
  payload: unknown;
  transferList: ArrayBuffer[];
}

export function isExactFitView(value: unknown): value is ArrayBufferView {
  if (!ArrayBuffer.isView(value)) return false;
  const buffer = value.buffer as ArrayBuffer;
  return value.byteOffset === 0 && value.byteLength === buffer.byteLength;
}

/**
 * Prepare a submit() payload for the thread boundary. ArrayBuffers and
 * exact-fit views transfer zero-copy; shared-slab views are copied into a
 * standalone ArrayBuffer first; everything else crosses by structured clone.
 */
export function prepareTransferablePayload(value: unknown): PreparedTransferPayload {
  if (value instanceof ArrayBuffer) {
    return { payloadKind: "buffer", payload: value, transferList: [value] };
  }
  if (ArrayBuffer.isView(value)) {
    const buffer = value.buffer as ArrayBuffer;
    if (value.byteOffset === 0 && value.byteLength === buffer.byteLength) {
      return { payloadKind: "buffer", payload: buffer, transferList: [buffer] };
    }
    const copy = buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    return { payloadKind: "buffer", payload: copy, transferList: [copy] };
  }
  return { payloadKind: "value", payload: value, transferList: [] };
}
