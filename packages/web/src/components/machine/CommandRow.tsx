import { CopyableCode, CopyableCodeAction, CopyableCodeRoot } from "@botiverse/raft-ui";
import Tooltip from "../ui/Tooltip";
import { useCallback } from "react";
import type { CommandStep, CopyTarget } from "./ComputerCommandGuide";

/** The label above a command line (Raft DS field label: 13/18 600). */
const COMMAND_STEP_LABEL_CLASS_NAME = "mb-1 text-footnote font-semibold text-foreground";

/** Layout only: the command line itself (Raft DS `rf-cmd`: code surface,
 *  hairline, Space Mono 13/20) is drawn by raft-ui's CopyableCode. */
const COMMAND_LINE_CLASS_NAME = "min-w-0 flex-1";

export function CommandRow({
  step,
  copied,
  onCopy,
}: {
  step: CommandStep;
  copied: boolean;
  onCopy: (target: CopyTarget) => void;
}) {
  const { target, label, command, copyAriaLabel } = step;
  const handleCopy = useCallback(() => onCopy(target), [onCopy, target]);
  return (
    <div>
      {label ? <div className={COMMAND_STEP_LABEL_CLASS_NAME}>{label}</div> : null}
      <CopyableCodeRoot
        copied={copied}
        onCopy={handleCopy}
      >
        <CopyableCode className={COMMAND_LINE_CLASS_NAME}>
          {command}
        </CopyableCode>
        <Tooltip content={copyAriaLabel}>
          <CopyableCodeAction
            aria-label={copyAriaLabel}
            className="shrink-0"
          />
        </Tooltip>
      </CopyableCodeRoot>
    </div>
  );
}
