/**
 * Coalesces bursts of "something changed, reload X" into one reload.
 *
 * - The first request opens a window of `delayMs`; requests inside it join the
 *   same reload instead of starting their own.
 * - While the page is hidden nothing is fetched: the request is remembered and
 *   runs once the page is visible again (`flushIfPending`).
 *
 * Used for the followed-thread list, which a busy channel would otherwise
 * reload on every reply into a thread that is not in the local list yet.
 */
export type CoalescedRefresh = {
  /** Ask for a reload; coalesced with others in the window, deferred while hidden. */
  request: () => void;
  /** Run a reload that was deferred while the page was hidden. */
  flushIfPending: () => void;
  /** Drop any scheduled or deferred reload. */
  cancel: () => void;
};

export function createCoalescedRefresh({
  run,
  delayMs,
  isVisible,
  schedule = (callback, ms) => setTimeout(callback, ms),
  clear = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}: {
  run: () => void;
  delayMs: number;
  isVisible: () => boolean;
  schedule?: (callback: () => void, ms: number) => unknown;
  clear?: (handle: unknown) => void;
}): CoalescedRefresh {
  let timer: unknown = null;
  let deferred = false;

  const request = () => {
    if (!isVisible()) {
      deferred = true;
      return;
    }
    if (timer !== null) return;
    timer = schedule(() => {
      timer = null;
      if (!isVisible()) {
        deferred = true;
        return;
      }
      run();
    }, delayMs);
  };

  return {
    request,
    flushIfPending: () => {
      if (!deferred || !isVisible()) return;
      deferred = false;
      request();
    },
    cancel: () => {
      if (timer !== null) clear(timer);
      timer = null;
      deferred = false;
    },
  };
}
