import type { ButtonHTMLAttributes, ReactNode } from "react";

/** Raft Design System UI text link (the section action / "See all" form): ink
 *  footnote text, 600, a 1.5px underline 3px below; keyboard focus gets the
 *  shared focus ring. Not a prose link, so it never turns link blue. */
export const SHOW_MORE_TOGGLE_CLASS = "rounded-[2px] text-footnote font-semibold text-foreground underline decoration-[1.5px] underline-offset-[3px] hover:decoration-attention outline-none focus-visible:shadow-focus";

type ShowMoreToggleProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "type"> & {
  expanded: boolean;
  collapsedLabel: ReactNode;
  expandedLabel?: ReactNode;
};

export default function ShowMoreToggle({
  expanded,
  collapsedLabel,
  expandedLabel = "Collapse",
  className = "",
  ...buttonProps
}: ShowMoreToggleProps) {
  const cls = `${SHOW_MORE_TOGGLE_CLASS}${className ? ` ${className}` : ""}`;
  return (
    <button type="button" className={cls} {...buttonProps}>
      {expanded ? expandedLabel : collapsedLabel}
    </button>
  );
}
