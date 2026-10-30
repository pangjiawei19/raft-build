import { useCallback } from "react";
import { useIntl } from "react-intl";
import { useServerStore } from "../../store/serverStore";
import TextLink from "../ui/TextLink";

/**
 * Shared escape links for every blocking server-setup surface. Setup may make
 * you finish before chatting, but it must never lock the owner out of the
 * server's own settings, where Delete lives. The setup gate stays down on
 * settings routes, so this link actually lands somewhere usable (task #246;
 * replaces the in-modal Delete from task #141).
 */
export default function SetupSessionFooter({
  disabled = false,
  showServerSettings = false,
}: {
  disabled?: boolean;
  /** Only the steps before the server works (Connect computer, Meet Cindy): that
   * is where a half-built server needs a way to Settings > Delete (cindyz). */
  showServerSettings?: boolean;
}) {
  const { formatMessage } = useIntl();
  const clearCurrent = useServerStore((state) => state.clearCurrent);
  const serverSlug = useServerStore((state) => state.current?.slug ?? null);

  const handleSwitchServer = useCallback(() => {
    clearCurrent();
    window.history.pushState({}, "", "/servers");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, [clearCurrent]);
  const handleOpenSettings = useCallback(() => {
    if (!serverSlug) return;
    window.history.pushState({}, "", `/s/${serverSlug}/settings/server`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, [serverSlug]);

  return (
    <div className="flex items-center gap-4 text-footnote" data-testid="setup-session-footer">
      <TextLink
        variant="muted"
        onClick={handleSwitchServer}
        disabled={disabled}
        data-testid="setup-switch-server"
      >
        {formatMessage({ id: "layout.onboarding.switchServer" })}
      </TextLink>
      {showServerSettings && serverSlug ? (
        <TextLink
          variant="muted"
          onClick={handleOpenSettings}
          disabled={disabled}
          data-testid="setup-server-settings"
        >
          {formatMessage({ id: "layout.onboarding.serverSettings" })}
        </TextLink>
      ) : null}
    </div>
  );
}
