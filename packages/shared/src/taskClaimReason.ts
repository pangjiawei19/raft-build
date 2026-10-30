/**
 * Refusal reason a claim carries when the task is already assigned to the
 * caller. It is a *refusal* — no state was written, so the row's `success` is
 * false — but it authorises work, because it proves the caller already holds
 * the task.
 *
 * Shared rather than written out at each site because the server produces this
 * string and the CLI branches on it: the claim exit status treats it as
 * authorising work (so an agent re-confirming its own claim is not told the
 * claim failed), and the result formatter gives it its own line. Comparing
 * against a copied literal would mean a pure copy edit on the producer could
 * silently flip the consumer's branch, with production broken and tests still
 * green because each side held its own copy of the old wording.
 *
 * One symbol keeps the sides from diverging at all, rather than relying on a
 * test to notice that they have (@Kaiming, `#proj-runtime:941d4a53`).
 */
export const TASK_CLAIM_REASON_ALREADY_CLAIMED_BY_YOU = "already claimed by you";
