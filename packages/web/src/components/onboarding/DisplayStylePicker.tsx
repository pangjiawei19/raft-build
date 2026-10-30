import { useOptionalAppTheme } from "../../hooks/useAppTheme";
import AppearanceThemePicker from "../settings/AppearanceThemePicker";

/**
 * The appearance choice, offered once during onboarding. Same cards as
 * Settings > Appearance on purpose: what you pick here is what you will find
 * there later. Selecting applies immediately, so the dialog and the app behind
 * it restyle under the user's cursor; that is the preview.
 */
export default function DisplayStylePicker() {
  const theme = useOptionalAppTheme();
  if (!theme) return null;
  return <AppearanceThemePicker mode={theme.mode} onModeChange={theme.setMode} size="large" />;
}
