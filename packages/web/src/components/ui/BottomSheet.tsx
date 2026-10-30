import { useEffect, useLayoutEffect, useRef } from "react";
import type { HTMLAttributes, MouseEvent, ReactNode } from "react";
import { createPortal } from "react-dom";

function stopClickPropagation(event: MouseEvent) {
  event.stopPropagation();
}

export interface BottomSheetProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  children: ReactNode;
  onClose: () => void;
  /** CSS z-index. Default 50 to match modal-layer surfaces. */
  zIndex?: number;
  /** Click outside the sheet closes it. Default true. */
  dismissOnBackdrop?: boolean;
  /** Lock body scroll while mounted. Default true. */
  lockBodyScroll?: boolean;
  /** Width class for the sheet card. */
  widthClass?: string;
  /** Extra classes on the sheet card. */
  sheetClassName?: string;
}

/**
 * Mobile bottom sheet primitive.
 *
 * Raft Design System › Sheet (`rf-sheet`): the popover layer rising from the
 * bottom edge — 16px top corners, a grab handle, a seam edge plus the float
 * shadow, and no scrim (as in the product: unlike Lightbox, there is no dim
 * backdrop). The sheet runs to the bottom edge and pads the safe area itself.
 */
export default function BottomSheet({
  children,
  onClose,
  zIndex = 50,
  dismissOnBackdrop = true,
  lockBodyScroll = true,
  widthClass = "max-w-md",
  sheetClassName = "",
  className = "",
  ...rest
}: BottomSheetProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // keydown-focus-on-open
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Move focus into the sheet on open so a focused background element can't
  // swallow keys (e.g. Escape) meant for it. Guarded so we don't steal focus
  // from content that already grabbed it (autofocused inputs run first). Full
  // Tab-cycle focus-trap is Phase 2.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root && !root.contains(document.activeElement)) root.focus();
  }, []);

  useEffect(() => {
    if (!lockBodyScroll) return;
    const prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevBodyOverflow;
    };
  }, [lockBodyScroll]);

  return createPortal(
    <div
      {...rest}
      ref={rootRef}
      tabIndex={-1}
      className={`fixed inset-x-0 bottom-0 outline-none ${className}`}
      style={{ zIndex, ...rest.style }}
      onClick={
        dismissOnBackdrop
          ? (e) => {
              if (e.target === e.currentTarget) onClose();
            }
          : undefined
      }
    >
      <div
        data-slot="bottom-sheet"
        className={`mx-auto w-full rounded-t-dialog bg-layer-popover pt-1.5 text-foreground shadow-float ring-1 ring-line-seam ${widthClass} ${sheetClassName} pb-[max(16px,env(safe-area-inset-bottom))]`}
        onClick={stopClickPropagation}
      >
        <span aria-hidden="true" className="mx-auto mb-1 block h-1 w-9 rounded-[1px] bg-line-seam" />
        {children}
      </div>
    </div>,
    document.body,
  );
}
