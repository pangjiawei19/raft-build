import { useSyncExternalStore } from "react";

/**
 * Task #247: a new account picks its display style once, during onboarding.
 *
 * Browser-local on purpose, like the theme itself. Only account setup marks it
 * "pending", so people who signed up before this shipped are never asked; the
 * picker (setup step for owners, a dialog for invited members) marks it "done"
 * whatever they choose, including nothing.
 */
const STORAGE_KEY = "raft:onboarding-display-style:v1";
const CHANGE_EVENT = "raft:onboarding-display-style-change";

type OnboardingDisplayStyleState = "pending" | "done" | null;

// Set when "done" could not be persisted (private mode, quota), so Continue
// still closes the prompt for the rest of this page's life.
let doneThisSession = false;

function read(): OnboardingDisplayStyleState {
  if (doneThisSession) return "done";
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "pending" || value === "done" ? value : null;
  } catch {
    return null;
  }
}

function write(value: Exclude<OnboardingDisplayStyleState, null>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Private mode / quota: the prompt simply does not persist.
  }
  window.dispatchEvent(new window.Event(CHANGE_EVENT));
}

/** Called by account setup. Never re-opens a choice already made in this browser. */
export function markOnboardingDisplayStylePending() {
  if (read() === null) write("pending");
}

export function completeOnboardingDisplayStyle() {
  doneThisSession = true;
  write("done");
}

/** Test seam: forget the in-memory "done". */
export function resetOnboardingDisplayStyleSessionForTest() {
  doneThisSession = false;
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useOnboardingDisplayStylePending(): boolean {
  return useSyncExternalStore(subscribe, () => read() === "pending", () => false);
}
