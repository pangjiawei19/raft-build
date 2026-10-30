/**
 * Canonical section-eyebrow label for panels, dialogs and list headers.
 * Do NOT inline new section eyebrows — use this primitive instead.
 *
 * Raft Design System › ListRow section title (`rf-section`): 13/18 700 ink-3,
 * sentence case — hierarchy by size, weight and colour, never ALL CAPS or
 * wide tracking. The source string is rendered as written.
 *
 * - `as` — element type (`"span"` | `"div"` | `"label"` | `"button"`, default
 *   `"span"`); `"button"` is the collapsible section title (DS
 *   `button.rf-section__title`), always `type="button"`
 * - `tone` — `"hint"` (ink-3, default), `"muted"` (ink-2) for a drawer
 *   section heading that sits beside raft-ui FormSection titles (DS
 *   `rf-drawer__section`), or `"ink"` for an eyebrow that labels the current
 *   selection (e.g. MachineDetailPanel's selected count)
 * - `className` — callsite-specific layout additions (margin, padding)
 * - `htmlFor` — forwarded when `as="label"`
 * - other attributes (`id`, `role`, `aria-*`, `data-*`) go to the element
 * - `children` — label text
 */

import type { HTMLAttributes, LabelHTMLAttributes, ReactNode } from "react";

const BASE_CLASS = "text-footnote font-bold";
const TONE_CLASS = {
  hint: "text-foreground-hint",
  muted: "text-foreground-muted",
  ink: "text-foreground",
} as const;

export type SectionEyebrowTone = keyof typeof TONE_CLASS;

export type SectionEyebrowProps = Omit<HTMLAttributes<HTMLElement>, "className" | "children"> & {
  /** HTML element to render. Default `"span"`. Use `"div"` for block-level
   *  eyebrows (e.g. with `mb-3`), `"label"` for form field labels, `"button"`
   *  for a section title that toggles its section (pass the hover and focus
   *  treatment in `className`). */
  as?: "span" | "div" | "label" | "button";
  /** Text colour. Default `"hint"` (ink-3). */
  tone?: SectionEyebrowTone;
  /** Additional classes, appended to the base token: margin (`mb-3`) or
   *  padding (`px-3 py-1.5`). Colour comes from `tone`. */
  className?: string;
  /** Eyebrow text / nodes. */
  children?: ReactNode;
  /** When `as="label"`, forward to the `<label htmlFor>` attribute. */
  htmlFor?: LabelHTMLAttributes<HTMLLabelElement>["htmlFor"];
};

export default function SectionEyebrow({
  as: Tag = "span",
  tone = "hint",
  className = "",
  children,
  htmlFor,
  ...props
}: SectionEyebrowProps) {
  const cls = `${BASE_CLASS} ${TONE_CLASS[tone]} ${className}`.trim();
  if (Tag === "label") {
    return (
      <label {...props} className={cls} htmlFor={htmlFor}>
        {children}
      </label>
    );
  }
  if (Tag === "button") {
    return <button {...props} type="button" className={cls}>{children}</button>;
  }
  if (Tag === "div") {
    return <div {...props} className={cls}>{children}</div>;
  }
  return <span {...props} className={cls}>{children}</span>;
}
