import type { PropsWithChildren } from "react";
import { X } from "lucide-react";
import {
  ToastAction,
  ToastActions,
  ToastBody,
  ToastClose,
  ToastContent,
  ToastPortal,
  ToastProvider,
  ToastRoot,
  ToastIcon,
  ToastDescription,
  ToastTitle,
  ToastViewport,
  useToastManager,
} from "@botiverse/raft-ui";
import { useEffect } from "react";
import { useIntl } from "react-intl";
import { setToastManager } from "./toastBridge";


/**
 * The default raft-ui toast close control intentionally uses English fallback
 * copy. The app owns the active locale, so keep the same provider/manager
 * contract while supplying localized visible and accessible dismissal text.
 *
 * Raft Design System › Toast: the neutral HUD (raft-ui's raft toast recipe).
 * A receipt with no "who" leads with one status pixel that says the result —
 * done lime, a problem orange, information cyan — instead of an icon.
 */
const TOAST_PIXEL_TONE: Record<string, string> = {
  success: "bg-task-status-done",
  warning: "bg-presence-error",
  error: "bg-presence-error",
};

function toastPixelTone(intent: string | undefined): string {
  return (intent && TOAST_PIXEL_TONE[intent]) || "bg-info";
}
function LocalizedToastList() {
  const { formatMessage } = useIntl();
  const { toasts } = useToastManager();
  const dismissLabel = formatMessage({ id: "common.toast.close" });

  return toasts.map((toastObject) => {
    const showAction = Boolean(toastObject.actionProps?.children);
    const showClose = toastObject.data?.hasClose !== false;
    const showIcon = toastObject.data?.hasIcon !== false;
    const intent = toastObject.data?.intent ?? toastObject.type;
    return (
      <ToastRoot key={toastObject.id} toast={toastObject} layout="inline" data-testid="localized-toast-row">
        <ToastContent
          className={[
            "!grid-cols-[auto_minmax(0,1fr)_auto] !items-center !gap-x-3 !gap-y-0",
            toastObject.data?.contentClassName,
          ].filter(Boolean).join(" ")}
          data-testid="localized-toast-content-row"
        >
          {showIcon ? (
            <ToastIcon className="flex size-5 items-center justify-center border-0 bg-transparent p-0 shadow-none" data-testid="localized-toast-icon">
              <span
                aria-hidden="true"
                data-testid="localized-toast-pixel"
                className={`block size-[9px] rounded-[2px] border-[1.5px] border-sticker-ink ${toastPixelTone(intent)}`}
              />
            </ToastIcon>
          ) : null}
          <ToastBody className="min-w-0 text-left" data-testid="localized-toast-content">
            <ToastTitle className="whitespace-normal break-words font-normal" />
            {toastObject.description ? <ToastDescription /> : null}
          </ToastBody>
          {showAction || showClose ? (
            <ToastActions
              className="!col-span-1 !col-start-3 !row-start-1 !w-auto shrink-0 justify-self-end"
              data-testid="localized-toast-actions"
            >
              {showClose ? (
                <ToastClose
                  aria-label={dismissLabel}
                  aria-hidden={false}
                  data-testid="localized-toast-close"
                >
                  <X size={16} aria-hidden="true" />
                </ToastClose>
              ) : null}
              {showAction ? <ToastAction /> : null}
            </ToastActions>
          ) : null}
        </ToastContent>
      </ToastRoot>
    );
  });
}

/** Publishes the live manager to `toastBridge` for surfaces that may render without a provider. */
function ToastManagerBridge() {
  const manager = useToastManager();
  useEffect(() => {
    setToastManager(manager);
    return () => setToastManager(null);
  }, [manager]);
  return null;
}

export default function LocalizedToastProvider({ children }: PropsWithChildren) {
  return (
    <ToastProvider renderViewport={false}>
      <ToastManagerBridge />
      {children}
      <ToastPortal>
        <ToastViewport placement="bottom-center">
          <LocalizedToastList />
        </ToastViewport>
      </ToastPortal>
    </ToastProvider>
  );
}
