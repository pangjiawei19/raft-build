import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { AlertTriangle, CheckCircle2, Plus, RefreshCw } from "lucide-react";
import { useIntl } from "react-intl";
import { SLACK_BRIDGE_PREFLIGHT_CHECK_IDS } from "@botiverse/raft-shared";
import {
  Badge,
  Button,
  Card,
  Select,
  SelectContent,
  SelectIcon,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectList,
  SelectTrigger,
  SelectValue,
  Separator,
  Step,
  Steps,
} from "@botiverse/raft-ui";
import type { MessageId } from "../../i18n/messages";
import Banner from "../ui/Banner";
import FormField from "../ui/FormField";
import SectionEyebrow from "../ui/SectionEyebrow";
import {
  applyManagedSlackBridgeChannelPairs,
  finishSlackBridgeSetup,
  isSlackBridgePreflightPassed,
  projectSlackBridgeHealth,
  SlackBridgePartialUpdateError,
  validateSlackBridgeChannelPairs,
  verifyAndEnableSlackBridge,
} from "./slackBridgeProvisioning";
import type {
  SlackBridgeChannelPair,
  SlackBridgeHealthAction,
  SlackBridgeHealthReason,
  SlackBridgeHealthState,
  SlackBridgePreflightCheckId,
  SlackBridgeProvisioningProvider,
  SlackBridgeProvisioningView,
  SlackBridgeSetupSnapshot,
  SlackBridgeSetupStage,
} from "./slackBridgeProvisioning";
import { RemovePairButton } from "./RemovePairButton";

type SlackBridgeDisplayStage = "connect" | "channels" | "health";

const DISPLAY_STAGES: SlackBridgeDisplayStage[] = ["connect", "channels", "health"];

const STAGE_LABEL_ID: Record<SlackBridgeSetupStage, MessageId> = {
  connect: "settings.slackBridge.stage.connect",
  oauth: "settings.slackBridge.stage.oauth",
  channels: "settings.slackBridge.stage.channels",
  preflight: "settings.slackBridge.stage.preflight",
  enable: "settings.slackBridge.stage.enable",
  health: "settings.slackBridge.stage.health",
};

const HEALTH_LABEL_ID: Record<SlackBridgeHealthState, MessageId> = {
  connected: "settings.slackBridge.health.connected",
  degraded: "settings.slackBridge.health.degraded",
  unverified: "settings.slackBridge.health.unverified",
  disconnected: "settings.slackBridge.health.disconnected",
};

const HEALTH_REASON_ID: Record<SlackBridgeHealthReason, MessageId> = {
  healthy: "settings.slackBridge.reason.healthy",
  install_missing: "settings.slackBridge.reason.installMissing",
  oauth_pending: "settings.slackBridge.reason.oauthPending",
  reauth_required: "settings.slackBridge.reason.reauthRequired",
  install_disconnected: "settings.slackBridge.reason.installDisconnected",
  install_revoked: "settings.slackBridge.reason.installRevoked",
  install_quarantined: "settings.slackBridge.reason.installQuarantined",
  credential_missing: "settings.slackBridge.reason.credentialMissing",
  credential_persist_unknown: "settings.slackBridge.reason.credentialPersistUnknown",
  credential_revoked: "settings.slackBridge.reason.credentialRevoked",
  binding_required: "settings.slackBridge.reason.bindingRequired",
  binding_paused: "settings.slackBridge.reason.bindingPaused",
  binding_revoked: "settings.slackBridge.reason.bindingRevoked",
  binding_quarantined: "settings.slackBridge.reason.bindingQuarantined",
  audience_mismatch: "settings.slackBridge.reason.audienceMismatch",
  audience_unavailable: "settings.slackBridge.reason.audienceUnavailable",
  connection_failed: "settings.slackBridge.reason.connectionFailed",
  scope_mismatch: "settings.slackBridge.reason.scopeMismatch",
  verification_required: "settings.slackBridge.reason.verificationRequired",
};

const HEALTH_ACTION_ID: Record<SlackBridgeHealthAction, MessageId> = {
  none: "settings.slackBridge.action.none",
  connect: "settings.slackBridge.action.connect",
  finish_oauth: "settings.slackBridge.action.finishOauth",
  reauthorize: "settings.slackBridge.action.reauthorize",
  reconnect: "settings.slackBridge.action.reconnect",
  resolve_quarantine: "settings.slackBridge.action.resolveQuarantine",
  verify_credential: "settings.slackBridge.action.verifyCredential",
  configure_binding: "settings.slackBridge.action.configureBinding",
  resume_binding: "settings.slackBridge.action.resumeBinding",
  repair_binding: "settings.slackBridge.action.repairBinding",
  repair_audience: "settings.slackBridge.action.repairAudience",
  retry_verification: "settings.slackBridge.action.retryVerification",
};

const PREFLIGHT_LABEL_ID: Record<SlackBridgePreflightCheckId, MessageId> = {
  oauth: "settings.slackBridge.preflight.oauth",
  endpoint: "settings.slackBridge.preflight.endpoint",
  scope: "settings.slackBridge.preflight.scope",
  audience: "settings.slackBridge.preflight.audience",
};

const PREFLIGHT_STATE_ID: Record<"passed" | "failed" | "unverified", MessageId> = {
  passed: "settings.slackBridge.check.passed",
  failed: "settings.slackBridge.check.failed",
  unverified: "settings.slackBridge.check.unverified",
};

/** Raft Design System status chips: ok is lime, a problem is orange, neutral or unknown is stone. */
type StatusBadgeVariant = "success" | "warning" | "muted";

const HEALTH_BADGE_VARIANT: Record<SlackBridgeHealthState, StatusBadgeVariant> = {
  connected: "success",
  degraded: "warning",
  unverified: "muted",
  disconnected: "warning",
};

const PREFLIGHT_STATE_BADGE_VARIANT: Record<"passed" | "failed" | "unverified", StatusBadgeVariant> = {
  passed: "success",
  failed: "warning",
  unverified: "muted",
};

/**
 * Mention sync is an enhancement (Slack's @ menu), never a delivery problem:
 * typing a unique @name in Slack still reaches Raft members. So the banner only shows
 * when an admin can do something about it. A free Slack plan (`paid_only`)
 * and transient failures (no `slackError`; the next tick retries) show nothing.
 */
const MENTION_SYNC_SILENT_ERRORS = new Set(["paid_only", "paid_teams_only"]);

const MENTION_SYNC_HINT_ID: Record<string, MessageId> = {
  restricted_action: "settings.slackBridge.mentionSyncRestricted",
  permission_denied: "settings.slackBridge.mentionSyncRestricted",
  missing_scope: "settings.slackBridge.mentionSyncMissingScope",
  name_taken: "settings.slackBridge.mentionSyncNameTaken",
};

function mentionSyncHintId(slackError: string | null): MessageId | null {
  if (!slackError || MENTION_SYNC_SILENT_ERRORS.has(slackError)) return null;
  return MENTION_SYNC_HINT_ID[slackError] ?? "settings.slackBridge.mentionSyncGeneric";
}

const FAILING_SURFACE_ID: Record<Exclude<SlackBridgeSetupSnapshot["rawHealth"]["failingSurface"], null>, MessageId> = {
  install: "settings.slackBridge.surface.install",
  credential: "settings.slackBridge.surface.credential",
  binding: "settings.slackBridge.surface.binding",
  audience: "settings.slackBridge.surface.audience",
  connection: "settings.slackBridge.surface.connection",
  scope: "settings.slackBridge.surface.scope",
};

function displayStage(stage: SlackBridgeSetupStage): SlackBridgeDisplayStage {
  if (stage === "connect" || stage === "oauth") return "connect";
  if (stage === "health") return "health";
  return "channels";
}

function StepRail({ stage }: { stage: SlackBridgeSetupStage }) {
  const { formatMessage } = useIntl();
  const current = displayStage(stage);
  const activeIndex = DISPLAY_STAGES.indexOf(current);
  return (
    <Steps current={activeIndex + 1} aria-label={formatMessage({ id: "settings.slackBridge.progress" })}>
      {DISPLAY_STAGES.map((item) => (
        <Step key={item} title={formatMessage({ id: STAGE_LABEL_ID[item] })} />
      ))}
    </Steps>
  );
}

function PreflightResults({
  preflight,
  passed,
}: {
  preflight: NonNullable<SlackBridgeSetupSnapshot["preflight"]>;
  passed: boolean;
}) {
  const { formatMessage } = useIntl();
  const checks = new Map(preflight.checks.map((check) => [check.id, check.state]));
  return (
    <div className="mt-3 space-y-3">
      {passed ? (
        <Banner intent="success" density="sm" role="status" icon={<CheckCircle2 size={16} />}>
          {formatMessage({ id: "settings.slackBridge.preflightPassed" })}
        </Banner>
      ) : (
        <Banner intent="warning" density="sm" icon={<AlertTriangle size={16} />}>
          {formatMessage({ id: "settings.slackBridge.preflightNotPassed" })}
        </Banner>
      )}
      <ul className="grid gap-2 sm:grid-cols-2">
        {SLACK_BRIDGE_PREFLIGHT_CHECK_IDS.map((checkId) => {
          const state = checks.get(checkId) ?? "unverified";
          return (
            <li key={checkId} className="flex min-h-11 items-center justify-between gap-3 rounded-control border border-line-hairline px-3 py-2">
              <span className="min-w-0 text-callout font-semibold text-foreground">{formatMessage({ id: PREFLIGHT_LABEL_ID[checkId] })}</span>
              <Badge appearance="soft" variant={PREFLIGHT_STATE_BADGE_VARIANT[state]}>
                {formatMessage({ id: PREFLIGHT_STATE_ID[state] })}
              </Badge>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function HealthPanel({
  snapshot,
  channelNames,
  canManage,
  onManage,
  busy,
  onRefresh,
}: {
  snapshot: SlackBridgeSetupSnapshot;
  channelNames: { raft: Map<string, string>; slack: Map<string, string> };
  canManage: boolean;
  onManage: () => void;
  busy: boolean;
  onRefresh: () => void;
}) {
  const { formatDate, formatMessage } = useIntl();
  const [showInviteHelp, setShowInviteHelp] = useState(false);
  const toggleInviteHelp = useCallback(() => setShowInviteHelp((visible) => !visible), []);
  const health = projectSlackBridgeHealth(snapshot.rawHealth);
  const mentionSync = snapshot.rawHealth.agentMentionSync;
  const mentionSyncHint = mentionSync ? mentionSyncHintId(mentionSync.slackError) : null;
  const mappedChannelsWithAccessIssues = snapshot.channelPairs
    .map((pair) => snapshot.slackChannels.find((channel) => channel.id === pair.slackChannelId))
    .filter((channel): channel is NonNullable<typeof channel> => channel?.isMember !== true);
  const channelsMissingMembership = mappedChannelsWithAccessIssues
    .filter((channel) => channel.isMember === false);
  const hasUnknownMembership = mappedChannelsWithAccessIssues
    .some((channel) => channel.isMember === undefined);
  const showMembershipRecovery = health.reason === "audience_mismatch"
    && mappedChannelsWithAccessIssues.length > 0;
  return (
    <div className="border-t border-line-hairline pt-4" data-testid="slack-bridge-health">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <SectionEyebrow as="div">{formatMessage({ id: "settings.slackBridge.healthLabel" })}</SectionEyebrow>
          <Badge className="mt-2" appearance="soft" variant={HEALTH_BADGE_VARIANT[health.state]}>
            {formatMessage({ id: HEALTH_LABEL_ID[health.state] })}
          </Badge>
          <div className="mt-1 text-footnote text-foreground-muted">
            {formatMessage({ id: HEALTH_REASON_ID[health.reason] })}
          </div>
        </div>
        {snapshot.workspaceName && (
          <Badge appearance="soft" variant="default">{snapshot.workspaceName}</Badge>
        )}
      </div>
      {mentionSync?.state === "degraded" && mentionSyncHint && (
        <Banner
          className="mt-4"
          intent="info"
          density="sm"
          withIcon
          title={formatMessage({ id: "settings.slackBridge.mentionSyncTitle" })}
          data-testid="slack-mention-sync-hint"
        >
          <p>{formatMessage(
            { id: mentionSyncHint },
            {
              count: Math.max(1, mentionSync.expected - mentionSync.actual),
              code: mentionSync.slackError ?? "",
            },
          )}</p>
        </Banner>
      )}
      {showMembershipRecovery && (
        <Banner
          className="mt-4"
          intent="warning"
          density="sm"
          withIcon
          title={formatMessage({
            id: hasUnknownMembership
              ? "settings.slackBridge.membershipRecoveryUnknownTitle"
              : "settings.slackBridge.membershipRecoveryTitle",
          })}
        >
          <p>{hasUnknownMembership
            ? formatMessage({ id: "settings.slackBridge.membershipRecoveryUnknownDescription" })
            : formatMessage(
              { id: "settings.slackBridge.membershipRecoveryDescription" },
              {
                channels: channelsMissingMembership
                  .map((channel) => `#${channel.name}`)
                  .join(", "),
              },
            )}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={toggleInviteHelp}>
              {formatMessage({ id: "settings.slackBridge.showInviteSteps" })}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={onRefresh}>
              <RefreshCw size={16} />
              {formatMessage({ id: "settings.slackBridge.refreshAndRecheck" })}
            </Button>
          </div>
          {showInviteHelp && (
            <ol className="mt-3 list-decimal space-y-1 pl-5">
              <li>{formatMessage({ id: "settings.slackBridge.inviteStepOpen" })}</li>
              <li>{formatMessage({ id: "settings.slackBridge.inviteStepInvite" })}</li>
              <li>{formatMessage({ id: "settings.slackBridge.inviteStepReturn" })}</li>
            </ol>
          )}
        </Banner>
      )}
      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-footnote font-medium text-foreground-hint">{formatMessage({ id: "settings.slackBridge.lastVerifiedLabel" })}</dt>
          <dd className="mt-0.5 text-callout text-foreground">
            {health.lastVerifiedAt
              ? formatMessage(
                { id: "settings.slackBridge.lastVerified" },
                {
                  when: formatDate(health.lastVerifiedAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "UTC",
                  }),
                },
              )
              : formatMessage({ id: "settings.slackBridge.notVerified" })}
          </dd>
        </div>
        <div>
          <dt className="text-footnote font-medium text-foreground-hint">{formatMessage({ id: "settings.slackBridge.failingSurfaceLabel" })}</dt>
          <dd className="mt-0.5 text-callout text-foreground">
            {health.failingSurface
              ? formatMessage({ id: FAILING_SURFACE_ID[health.failingSurface] })
              : formatMessage({ id: "settings.slackBridge.failingSurfaceNone" })}
          </dd>
        </div>
        <div>
          <dt className="text-footnote font-medium text-foreground-hint">{formatMessage({ id: "settings.slackBridge.nextActionLabel" })}</dt>
          <dd className="mt-0.5 text-callout text-foreground">{formatMessage({ id: HEALTH_ACTION_ID[health.action] })}</dd>
        </div>
      </dl>
      <div className="mt-4">
        <Separator className="mb-3" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionEyebrow as="div">
            {formatMessage({ id: "settings.slackBridge.selectedPairs" })}
          </SectionEyebrow>
          {canManage && (
            <Button size="sm" variant="outline" onClick={onManage}>
              {formatMessage({ id: "settings.slackBridge.managePairs" })}
            </Button>
          )}
        </div>
        <ul className="mt-2 space-y-1.5">
          {snapshot.channelPairs.map((pair) => (
            <li key={`${pair.raftChannelId}:${pair.slackChannelId}`} className="rounded-control bg-fill-muted px-3 py-2 text-callout font-semibold text-foreground">
              {formatMessage(
                { id: "settings.slackBridge.channelPair" },
                {
                  raftName: channelNames.raft.get(pair.raftChannelId),
                  slackName: channelNames.slack.get(pair.slackChannelId),
                },
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

interface SlackBridgeSetupWizardProps {
  canManage: boolean;
  provider: SlackBridgeProvisioningProvider;
  onOAuthRedirect?: (url: string) => void;
}

interface WizardState {
  view: SlackBridgeProvisioningView | null;
  busy: boolean;
  error: boolean;
  partialSuccess: boolean;
  pairs: SlackBridgeChannelPair[];
  raftChannelId: string;
  slackChannelId: string;
  disconnectConfirmed: boolean;
  editingMappings: boolean;
  mappingBaseline: SlackBridgeSetupSnapshot | null;
}

type WizardAction =
  | { type: "start" }
  | { type: "view"; view: SlackBridgeProvisioningView }
  | { type: "error"; partialSuccess?: boolean }
  | { type: "pairs"; pairs: SlackBridgeChannelPair[] }
  | { type: "raft_channel"; channelId: string }
  | { type: "slack_channel"; channelId: string }
  | { type: "confirm_disconnect" }
  | { type: "cancel_disconnect" }
  | { type: "edit_mappings" }
  | { type: "refresh_view"; view: SlackBridgeProvisioningView };

const INITIAL_WIZARD_STATE: WizardState = {
  view: null,
  busy: false,
  error: false,
  partialSuccess: false,
  pairs: [],
  raftChannelId: "",
  slackChannelId: "",
  disconnectConfirmed: false,
  editingMappings: false,
  mappingBaseline: null,
};

function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "start":
      return { ...state, busy: true, error: false, partialSuccess: false };
    case "view": {
      const snapshot = action.view.kind === "ready" ? action.view.snapshot : null;
      if (snapshot?.stage === "channels") {
        return {
          ...state,
          view: action.view,
          busy: false,
          error: false,
          partialSuccess: false,
          pairs: snapshot.channelPairs,
          raftChannelId: snapshot.raftChannels[0]?.id ?? "",
          slackChannelId: snapshot.slackChannels.find((channel) => channel.isMember === true)?.id ?? "",
          disconnectConfirmed: false,
          editingMappings: false,
          mappingBaseline: null,
        };
      }
      return {
        ...state,
        view: action.view,
        busy: false,
        error: false,
        partialSuccess: false,
        disconnectConfirmed: false,
        pairs: snapshot?.channelPairs ?? state.pairs,
        editingMappings: false,
        mappingBaseline: null,
      };
    }
    case "error":
      return { ...state, busy: false, error: true, partialSuccess: action.partialSuccess ?? false };
    case "pairs":
      return { ...state, pairs: action.pairs };
    case "raft_channel":
      return { ...state, raftChannelId: action.channelId };
    case "slack_channel":
      return { ...state, slackChannelId: action.channelId };
    case "confirm_disconnect":
      return { ...state, disconnectConfirmed: true };
    case "cancel_disconnect":
      return { ...state, disconnectConfirmed: false };
    case "edit_mappings":
      return {
        ...state,
        editingMappings: true,
        pairs: state.view?.kind === "ready" ? state.view.snapshot.channelPairs : state.pairs,
        slackChannelId: state.view?.kind === "ready"
          ? state.view.snapshot.slackChannels.find((channel) => channel.isMember === true)?.id ?? ""
          : state.slackChannelId,
        mappingBaseline: state.view?.kind === "ready" ? state.view.snapshot : null,
      };
    case "refresh_view": {
      const snapshot = action.view.snapshot;
      if (state.editingMappings && snapshot.stage === "health") {
        const raftChannelId = snapshot.raftChannels.some((channel) => channel.id === state.raftChannelId)
          ? state.raftChannelId
          : snapshot.raftChannels[0]?.id ?? "";
        const slackChannelId = snapshot.slackChannels.some((channel) =>
          channel.id === state.slackChannelId && channel.isMember === true)
          ? state.slackChannelId
          : snapshot.slackChannels.find((channel) => channel.isMember === true)?.id ?? "";
        return {
          ...state,
          view: action.view,
          busy: false,
          error: false,
          partialSuccess: false,
          raftChannelId,
          slackChannelId,
          mappingBaseline: snapshot,
        };
      }
      return wizardReducer(state, { type: "view", view: action.view });
    }
  }
}

function redirectToOAuth(url: string) {
  window.location.assign(url);
}

export default function SlackBridgeSetupWizard({
  canManage,
  provider,
  onOAuthRedirect = redirectToOAuth,
}: SlackBridgeSetupWizardProps) {
  const { formatMessage } = useIntl();
  const [state, dispatch] = useReducer(wizardReducer, INITIAL_WIZARD_STATE);
  const {
    view,
    busy,
    error,
    partialSuccess,
    pairs,
    raftChannelId,
    slackChannelId,
    disconnectConfirmed,
    editingMappings,
    mappingBaseline,
  } = state;

  useEffect(() => {
    let active = true;
    dispatch({ type: "start" });
    void provider.load()
      .then((next) => {
        if (active) dispatch({ type: "view", view: next });
      })
      .catch(() => {
        if (active) dispatch({ type: "error" });
      });
    return () => {
      active = false;
    };
  }, [provider]);

  const snapshot = view?.kind === "ready" ? view.snapshot : null;

  const channelNames = useMemo(() => {
    const raft = new Map(snapshot?.raftChannels.map((channel) => [channel.id, channel.name]) ?? []);
    const slack = new Map(snapshot?.slackChannels.map((channel) => [channel.id, channel.name]) ?? []);
    return { raft, slack };
  }, [snapshot]);

  const mutate = useCallback(async (operation: () => Promise<SlackBridgeProvisioningView>) => {
    dispatch({ type: "start" });
    try {
      dispatch({ type: "view", view: await operation() });
    } catch (cause) {
      dispatch({ type: "error", partialSuccess: cause instanceof SlackBridgePartialUpdateError });
    }
  }, []);

  const refresh = useCallback(async () => {
    dispatch({ type: "start" });
    try {
      dispatch({ type: "refresh_view", view: await provider.load() });
    } catch {
      dispatch({ type: "error" });
    }
  }, [provider]);

  const connectAndAuthorize = useCallback(async () => {
    dispatch({ type: "start" });
    try {
      const connected = await provider.connect();
      if (connected.snapshot.stage !== "oauth") {
        dispatch({ type: "view", view: connected });
        return;
      }
      const result = await provider.beginOAuth();
      if (result.kind === "redirect") onOAuthRedirect(result.url);
      else dispatch({ type: "view", view: result.view });
    } catch {
      dispatch({ type: "error" });
    }
  }, [onOAuthRedirect, provider]);

  const authorize = useCallback(() => {
    dispatch({ type: "start" });
    void provider.beginOAuth()
      .then((result) => {
        if (result.kind === "redirect") onOAuthRedirect(result.url);
        else dispatch({ type: "view", view: result.view });
      })
      .catch(() => dispatch({ type: "error" }));
  }, [onOAuthRedirect, provider]);

  const addPair = useCallback(() => {
    if (snapshot?.slackChannels.find((channel) => channel.id === slackChannelId)?.isMember !== true) return;
    const candidate = [...pairs, { raftChannelId, slackChannelId }];
    if (!validateSlackBridgeChannelPairs(candidate).valid) return;
    dispatch({ type: "pairs", pairs: candidate });
  }, [pairs, raftChannelId, slackChannelId, snapshot]);

  const removePair = useCallback(
    (pair: SlackBridgeChannelPair) => dispatch({ type: "pairs", pairs: pairs.filter((item) => item !== pair) }),
    [pairs],
  );

  const selectRaftChannel = useCallback((value: string | null) => {
    if (value != null) dispatch({ type: "raft_channel", channelId: value });
  }, []);

  const selectSlackChannel = useCallback((value: string | null) => {
    if (value != null) dispatch({ type: "slack_channel", channelId: value });
  }, []);

  const savePairs = useCallback(() => {
    void mutate(() => editingMappings && mappingBaseline
      ? applyManagedSlackBridgeChannelPairs({ provider, baseline: mappingBaseline, desiredPairs: pairs })
      : finishSlackBridgeSetup({ provider, pairs }));
  }, [editingMappings, mappingBaseline, mutate, pairs, provider]);

  const startEditingMappings = useCallback(() => dispatch({ type: "edit_mappings" }), []);
  const confirmDisconnect = useCallback(() => dispatch({ type: "confirm_disconnect" }), []);
  const cancelDisconnect = useCallback(() => dispatch({ type: "cancel_disconnect" }), []);

  const pairValidation = validateSlackBridgeChannelPairs(pairs);
  const pairsUseMemberChannels = pairs.every((pair) =>
    snapshot?.slackChannels.find((channel) => channel.id === pair.slackChannelId)?.isMember === true);
  const pairChangesValid = editingMappings && pairs.length === 0
    ? true
    : pairValidation.valid && pairsUseMemberChannels;
  const raftChannelOptions = useMemo(
    () => (snapshot?.raftChannels ?? []).map((channel) => ({
      value: channel.id,
      label: formatMessage({ id: "settings.slackBridge.channelName" }, { name: channel.name }),
    })),
    [formatMessage, snapshot],
  );
  const slackChannelOptions = useMemo(
    () => (snapshot?.slackChannels ?? []).map((channel) => ({
      value: channel.id,
      label: formatMessage(
        { id: channel.isMember === true
          ? "settings.slackBridge.channelName"
          : "settings.slackBridge.channelMembershipRequiredOption" },
        { name: channel.name },
      ),
      disabled: channel.isMember !== true,
    })),
    [formatMessage, snapshot],
  );
  const availableSlackChannelCount = snapshot?.slackChannels
    .filter((channel) => channel.isMember === true).length ?? 0;
  const inviteRequiredSlackChannelCount = snapshot?.slackChannels
    .filter((channel) => channel.isMember !== true).length ?? 0;
  const selectedSlackChannelIsMember = snapshot?.slackChannels
    .find((channel) => channel.id === slackChannelId)?.isMember === true;
  const preflightPassed = isSlackBridgePreflightPassed(snapshot?.preflight ?? null);
  const disconnectConnectionEpoch = Number(snapshot?.rawHealth?.install?.epochs.connection ?? NaN);
  const canDisconnect = canManage
    && !!provider.disconnect
    && snapshot?.stage !== "connect"
    && snapshot?.rawHealth?.install?.state !== "revoked"
    && Number.isSafeInteger(disconnectConnectionEpoch)
    && disconnectConnectionEpoch > 0;

  const retryFinishSetup = useCallback(() => {
    void mutate(() => verifyAndEnableSlackBridge(provider));
  }, [mutate, provider]);

  const enableBridge = useCallback(() => {
    void mutate(() => preflightPassed
      ? provider.enable()
      : verifyAndEnableSlackBridge(provider));
  }, [mutate, preflightPassed, provider]);

  const disconnect = useCallback(() => {
    void mutate(() => provider.disconnect!(disconnectConnectionEpoch));
  }, [disconnectConnectionEpoch, mutate, provider]);

  // Re-authorizing keeps the channel pairs (the server resumes them on the
  // OAuth callback); disconnecting revokes them. Offered wherever disconnect is.
  const canReauthorize = canDisconnect && snapshot?.stage !== "oauth" && !!provider.beginReauthorization;
  const reauthorize = useCallback(() => {
    dispatch({ type: "start" });
    void provider.beginReauthorization!()
      .then((result) => {
        if (result.kind === "redirect") onOAuthRedirect(result.url);
        else dispatch({ type: "view", view: result.view });
      })
      .catch(() => dispatch({ type: "error" }));
  }, [onOAuthRedirect, provider]);

  if (busy && !view) {
    return <Card className="p-4 text-callout text-foreground-muted">{formatMessage({ id: "settings.slackBridge.loading" })}</Card>;
  }

  if (!view && error) {
    return (
      <Banner intent="warning" density="lg" withIcon title={formatMessage({ id: "settings.slackBridge.title" })}>
        {formatMessage({ id: "settings.slackBridge.operationFailed" })}
      </Banner>
    );
  }

  if (!snapshot) return null;

  return (
    <Card render={<section />} className="space-y-4 p-4" data-testid="slack-bridge-setup-wizard">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <SectionEyebrow as="div">{formatMessage({ id: "settings.slackBridge.eyebrow" })}</SectionEyebrow>
          <h3 className="mt-1 text-headline text-foreground">{formatMessage({ id: "settings.slackBridge.title" })}</h3>
          <p className="mt-1 max-w-2xl text-footnote text-foreground-muted">
            {formatMessage({ id: "settings.slackBridge.description" })}
          </p>
        </div>
        {!canManage && (
          <Badge appearance="soft" variant="muted">
            {formatMessage({ id: "settings.slackBridge.readOnly" })}
          </Badge>
        )}
      </div>
      <StepRail stage={snapshot.stage} />
      {error && (
        <Banner intent="warning" density="sm" withIcon>
          {formatMessage({
            id: partialSuccess
              ? "settings.slackBridge.mappingPartialFailure"
              : "settings.slackBridge.operationFailed",
          })}
        </Banner>
      )}

      {snapshot.stage === "connect" && (
        <div className="border-t border-line-hairline pt-4">
          <div className="text-subhead font-semibold text-foreground">{formatMessage({ id: "settings.slackBridge.connectTitle" })}</div>
          <p className="mt-1 text-footnote text-foreground-muted">{formatMessage({ id: "settings.slackBridge.connectDescription" })}</p>
          {canManage && (
            <Button className="mt-3" variant="accent" size="sm" disabled={busy} onClick={connectAndAuthorize}>
              {formatMessage({ id: "settings.slackBridge.connect" })}
            </Button>
          )}
        </div>
      )}

      {snapshot.stage === "oauth" && (
        <div className="border-t border-line-hairline pt-4">
          <div className="text-subhead font-semibold text-foreground">{formatMessage({ id: "settings.slackBridge.oauthTitle" })}</div>
          <p className="mt-1 text-footnote text-foreground-muted">{formatMessage({ id: "settings.slackBridge.oauthDescription" })}</p>
          {canManage && (
            <Button
              className="mt-3"
              variant="accent"
              size="sm"
              disabled={busy}
              onClick={authorize}
            >
              {formatMessage({ id: "settings.slackBridge.authorize" })}
            </Button>
          )}
        </div>
      )}

      {(snapshot.stage === "channels" || (snapshot.stage === "health" && editingMappings)) && (
        <div className="space-y-3 border-t border-line-hairline pt-4">
          <div>
            <div className="text-subhead font-semibold text-foreground">{formatMessage({ id: "settings.slackBridge.channelsTitle" })}</div>
            <p className="mt-1 text-footnote text-foreground-muted">{formatMessage({ id: "settings.slackBridge.channelsDescription" })}</p>
          </div>
          <p className="text-footnote font-semibold text-foreground-muted" aria-live="polite">
            {formatMessage(
              { id: "settings.slackBridge.channelAvailabilitySummary" },
              {
                availableCount: availableSlackChannelCount,
                inviteRequiredCount: inviteRequiredSlackChannelCount,
              },
            )}
          </p>
          {canManage && (
            <div
              className="grid gap-x-2 gap-y-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
              data-testid="slack-bridge-channel-pair-grid"
            >
              <FormField label={formatMessage({ id: "settings.slackBridge.raftChannel" })} size="compact">
                <Select
                  value={raftChannelId}
                  onValueChange={selectRaftChannel}
                  items={raftChannelOptions}
                >
                  <SelectTrigger className="w-full" aria-label={formatMessage({ id: "settings.slackBridge.raftChannel" })}>
                    <SelectValue />
                    <SelectIcon />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectList>
                      {raftChannelOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          <SelectItemText>{option.label}</SelectItemText>
                          <SelectItemIndicator />
                        </SelectItem>
                      ))}
                    </SelectList>
                  </SelectContent>
                </Select>
              </FormField>
              <FormField
                label={formatMessage({ id: "settings.slackBridge.slackChannel" })}
                size="compact"
              >
                <Select
                  value={slackChannelId}
                  onValueChange={selectSlackChannel}
                  items={slackChannelOptions}
                >
                  <SelectTrigger className="w-full" aria-label={formatMessage({ id: "settings.slackBridge.slackChannel" })}>
                    <SelectValue />
                    <SelectIcon />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectList>
                      {slackChannelOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                          <SelectItemText>{option.label}</SelectItemText>
                          <SelectItemIndicator />
                        </SelectItem>
                      ))}
                    </SelectList>
                  </SelectContent>
                </Select>
              </FormField>
              <p
                className="text-caption text-foreground-hint sm:col-start-2 sm:row-start-2"
                data-testid="slack-bridge-channel-membership-hint"
              >
                {formatMessage({ id: "settings.slackBridge.slackChannelMembershipHint" })}
              </p>
              <div
                className="flex items-center gap-2 self-end sm:col-start-3 sm:row-start-1"
                data-testid="slack-bridge-channel-pair-actions"
              >
                <Button size="sm" variant="outline" disabled={!raftChannelId || !slackChannelId || !selectedSlackChannelIsMember} onClick={addPair}>
                  <Plus size={16} />
                  {formatMessage({ id: "settings.slackBridge.addPair" })}
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={refresh}>
                  <RefreshCw size={16} />
                  {formatMessage({ id: "settings.slackBridge.refreshChannels" })}
                </Button>
              </div>
            </div>
          )}
          <ul className="space-y-2" aria-label={formatMessage({ id: "settings.slackBridge.selectedPairs" })}>
            {pairs.map((pair) => (
              <li key={`${pair.raftChannelId}:${pair.slackChannelId}`} className="flex min-h-11 items-center justify-between gap-3 rounded-control bg-fill-muted px-3 py-2 text-callout font-semibold text-foreground">
                <span>
                  {formatMessage(
                    { id: "settings.slackBridge.channelPair" },
                    {
                      raftName: channelNames.raft.get(pair.raftChannelId),
                      slackName: channelNames.slack.get(pair.slackChannelId),
                    },
                  )}
                </span>
                {canManage && (
                  <RemovePairButton pair={pair} onRemove={removePair} />
                )}
              </li>
            ))}
          </ul>
          {!pairChangesValid && pairs.length > 0 && (
            <Banner intent="warning" density="sm">{formatMessage({ id: "settings.slackBridge.pairInvalid" })}</Banner>
          )}
          {canManage && (
            <div className="flex justify-end">
              <Button
                variant="accent"
                size="sm"
                disabled={!pairChangesValid || busy || (editingMappings && !mappingBaseline)}
                onClick={savePairs}
              >
                {formatMessage({
                  id: editingMappings
                    ? "settings.slackBridge.applyPairChanges"
                    : "settings.slackBridge.finishSetup",
                })}
              </Button>
            </div>
          )}
        </div>
      )}

      {snapshot.stage === "preflight" && (
        <div className="border-t border-line-hairline pt-4">
          <div className="text-subhead font-semibold text-foreground">{formatMessage({ id: "settings.slackBridge.preflightTitle" })}</div>
          <p className="mt-1 text-footnote text-foreground-muted">{formatMessage({ id: "settings.slackBridge.preflightDescription" })}</p>
          {snapshot.preflight && (
            <PreflightResults preflight={snapshot.preflight} passed={preflightPassed} />
          )}
          {canManage && (
            <Button className="mt-3" variant="accent" size="sm" disabled={busy} onClick={retryFinishSetup}>
              {formatMessage({ id: "settings.slackBridge.retryFinishSetup" })}
            </Button>
          )}
        </div>
      )}

      {snapshot.stage === "enable" && (
        <div className="space-y-3 border-t border-line-hairline pt-4">
          {snapshot.preflight ? (
            <PreflightResults preflight={snapshot.preflight} passed={preflightPassed} />
          ) : (
            <Banner intent="warning" density="sm" icon={<AlertTriangle size={16} />}>
              {formatMessage({ id: "settings.slackBridge.preflightNotPassed" })}
            </Banner>
          )}
          {canManage && (
            <div className="flex justify-end">
              <Button
                variant="accent"
                size="sm"
                disabled={busy}
                onClick={enableBridge}
              >
                {formatMessage({ id: "settings.slackBridge.retryFinishSetup" })}
              </Button>
            </div>
          )}
        </div>
      )}

      {snapshot.stage === "health" && !editingMappings && (
        <HealthPanel
          snapshot={snapshot}
          channelNames={channelNames}
          canManage={canManage}
          onManage={startEditingMappings}
          busy={busy}
          onRefresh={refresh}
        />
      )}

      {canDisconnect && !disconnectConfirmed && (
        <div className="flex flex-wrap justify-end gap-2" data-testid="slack-bridge-connection-actions">
          {canReauthorize && (
            <Button size="sm" variant="outline" disabled={busy} onClick={reauthorize} data-testid="slack-bridge-reauthorize">
              {formatMessage({ id: "settings.slackBridge.reauthorize" })}
            </Button>
          )}
          <Button variant="warning" size="sm" disabled={busy} onClick={confirmDisconnect}>
            {formatMessage({ id: "settings.slackBridge.disconnect" })}
          </Button>
        </div>
      )}
      {canDisconnect && disconnectConfirmed && (
        <Banner intent="destructive" density="sm" data-testid="slack-bridge-disconnect-confirmation">
          <p>{formatMessage({ id: "settings.slackBridge.disconnectDescription" })}</p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={cancelDisconnect}>
              {formatMessage({ id: "settings.common.cancel" })}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={busy}
              onClick={disconnect}
            >
              {formatMessage({ id: "settings.slackBridge.disconnectConfirm" })}
            </Button>
          </div>
        </Banner>
      )}
    </Card>
  );
}
