import { Button, Card, IconTile } from "@botiverse/raft-ui";
import { useCallback } from "react";
import { useIntl } from "react-intl";
import type { AuthProvider } from "../../hooks/useAuthProviders";
import { SocialProviderIcon } from "./SettingsPanel";

export function ProviderAccountRow({
  provider,
  identity,
  linking,
  onConnect,
  onRequestDisconnect,
}: {
  provider: AuthProvider;
  identity: { providerEmail: string | null } | undefined;
  linking: boolean;
  onConnect: (provider: AuthProvider) => void;
  onRequestDisconnect: (provider: AuthProvider) => void;
}) {
  const { formatMessage } = useIntl();
  const handleConnect = useCallback(() => onConnect(provider), [onConnect, provider]);
  const handleRequestDisconnect = useCallback(() => onRequestDisconnect(provider), [onRequestDisconnect, provider]);

  return (
    <Card
      role="group"
      aria-label={formatMessage({ id: "settings.account.providerAccountAria" }, { label: provider.label })}
      className="min-h-11 flex-row items-center gap-3 px-4 py-3 text-left"
    >
      <IconTile>
        <SocialProviderIcon providerId={provider.id} />
      </IconTile>
      <div className="min-w-0 flex-1">
        <div className="truncate text-subhead font-semibold text-foreground">{provider.label}</div>
        <div className="truncate text-footnote text-foreground-muted">
          {identity?.providerEmail
            ? formatMessage({ id: "settings.account.connectedAs" }, { email: identity.providerEmail })
            : formatMessage({ id: "settings.account.notConnected" })}
        </div>
      </div>
      {!identity && (
        <Button
          variant="outline" size="sm"
          type="button"
          onClick={handleConnect}
          disabled={linking}
          className="shrink-0"
        >
          {linking ? formatMessage({ id: "settings.account.connecting" }) : formatMessage({ id: "settings.account.connect" })}
        </Button>
      )}
      {identity && (
        <Button
          variant="outline" size="sm"
          type="button"
          onClick={handleRequestDisconnect}
          aria-label={formatMessage({ id: "settings.account.disconnectAria" }, { label: provider.label })}
          className="shrink-0"
        >
          {formatMessage({ id: "settings.account.disconnect" })}
        </Button>
      )}
    </Card>
  );
}
