import { createContext, useContext } from "react";
import type {
  AppAppearanceMode,
  AppResolvedMode,
  AppThemePreferences,
} from "../theme/appTheme";

export interface AppThemeContextValue {
  preferences: AppThemePreferences;
  /** The chosen appearance: light, dark, or follow the system. */
  mode: AppAppearanceMode;
  /** What is on screen right now. */
  resolvedMode: AppResolvedMode;
  setMode: (mode: AppAppearanceMode) => void;
}

export const AppThemeContext = createContext<AppThemeContextValue | null>(null);

export function useAppTheme(): AppThemeContextValue {
  const value = useContext(AppThemeContext);
  if (value === null) {
    throw new Error("useAppTheme must be used within AppThemeProvider");
  }
  return value;
}

export function useOptionalAppTheme(): AppThemeContextValue | null {
  return useContext(AppThemeContext);
}
