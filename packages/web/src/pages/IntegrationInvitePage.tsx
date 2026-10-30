import { AppSetupPanel, AppSetupRequirement } from "../components/integrations/AppSetup";
import { useCallback, useEffect, useEffectEvent, useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { useNavigate, useParams } from "react-router-dom";
import { Check, ExternalLink, Link2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectIcon,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectList,
  SelectTrigger,
  SelectValue,
  Button,
  Card,
  Separator,
  IconTile,
} from "@botiverse/raft-ui";
import api from "../api/client";
import Banner from "../components/ui/Banner";
import RequestedScopeConsent from "../components/oauth/RequestedScopeConsent";
import SectionEyebrow from "../components/ui/SectionEyebrow";
import { DEFAULT_DECLARED_OAUTH_SCOPES } from "../lib/oauthScopePresentation";

type OAuthClientShareInvite = {
  client: {
    id: string;
    clientId: string;
    name: string;
    description: string | null;
    homepageUrl: string | null;
    returnUrl: string | null;
    allowedScopes: string[] | null;
    logoUrl: string | null;
    publisherName: string | null;
    sourceServerName: string | null;
    installedAt: string | null;
    setupUrl?: string | null;
    setupDescription?: string | null;
  };
  link: {
    id: string;
    expiresAt: string | null;
  };
  manageableServers: Array<{
    id: string;
    name: string;
    slug: string;
    role: string;
    installedAt: string | null;
  }>;
};

type SelectOption = {
  value: string;
  label: string;
};

function renderSelectItems(options: readonly SelectOption[]) {
  return options.map((option) => (
    <SelectItem key={option.value} value={option.value}>
      <SelectItemText>{option.label}</SelectItemText>
      <SelectItemIndicator />
    </SelectItem>
  ));
}

function getDomain(raw: string | null | undefined, notConfiguredLabel: string) {
  if (!raw) return notConfiguredLabel;
  try {
    return new URL(raw).hostname;
  } catch {
    return raw;
  }
}

export default function IntegrationInvitePage() {
  const { formatDate, formatMessage } = useIntl();
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<OAuthClientShareInvite | null>(null);
  const [selectedServerId, setSelectedServerId] = useState("");
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState("");
  const [installed, setInstalled] = useState(false);

  // Effect Event: the fetch re-runs only when the token changes, while still
  // reading the current formatMessage for its fallback copy.
  const loadInvite = useEffectEvent(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get(`/integration-invites/${encodeURIComponent(token)}`);
      setInvite(data);
      const firstUninstalled = data.manageableServers.find((server: OAuthClientShareInvite["manageableServers"][number]) => !server.installedAt);
      const selected = firstUninstalled ?? data.manageableServers[0];
      setSelectedServerId(selected?.id ?? "");
      setInstalled(Boolean(selected?.installedAt));
    } catch (err: any) {
      setError(err.response?.data?.error || formatMessage({ id: "pages.integrationInvite.inviteNotFound" }));
    } finally {
      setLoading(false);
    }
  });

  useEffect(() => {
    void loadInvite();
  }, [token]);

  const selectedServer = invite?.manageableServers.find((server) => server.id === selectedServerId) ?? null;
  const manageableServerOptions = useMemo(() => invite?.manageableServers.map((server) => ({
    value: server.id,
    label: `${server.name}${server.installedAt ? formatMessage({ id: "pages.integrationInvite.installedSuffix" }) : ""}`,
  })) ?? [], [formatMessage, invite]);

  const install = useCallback(async () => {
    if (!selectedServerId) return;
    setInstalling(true);
    setError("");
    try {
      const { data } = await api.post(`/integration-invites/${encodeURIComponent(token)}/install`, {
        serverId: selectedServerId,
      });
      setInvite(data);
      setInstalled(true);
    } catch (err: any) {
      setError(err.response?.data?.error || formatMessage({ id: "pages.integrationInvite.installFailed" }));
    } finally {
      setInstalling(false);
    }
  }, [formatMessage, selectedServerId, token]);
  const handleInstallClick = useCallback(() => {
    void install();
  }, [install]);
  const handleServerChange = useCallback((value: string | null) => {
    if (value == null) return;
    setSelectedServerId(value);
    setInstalled(Boolean(invite?.manageableServers.find((server) => server.id === value)?.installedAt));
  }, [invite]);
  const selectedServerSlug = selectedServer?.slug;
  const openSelectedServerSettings = useCallback(() => {
    navigate(`/s/${selectedServerSlug}/settings`);
  }, [navigate, selectedServerSlug]);

  return (
    <div
      className="h-full min-h-0 overflow-y-auto bg-layer-sidebar font-display text-foreground safe-top safe-bottom"
      data-testid="integration-invite-page"
    >
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-4 py-8">
        <Card className="p-5">
          <div className="flex items-start justify-between gap-4 pb-4">
            <div>
              <SectionEyebrow as="div">{formatMessage({ id: "pages.integrationInvite.eyebrow" })}</SectionEyebrow>
              <h1 className="mt-1 text-title">{formatMessage({ id: "pages.integrationInvite.title" })}</h1>
            </div>
            <IconTile size="lg">
              <Link2 />
            </IconTile>
          </div>
          <Separator />

          {loading ? (
            <div className="py-12 text-center text-callout text-foreground-muted">{formatMessage({ id: "pages.integrationInvite.loading" })}</div>
          ) : error && !invite ? (
            <Banner intent="warning" className="mt-4">{error}</Banner>
          ) : invite ? (
            <div className="space-y-4 pt-4">
              {error && <Banner intent="warning">{error}</Banner>}
              {installed && (
                <Banner intent="success">
                  {invite.client.name} {formatMessage({ id: "pages.integrationInvite.installedBannerMid" })} {selectedServer?.name ?? formatMessage({ id: "pages.integrationInvite.installedBannerFallbackServer" })}.
                </Banner>
              )}

              {invite.client.setupUrl ? installed && selectedServerId
                ? <AppSetupPanel clientId={invite.client.id} serverId={selectedServerId} />
                : <AppSetupRequirement url={invite.client.setupUrl} description={invite.client.setupDescription} /> : null}

              <div className="rounded-container border border-line-hairline p-4">
                <div className="text-headline">{invite.client.name}</div>
                <div className="mt-1 text-caption text-foreground-hint">
                  {formatMessage({ id: "pages.integrationInvite.sharedByPrefix" })} {invite.client.publisherName ?? formatMessage({ id: "pages.integrationInvite.sharedByPublisherFallback" })} {formatMessage({ id: "pages.integrationInvite.sharedByServerMid" })} {invite.client.sourceServerName ?? formatMessage({ id: "pages.integrationInvite.sharedByServerFallback" })}
                </div>
                {invite.client.description && (
                  <p className="mt-3 text-callout text-foreground-muted">{invite.client.description}</p>
                )}
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-footnote font-medium text-foreground-hint">{formatMessage({ id: "pages.integrationInvite.clientIdLabel" })}</div>
                    <div className="break-all font-mono text-mono-meta text-foreground">{invite.client.clientId}</div>
                  </div>
                  <div>
                    <div className="text-footnote font-medium text-foreground-hint">{formatMessage({ id: "pages.integrationInvite.homepageLabel" })}</div>
                    <div className="break-all font-mono text-mono-meta text-foreground">{getDomain(invite.client.homepageUrl, formatMessage({ id: "pages.integrationInvite.notConfigured" }))}</div>
                  </div>
                  <div>
                    <div className="text-footnote font-medium text-foreground-hint">{formatMessage({ id: "pages.integrationInvite.callbackLabel" })}</div>
                    <div className="break-all font-mono text-mono-meta text-foreground">{getDomain(invite.client.returnUrl, formatMessage({ id: "pages.integrationInvite.notConfigured" }))}</div>
                  </div>
                  <div>
                    <div className="text-footnote font-medium text-foreground-hint">{formatMessage({ id: "pages.integrationInvite.inviteExpiryLabel" })}</div>
                    <div className="text-callout text-foreground">{invite.link.expiresAt ? formatDate(invite.link.expiresAt) : formatMessage({ id: "pages.integrationInvite.noExpiry" })}</div>
                  </div>
                </div>
              </div>

              <RequestedScopeConsent
                scopes={invite.client.allowedScopes?.length ? invite.client.allowedScopes : DEFAULT_DECLARED_OAUTH_SCOPES}
                className="rounded-container border border-line-hairline p-4"
              />

              {invite.manageableServers.length === 0 ? (
                <Banner intent="warning" className="font-bold">
                  {formatMessage({ id: "pages.integrationInvite.needAdmin" })}
                </Banner>
              ) : (
                <div className="rounded-container border border-line-hairline p-4">
                  <SectionEyebrow as="div">{formatMessage({ id: "pages.integrationInvite.installTargetLabel" })}</SectionEyebrow>
                  <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                    <div className="min-w-0">
                      <Select
                        value={selectedServerId}
                        onValueChange={handleServerChange}
                        items={manageableServerOptions}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={formatMessage({ id: "pages.integrationInvite.installTargetLabel" })} />
                          <SelectIcon />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectList>{renderSelectItems(manageableServerOptions)}</SelectList>
                        </SelectContent>
                      </Select>
                    </div>
                    {selectedServer?.installedAt ? (
                      <Button type="button" onClick={openSelectedServerSettings} size="lg" className="w-full md:w-auto">
                        <ExternalLink size={14} />
                        {formatMessage({ id: "pages.integrationInvite.openSettings" })}
                      </Button>
                    ) : (
                      <Button type="button" onClick={handleInstallClick} disabled={installing || !selectedServerId} size="lg" variant="accent" className="w-full md:w-auto">
                        <Check size={14} />
                        {installing ? formatMessage({ id: "pages.integrationInvite.installing" }) : formatMessage({ id: "pages.integrationInvite.installApp" })}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
