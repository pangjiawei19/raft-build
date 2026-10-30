import { DialogSurface } from "@botiverse/raft-ui";
import type { FormEvent, ReactNode } from "react";

/**
 * The one frame the steps after Create Cindy share (survey, display style,
 * handoff): one fixed size, so the dialog does not change size between them,
 * and smaller than the two setup steps before it, which carry far more
 * content (cindyz, task #247). The body scrolls inside the frame if it ever
 * outgrows it; header and footer stay put.
 */
export default function SetupStepFrame({
  eyebrow,
  title,
  hint,
  children,
  footer,
  onSubmit,
  bodyClassName = "",
  testId,
}: {
  eyebrow?: ReactNode;
  title?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  /** Wrap body and footer in a form, so the footer's submit button submits it. */
  onSubmit?: (event: FormEvent) => void;
  bodyClassName?: string;
  testId?: string;
}) {
  const content = (
    <>
      <div className={`min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-9 ${bodyClassName}`}>{children}</div>
      <footer className="flex shrink-0 flex-col-reverse gap-3 border-t border-line-seam px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-9">
        {footer}
      </footer>
    </>
  );

  return (
    <DialogSurface
      render={<section />}
      className="w-full max-w-[720px] md:h-[min(520px,calc(100dvh-3rem))]"
      data-testid={testId}
    >
      {title ? (
        <header className="shrink-0 border-b border-line-seam px-6 pb-4 pt-6 sm:px-9">
          {/* The onboarding step label: Space Mono 12, sentence case. */}
          {eyebrow ? (
            <p className="font-mono text-mono-meta text-foreground-hint">{eyebrow}</p>
          ) : null}
          <h1 className="mt-1 text-title text-foreground">{title}</h1>
          {hint ? <p className="mt-1.5 text-callout text-foreground-muted">{hint}</p> : null}
        </header>
      ) : null}
      {onSubmit ? (
        <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          {content}
        </form>
      ) : (
        content
      )}
    </DialogSurface>
  );
}
