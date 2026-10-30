import assert from "node:assert/strict";
import "./helpers/domSetup";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { AppearanceThemeSettingsControl } from "../src/components/settings/SettingsPanel";
import { AppThemeProvider } from "../src/theme/AppThemeProvider";
import { useAppTheme } from "../src/hooks/useAppTheme";
import { useAuthStore } from "../src/store/authStore";
import {
  APP_THEME_PREFERENCES_STORAGE_KEY,
  APP_THEME_STORAGE_KEY,
} from "../src/theme/appTheme";
import { TestIntlProvider } from "./helpers/intl";

const originalMatchMedia = window.matchMedia;

function accessToken(subject: string): string {
  const payload = Buffer.from(JSON.stringify({ sub: subject, type: "access" })).toString("base64url");
  return `header.${payload}.signature`;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.matchMedia = originalMatchMedia;
  useAuthStore.setState({ accessToken: null, user: null });
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.style.removeProperty("color-scheme");
});

beforeEach(() => {
  useAuthStore.setState({ accessToken: accessToken("appearance-account"), user: null });
});

let observedMode = "";

function PolicyProbe() {
  const { mode } = useAppTheme();
  observedMode = mode;
  return null;
}

function ProductAppearance() {
  return (
    <TestIntlProvider locale="en">
      <AppThemeProvider>
        <PolicyProbe />
        <AppearanceThemeSettingsControl />
      </AppThemeProvider>
    </TestIntlProvider>
  );
}

function modeRadio(mode: "light" | "dark" | "system") {
  return within(screen.getByTestId(`appearance-theme-${mode}`)).getByRole("radio");
}

test("the real Settings Appearance path saves the device preference", () => {
  window.localStorage.setItem(APP_THEME_STORAGE_KEY, "brutal");
  observedMode = "";
  render(<ProductAppearance />);
  assert.equal(observedMode, "light", "a legacy brutal device opens on Light");

  fireEvent.click(modeRadio("dark"));
  assert.equal(observedMode, "dark", "the settings control received the mode mutation");
  assert.deepEqual(
    JSON.parse(window.localStorage.getItem(APP_THEME_PREFERENCES_STORAGE_KEY) ?? "null"),
    { mode: "dark" },
  );
  // Only the mode reaches the page root; there is no theme family attribute.
  assert.equal(document.documentElement.classList.contains("dark"), true);
  assert.equal(document.documentElement.classList.contains("light"), false);
  assert.equal(document.documentElement.style.colorScheme, "dark");
  assert.equal(document.documentElement.hasAttribute("data-theme"), false);
  assert.ok(screen.queryByRole("status") === null, "there is no deployment rollback notice");
});

test("Light, Dark and System are the three choices, and the choice survives a remount", () => {
  const view = render(<ProductAppearance />);
  assert.equal(screen.getAllByRole("radio").length, 3);
  assert.ok(screen.getByTestId("appearance-theme-light").textContent?.includes("Light"));
  assert.ok(screen.getByTestId("appearance-theme-dark").textContent?.includes("Dark"));
  assert.ok(screen.getByTestId("appearance-theme-system").textContent?.includes("System"));

  fireEvent.click(modeRadio("light"));
  fireEvent.click(modeRadio("system"));
  assert.deepEqual(
    JSON.parse(window.localStorage.getItem(APP_THEME_PREFERENCES_STORAGE_KEY) ?? "null"),
    { mode: "system" },
  );

  view.unmount();
  render(<ProductAppearance />);
  assert.equal(modeRadio("system").getAttribute("aria-checked"), "true");
  assert.equal(modeRadio("light").getAttribute("aria-checked"), "false");
});

test("each card previews the Raft Design System in its own mode, whatever the page is in", () => {
  window.localStorage.setItem(APP_THEME_PREFERENCES_STORAGE_KEY, JSON.stringify({ mode: "dark" }));
  render(<ProductAppearance />);

  assert.equal(document.documentElement.classList.contains("dark"), true, "the page itself is dark");
  // Each preview is a mode scope (`.light` / `.dark`), so it renders its own
  // mode whatever the page root says.
  const previewModes = (mode: "light" | "dark" | "system") =>
    Array.from(
      screen.getByTestId(`appearance-theme-${mode}`).querySelectorAll<HTMLElement>(".light, .dark"),
      (node) => (node.classList.contains("dark") ? "dark" : "light"),
    );
  assert.deepEqual(previewModes("light"), ["light"]);
  assert.deepEqual(previewModes("dark"), ["dark"]);
  assert.deepEqual(previewModes("system"), ["light", "dark"]);
  const lightPreview = screen.getByTestId("appearance-theme-light").querySelector<HTMLElement>(".light");
  // The preview is the frame → sidebar → paper ladder of the DS.
  assert.ok(lightPreview?.querySelector(".bg-layer-frame"));
  assert.ok(lightPreview?.querySelector(".bg-layer-sidebar"));
});
