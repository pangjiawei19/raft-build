import { AppSetupRequirement } from "../components/integrations/AppSetup";
import { appendOAuthAuthorizationParams } from "@botiverse/raft-shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { useIntl } from "react-intl";
import {
  Select,
  SelectContent,
  SelectIcon,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectList,
  SelectTrigger,
  SelectValue, Spinner, Button, Card, Badge, Input
} from "@botiverse/raft-ui";
import api from "../api/client";
import { useAuthStore } from "../store/authStore";
import { useServerStore } from "../store/serverStore";
import type { Server } from "../store/serverStore";
import AvatarSlot from "../components/ui/AvatarSlot";
import SignedInAs from "../components/auth/SignedInAs";
import RaftBrandLockup from "../components/brand/RaftBrandLockup";
import RequestedScopeConsent from "../components/oauth/RequestedScopeConsent";
import { hasAgentInboundOAuthScope } from "../lib/oauthScopePresentation";
import { MarketplaceServerRow } from "./MarketplaceServerRow";

type LoginClientSummary = {
  id?: string;
  clientId: string;
  appType: "server_local" | "third_party_global";
  name: string;
  description: string | null;
  homepageUrl: string | null;
  returnUrl: string | null;
  logoUrl?: string | null;
  setupUrl?: string | null;
  setupDescription?: string | null;
  allowedScopes?: string[] | null;
  scopeValidation?: {
    allowed: boolean;
    reason: "not_allowed" | "unsupported" | "mixed" | null;
    disallowedScopes: string[];
  };
  marketplace?: boolean;
  availability?: "ready" | "install_required";
  installation?: {
    serverId: string;
    canInstall: boolean;
  };
};

export type AvailableServerClient = {
  server: Server;
  client: LoginClientSummary;
};

type SelectOption = {
  value: string;
  label: string;
};

function marketplaceServerRank(entry: AvailableServerClient | undefined) {
  if (!entry) return 3;
  if (entry.client.availability !== "install_required") return 0;
  return entry.client.installation?.canInstall ? 1 : 2;
}


function renderSelectItems(options: readonly SelectOption[]) {
  return options.map((option) => (
    <SelectItem key={option.value} value={option.value}>
      <SelectItemText>{option.label}</SelectItemText>
      <SelectItemIndicator />
    </SelectItem>
  ));
}

// The app's details sit in a raft-ui Card; a card that opens the app's
// homepage is the same Card drawn on a link.
const APP_DETAILS_CARD_CLASS = "mt-1.5 px-3 py-2.5 text-callout";
const APP_DETAILS_LINK_CARD_CLASS = `${APP_DETAILS_CARD_CLASS} no-underline outline-none hover:press-overlay active:press-overlay focus-visible:shadow-focus`;

// A field label above a value (DS TextField label: 13/18 600, ink-2).
const FIELD_LABEL_CLASS = "text-footnote font-semibold text-foreground-muted";
// Help text under a field (DS: 12/16, ink-3).
const FIELD_HELP_CLASS = "mt-1.5 text-caption text-foreground-hint";
// A read-only stand-in where the server picker would be (loading / none).
const FIELD_PLACEHOLDER_CLASS = "flex min-h-11 items-center rounded-control border-[1.5px] border-line-hairline bg-fill-muted px-3 text-callout text-foreground-muted";
// DS Button drawn on a link, so these stay links for assistive tech.
const GHOST_LINK_BUTTON_CLASS = "inline-flex h-8 items-center rounded-control px-2.5 text-footnote font-bold text-foreground no-underline outline-none hover:bg-fill-pressed active:bg-fill-pressed focus-visible:shadow-focus";
const OUTLINE_LINK_BUTTON_CLASS = "mt-3 flex h-11 w-full items-center justify-center rounded-control border-[1.5px] border-line-strong bg-layer-card px-4 text-center text-subhead font-bold text-foreground no-underline outline-none hover:press-overlay active:press-overlay focus-visible:shadow-focus";

function LoginAppDetailsCard({ client }: { client: LoginClientSummary }) {
  const { formatMessage } = useIntl();
  const content = (
    <div className="flex min-w-0 items-start gap-3">
      <AvatarSlot
        context="list-row"
        type="app"
        appAvatarUrl={client.logoUrl}
        appInitials={initialsForApp(client.name)}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 break-words text-subhead font-bold">{client.name}</span>
          <Badge variant="success" appearance="soft">{formatMessage({
            id: client.marketplace || client.availability === "install_required"
              ? "pages.humanLogin.marketplace"
              : "pages.humanLogin.ready",
          })}</Badge>
        </div>
        {client.description && <div className="text-footnote text-foreground-muted">{client.description}</div>}
      </div>
    </div>
  );

  if (!client.homepageUrl) {
    return <Card className={APP_DETAILS_CARD_CLASS}>{content}</Card>;
  }

  return (
    <Card
      render={(
        <a
          href={client.homepageUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`${formatMessage({ id: "pages.humanLogin.openAppAriaPrefix" })} ${client.name}`}
        />
      )}
      className={APP_DETAILS_LINK_CARD_CLASS}
    >
      {content}
    </Card>
  );
}

export function initialsForApp(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return "A";
  const second = parts[1];
  return (second ? `${first[0]}${second[0]}` : first.slice(0, 2)).toUpperCase();
}

export default function HumanLoginSetupPage() {
  const { formatMessage } = useIntl();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const servers = useServerStore((s) => s.servers);
  const serversLoading = useServerStore((s) => s.loading);
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const configuredReturnUrl = params.get("return_to") || params.get("redirect_uri") || "";
  const setupState = params.get("state") || "";
  const oidcFlow = params.get("flow") === "oidc";
  const oidcNonce = params.get("nonce") || "";
  const oidcCodeChallenge = params.get("code_challenge") || "";
  const oidcCodeChallengeMethod = params.get("code_challenge_method") || "";
  const requestedServerHint = params.get("server") || "";
  const clientId = params.get("client_id") || "";
  const scopes = useMemo(() => {
    const raw = params.get("scope") || "openid profile";
    return raw.split(/\s+/).map((scope) => scope.trim()).filter(Boolean);
  }, [params]);
  const candidateServers = useMemo(() => (
    requestedServerHint
      ? servers.filter((server) => server.id === requestedServerHint || server.slug === requestedServerHint)
      : servers
  ), [requestedServerHint, servers]);
  const [selectedServerId, setSelectedServerId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [availableServerClients, setAvailableServerClients] = useState<AvailableServerClient[]>([]);
  const [installRequiredServerClients, setInstallRequiredServerClients] = useState<AvailableServerClient[]>([]);
  const [clientLoading, setClientLoading] = useState(false);
  const [clientError, setClientError] = useState("");
  const [installingServerId, setInstallingServerId] = useState("");
  const [serverQuery, setServerQuery] = useState("");
  const handleServerQueryChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setServerQuery(event.target.value);
  }, []);

  // Async-loader: OAuth client availability by clientId across the user's servers.
  // Unavailable servers are hidden from the selector instead of surfacing a dead option.
  // oxlint-disable-next-line react-doctor/no-cascading-set-state
  useEffect(() => {
    if (!clientId.trim()) {
      setAvailableServerClients([]);
      setInstallRequiredServerClients([]);
      setClientError("");
      setClientLoading(false);
      setSelectedServerId("");
      return;
    }

    if (serversLoading) {
      setAvailableServerClients([]);
      setInstallRequiredServerClients([]);
      setClientError("");
      setClientLoading(true);
      return;
    }

    if (candidateServers.length === 0) {
      setAvailableServerClients([]);
      setInstallRequiredServerClients([]);
      setClientError(formatMessage({ id: "pages.humanLogin.noServerAccess" }));
      setClientLoading(false);
      setSelectedServerId("");
      return;
    }

    let cancelled = false;
    setClientLoading(true);
    setClientError("");
    setAvailableServerClients([]);
    setInstallRequiredServerClients([]);

    void Promise.all(candidateServers.map((server) =>
      api.get("/oauth/clients/lookup", {
        params: {
          client_id: clientId,
          server_id: server.id,
          scope: scopes.join(" "),
        },
      }).then((res) => ({
        server,
        client: res.data as LoginClientSummary,
      })).catch(() => null)
    )).then((results) => {
      if (cancelled) return;
      const found = results.filter((result): result is AvailableServerClient => result !== null);
      const available = found.filter((result) => result.client.availability !== "install_required");
      const installRequired = found.filter((result) => result.client.availability === "install_required");
      setAvailableServerClients(available);
      setInstallRequiredServerClients(installRequired);
      const ordered = [...found].sort((left, right) => (
        marketplaceServerRank(left) - marketplaceServerRank(right)
        || left.server.name.localeCompare(right.server.name)
      ));
      setSelectedServerId((current) => (
        found.some((entry) => entry.server.id === current) ? current : ordered[0]?.server.id ?? ""
      ));
      if (available.length === 0 && installRequired.length === 0) {
        setClientError(formatMessage({ id: "pages.humanLogin.notRegisteredForAny" }));
      }
    }).finally(() => {
      if (!cancelled) {
        setClientLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [candidateServers, clientId, scopes, serversLoading, formatMessage]);

  const selectedServerClient = availableServerClients.find((entry) => entry.server.id === selectedServerId);
  const client = selectedServerClient?.client ?? null;
  const marketplaceClient = [
    ...availableServerClients,
    ...installRequiredServerClients,
  ].find((entry) => entry.client.marketplace || entry.client.availability === "install_required")?.client ?? null;
  const marketplaceServerRows = candidateServers.map((server) => {
    const entry = availableServerClients.find((candidate) => candidate.server.id === server.id)
      ?? installRequiredServerClients.find((candidate) => candidate.server.id === server.id);
    return { server, entry };
  }).sort((left, right) => (
    marketplaceServerRank(left.entry) - marketplaceServerRank(right.entry)
    || left.server.name.localeCompare(right.server.name)
  ));
  const normalizedServerQuery = serverQuery.trim().toLocaleLowerCase();
  const filteredMarketplaceServerRows = marketplaceServerRows.filter(({ server }) => (
    !normalizedServerQuery
    || server.name.toLocaleLowerCase().includes(normalizedServerQuery)
    || server.slug.toLocaleLowerCase().includes(normalizedServerQuery)
  ));
  const isMarketplaceApp = marketplaceClient !== null;
  const selectedMarketplaceRow = marketplaceServerRows.find(({ server }) => server.id === selectedServerId);
  const selectedMarketplaceEntry = selectedMarketplaceRow?.entry ?? null;
  const selectedMarketplaceInstalled = selectedMarketplaceEntry != null
    && selectedMarketplaceEntry.client.availability !== "install_required";
  const selectedMarketplaceCanInstall = selectedMarketplaceEntry?.client.installation?.canInstall === true;
  const selectedMarketplaceNeedsAdmin = selectedMarketplaceEntry?.client.availability === "install_required"
    && !selectedMarketplaceCanInstall;
  const detailsClient = marketplaceClient ?? client;
  const availableServerOptions = useMemo(() => availableServerClients.map(({ server }) => ({
    value: server.id,
    label: `${server.name} (${server.slug})`,
  })), [availableServerClients]);

  const serviceName = detailsClient?.name || (clientId.trim() ? formatMessage({ id: "pages.humanLogin.thisApp" }) : formatMessage({ id: "pages.humanLogin.thisService" }));
  const selectedServerName = selectedMarketplaceRow?.server.name
    ?? selectedServerClient?.server.name
    ?? formatMessage({ id: "pages.humanLogin.thisServerFallback" });
  const hasAgentInboundRequest = hasAgentInboundOAuthScope(scopes);
  const scopeValidationClient = selectedMarketplaceEntry?.client ?? client;
  const disallowedScopes = scopeValidationClient?.scopeValidation?.disallowedScopes ?? [];
  const scopeValidationReason = scopeValidationClient?.scopeValidation?.reason ?? null;
  const hasDisallowedScopes = disallowedScopes.length > 0;
  const canContinue = !!client && !submitting && !installingServerId && !clientLoading && !clientError && !!configuredReturnUrl.trim() && !!selectedServerId && !hasAgentInboundRequest && !hasDisallowedScopes;
  const canInstallAndContinue = isMarketplaceApp
    && selectedMarketplaceCanInstall
    && !!selectedMarketplaceEntry?.client.id
    && !submitting
    && !installingServerId
    && !clientLoading
    && !!configuredReturnUrl.trim()
    && !hasAgentInboundRequest
    && !hasDisallowedScopes;
  const scopeSummary = scopes.join(" · ");
  const unavailableAfterLookup = !!clientId.trim() && !serversLoading && !clientLoading
    && availableServerClients.length === 0 && installRequiredServerClients.length === 0;

  const authorizeWithClient = useCallback(async (serverId: string, loginClient: LoginClientSummary) => {
    setSubmitting(true);
    setStatus("");
    try {
      const { data } = await api.post("/oauth/authorize/human", {
        clientId: loginClient.clientId,
        serverId,
        returnUrl: configuredReturnUrl,
        scopes,
        ...(oidcFlow ? {
          oidc: true,
          nonce: oidcNonce || undefined,
          codeChallenge: oidcCodeChallenge || undefined,
          codeChallengeMethod: oidcCodeChallengeMethod || undefined,
          server: requestedServerHint || undefined,
        } : {}),
      });
      window.location.assign(appendOAuthAuthorizationParams(data.returnUrl, data.code, setupState));
    } catch (err: any) {
      setStatus(err.response?.data?.error_description || err.response?.data?.error || formatMessage({ id: "pages.humanLogin.continueFailed" }));
    } finally {
      setSubmitting(false);
    }
  }, [
    configuredReturnUrl,
    formatMessage,
    oidcCodeChallenge,
    oidcCodeChallengeMethod,
    oidcFlow,
    oidcNonce,
    requestedServerHint,
    scopes,
    setupState,
  ]);

  const installMarketplaceApp = useCallback(async (entry: AvailableServerClient) => {
    if (!entry.client.id || !entry.client.installation?.canInstall) return;
    setInstallingServerId(entry.server.id);
    setStatus("");
    try {
      await api.post(`/integrations/marketplace/${entry.client.id}/install`, undefined, {
        headers: { "X-Server-Id": entry.server.id },
      });
      const installedEntry: AvailableServerClient = {
        server: entry.server,
        client: {
          ...entry.client,
          availability: "ready",
          installation: undefined,
        },
      };
      setInstallRequiredServerClients((current) => (
        current.filter((candidate) => candidate.server.id !== entry.server.id)
      ));
      setAvailableServerClients((current) => (
        current.some((candidate) => candidate.server.id === entry.server.id)
          ? current
          : [...current, installedEntry]
      ));
      setSelectedServerId(entry.server.id);
      await authorizeWithClient(entry.server.id, installedEntry.client);
    } catch (err: unknown) {
      const apiError = err as { response?: { data?: { error?: string } } };
      setStatus(apiError.response?.data?.error || formatMessage({ id: "pages.humanLogin.installFailed" }));
    } finally {
      setInstallingServerId("");
    }
  }, [authorizeWithClient, formatMessage]);

  const continueToApp = useCallback(async () => {
    if (!clientId.trim()) {
      setStatus(formatMessage({ id: "pages.humanLogin.missingClientId" }));
      return;
    }
    if (!configuredReturnUrl.trim()) {
      setStatus(formatMessage({ id: "pages.humanLogin.missingReturnUrl" }));
      return;
    }
    if (!selectedServerId) {
      setStatus(formatMessage({ id: "pages.humanLogin.chooseServer" }));
      return;
    }
    if (!client) {
      setStatus(clientError || formatMessage({ id: "pages.humanLogin.notRegisteredForServer" }));
      return;
    }

    await authorizeWithClient(selectedServerId, client);
  }, [authorizeWithClient, client, clientError, clientId, configuredReturnUrl, formatMessage, selectedServerId]);

  const handleCommit = useCallback(() => {
    if (selectedMarketplaceCanInstall && selectedMarketplaceEntry) {
      void installMarketplaceApp(selectedMarketplaceEntry);
      return;
    }
    void continueToApp();
  }, [continueToApp, installMarketplaceApp, selectedMarketplaceCanInstall, selectedMarketplaceEntry]);

  const handleLogout = useCallback(() => logout(), [logout]);

  const handleSelectServerRow = useCallback((serverId: string) => {
    if (installingServerId) return;
    setSelectedServerId(serverId);
  }, [installingServerId]);

  const handleServerChange = useCallback((value: string | null) => {
    if (value == null) return;
    setSelectedServerId(value);
  }, []);

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-layer-sidebar font-display text-foreground">
      <header className="border-b border-line-seam bg-layer-canvas">
        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
            <span className="shrink-0 text-footnote font-bold text-foreground-hint sm:text-subhead">{formatMessage({ id: "pages.humanLogin.loginWith" })}</span>
            <RaftBrandLockup className="h-5 w-auto shrink-0 sm:h-6" adaptToDarkMode />
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-4">
            <a className={GHOST_LINK_BUTTON_CLASS} href="/">{formatMessage({ id: "pages.humanLogin.back" })}</a>
            <Button
              onClick={handleLogout}
              size="sm"
              variant="outline"
            >
              {formatMessage({ id: "pages.humanLogin.logOut" })}
            </Button>
          </div>
        </div>
      </header>

      {unavailableAfterLookup ? (
        <main className="mx-auto max-w-2xl px-4 py-6 pb-10 sm:px-5 sm:py-8 sm:pb-12 md:py-10 md:pb-14">
          <Card render={<section />} className="p-4 sm:p-6">
            <h1 className="text-title sm:text-display">
              {formatMessage({ id: "pages.humanLogin.notAccessibleTitle" })}
            </h1>
            <p className="mt-4 text-callout text-foreground-muted">
              {formatMessage({ id: "pages.humanLogin.notAccessibleBody" })}
            </p>
            <div className="mt-5 rounded-container border border-line-hairline bg-info-soft p-4 text-callout text-foreground">
              <h2 className="font-bold">{formatMessage({ id: "pages.humanLogin.howToGetAccessTitle" })}</h2>
              <p className="mt-1">
                {formatMessage({ id: "pages.humanLogin.howToGetAccessBody" })}
              </p>
            </div>
            <p className="mt-5 text-caption text-foreground-hint">
              <SignedInAs user={user} prefix={formatMessage({ id: "pages.humanLogin.signedInAsPrefix" })} />
            </p>
          </Card>
        </main>
      ) : (
        <main className="mx-auto grid max-w-5xl gap-5 px-4 py-6 pb-10 sm:gap-6 sm:px-5 sm:py-8 sm:pb-12 md:grid-cols-[1fr_360px] md:py-10 md:pb-14">
        <Card render={<section />} className="p-4 sm:p-6">
          <h1 className="mb-3">
            <span className="block text-headline sm:text-title">{formatMessage({ id: "pages.humanLogin.connectTitle" }, { serviceName, serverName: selectedServerName })}</span>
            <span className="mt-1 block break-words text-display sm:text-hero">{serviceName}</span>
          </h1>
          <p className="text-callout text-foreground-muted">
            {formatMessage({ id: "pages.humanLogin.useAccountWith" }, { serviceName, b: (chunks) => <strong key="service">{chunks}</strong> })}
          </p>
          <p className="mt-2 text-caption text-foreground-hint">
            <SignedInAs user={user} prefix={formatMessage({ id: "pages.humanLogin.signedInAsPrefix" })} />
          </p>

          <div className="mt-5">
            <div className={FIELD_LABEL_CLASS}>{formatMessage({ id: "pages.humanLogin.appDetailsLabel" })}</div>
            {detailsClient && !clientLoading ? (
              <LoginAppDetailsCard client={detailsClient} />
            ) : detailsClient ? (
              <span className="text-foreground-muted">{formatMessage({ id: "pages.humanLogin.loadingServers" })}</span>
            ) : (
              <Card className={APP_DETAILS_CARD_CLASS}>
                <span className="text-foreground-muted">
                  {clientLoading
                    ? formatMessage({ id: "pages.humanLogin.loadingServers" })
                    : clientError || formatMessage({ id: "pages.humanLogin.selectServerFallback" })}
                </span>
              </Card>
            )}
            <p className={FIELD_HELP_CLASS}>
              {formatMessage({ id: "pages.humanLogin.appDetailsHelp" })}
            </p>
          </div>

          <div className="mt-5">
            <div className={FIELD_LABEL_CLASS} id="slock-login-server-label">
              {formatMessage({ id: "pages.humanLogin.raftServerLabel" })}
            </div>
            <div id="slock-login-server" className="mt-1.5">
              {clientLoading ? (
                <div className={FIELD_PLACEHOLDER_CLASS}>
                  {formatMessage({ id: "pages.humanLogin.loadingServers" })}
                </div>
              ) : isMarketplaceApp ? (
                <div role="group" aria-labelledby="slock-login-server-label">
                  <Card>
                    {marketplaceServerRows.length > 5 && (
                      <div className="border-b border-line-hairline p-2">
                        <Input
                          type="search"
                          value={serverQuery}
                          onChange={handleServerQueryChange}
                          disabled={!!installingServerId}
                          placeholder={formatMessage({ id: "pages.humanLogin.searchServers" })}
                          aria-label={formatMessage({ id: "pages.humanLogin.searchServers" })}
                          className="w-full"
                        />
                      </div>
                    )}
                    <div className="max-h-72 overflow-y-auto">
                  {/* raft-ui ListRows: the hairline between two rows is theirs. */}
                  {filteredMarketplaceServerRows.map(({ server, entry }) => (
                    <MarketplaceServerRow
                      key={server.id}
                      server={server}
                      entry={entry}
                      selected={selectedServerId === server.id}
                      installPending={installingServerId === server.id}
                      installInFlight={!!installingServerId}
                      onSelect={handleSelectServerRow}
                    />
                  ))}
                    {filteredMarketplaceServerRows.length === 0 && (
                      <div className="px-3 py-6 text-center text-callout text-foreground-hint">
                        {formatMessage({ id: "pages.humanLogin.noServerSearchResults" })}
                      </div>
                    )}
                    </div>
                  </Card>
                </div>
              ) : availableServerClients.length > 0 ? (
                <Select
                  value={selectedServerId}
                  onValueChange={handleServerChange}
                  items={availableServerOptions}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={formatMessage({ id: "pages.humanLogin.raftServerLabel" })} />
                    <SelectIcon />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectList>{renderSelectItems(availableServerOptions)}</SelectList>
                  </SelectContent>
                </Select>
              ) : (
                <div className={FIELD_PLACEHOLDER_CLASS}>
                  {formatMessage({ id: "pages.humanLogin.noAvailableServers" })}
                </div>
              )}
            </div>
            <p className={FIELD_HELP_CLASS}>
              {formatMessage({ id: isMarketplaceApp
                ? "pages.humanLogin.marketplaceServerHelp"
                : "pages.humanLogin.serverHelp" })}
            </p>
          </div>

          <RequestedScopeConsent scopes={scopes} />

          {hasDisallowedScopes ? (
            <div
              role="alert"
              data-testid="oauth-scope-configuration-error"
              className="mt-4 rounded-container border border-line-hairline bg-warning-soft p-4 text-foreground"
            >
              <div className="text-callout font-bold">
                {formatMessage({ id: scopeValidationReason === "unsupported"
                  ? "pages.humanLogin.unsupportedScopeTitle"
                  : scopeValidationReason === "mixed"
                    ? "pages.humanLogin.invalidScopeTitle"
                    : "pages.humanLogin.scopeConfigurationTitle" })}
              </div>
              <p className="mt-1 text-callout">
                {formatMessage(
                  { id: scopeValidationReason === "unsupported"
                    ? "pages.humanLogin.unsupportedScopeBody"
                    : scopeValidationReason === "mixed"
                      ? "pages.humanLogin.invalidScopeBody"
                      : "pages.humanLogin.scopeConfigurationBody" },
                  { appName: serviceName, scopes: disallowedScopes.join(", ") },
                )}
              </p>
            </div>
          ) : null}

          {isMarketplaceApp ? (
            <div
              className="mt-6 rounded-container border border-line-hairline bg-fill-muted p-4"
              data-testid="marketplace-login-commit-zone"
              aria-busy={!!installingServerId}
            >
              {selectedMarketplaceInstalled && selectedMarketplaceRow ? (
                <p className="text-callout text-foreground">
                  {formatMessage(
                    { id: "pages.humanLogin.selectedServerCommit" },
                    { serverName: selectedMarketplaceRow.server.name, b: (chunks) => <strong key="server">{chunks}</strong> },
                  )}
                </p>
              ) : selectedMarketplaceCanInstall && selectedMarketplaceEntry && selectedMarketplaceRow ? (
                <>
                  <p className="text-callout text-foreground">
                    {formatMessage(
                      { id: "pages.humanLogin.installCommitBody" },
                      {
                        serverName: selectedMarketplaceRow.server.name,
                        appName: selectedMarketplaceEntry.client.name,
                        b: (chunks) => <strong key="server">{chunks}</strong>,
                      },
                    )}
                  </p>
                  <p className="mt-2 font-mono text-mono-meta text-foreground-muted">
                    {formatMessage({ id: "pages.humanLogin.installCommitScopes" }, { scopes: scopeSummary })}
                  </p>
                </>
              ) : selectedMarketplaceNeedsAdmin && selectedMarketplaceEntry && selectedMarketplaceRow ? (
                <p className="text-callout text-foreground">
                  {formatMessage(
                    { id: "pages.humanLogin.adminCommitBody" },
                    {
                      serverName: selectedMarketplaceRow.server.name,
                      appName: selectedMarketplaceEntry.client.name,
                      b: (chunks) => <strong key="server">{chunks}</strong>,
                    },
                  )}
                </p>
              ) : (
                <p className="text-callout text-foreground">
                  {formatMessage({ id: "pages.humanLogin.serverStatusUnavailable" })}
                </p>
              )}

              {selectedMarketplaceCanInstall && detailsClient?.setupUrl ? <AppSetupRequirement url={detailsClient.setupUrl} description={detailsClient.setupDescription} /> : null}

              {!selectedMarketplaceNeedsAdmin ? (
                <Button
                  disabled={selectedMarketplaceCanInstall ? !canInstallAndContinue : !canContinue}
                  onClick={handleCommit}
                  size="xl"
                  variant="accent"
                  className="mt-4 w-full"
                >
                  {installingServerId ? (
                    <Spinner
                      size="sm"
                      aria-hidden="true"
                      className="mr-2"
                      data-testid="marketplace-install-pending-button-spinner"
                    />
                  ) : null}
                  {selectedMarketplaceCanInstall
                    ? installingServerId
                      ? formatMessage({ id: "pages.humanLogin.installingAndContinuing" })
                      : formatMessage({ id: "pages.humanLogin.installAndContinue" })
                    : submitting
                      ? formatMessage({ id: "pages.humanLogin.continuing" })
                      : formatMessage({ id: "pages.humanLogin.continueLogin" })}
                </Button>
              ) : null}

              {selectedMarketplaceNeedsAdmin && selectedMarketplaceRow ? (
                <a
                  href={`/s/${encodeURIComponent(selectedMarketplaceRow.server.slug)}/members`}
                  className={OUTLINE_LINK_BUTTON_CLASS}
                >
                  {formatMessage({ id: "pages.humanLogin.findServerAdmin" })}
                </a>
              ) : null}
            </div>
          ) : (
            <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
              <Button
                disabled={!canContinue}
                onClick={continueToApp}
                size="lg"
                variant="accent"
                className="w-full sm:w-auto"
              >
                {submitting ? formatMessage({ id: "pages.humanLogin.continuing" }) : formatMessage({ id: "pages.humanLogin.loginWithRaft" })}
              </Button>
            </div>
          )}

          {status && <pre className="mt-4 min-h-16 overflow-auto rounded-container border border-line-hairline bg-layer-code p-3 font-mono text-mono-code text-foreground">{status}</pre>}
        </Card>

        <Card render={<aside />} className="p-5">
          <h2 className="mb-4 text-headline">{formatMessage({ id: "pages.humanLogin.faqTitle" })}</h2>
          <div className="space-y-5 text-callout text-foreground-muted">
            <section>
              <h3 className="text-subhead font-bold text-foreground">{formatMessage({ id: "pages.humanLogin.faqWhatTitle" })}</h3>
              <p>
                {formatMessage({ id: "pages.humanLogin.faqWhatBody" })}
              </p>
            </section>
            <section>
              <h3 className="text-subhead font-bold text-foreground">{formatMessage({ id: "pages.humanLogin.faqRegisterTitle" })}</h3>
              <p>
                {formatMessage({ id: "pages.humanLogin.faqRegisterBody" })}
              </p>
            </section>
            <section>
              <h3 className="text-subhead font-bold text-foreground">{formatMessage({ id: "pages.humanLogin.faqAgentTitle" })}</h3>
              <p>
                {formatMessage({ id: "pages.humanLogin.faqAgentBody" })}
              </p>
            </section>
          </div>
        </Card>
      </main>
      )}
    </div>
  );
}
