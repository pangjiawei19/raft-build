import { DialogSurface } from "@botiverse/raft-ui";
import CloseButton from "./CloseButton";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useIntl } from "react-intl";
import Modal from "../Modal";

/**
 * Product dialog shell for small forms (Create Agent, Add/Edit MCP, …) on the
 * shared Modal backdrop.
 *
 * Raft Design System › Dialog (`rf-dialog`): raft-ui's DialogSurface (the
 * popover layer, dialog radius, seam edge and float shadow, no motion) with
 * 20px padding, a sentence-case headline title (17/22 700) and a quiet ghost
 * close in the top right. The surface rather than raft-ui's Dialog parts
 * because these callers own the Modal lifecycle (backdrop / Escape / layer).
 */
export default function DialogCard({
  title,
  titleId,
  onClose,
  children,
  maxWidthClass = "max-w-md",
  testId,
  closeOnBackdrop = false,
  layer,
}: {
  title: ReactNode;
  titleId?: string;
  onClose: () => void;
  children: ReactNode;
  maxWidthClass?: string;
  testId?: string;
  /** Stacking tier forwarded to Modal (0 → z-50, 1 → z-60, >=2 → z-70).
   *  Needed when the card opens from inside another modal (for example the
   *  agent detail runtime editor) so it lands above the parent instead of
   *  behind it. */
  layer?: number;
  /** Passed through because some callers close on backdrop and some must not.
   *  Without it, adopting this shell would silently take backdrop-close away
   *  from a dialog that had it — a behaviour change wearing a refactor's
   *  clothes. Defaults to the previous behaviour of this component. */
  closeOnBackdrop?: boolean;
}) {
  const { formatMessage } = useIntl();
  return (
    <Modal onClose={onClose} closeOnBackdrop={closeOnBackdrop} {...(layer !== undefined ? { layer } : {})}>
      <DialogSurface
        data-slot="dialog-card"
        className={`w-full p-5 ${maxWidthClass}`}
        data-testid={testId}
      >
        <div className="mb-4 flex items-start justify-between gap-2">
          <h2 id={titleId} className="min-w-0 font-sans text-headline text-foreground">{title}</h2>
          <CloseButton
            type="button"
            size="icon-sm"
            onClick={onClose}
            aria-label={formatMessage({ id: "common.close" })}
            className="-my-1.5 -mr-1.5 shrink-0"
          >
            <X size={18} />
          </CloseButton>
        </div>
        {children}
      </DialogSurface>
    </Modal>
  );
}
