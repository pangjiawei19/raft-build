import type { IntlShape } from "react-intl";
import { showToast } from "../toastBridge";

/**
 * Stop a hosted agent's running turn and say what happened in one short
 * toast. No confirmation: stopping a runaway turn must be quick (Tenny). A
 * failed stop offers Retry (the provider's stop is idempotent).
 */
export async function stopHostedTurnWithFeedback(
  stop: () => Promise<"interrupted" | "not_running">,
  formatMessage: IntlShape["formatMessage"],
): Promise<void> {
  try {
    const result = await stop();
    showToast({
      title: formatMessage({ id: result === "interrupted" ? "agent.detail.stopHostedTurn.interrupted" : "agent.detail.stopHostedTurn.notRunning" }),
      type: "success",
    });
  } catch {
    showToast({
      title: formatMessage({ id: "agent.detail.stopHostedTurn.failed" }),
      type: "error",
      actionProps: {
        children: formatMessage({ id: "agent.detail.stopHostedTurn.retry" }),
        onClick: () => { void stopHostedTurnWithFeedback(stop, formatMessage); },
      },
    });
  }
}
