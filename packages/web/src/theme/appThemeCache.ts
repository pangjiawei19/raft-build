import {
  APP_THEME_PREFERENCES_STORAGE_KEY,
  APP_THEME_PRESET_STORAGE_KEY_PREFIX,
  APP_THEME_STORAGE_KEY,
  DEFAULT_APP_THEME_PREFERENCES,
  normalizeAppThemePreferences,
  preferencesFromLegacyPreset,
} from "./appTheme";
import type { AppThemePreferences } from "./appTheme";

export {
  APP_THEME_PREFERENCES_STORAGE_KEY,
  APP_THEME_PRESET_STORAGE_KEY_PREFIX,
  APP_THEME_STORAGE_KEY,
} from "./appTheme";

type ThemeStorage = Pick<Storage, "getItem" | "setItem" | "key" | "length">;

/**
 * One preference for this browser profile. It is not derived from the signed-in
 * account, so switching accounts or signing out keeps the same appearance.
 */
export const DEVICE_THEME_STORAGE_KEY = APP_THEME_PREFERENCES_STORAGE_KEY;

function browserStorage(): ThemeStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function parseStoredPreferences(raw: string | null): AppThemePreferences | null {
  if (!raw) return null;
  const legacy = preferencesFromLegacyPreset(raw);
  if (legacy) return legacy;
  try {
    return normalizeAppThemePreferences(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function readDeviceThemePreferences(
  storage: ThemeStorage | null = browserStorage(),
): AppThemePreferences {
  if (storage === null) return { ...DEFAULT_APP_THEME_PREFERENCES };
  try {
    const raw = storage.getItem(DEVICE_THEME_STORAGE_KEY);
    if (raw) {
      // A corrupt record falls back to the default below (JSON.parse throws);
      // a readable record of another shape still lets a legacy key migrate.
      const current = preferencesFromLegacyPreset(raw) ?? normalizeAppThemePreferences(JSON.parse(raw));
      if (current) return current;
    }

    const migrated = migrateLegacyDevicePreferences(storage);
    if (!migrated) return { ...DEFAULT_APP_THEME_PREFERENCES };
    // Keep the user's existing choice even when this browser cannot persist it.
    writeDeviceThemePreferences(migrated, storage);
    return migrated;
  } catch {
    return { ...DEFAULT_APP_THEME_PREFERENCES };
  }
}

export function writeDeviceThemePreferences(
  preferences: AppThemePreferences,
  storage: ThemeStorage | null = browserStorage(),
): boolean {
  const normalized = normalizeAppThemePreferences(preferences);
  if (storage === null || normalized === null) return false;
  try {
    storage.setItem(DEVICE_THEME_STORAGE_KEY, JSON.stringify(normalized));
    return true;
  } catch {
    // Storage is an optimization for first paint. The current page stays
    // responsive even when private mode or quota policy makes it unavailable.
    return false;
  }
}

function migrateLegacyDevicePreferences(storage: ThemeStorage): AppThemePreferences | null {
  const legacyPreset = preferencesFromLegacyPreset(storage.getItem(APP_THEME_STORAGE_KEY));
  if (legacyPreset) return legacyPreset;

  // Older builds stored one preset per account. A device with exactly one such
  // value keeps it; several accounts can disagree, so none of them is promoted.
  const accountPreferences: AppThemePreferences[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(APP_THEME_PRESET_STORAGE_KEY_PREFIX)) continue;
    const parsed = parseStoredPreferences(storage.getItem(key));
    if (parsed) accountPreferences.push(parsed);
  }
  if (accountPreferences.length !== 1) return null;
  return accountPreferences[0] ?? null;
}

/** Whether this browser already holds an appearance choice (current or legacy keys). */
export function hasDeviceThemePreference(storage: ThemeStorage | null = browserStorage()): boolean {
  if (storage === null) return false;
  try {
    readDeviceThemePreferences(storage);
    return storage.getItem(DEVICE_THEME_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}
