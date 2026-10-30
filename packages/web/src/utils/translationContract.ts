const SILENT_TRANSLATION_SKIP_REASONS = new Set([
  "same_language",
  "own_message",
  "system_message",
  "code_or_link_only",
  "low_confidence",
]);

export function shouldHideTranslationIndicator(status: string, reason?: string | null) {
  if (status === "not_found") return true;
  if (status !== "skipped") return false;
  return !reason || SILENT_TRANSLATION_SKIP_REASONS.has(reason);
}

export type PublicPersonalSettingsTabId = "account" | "language-region" | "appearance";

export function getPublicPersonalSettingsTabIds(options: {
  authenticated: boolean;
  translationEnabled: boolean;
}): PublicPersonalSettingsTabId[] {
  if (!options.authenticated) {
    return [
      ...(options.translationEnabled ? ["language-region" as const] : []),
      "appearance",
    ];
  }
  return [
    "account",
    ...(options.translationEnabled ? ["language-region" as const] : []),
    "appearance",
  ];
}
