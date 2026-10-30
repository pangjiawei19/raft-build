import assert from "node:assert/strict";
import "./helpers/domSetup";
import { act, useEffect } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { useAuthStore } from "../src/store/authStore";
import {
  AppThemeProvider,
  useAppTheme,
} from "../src/theme/AppThemeProvider";
import {
  APP_THEME_PREFERENCES_STORAGE_KEY,
  APP_THEME_STORAGE_KEY,
} from "../src/theme/appTheme";
import { RAFT_DARK_THEME_CHROME_COLOR, RAFT_LIGHT_THEME_CHROME_COLOR } from "../src/theme/appThemeChrome";

function accessToken(subject: string): string {
  const payload = Buffer.from(JSON.stringify({ sub: subject, type: "access" }))
    .toString("base64url");
  return `header.${payload}.signature`;
}

let systemDark = false;
window.matchMedia = ((query: string) => ({
  get matches() {
    return query === "(prefers-color-scheme: dark)" && systemDark;
  },
  media: query,
  onchange: null,
  addListener: () => undefined,
  removeListener: () => undefined,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => true,
})) as typeof window.matchMedia;

function ThemeProbe() {
  const { mode, resolvedMode, setMode } = useAppTheme();
  useEffect(() => {
    beforePaintSnapshots.push({
      mode,
      rootTheme: document.documentElement.dataset.theme,
      light: document.documentElement.classList.contains("light"),
      dark: document.documentElement.classList.contains("dark"),
      themeColor: document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content,
    });
  }, [mode, resolvedMode]);
  return (
    <div>
      <output data-testid="mode">{mode}</output>
      <output data-testid="resolved">{resolvedMode}</output>
      <button type="button" onClick={() => setMode("light")}>Use light</button>
    </div>
  );
}

const originalLocalStorage = window.localStorage;
const beforePaintSnapshots: Array<{
  mode: string;
  rootTheme: string | undefined;
  light: boolean;
  dark: boolean;
  themeColor: string | undefined;
}> = [];

function setAccount(accountId: string | null) {
  useAuthStore.setState({
    accessToken: accountId === null ? null : accessToken(accountId),
    user: null,
  });
}

beforeEach(() => {
  const themeColor = document.createElement("meta");
  themeColor.name = "theme-color";
  themeColor.content = "#FFD440";
  document.head.append(themeColor);
});

afterEach(() => {
  cleanup();
  systemDark = false;
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: originalLocalStorage,
  });
  document.querySelector('meta[name="theme-color"]')?.remove();
  window.localStorage.clear();
  beforePaintSnapshots.length = 0;
  setAccount(null);
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.style.removeProperty("color-scheme");
});

test("legacy brutal stays light even when the system is dark and storage cannot be written", async () => {
  systemDark = true;
  const values = new Map<string, string>([[APP_THEME_STORAGE_KEY, "brutal"]]);
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return values.size;
      },
      key: (index: number) => Array.from(values.keys())[index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: () => {
        throw new Error("storage is read-only");
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
      clear: () => {
        values.clear();
      },
    },
  });

  render(
    <AppThemeProvider>
      <ThemeProbe />
    </AppThemeProvider>,
  );

  assert.equal(screen.getByTestId("mode").textContent, "light");
  await waitFor(() => {
    assert.equal(document.documentElement.hasAttribute("data-theme"), false, "only the mode reaches <html>; no theme family");
    assert.equal(document.documentElement.classList.contains("dark"), false);
  });
  assert.equal(window.localStorage.getItem(APP_THEME_PREFERENCES_STORAGE_KEY), null);
});

test("the device preference restores and persists without an account", async () => {
  window.localStorage.setItem(APP_THEME_STORAGE_KEY, "elegant-dark");

  render(
    <AppThemeProvider>
      <ThemeProbe />
    </AppThemeProvider>,
  );

  assert.equal(screen.getByTestId("mode").textContent, "dark");
  await waitFor(() => {
    assert.equal(document.documentElement.hasAttribute("data-theme"), false, "only the mode reaches <html>; no theme family");
    assert.equal(document.documentElement.classList.contains("dark"), true);
    assert.equal(
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content,
      RAFT_DARK_THEME_CHROME_COLOR,
    );
  });

  fireEvent.click(screen.getByRole("button", { name: "Use light" }));

  assert.equal(screen.getByTestId("mode").textContent, "light");
  assert.equal(
    window.localStorage.getItem(APP_THEME_PREFERENCES_STORAGE_KEY),
    JSON.stringify({ mode: "light" }),
  );
  assert.deepEqual(beforePaintSnapshots.at(-1), {
    mode: "light",
    rootTheme: undefined,
    light: true,
    dark: false,
    themeColor: RAFT_LIGHT_THEME_CHROME_COLOR,
  });
});

test("following the system resolves to the system's mode", () => {
  systemDark = true;
  render(
    <AppThemeProvider>
      <ThemeProbe />
    </AppThemeProvider>,
  );
  assert.equal(screen.getByTestId("mode").textContent, "system");
  assert.equal(screen.getByTestId("resolved").textContent, "dark");
});

test("switching accounts keeps the same device theme", () => {
  window.localStorage.setItem(
    APP_THEME_PREFERENCES_STORAGE_KEY,
    JSON.stringify({ mode: "dark", lightThemeId: "brutal", darkThemeId: "elegant" }),
  );
  setAccount("account-a");

  render(
    <AppThemeProvider>
      <ThemeProbe />
    </AppThemeProvider>,
  );
  assert.equal(screen.getByTestId("mode").textContent, "dark");

  act(() => setAccount("account-b"));
  assert.equal(screen.getByTestId("mode").textContent, "dark");

  act(() => setAccount(null));
  assert.equal(screen.getByTestId("mode").textContent, "dark");
});

test("a storage event from another tab refreshes the device preference", () => {
  window.localStorage.clear();
  render(
    <AppThemeProvider>
      <ThemeProbe />
    </AppThemeProvider>,
  );
  assert.equal(screen.getByTestId("mode").textContent, "system");

  const next = JSON.stringify({ mode: "light" });
  window.localStorage.setItem(APP_THEME_PREFERENCES_STORAGE_KEY, next);
  act(() => window.dispatchEvent(new StorageEvent("storage", {
    key: APP_THEME_PREFERENCES_STORAGE_KEY,
    newValue: next,
  })));
  assert.equal(screen.getByTestId("mode").textContent, "light");
});
