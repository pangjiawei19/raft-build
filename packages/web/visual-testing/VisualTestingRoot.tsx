import type { ReactNode } from "react";
import { ThemeProvider, TooltipProvider } from "@botiverse/raft-ui";
import { BrowserRouter } from "react-router-dom";

import { IntlProviderWrapper } from "../src/i18n/IntlProviderWrapper";
import { LocaleProvider } from "../src/i18n/LocaleProvider";
import { AppThemeContext } from "../src/hooks/useAppTheme";
import type { AppThemeContextValue } from "../src/hooks/useAppTheme";
import type { AppResolvedMode } from "../src/theme/appTheme";

// The visual-testing root pins the appearance; the setter is inert.
function ignoreThemeChange() {}

function fixedThemeContext(mode: AppResolvedMode): AppThemeContextValue {
  return {
    preferences: { mode },
    mode,
    resolvedMode: mode,
    setMode: ignoreThemeChange,
  };
}

const FIXED_THEME_CONTEXTS: Record<AppResolvedMode, AppThemeContextValue> = {
  light: fixedThemeContext("light"),
  dark: fixedThemeContext("dark"),
};

export function VisualTestingRoot({
  children,
  mode,
}: {
  children: ReactNode;
  mode: AppResolvedMode;
}) {
  return (
    <ThemeProvider mode={mode}>
      <AppThemeContext.Provider value={FIXED_THEME_CONTEXTS[mode]}>
        <TooltipProvider>
          <BrowserRouter>
            <LocaleProvider>
              <IntlProviderWrapper>{children}</IntlProviderWrapper>
            </LocaleProvider>
          </BrowserRouter>
        </TooltipProvider>
      </AppThemeContext.Provider>
    </ThemeProvider>
  );
}
