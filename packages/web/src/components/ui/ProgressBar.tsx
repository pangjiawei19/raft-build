import { Progress, ProgressTrack, ProgressIndicator } from "@botiverse/raft-ui";
import type { HTMLAttributes } from "react";
import { useContext } from "react";
import { IntlContext } from "react-intl";
import { en } from "../../i18n/messages/en";

/** Product labels and value normalization over the themed RUI progress recipe.
 *
 *  Raft Design System › Loading (`rf-progress`): an 8px sunken track with a
 *  cyan fill that carries an ink edge; orange near a limit, lime when done.
 *  Progress is a passive indicator, so it is never the action pink. */
export type ProgressBarTone = "cyan" | "lime" | "orange";

const TONE_CLASS: Record<ProgressBarTone, "information" | "success" | "warning"> = {
  cyan: "information",
  lime: "success",
  orange: "warning",
};

export interface ProgressBarProps extends Omit<HTMLAttributes<HTMLDivElement>, "role"> {
  /** 0–100 for a determinate bar; omit (or null) for an indeterminate stripe. */
  value?: number | null;
  /** Fill color. Defaults to the DS cyan fill. */
  tone?: ProgressBarTone;
  /** Optional phase / status label rendered above the track (left). */
  label?: string;
  /** Show the numeric percent at the right of the label row (determinate only). */
  showPercent?: boolean;
}

export default function ProgressBar({
  value = null,
  tone = "cyan",
  label,
  showPercent = false,
  className = "",
  ...rest
}: ProgressBarProps) {
  const intl = useContext(IntlContext);
  const indeterminate = value === null || value === undefined || Number.isNaN(value);
  const pct = indeterminate ? 0 : Math.max(0, Math.min(100, value));
  const defaultAriaLabel =
    intl?.formatMessage({ id: "ui.progressBar.ariaLabel" }) ?? en["ui.progressBar.ariaLabel"];

  return (
    <div className={className} {...rest}>
      {(label || (showPercent && !indeterminate)) && (
        <div className="mb-1.5 flex items-center justify-between gap-2">
          {label ? <span className="truncate text-footnote font-semibold text-foreground">{label}</span> : <span />}
          {showPercent && !indeterminate && <span className="shrink-0 font-mono text-mono-meta text-foreground-hint">{Math.round(pct)}%</span>}
        </div>
      )}
      <Progress value={indeterminate ? null : pct} variant={TONE_CLASS[tone]} aria-label={label ?? defaultAriaLabel}>
        <ProgressTrack>
          <ProgressIndicator />
        </ProgressTrack>
      </Progress>
    </div>
  );
}
