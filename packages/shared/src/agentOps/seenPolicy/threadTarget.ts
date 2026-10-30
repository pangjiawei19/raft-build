// The thread-target check's rule (glimpse G2-5), shared by the CLI (over its
// consumed-seq ledger) and the SDK (over its SeenFrontier): a top-level send
// is checked when a thread under that target was read more recently, in this
// model context, than the target itself.

import { getParentTargetForThread } from "./consumedSeqs";

export interface ThreadTargetMismatch {
  parentTarget: string;
  threadTarget: string;
  threadSeq: number;
}

/**
 * `latestThread` is the thread under `target` read most recently in this
 * context (with the seq read there), `parentReadOrder` when `target` itself
 * was last read; both in the same local read order. A thread target is never
 * checked.
 */
export function detectThreadTargetMismatch(
  target: string,
  latestThread: { target: string; seq: number; readOrder: number } | undefined,
  parentReadOrder: number | undefined,
): ThreadTargetMismatch | null {
  if (getParentTargetForThread(target) !== null) return null;
  if (!latestThread) return null;
  if (parentReadOrder !== undefined && parentReadOrder >= latestThread.readOrder) return null;
  return { parentTarget: target, threadTarget: latestThread.target, threadSeq: latestThread.seq };
}
