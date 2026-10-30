/**
 * Thin product adapter over RUI Field. It keeps the existing label/help/error
 * call shape while delegating field semantics and theme styling to RUI.
 *
 * Raft Design System › TextField: the label sits above the control, always
 * visible, 13/18 600 ink-2, sentence case (never ALL CAPS); help text below is
 * 12/16 ink-3; an error turns the control's line and the help line to the
 * danger ink. raft-ui's raft field recipe draws all of it, including the 6px
 * label → control → help rhythm (the field's own gap); this adapter only
 * picks the label step.
 */

import { useContext } from "react";
import type { LabelHTMLAttributes, ReactNode } from "react";
import { IntlContext } from "react-intl";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  LabelAsterisk,
  LabelOptional,
} from "@botiverse/raft-ui";
import { en } from "../../i18n/messages/en";


export type FormFieldProps = {
  /** Field label text. */
  label: ReactNode;
  /** Show a `*` required marker after the label. */
  required?: boolean;
  /** Show the localized optional marker in muted case after the label.
   *  Mutually exclusive with `required`. */
  optional?: boolean;
  /** Helper text rendered below the control. */
  hint?: ReactNode;
  /** Error text rendered below the control (takes precedence over `hint`). */
  error?: ReactNode;
  /** Small control or tooltip rendered beside the label. */
  labelAccessory?: ReactNode;
  /** Secondary action pushed to the far end of the label row, e.g. the
   *  sign-in form's "Forgot password?" link. */
  labelAction?: ReactNode;
  /** `<label htmlFor>` — point at the inner control's `id`. */
  htmlFor?: LabelHTMLAttributes<HTMLLabelElement>["htmlFor"];
  /** Label size. `"compact"` selects the denser settings form treatment. */
  size?: "default" | "compact";
  /** Additional classes appended to the outer `<div>`. */
  className?: string;
  /** The actual control — `<input>`, `<textarea>`, `<SegmentedControl>`,
   *  `<select>`, custom group, etc. */
  children: ReactNode;
};

export default function FormField({
  label,
  required,
  optional,
  hint,
  error,
  labelAccessory,
  labelAction,
  htmlFor,
  size = "default",
  className,
  children,
}: FormFieldProps) {
  // Some legacy test and static-render seams mount this shared primitive
  // without an IntlProvider; keep that path human-readable instead of throwing.
  const intl = useContext(IntlContext);
  const optionalLabel = intl?.formatMessage({ id: "ui.formField.optional" }) ?? en["ui.formField.optional"];
  // raft-ui's label step: md = 13/18 600 (the DS field label), sm = 12/16 600
  // for the denser settings form treatment.
  const labelSize = size === "compact" ? "sm" : "md";
  const wrapperCls = className ? className : undefined;
  const hasLabelRow = Boolean(labelAccessory || labelAction);
  const labelElement = (
    <FieldLabel
      size={labelSize}
      htmlFor={htmlFor}
    >
      {label}
      {required ? <LabelAsterisk className="ml-1" /> : null}
      {optional ? (
        <LabelOptional className="ml-1">{optionalLabel}</LabelOptional>
      ) : null}
    </FieldLabel>
  );
  return (
    <Field className={wrapperCls} invalid={Boolean(error)}>
      {hasLabelRow ? (
        <div className="flex items-center gap-1">
          {labelElement}
          {labelAccessory}
          {labelAction ? <span className="ml-auto flex">{labelAction}</span> : null}
        </div>
      ) : labelElement}
      {children}
      {error ? (
        <FieldError role="alert" match={Boolean(error)}>
          {error}
        </FieldError>
      ) : hint ? (
        <FieldDescription>{hint}</FieldDescription>
      ) : null}
    </Field>
  );
}
