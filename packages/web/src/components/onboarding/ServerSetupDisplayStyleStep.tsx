import { useIntl } from "react-intl";
import { Button } from "@botiverse/raft-ui";
import { useAuthStore } from "../../store/authStore";
import DisplayStylePicker from "./DisplayStylePicker";
import SetupSessionFooter from "./SetupSessionFooter";
import SetupStepFrame from "./SetupStepFrame";

/**
 * Owners: asked after the survey and before the handoff. By now the user has
 * seen the app behind the setup modal, so the choice is informed, and Cindy's
 * first message then arrives in the style they picked.
 * Invited members (`variant="member"`): the same page as a dialog on their
 * first visit, without the setup eyebrow and setup escape links.
 * Continuing without touching anything keeps light, which is what onboarding
 * has shown so far.
 */
export default function ServerSetupDisplayStyleStep({
  onDone,
  variant = "setup",
}: {
  onDone: () => void;
  variant?: "setup" | "member";
}) {
  const loading = useAuthStore((state) => state.loading);
  const { formatMessage } = useIntl();

  return (
    <SetupStepFrame
      testId="server-setup-display-style"
      eyebrow={variant === "setup" ? formatMessage({ id: "layout.onboarding.setupServerEyebrow" }) : undefined}
      title={formatMessage({ id: "layout.onboarding.displayStyleTitle" })}
      hint={formatMessage({ id: "layout.onboarding.displayStyleHint" })}
      footer={
        <>
          {variant === "setup" ? <SetupSessionFooter disabled={loading} /> : <span />}
          <Button
            type="button"
            onClick={onDone}
            disabled={loading}
            size="lg"
            variant="accent"
            className="w-full sm:w-auto"
            data-testid="server-setup-display-style-continue"
          >
            {formatMessage({ id: "layout.onboarding.continue" })}
          </Button>
        </>
      }
    >
      <DisplayStylePicker />
    </SetupStepFrame>
  );
}
