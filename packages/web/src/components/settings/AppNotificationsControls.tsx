import { useCallback, useEffect, useEffectEvent, useMemo, useState } from "react";
import type { ChangeEvent, FocusEvent } from "react";
import { useIntl } from "react-intl";
import type { IntlShape } from "react-intl";
import {
  APP_NOTIFICATION_EVENT_GROUPS,
  APP_NOTIFICATION_GROUPS,
} from "@botiverse/raft-shared";
import type {
  AppNotificationEvent,
  AppNotificationGroup,
} from "@botiverse/raft-shared";
import { Bell, Check, Copy, KeyRound, RotateCw } from "lucide-react";
import { Badge, Card, Switch, Button, Table, TableHeader, TableBody, TableRow, TableHead, Input, Separator, ListRow, ListRowBody, ListRowDescription, ListRowTitle } from "@botiverse/raft-ui";
import api from "../../api/client";
import Banner from "../ui/Banner";
import SectionEyebrow from "../ui/SectionEyebrow";
import { AppNotificationGroupCheckbox } from "./AppNotificationGroupCheckbox";
import { AppNotificationEventCheckbox } from "./AppNotificationEventCheckbox";
import { AppPermissionAccessRow } from "./AppPermissionAccessRow";
import type { MessageId } from "../../i18n/messages";

// Holds catalog IDS, not display text: module scope cannot call formatMessage.
// Call sites format. Same shape as the sub-batch F distribution helpers.
const GROUP_META: Record<AppNotificationGroup, { labelId: MessageId; summaryId: MessageId }> = {
  server: { labelId: "settings.connectedApps.appNotifications.group.server.label", summaryId: "settings.connectedApps.appNotifications.group.server.summary" },
  agent: { labelId: "settings.connectedApps.appNotifications.group.agent.label", summaryId: "settings.connectedApps.appNotifications.group.agent.summary" },
  channel: { labelId: "settings.connectedApps.appNotifications.group.channel.label", summaryId: "settings.connectedApps.appNotifications.group.channel.summary" },
  computer: { labelId: "settings.connectedApps.appNotifications.group.computer.label", summaryId: "settings.connectedApps.appNotifications.group.computer.summary" },
  agent_reminder_write: { labelId: "settings.connectedApps.appNotifications.group.agent_reminder_write.label", summaryId: "settings.connectedApps.appNotifications.group.agent_reminder_write.summary" },
};

export { GROUP_META as APP_NOTIFICATION_GROUP_META };

export function permissionGroupLabel(group: AppNotificationGroup, formatMessage: IntlShape["formatMessage"]): string {
  const resource = formatMessage({ id: GROUP_META[group].labelId });
  return group === "agent_reminder_write" ? resource : formatMessage({ id: "settings.connectedApps.appPermissions.readLabel" }, { resource });
}

const EVENT_LABEL_ID: Record<AppNotificationEvent, MessageId> = {
  "server.member_added": "settings.connectedApps.appNotifications.event.server_member_added",
  "server.member_removed": "settings.connectedApps.appNotifications.event.server_member_removed",
  "server.member_role_changed": "settings.connectedApps.appNotifications.event.server_member_role_changed",
  "server.config_updated": "settings.connectedApps.appNotifications.event.server_config_updated",
  "server.public_channel_created": "settings.connectedApps.appNotifications.event.server_public_channel_created",
  "server.public_channel_archived": "settings.connectedApps.appNotifications.event.server_public_channel_archived",
  "server.plan_changed": "settings.connectedApps.appNotifications.event.server_plan_changed",
  "agent.status_changed": "settings.connectedApps.appNotifications.event.agent_status_changed",
  "agent.profile_updated": "settings.connectedApps.appNotifications.event.agent_profile_updated",
  "agent.runtime_changed": "settings.connectedApps.appNotifications.event.agent_runtime_changed",
  "agent.model_changed": "settings.connectedApps.appNotifications.event.agent_model_changed",
  "channel.member_added": "settings.connectedApps.appNotifications.event.channel_member_added",
  "channel.member_removed": "settings.connectedApps.appNotifications.event.channel_member_removed",
  "channel.config_updated": "settings.connectedApps.appNotifications.event.channel_config_updated",
  "channel.archived": "settings.connectedApps.appNotifications.event.channel_archived",
  "thread.created": "settings.connectedApps.appNotifications.event.thread_created",
  "thread.resolved": "settings.connectedApps.appNotifications.event.thread_resolved",
  "computer.online": "settings.connectedApps.appNotifications.event.computer_online",
  "computer.offline": "settings.connectedApps.appNotifications.event.computer_offline",
  "computer.version_changed": "settings.connectedApps.appNotifications.event.computer_version_changed",
  "computer.agent_started": "settings.connectedApps.appNotifications.event.computer_agent_started",
  "computer.agent_stopped": "settings.connectedApps.appNotifications.event.computer_agent_stopped",
};

export type AppNotificationSelection = {
  groups: AppNotificationGroup[];
  events: AppNotificationEvent[];
};

export type AppNotificationsDeveloperState = {
  source_installation?: {
    installation_id: AppNotificationsInstallationState["installation_id"];
    status: "active" | "suspended";
    enabled: boolean;
    approved_request_revision_id: string | null;
    approved_groups: AppNotificationGroup[];
  } | null;
  request_revision: number;
  current_revision_id: string | null;
  current_groups: AppNotificationGroup[];
  current_events: AppNotificationEvent[];
  pending_revision: {
    id: string;
    revision: number;
    groups: AppNotificationGroup[];
    events: AppNotificationEvent[];
    created_at: string;
  } | null;
  webhook: {
    endpoint_url: string;
    config_revision: number;
    enabled: boolean;
    previous_valid_until: string | null;
    updated_at: string;
  } | null;
};

export type AppNotificationsInstallationState = {
  installation_id: string;
  status: "active";
  approved_request_revision_id: string | null;
  requested_groups: AppNotificationGroup[];
  requested_events: AppNotificationEvent[];
  approved_groups: AppNotificationGroup[];
  subscribed_events: AppNotificationEvent[];
  effective_groups: AppNotificationGroup[];
  effective_events: AppNotificationEvent[];
  grant_revision: number;
  subscription_revision: number;
  app_review_pending: boolean;
  approval_required: boolean;
};

const ALL_EVENTS = Object.keys(APP_NOTIFICATION_EVENT_GROUPS) as AppNotificationEvent[];

type ApiError = {
  message?: string;
  response?: { data?: { error?: string } };
};

function apiErrorMessage(error: unknown, fallback: string): string {
  const apiError = error as ApiError;
  return apiError.response?.data?.error || apiError.message || fallback;
}

function sortedSelection(selection: AppNotificationSelection): AppNotificationSelection {
  return {
    groups: APP_NOTIFICATION_GROUPS.filter((group) => selection.groups.includes(group)),
    events: ALL_EVENTS.filter((event) => selection.events.includes(event)),
  };
}

export function toggleAppNotificationGroup(
  selection: AppNotificationSelection,
  group: AppNotificationGroup,
  checked: boolean,
): AppNotificationSelection {
  const groups = checked
    ? [...selection.groups, group]
    : selection.groups.filter((item) => item !== group);
  const events = checked
    ? selection.events
    : selection.events.filter((event) => !(APP_NOTIFICATION_EVENT_GROUPS[event] as readonly AppNotificationGroup[]).includes(group));
  return sortedSelection({ groups, events });
}

export function toggleAppNotificationEvent(
  selection: AppNotificationSelection,
  event: AppNotificationEvent,
  checked: boolean,
): AppNotificationSelection {
  const events = checked
    ? [...selection.events, event]
    : selection.events.filter((item) => item !== event);
  return sortedSelection({ groups: selection.groups, events });
}

// Takes formatMessage as a parameter: this is a plain helper, not a component, so
// it cannot call useIntl. Both call sites are inside components that already have
// it. (The alternative — returning a MessageId as the F/H2a helpers do — does not
// apply here because this returns JSX, not a string.)
function statusBadge(
  state: AppNotificationsDeveloperState | null,
  formatMessage: IntlShape["formatMessage"],
) {
  if (state?.pending_revision) return <Badge appearance="soft" variant="warning">{formatMessage({ id: "settings.connectedApps.appNotifications.pendingAppReview" })}</Badge>;
  if (state?.current_events?.length) return <Badge appearance="soft" variant="success">{formatMessage({ id: "settings.connectedApps.appNotifications.requestApproved" })}</Badge>;
  return <Badge appearance="soft" variant="muted">{formatMessage({ id: "settings.connectedApps.appNotifications.disabled" })}</Badge>;
}

// Raft DS settings vocabulary shared by every block below: an inset group
// (rf-list--inset) is a raft-ui Card holding hairline-divided rows
// (rf-row--plain); a status notice is the DS Banner (`live={false}`: these
// persistent notices are part of the page, not news). A neutral hint is a
// sunken note.
const INSET_GROUP = "divide-y divide-line-hairline";
const NOTE = "rounded-container bg-fill-muted px-3 py-2 text-footnote text-foreground";

function AppNotificationsEyebrow() {
  const { formatMessage } = useIntl();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <SectionEyebrow as="div">{formatMessage({ id: "settings.connectedApps.section.webhook" })}</SectionEyebrow>
      <Badge.Experimental />
    </div>
  );
}

export function AppNotificationPermissionPicker({
  value,
  onChange,
  disabled = false,
  allowedGroups,
  allowedEvents,
  section = "all",
}: {
  value: AppNotificationSelection;
  onChange: (next: AppNotificationSelection) => void;
  disabled?: boolean;
  allowedGroups?: readonly AppNotificationGroup[];
  allowedEvents?: readonly AppNotificationEvent[];
  section?: "all" | "groups" | "events";
}) {
  const { formatMessage } = useIntl();
  const selectedGroups = new Set(value.groups);
  const selectedEvents = new Set(value.events);
  const allowedGroupSet = allowedGroups ? new Set(allowedGroups) : null;
  const allowedEventSet = allowedEvents ? new Set(allowedEvents) : null;

  return (
    <div className="space-y-4" data-testid="app-notifications-permission-picker">
      {section !== "events" ? <Card className={INSET_GROUP}>
        {APP_NOTIFICATION_GROUPS.map((group) => {
          const allowed = !allowedGroupSet || allowedGroupSet.has(group);
          const inactive = disabled || !allowed;
          return (
            <label
              key={group}
              className={`flex min-h-11 items-start gap-3 px-4 py-3 ${inactive ? "cursor-not-allowed" : ""}`}
            >
              <AppNotificationGroupCheckbox
                group={group}
                value={value}
                checked={selectedGroups.has(group)}
                disabled={inactive}
                onChange={onChange}
              />
              <span className="min-w-0">
                <span className={`block text-subhead font-semibold ${inactive ? "text-foreground-disabled" : "text-foreground"}`}>{permissionGroupLabel(group, formatMessage)}</span>
                <span className={`mt-0.5 block text-footnote ${inactive ? "text-foreground-disabled" : "text-foreground-muted"}`}>{formatMessage({ id: GROUP_META[group].summaryId })}</span>
              </span>
            </label>
          );
        })}
      </Card> : null}
      {section !== "groups" ? APP_NOTIFICATION_GROUPS.filter((group) => selectedGroups.has(group)).map((group) => {
        const events = ALL_EVENTS.filter((event) => APP_NOTIFICATION_EVENT_GROUPS[event][0] === group);
        // Write grants (agent_reminder_write) carry no events.
        if (events.length === 0) return null;
        return (
          <details key={group} open>
            <summary className="text-footnote font-bold text-foreground-hint">{formatMessage({ id: "settings.connectedApps.appNotifications.groupEventsSummary" }, { group: formatMessage({ id: GROUP_META[group].labelId }) })}</summary>
            <Card className={`mt-2 ${INSET_GROUP}`}>
              {events.map((event) => {
                const requiredGroups = APP_NOTIFICATION_EVENT_GROUPS[event];
                const available = requiredGroups.every((required) => selectedGroups.has(required))
                  && (!allowedEventSet || allowedEventSet.has(event));
                const inactive = disabled || !available;
                return (
                  <label key={event} className={`flex min-h-11 items-start gap-3 px-4 py-3 text-subhead font-semibold ${inactive ? "cursor-not-allowed text-foreground-disabled" : "text-foreground"}`}>
                    <AppNotificationEventCheckbox
                      event={event}
                      value={value}
                      checked={selectedEvents.has(event)}
                      disabled={inactive}
                      onChange={onChange}
                    />
                    <span className="min-w-0 break-words">
                      {formatMessage({ id: EVENT_LABEL_ID[event] })}
                      {requiredGroups.length > 1 ? <span className={`mt-0.5 block text-footnote font-normal ${inactive ? "text-foreground-disabled" : "text-foreground-muted"}`}>{formatMessage({ id: "settings.connectedApps.appNotifications.requiresAgentAndComputer" })}</span> : null}
                    </span>
                  </label>
                );
              })}
            </Card>
          </details>
        );
      }) : null}
      {value.groups.length === 0 ? (
        <div className={NOTE}>
          {formatMessage({ id: "settings.connectedApps.appPermissions.noSelection" })}
        </div>
      ) : null}
    </div>
  );
}

function selectInputOnFocus(event: FocusEvent<HTMLInputElement>) {
  event.target.select();
}

export function DeveloperAppPermissions({ clientId, value, onChange, state, loading }: {
  clientId: string | null;
  value: AppNotificationSelection;
  onChange: (next: AppNotificationSelection) => void;
  state: AppNotificationsDeveloperState | null;
  loading: boolean;
}) {
  const { formatMessage } = useIntl();
  return (
    <section className="space-y-3" data-testid="developer-app-permissions">
      <Card>
        <Table aria-label={formatMessage({ id: "settings.connectedApps.section.appPermissions" })} data-testid="app-permissions-resources">
          <TableHeader>
            <TableRow>
              <TableHead>{formatMessage({ id: "settings.connectedApps.appPermissions.resource" })}</TableHead>
              <TableHead className="w-36">{formatMessage({ id: "settings.connectedApps.appPermissions.access" })}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {APP_NOTIFICATION_GROUPS.map((group) => (
              <AppPermissionAccessRow
                key={group}
                group={group}
                value={value}
                disabled={loading || (clientId !== null && state === null)}
                onChange={onChange}
              />
            ))}
          </TableBody>
        </Table>
      </Card>
      <p className="text-caption text-foreground-hint">{formatMessage({ id: "settings.connectedApps.appPermissions.credentialHint" })}</p>
      {state?.pending_revision ? (
        <Banner intent="warning" density="sm" live={false}>{formatMessage({ id: "settings.connectedApps.appNotifications.revisionPendingReview" }, { revision: state.pending_revision.revision })}</Banner>
      ) : null}
      {state?.source_installation ? (
        <Card className="space-y-3 p-4" data-testid="app-notifications-source-installation">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-subhead font-semibold text-foreground">{formatMessage({ id: "settings.connectedApps.appNotifications.sourceInstallation" })}</div>
            <Badge
              appearance="soft"
              variant={!state.source_installation.enabled
                ? "muted"
                : state.source_installation.status === "suspended"
                  ? "warning"
                  : "success"}
            >
              {formatMessage({ id: !state.source_installation.enabled
                ? "settings.connectedApps.appNotifications.sourceDisabled"
                : state.source_installation.status === "suspended"
                  ? "settings.connectedApps.appNotifications.sourceSuspended"
                  : "settings.connectedApps.appNotifications.sourceActive" })}
            </Badge>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-footnote font-semibold text-foreground-muted">{formatMessage({ id: "settings.connectedApps.appNotifications.installationId" })}</span>
            <Input readOnly value={state.source_installation.installation_id} onFocus={selectInputOnFocus}
              className="w-full font-mono text-mono-code" />
          </label>
          <div className="text-caption text-foreground-hint">{formatMessage({ id: "settings.connectedApps.appNotifications.sourceUse" })}</div>
        </Card>
      ) : null}
    </section>
  );
}

function AppPermissionsEyebrow() {
  const { formatMessage } = useIntl();
  return <SectionEyebrow as="div">{formatMessage({ id: "settings.connectedApps.section.appPermissions" })}</SectionEyebrow>;
}

export function DeveloperAppNotifications({
  clientId,
  value,
  onChange,
  state,
  loading,
  onStateChange,
  onConfigurationOpenChange,
  onError,
  embedded = false,
}: {
  clientId: string | null;
  value: AppNotificationSelection;
  onChange: (next: AppNotificationSelection) => void;
  state: AppNotificationsDeveloperState | null;
  loading: boolean;
  onStateChange: (next: AppNotificationsDeveloperState) => void;
  onConfigurationOpenChange?: (open: boolean) => void;
  onError: (message: string) => void;
  embedded?: boolean;
}) {
  const { formatMessage } = useIntl();
  const sourceEndpoint = state?.webhook?.endpoint_url ?? "";
  const [endpointDraft, setEndpointDraft] = useState<{
    clientId: string | null;
    sourceEndpoint: string;
    value: string;
  } | null>(null);
  const [busy, setBusy] = useState<"endpoint" | "rotate" | "disable" | null>(null);
  const [configurationDraft, setConfigurationDraft] = useState<{
    clientId: string;
    open: boolean;
  } | null>(null);
  const [secretState, setSecretState] = useState<{
    clientId: string;
    value: string;
    copied: boolean;
  } | null>(null);
  const endpoint = endpointDraft?.clientId === clientId && endpointDraft.sourceEndpoint === sourceEndpoint
    ? endpointDraft.value
    : sourceEndpoint;
  const signingSecret = clientId && secretState?.clientId === clientId ? secretState.value : null;
  const configurationOpen = clientId && configurationDraft?.clientId === clientId
    ? configurationDraft.open
    : !!state?.webhook?.enabled;

  const refresh = useCallback(async () => {
    if (!clientId) return;
    const { data } = await api.get(`/integrations/clients/${clientId}/app-notifications`);
    onStateChange(data);
  }, [clientId, onStateChange]);

  const saveEndpoint = useCallback(async () => {
    if (!clientId) return;
    setBusy("endpoint");
    onError("");
    try {
      const { data } = await api.put(`/integrations/clients/${clientId}/app-notifications/webhook`, { endpointUrl: endpoint });
      setSecretState(data.signing_secret ? { clientId, value: data.signing_secret, copied: false } : null);
      await refresh();
    } catch (error: unknown) {
      onError(apiErrorMessage(error, formatMessage({ id: "settings.connectedApps.appNotifications.failedSaveEndpoint" })));
    } finally {
      setBusy(null);
    }
  }, [clientId, endpoint, formatMessage, onError, refresh]);

  const rotateSecret = useCallback(async () => {
    if (!clientId) return;
    setBusy("rotate");
    onError("");
    try {
      const { data } = await api.post(`/integrations/clients/${clientId}/app-notifications/webhook/rotate-secret`);
      setSecretState({ clientId, value: data.signing_secret, copied: false });
      await refresh();
    } catch (error: unknown) {
      onError(apiErrorMessage(error, formatMessage({ id: "settings.connectedApps.appNotifications.failedRotateSecret" })));
    } finally {
      setBusy(null);
    }
  }, [clientId, formatMessage, onError, refresh]);

  const disableEndpoint = useCallback(async (): Promise<boolean> => {
    if (!clientId) return false;
    setBusy("disable");
    onError("");
    try {
      await api.delete(`/integrations/clients/${clientId}/app-notifications/webhook`);
      setSecretState(null);
      await refresh();
      return true;
    } catch (error: unknown) {
      onError(apiErrorMessage(error, formatMessage({ id: "settings.connectedApps.appNotifications.failedDisableEndpoint" })));
      return false;
    } finally {
      setBusy(null);
    }
  }, [clientId, formatMessage, onError, refresh]);

  const toggleConfiguration = useCallback(async (enabled: boolean) => {
    if (!clientId) return;
    if (enabled) {
      setConfigurationDraft({ clientId, open: true });
      onConfigurationOpenChange?.(true);
      return;
    }
    if (state?.webhook?.enabled && !(await disableEndpoint())) return;
    setConfigurationDraft({ clientId, open: false });
    onConfigurationOpenChange?.(false);
  }, [clientId, disableEndpoint, onConfigurationOpenChange, state?.webhook?.enabled]);

  const handleEndpointChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setEndpointDraft({
      clientId,
      sourceEndpoint,
      value: event.target.value,
    });
  }, [clientId, sourceEndpoint]);

  const copySecret = useCallback(async () => {
    if (!signingSecret) return;
    try {
      await navigator.clipboard.writeText(signingSecret);
      setSecretState((current) => current?.clientId === clientId
        ? { ...current, copied: true }
        : current);
    } catch (error: unknown) {
      onError(apiErrorMessage(error, formatMessage({ id: "settings.connectedApps.appNotifications.failedCopySecret" })));
    }
  }, [clientId, formatMessage, onError, signingSecret]);

  return (
    <section className="space-y-4" data-testid="developer-app-notifications">
      {!embedded ? <Separator className="mb-4" /> : null}
      {!embedded ? (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2">
            <Bell size={18} className="mt-0.5 shrink-0 text-foreground-muted" />
            <div className="min-w-0">
              <AppNotificationsEyebrow />
              <div className="mt-1 text-footnote text-foreground-muted">{formatMessage({ id: "settings.connectedApps.appNotifications.eventsMayReceive" })}</div>
            </div>
          </div>
          {loading ? <Badge appearance="soft">{formatMessage({ id: "common.loadingLabel" })}</Badge> : statusBadge(state, formatMessage)}
        </div>
      ) : null}
      <div className="space-y-2" data-testid="app-notifications-delivery">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-subhead font-semibold text-foreground">{formatMessage({ id: "settings.connectedApps.appNotifications.deliveryTitle" })}</div>
            <div className="mt-0.5 text-footnote text-foreground-muted">{formatMessage({ id: "settings.connectedApps.appNotifications.deliveryDescription" })}</div>
          </div>
          {embedded ? (loading ? <Badge appearance="soft">{formatMessage({ id: "common.loadingLabel" })}</Badge> : statusBadge(state, formatMessage)) : null}
        </div>
        <Card className={INSET_GROUP}>
          {/* DS ListRow › a setting row: raft-ui's `plain` display-only
              ListRow (the Switch is the target). */}
          <ListRow variant="plain" interactive={false}>
            <ListRowBody>
              <ListRowTitle id="app-notifications-enabled-label">
                {formatMessage({ id: "settings.connectedApps.appNotifications.enableTitle" })}
              </ListRowTitle>
              <ListRowDescription id="app-notifications-enabled-description" wrap>
                {formatMessage({ id: "settings.connectedApps.appNotifications.enableDescription" })}
              </ListRowDescription>
              {!clientId ? (
                <span className="text-caption text-foreground-hint">{formatMessage({ id: "settings.connectedApps.appNotifications.saveBeforeWebhook" })}</span>
              ) : null}
            </ListRowBody>
            <Switch
              checked={configurationOpen}
              onCheckedChange={toggleConfiguration}
              disabled={!clientId || loading || !state || !!busy}
              aria-labelledby="app-notifications-enabled-label"
              aria-describedby="app-notifications-enabled-description"
            />
          </ListRow>
          {configurationOpen && clientId ? (
            <div className="space-y-3 px-4 py-4" data-testid="app-notifications-configuration">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <label className="min-w-0 flex-1">
                  <span className="mb-1.5 block text-footnote font-semibold text-foreground-muted">{formatMessage({ id: "settings.connectedApps.appNotifications.httpsEndpoint" })}</span>
                  <Input
                    type="url"
                    value={endpoint}
                    onChange={handleEndpointChange}
                    className="w-full font-mono text-mono-code"
                    render={<input placeholder="https://example.com/raft/events" />}
                  />
                </label>
                <Button type="button" size="lg" onClick={saveEndpoint} disabled={!!busy || !endpoint.trim()}>
                  {busy === "endpoint" ? formatMessage({ id: "settings.connectedApps.appNotifications.saving" }) : formatMessage({ id: "settings.connectedApps.appNotifications.saveEndpoint" })}
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-footnote text-foreground-muted">
                <span>{state?.webhook?.enabled
              ? formatMessage({ id: "settings.connectedApps.appNotifications.enabledRevision" }, { revision: state.webhook.config_revision })
              : formatMessage({ id: "settings.connectedApps.appNotifications.enterEndpointToEnable" })}</span>
                {state?.webhook?.enabled ? (
                  <Button type="button" size="sm" onClick={rotateSecret} disabled={!!busy}>
                    <RotateCw size={16} /> {busy === "rotate" ? formatMessage({ id: "settings.connectedApps.appNotifications.rotating" }) : formatMessage({ id: "settings.connectedApps.appNotifications.rotateSecret" })}
                  </Button>
                ) : null}
              </div>
              {signingSecret ? (
                <Banner
                  intent="success"
                  density="sm"
                  live={false}
                  data-testid="app-notifications-secret-reveal"
                  icon={<KeyRound size={16} aria-hidden="true" />}
                  title={formatMessage({ id: "settings.connectedApps.appNotifications.signingSecretShownOnce" })}
                >
                  <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <code className="min-w-0 flex-1 break-all rounded-control border border-line-hairline bg-layer-code px-3 py-2 font-mono text-mono-code text-foreground">{signingSecret}</code>
                    <Button type="button" size="sm" onClick={copySecret}>
                      {secretState?.copied ? <Check size={16} /> : <Copy size={16} />} {secretState?.copied ? formatMessage({ id: "settings.connectedApps.appNotifications.copied" }) : formatMessage({ id: "settings.connectedApps.appNotifications.copy" })}
                    </Button>
                  </div>
                </Banner>
              ) : null}
            </div>
          ) : null}
        </Card>
      </div>
      {configurationOpen && clientId ? (
        <div className="space-y-3" data-testid="app-notifications-permissions">
          <div>
            <div className="text-subhead font-semibold text-foreground">{formatMessage({ id: "settings.connectedApps.appNotifications.permissionsTitle" })}</div>
            <div className="mt-0.5 text-footnote text-foreground-muted">{formatMessage({ id: "settings.connectedApps.appNotifications.permissionsDescription" })}</div>
          </div>
          <AppNotificationPermissionPicker value={value} onChange={onChange} section="events" disabled={loading || !state} />
          {state?.pending_revision ? (
            <Banner intent="warning" density="sm" live={false}>
              {formatMessage(
                { id: "settings.connectedApps.appNotifications.revisionPendingReview" },
                { revision: state.pending_revision.revision },
              )}
            </Banner>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ScopeChips({ values, empty }: { values: readonly string[]; empty: string }) {
  if (values.length === 0) return <span className="text-footnote text-foreground-hint">{empty}</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value) => <Badge key={value} appearance="soft">{value}</Badge>)}
    </div>
  );
}

// One fact row of an inset group (DS PropertyList inside rf-list--inset): the
// label on the left (stacked above on narrow widths), its scope chips on the right.
function ScopeRow({ label, values, empty }: { label: string; values: readonly string[]; empty: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
      <div className="text-footnote font-medium text-foreground-hint sm:w-44 sm:shrink-0 sm:py-0.5">{label}</div>
      <div className="min-w-0 flex-1">
        <ScopeChips values={values} empty={empty} />
      </div>
    </div>
  );
}

export function AppNotificationRequestSummary({
  groups,
  events,
  pendingGroups,
  pendingEvents,
  pendingRevisionId,
  reviewPending = false,
  canReview = false,
  reviewing = false,
  onApprove,
}: {
  groups: readonly AppNotificationGroup[];
  events: readonly AppNotificationEvent[];
  pendingGroups?: readonly AppNotificationGroup[];
  pendingEvents?: readonly AppNotificationEvent[];
  pendingRevisionId?: string | null;
  reviewPending?: boolean;
  canReview?: boolean;
  reviewing?: boolean;
  onApprove?: () => void;
}) {
  const { formatMessage } = useIntl();
  const shownGroups = reviewPending && pendingGroups ? pendingGroups : groups;
  const shownEvents = reviewPending && pendingEvents ? pendingEvents : events;
  const groupLabels = useMemo(
    () => shownGroups.map((group) => permissionGroupLabel(group, formatMessage)),
    [formatMessage, shownGroups],
  );
  const eventLabels = useMemo(
    () => shownEvents.map((event) => formatMessage({ id: EVENT_LABEL_ID[event] })),
    [formatMessage, shownEvents],
  );
  return (
    <section className="space-y-3" data-testid="app-notifications-request-summary">
      <Separator className="mb-4" />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <Bell size={18} className="mt-0.5 shrink-0 text-foreground-muted" />
          <div>
            <AppPermissionsEyebrow />
            <div className="mt-1 text-footnote text-foreground-muted">
              {formatMessage({
                id: reviewPending
                  ? "settings.connectedApps.appNotifications.requestPendingDescription"
                  : "settings.connectedApps.appNotifications.requestApprovedDescription",
              })}
            </div>
          </div>
        </div>
        {reviewPending ? <Badge appearance="soft" variant="warning">{formatMessage({ id: "settings.connectedApps.appNotifications.permissionUpdatePending" })}</Badge> : null}
      </div>
      <Card className={INSET_GROUP}>
        <ScopeRow
          label={formatMessage({ id: reviewPending ? "settings.connectedApps.appNotifications.requestedDataGroups" : "settings.connectedApps.appNotifications.dataGroups" })}
          values={groupLabels}
          empty={formatMessage({ id: "settings.connectedApps.appNotifications.noDataAccess" })}
        />
        <ScopeRow
          label={formatMessage({ id: reviewPending ? "settings.connectedApps.appNotifications.requestedNotificationEvents" : "settings.connectedApps.appNotifications.notificationEvents" })}
          values={eventLabels}
          empty={formatMessage({ id: "settings.connectedApps.appNotifications.noEvents" })}
        />
      </Card>
      {reviewPending && canReview && onApprove ? (
        <Banner
          intent="warning"
          density="sm"
          live={false}
          data-testid="app-notifications-review-action"
          // No displayed revision id means we cannot bind the approval to
          // what the reviewer saw — the server would 400 it anyway.
          actions={(
            <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={onApprove} disabled={reviewing || !pendingRevisionId}>
              {reviewing ? formatMessage({ id: "settings.connectedApps.appNotifications.approving" }) : formatMessage({ id: "settings.connectedApps.appNotifications.approvePermissionUpdate" })}
            </Button>
          )}
        >
          {formatMessage({ id: "settings.connectedApps.appNotifications.reviewActionHint" })}
        </Banner>
      ) : null}
    </section>
  );
}

export function InstalledAppNotifications({
  clientId,
  canManage,
  onError,
}: {
  clientId: string;
  canManage: boolean;
  onError: (message: string) => void;
}) {
  const { formatMessage } = useIntl();
  const [state, setState] = useState<AppNotificationsInstallationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/integrations/marketplace/${clientId}/install/app-notifications`);
      setState(data);
    } catch (error: unknown) {
      onError(apiErrorMessage(error, formatMessage({ id: "settings.connectedApps.appNotifications.failedLoadInstalled" })));
    } finally {
      setLoading(false);
    }
  }, [clientId, formatMessage, onError]);
  // Load once per app; parent re-renders (a new `onError`, a locale switch) must not refetch.
  const loadForClient = useEffectEvent(load);

  useEffect(() => {
    void loadForClient();
  }, [clientId]);

  const save = useCallback(async () => {
    setSaving(true);
    onError("");
    try {
      await api.put(`/integrations/marketplace/${clientId}/install/app-notifications/grant`);
      await load();
    } catch (error: unknown) {
      onError(apiErrorMessage(error, formatMessage({ id: "settings.connectedApps.appNotifications.failedUpdateInstalled" })));
    } finally {
      setSaving(false);
    }
  }, [clientId, formatMessage, load, onError]);

  const formatGroups = useCallback(
    (groups: readonly AppNotificationGroup[] | undefined) =>
      (groups ?? []).map((group) => permissionGroupLabel(group, formatMessage)),
    [formatMessage],
  );
  const formatEvents = useCallback(
    (events: readonly AppNotificationEvent[] | undefined) =>
      (events ?? []).map((event) => formatMessage({ id: EVENT_LABEL_ID[event] })),
    [formatMessage],
  );
  const approvedGroupLabels = useMemo(() => formatGroups(state?.approved_groups), [formatGroups, state?.approved_groups]);
  const subscribedEventLabels = useMemo(() => formatEvents(state?.subscribed_events), [formatEvents, state?.subscribed_events]);
  const effectiveEventLabels = useMemo(() => formatEvents(state?.effective_events), [formatEvents, state?.effective_events]);
  const newlyRequestedGroupLabels = useMemo(
    () => (state?.requested_groups ?? [])
      .filter((group) => !state?.approved_groups.includes(group))
      .map((group) => formatMessage(
        { id: "settings.connectedApps.appNotifications.newDataGroupPrefix" },
        { group: permissionGroupLabel(group, formatMessage) },
      )),
    [formatMessage, state?.approved_groups, state?.requested_groups],
  );

  if (loading) return <div className="text-footnote text-foreground-hint"><Separator className="mb-3" />{formatMessage({ id: "settings.connectedApps.appNotifications.loading" })}</div>;
  if (!state) return null;

  return (
    <section className="space-y-3" data-testid="installed-app-notifications">
      <Separator className="mb-4" />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <Bell size={18} className="mt-0.5 shrink-0 text-foreground-muted" />
          <div>
            <AppPermissionsEyebrow />
            <div className="mt-1 text-footnote text-foreground-muted">{formatMessage({ id: "settings.connectedApps.appNotifications.installedSummary" })}</div>
          </div>
        </div>
        {state.effective_groups.length > 0 ? <Badge appearance="soft" variant="success">{formatMessage({ id: "settings.connectedApps.appNotifications.enabled" })}</Badge> : <Badge appearance="soft" variant="muted">{formatMessage({ id: "settings.connectedApps.appNotifications.disabled" })}</Badge>}
      </div>
      {state.app_review_pending ? <Badge appearance="soft" variant="warning">{formatMessage({ id: "settings.connectedApps.appNotifications.appReviewPending" })}</Badge> : null}
      <Card className={INSET_GROUP}>
        <ScopeRow
          label={formatMessage({ id: "settings.connectedApps.appNotifications.approvedData" })}
          values={approvedGroupLabels}
          empty={formatMessage({ id: "settings.connectedApps.appNotifications.noDataAccessEmpty" })}
        />
        <ScopeRow
          label={formatMessage({ id: "settings.connectedApps.appNotifications.developerSubscriptions" })}
          values={subscribedEventLabels}
          empty={formatMessage({ id: "settings.connectedApps.appNotifications.noSubscriptions" })}
        />
        <ScopeRow
          label={formatMessage({ id: "settings.connectedApps.appNotifications.activeEvents" })}
          values={effectiveEventLabels}
          empty={formatMessage({ id: "settings.connectedApps.appNotifications.noActiveEvents" })}
        />
      </Card>
      {state.approval_required ? (
        <Banner
          intent="warning"
          density="sm"
          live={false}
          data-testid="app-notifications-approval-required"
          actions={canManage ? (
            <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={save} disabled={saving}>
              {saving ? formatMessage({ id: "settings.connectedApps.appNotifications.approving" }) : formatMessage({ id: "settings.connectedApps.appNotifications.approveUpdate" })}
            </Button>
          ) : undefined}
        >
          <div className="min-w-0 space-y-2">
            <div>{formatMessage({ id: "settings.connectedApps.appNotifications.newDataAccessNotice" })}</div>
            <ScopeChips
              values={newlyRequestedGroupLabels}
              empty={formatMessage({ id: "settings.connectedApps.appNotifications.noNewDataGroups" })}
            />
          </div>
        </Banner>
      ) : null}
    </section>
  );
}
