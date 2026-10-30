import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { ThemeProvider } from "@botiverse/raft-ui";
import { AppThemeContext } from "../hooks/useAppTheme";
import {
  DEVICE_THEME_STORAGE_KEY,
  readDeviceThemePreferences,
  writeDeviceThemePreferences,
} from "./appThemeCache";
import {
  APP_THEME_PRESET_STORAGE_KEY_PREFIX,
  APP_THEME_STORAGE_KEY,
  DEFAULT_APP_THEME_PREFERENCES,
  isAppAppearanceMode,
  resolveAppThemeMode,
} from "./appTheme";
import type {
  AppAppearanceMode,
  AppResolvedMode,
  AppThemePreferences,
} from "./appTheme";
import { appThemeChromeColor } from "./appThemeChrome";

// RUI reads matchMedia even when an explicit mode is supplied. Keep the
// provider usable in non-browser test/SSR harnesses that do not install it.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  })) as typeof window.matchMedia;
}

function subscribeSystemMode(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener?.("change", onChange);
  return () => query.removeEventListener?.("change", onChange);
}

function getSystemMode(): AppResolvedMode {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function syncRootTheme(mode: AppResolvedMode): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("light", mode === "light");
  root.classList.toggle("dark", mode === "dark");
  root.style.colorScheme = mode;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = appThemeChromeColor(mode);
}

function isDeviceThemeStorageKey(key: string | null): boolean {
  return key === DEVICE_THEME_STORAGE_KEY
    || key === APP_THEME_STORAGE_KEY
    || (key?.startsWith(APP_THEME_PRESET_STORAGE_KEY_PREFIX) ?? false);
}

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferenceState] = useState<AppThemePreferences>(
    () => readDeviceThemePreferences(),
  );
  const systemMode = useSyncExternalStore<AppResolvedMode>(
    subscribeSystemMode,
    getSystemMode,
    () => "light",
  );
  const resolvedMode = resolveAppThemeMode(preferences, systemMode);

  useLayoutEffect(() => {
    syncRootTheme(resolvedMode);
  }, [resolvedMode]);

  // Another tab changed the appearance: follow it.
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (!isDeviceThemeStorageKey(event.key)) return;
      setPreferenceState(readDeviceThemePreferences());
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const setMode = useCallback((mode: AppAppearanceMode) => {
    if (!isAppAppearanceMode(mode)) return;
    const next = { mode };
    setPreferenceState(next);
    writeDeviceThemePreferences(next);
  }, []);

  const contextValue = useMemo(() => ({
    preferences,
    mode: preferences.mode,
    resolvedMode,
    setMode,
  }), [preferences, resolvedMode, setMode]);

  return (
    <AppThemeContext.Provider value={contextValue}>
      <ThemeProvider mode={resolvedMode} onModeChange={setMode}>
        {children}
      </ThemeProvider>
    </AppThemeContext.Provider>
  );
}

// Compatibility re-export for existing Web consumers and tests.
export { useAppTheme } from "../hooks/useAppTheme";

export { DEFAULT_APP_THEME_PREFERENCES };
