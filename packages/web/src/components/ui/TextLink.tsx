import type { ButtonHTMLAttributes } from "react";

/**
 * The inline text-link used for secondary actions across auth and onboarding.
 *
 * Every one of these — Sign In / Create One, Forgot Password, Log out, and the
 * setup gate's Later — is the same control in one of two emphasis variants.
 * Each surface used to hand-roll the className, which is how "Later" ended up
 * as a dashed-underline mono one-off while "Log out" was a plain grey link.
 * Reuse this instead of re-writing the classes.
 *
 * Raft Design System: these are UI text links (See All, View, New), not prose
 * links — ink text with a 1.5px underline 3px below the baseline, in both
 * variants and at rest; colour carries the emphasis, not pink (pink is the one
 * primary button on the screen). Prose links inside rendered content are the
 * link blue and are not this component.
 *
 * - `primary`: the alternate primary action (Create One / Sign In) — ink, 600.
 * - `muted`: a low-key secondary escape hatch (Forgot Password / Log out /
 *   Later) — ink-2, 500; ink on hover.
 */
export type TextLinkVariant = "primary" | "muted";

const BASE_CLASS =
  "rounded-[2px] underline decoration-[1.5px] underline-offset-[3px] outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:text-foreground-disabled disabled:no-underline";

const VARIANT_CLASS: Record<TextLinkVariant, string> = {
  primary: "font-semibold text-foreground hover:decoration-attention",
  muted: "font-medium text-foreground-muted hover:text-foreground",
};

export default function TextLink({
  variant = "muted",
  type = "button",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: TextLinkVariant;
}) {
  return (
    <button
      type={type}
      className={`${BASE_CLASS} ${VARIANT_CLASS[variant]} ${className}`.trim()}
      {...props}
    />
  );
}
