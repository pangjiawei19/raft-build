/**
 * A module-scoped handle on the app's toast manager.
 *
 * Surfaces that must report a failure but are also rendered without a provider
 * (tests, and the odd non-app mount) cannot call `useToastManager()` — the hook
 * throws outside `<Toast.Provider>`. `LocalizedToastProvider` registers the
 * live manager here once, and everyone else reports through `showToast`, which
 * simply does nothing when no provider is mounted.
 */
type BridgedToast = {
  title: string;
  type?: string;
  /** One button on the toast, e.g. "Retry". */
  actionProps?: { children: string; onClick: () => void };
};
type ToastManager = { add: (toast: BridgedToast) => void };

let manager: ToastManager | null = null;

export function setToastManager(next: ToastManager | null): void {
  manager = next;
}

export function showToast(toast: BridgedToast): void {
  manager?.add(toast);
}
