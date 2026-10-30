import {
  Badge,
  Button,
  Card,
  ConversationPanelTabs,
  CopyableCode,
  CopyableCodeAction,
  CopyableCodeRoot,
  DialogSurface,
  PanelTitle,
  SortableTabsList,
  SortableTabsTab,
  Tabs,
  TabsLabel,
  ProfilePanelBody,
  useOrderedTabs,
  ChatIcon,
  DirectMessageIcon,
  Separator,
  DescriptionList,
  DescriptionItem,
  DescriptionTerm,
  DescriptionDetails,
  PanelAction,
  PanelNotice,
  PanelNoticeActions,
  PanelNoticeContent,
  IconTile,
  ListRow,
  ListRowBody,
  ListRowDescription,
  ListRowGroup,
  ListRowTitle,
  ListRowTop,
} from "@botiverse/raft-ui";
import type { BadgeProps, ButtonProps } from "@botiverse/raft-ui";
import CloseButton from "../ui/CloseButton";
import Tooltip from "../ui/Tooltip";
import EditProviderConnectionModal from "../settings/EditProviderConnectionModal";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import type { ComponentType, MouseEvent, ReactNode } from "react";
import { useIntl } from "react-intl";
import {
  Activity,
  Play,
  Square,
  Archive,
  Bug,
  Pencil,
  Check,
  X,
  FolderOpen,
  BellRing,
  BellOff,
  Link2,
  RotateCcw,
  Hash,
  Lock,
  Bot,
  Plus,
  Clipboard,
  HelpCircle,
  MoveRight,
  Blocks,
  Cpu,
} from "lucide-react";
import { useLocation } from "react-router-dom";
import { SIDEBAR_TAB_QUERY_PARAM, useAppNavigate, useMobileBack } from "../../hooks/useAppNavigate";
import {
  getRuntimeDisplayName,
  getDefaultModel,
  getModelLabel,
  getExistingAgentRuntimeOptions,
  isRuntimeDeprecated,
  isExternalAgentRuntime,
  runtimeAvailabilitySuffix,
  runtimeConfigModelValue,
  REASONING_EFFORT_RUNTIMES,
  parseRaftPermalink,
  canChangeMemberRole,
  clearClockTimeout,
  setClockTimeout,
} from "@botiverse/raft-shared";
import type {
  AgentActivity,
  ExternalAgentDiagnosticsView,
  ProviderConnectionSummary,
  ReasoningEffort,
  RuntimeReasoningEffort,
  ReminderSummary,
  RuntimeConfig,
  RuntimeFormDefinitionRef,
  ServerRole,
} from "@botiverse/raft-shared";
import { formatRuntimeAvailabilitySuffix, formatRuntimeLabelWithStatus } from "../../utils/runtimeAvailabilityLabel";
import { classifyRuntimeError, RUNTIME_ERROR_LABEL_ID, RUNTIME_LOOKUP_DISPLAY_MESSAGE_ID, runtimeLookupDisplayForReason } from "../../utils/classifyRuntimeError";
import type { RuntimeErrorKind } from "../../utils/classifyRuntimeError";
import { reasoningEffortLabelId, reconcileReasoningEffort } from "../../utils/reasoningEffortOptions";
import { MachineRunLabel } from "../machine/MachineRunLabel";
import { RuntimeAccountUsageGateChip } from "../machine/RuntimeAccountUsageChip";
import { projectRuntimeModelLabelPresentation, runtimeModelSelectionIsRunnable, useRuntimeModels } from "../../hooks/useRuntimeModels";
import { useExistingAgentRuntimeOptions as useExistingAgentRuntimeSelectionOptions } from "../../hooks/useRuntimeSelectionCatalog";
import { runtimeFormDefinitionRefKey, useRuntimeFormDefinitionCatalog } from "../../hooks/useRuntimeFormDefinition";
import { useRuntimeFormV2 } from "../../hooks/useRuntimeFormV2";
import { RUNTIME_FORM_V2_WEB_FLAG_KEY, useServerFeatureFlag } from "../../store/serverFeatureFlags";
import {
  applyRuntimeFormV2Change,
  initialRuntimeFormV2Values,
  runtimeFormV2Submission,
  validateRuntimeFormV2,
} from "@botiverse/raft-runtime-form";
import type { RuntimeFormV2Value, RuntimeFormV2Values } from "@botiverse/raft-runtime-form";
import { useTimeFormatter } from "../../hooks/useTimeFormatter";
import { formatRelativeTime } from "../../utils/relativeTime";
import { getSocket } from "../../api/socket";
import {
  useAgentStore,
  useAgentDisplayState,
  useAgentCurrentActivityState,
} from "../../store/agentStore";
import type {
  Agent,
  ActivityLogEntry,
  ExternalAgentStatus,
  OnboardingIdentityAdoptionPreview,
} from "../../store/agentStore";
import { useChannelStore } from "../../store/channelStore";
import { useMachineStore } from "../../store/machineStore";
import { resolveAgentMachineRow } from "../../utils/agentMachineRow";
import { resolveAgentServerRoleDisplay } from "../../utils/agentServerRoleDisplay";
import { useServerStore } from "../../store/serverStore";
import { catalogModelLabel } from "../../store/modelLabelCatalogStore";
import { useAuthStore } from "../../store/authStore";
import { useProfileStore } from "../../store/profileStore";
import { useThreadStore } from "../../store/threadStore";
import { useServerPermissions } from "../../hooks/useServerPermissions";
import { useProviderConnections } from "../../hooks/useProviderConnections";
import { useLiveSearchParams } from "../../hooks/useLiveSearchParams";
import { canViewAgentPrivateSurfaces } from "../../utils/agentVisibility";
import {
  buildRuntimeConfig,
  buildManagedConnectionRuntimeConfig,
  isBuiltInProviderApiKeyInvalid,
  isRuntimeConfigSaveDisabled,
  BUILTIN_RUNTIME_DEFAULT_PROVIDER_ID,
  hydrateRuntimeConfigForm,
  RuntimeConfigBuildError,
  runtimeConfigApiKey,
  runtimeConfigApiUrl,
  runtimeConfigBuiltInProviderApiKey,
  runtimeConfigBuiltInProviderBaseUrl,
  runtimeConfigBuiltInProviderSupportsImageInput,
  runtimeConfigBuiltInProviderMode,
  runtimeConfigCommand,
  runtimeConfigFastMode,
  runtimeConfigPiProviderApiKey,
  runtimeConfigPiProviderMode,
  runtimeConfigProviderMode,
  runtimeConfigProviderConnectionId,
  runtimeIgnoresModel,
  builtInProviderDefaultModel,
  isBuiltInGatewayProviderMode,
  piBuiltinProviderDefaultModel,
  reconcileBuiltInProviderModelSelection,
  PI_PROVIDER_CONFIGURED,
  supportsRuntimeApiUrl,
  supportsRuntimeBuiltInProvider,
  supportsRuntimeCustomModelName,
  supportsRuntimeFastMode,
  supportsRuntimePiProvider,
} from "../../utils/runtimeConfigForm";
import { buildSchemaDrivenKimiConfig } from "../../utils/schemaRuntimeConfigForm";
import type {
  BuiltInProviderMode,
  PiProviderMode,
  RuntimeProviderMode,
} from "../../utils/runtimeConfigForm";
import { formatRuntimeConfigBuildError } from "../../utils/runtimeConfigBuildErrorPresentation";
import AgentProfileOverflowMenu from "./AgentProfileOverflowMenu";
import { stopHostedTurnWithFeedback } from "./stopHostedTurn";

import { formatActivityText, formatSpawnFailureDetail } from "../../utils/activity";
import { getServerUrl } from "../../utils/server";
import { canViewMachineRuntimeAccountUsage } from "../../utils/machineRuntimeUsageVisibility";
import StatusDot from "../ui/StatusDot";
import type { StatusDotPresence } from "../ui/StatusDot";
import { buildAgentDiagnosticInfo } from "../../utils/agentDiagnosticInfo";
import { copyTextToClipboard } from "../../utils/selectMarkdown";
import { ExternalAgentToken } from "./ExternalAgentToken";
import { DEFAULT_COPY_FEEDBACK_TIMEOUT_MS, useCopyText } from "../../hooks/useCopyText";
import CopyButton from "../ui/CopyButton";
import { isCustomAvatar } from "./PixelAvatar";
import { useImageLightboxStore } from "../../store/imageLightboxStore";
import PanelHeader, { PROFILE_HANDLE_FONT_CLASS } from "../ui/PanelHeader";
import SectionEyebrow from "../ui/SectionEyebrow";
import SectionHeader from "../ui/SectionHeader";
import ShowMoreToggle from "../ui/ShowMoreToggle";
import AvatarSlot from "../ui/AvatarSlot";
import AvatarEditVeil from "../ui/AvatarEditVeil";
import AgentProfileEditDialog from "./AgentProfileEditDialog";
import type { AgentProfileEditField } from "./AgentProfileEditDialog";
import api from "../../api/client";
import AgentWorkspace from "./AgentWorkspace";
import { AgentMcpTab } from "./AgentMcpTab";
import AgentActivityLog from "./AgentActivityLog";
import AgentSkills from "./AgentSkills";
import AgentRemindersSection from "./AgentRemindersSection";
import AgentAppAccessTab from "./AgentAppAccessTab";
import ReportIssueDialog from "./ReportIssueDialog";
import { AgentDMConversationList } from "./AgentDMConversationList";
import type { AgentDMConversation } from "./AgentDMConversationList";
import RolePermissionHelpDialog from "../member/RolePermissionHelpDialog";
import type { MessageId } from "../../i18n/messages/en";

import ResetAgentDialog from "./ResetAgentDialog";
import ConfirmDialog from "../ConfirmDialog";
import Banner from "../ui/Banner";
import EmptyState from "../ui/EmptyState";
import Modal from "../Modal";
import RuntimeConfigFields from "./RuntimeConfigFields";
import {
  ExternalSetupTabSegmentedControl,
} from "./ExternalSetupTabSegmentedControl";
import type {
  ExternalSetupTab,
} from "./ExternalSetupTabSegmentedControl";
import { AgentMigrationSection } from "../agentMigration/AgentMigrationSection";
import { AgentArchiveDialog } from "../agentArchive/AgentArchiveDialog";
import { AgentArchiveSection } from "../agentArchive/AgentArchiveSection";
import { useArchivedAgentMachineName } from "../agentArchive/useArchivedAgentMachineName";
import { describeHostedRuntime, HostedRuntimeStatus } from "./HostedRuntimeStatus";
import { AgentConnections } from "./AgentConnections";
import { AgentHostedRuntimeUsage } from "./AgentHostedRuntimeUsage";
import { AgentHostedRuntimeModel } from "./AgentHostedRuntimeModel";
import { EnvVarEntryRow } from "./EnvVarEntryRow";
import type { EnvVarEntry } from "./EnvVarEntryRow";
import { ExternalSetupCopyButton } from "./ExternalSetupCopyButton";
import { recordProfileOpenE2eEvent } from "../../utils/profileOpenE2eTimeline";

recordProfileOpenE2eEvent({ kind: "module-evaluated", module: "agent-detail" });

const HOSTED_RUNTIME_POLL_MS = 5_000;
const FEEDBACK_EXPORT_ENABLED = Boolean(import.meta.env?.VITE_FEEDBACK_EXPORT_URL?.replace(/\/+$/, ""));
const AGENT_TABS = ["profile", "activity", "chat", "reminders", "workspace", "integrations", "mcp"] as const;
type AgentTab = typeof AGENT_TABS[number];
type PanelTabItem<T extends string> = {
  id: T;
  labelId: MessageId;
  icon: ComponentType<{ size?: number; className?: string }>;
};
const AGENT_PANEL_TABS: PanelTabItem<AgentTab>[] = [
  { id: "profile", icon: Bot, labelId: "agent.detail.tab.profile" },
  { id: "activity", icon: Activity, labelId: "agent.detail.tab.activity" },
  { id: "chat", icon: ChatIcon, labelId: "agent.detail.tab.chat" },
  { id: "reminders", icon: BellRing, labelId: "agent.detail.tab.reminders" },
  { id: "workspace", icon: FolderOpen, labelId: "agent.detail.tab.workspace" },
  { id: "integrations", icon: Link2, labelId: "agent.detail.tab.apps" },
  { id: "mcp", icon: Blocks, labelId: "agent.detail.tab.mcp" },
];
const EMPTY_ACTIVITY_LOG: ActivityLogEntry[] = [];
// Default-deny: Profile is the only public tab. Any new tab added to
// AGENT_TABS is private by default until explicitly added to PUBLIC_AGENT_TABS.
// Spec: #proj-server:175df9ee — agent-internal info must not silently widen
// visibility for non-creator members.
const PUBLIC_AGENT_TABS = new Set<AgentTab>(["profile"]);
// Private surfaces — workspace, activity, DMs, reminders, and integrations —
// are visible to creator OR admin. The legacy Permissions tab is intentionally
// no longer exposed from Agent detail; old saved tab orders are ignored because
// they no longer match AGENT_TABS.
const AGENT_ROLE_CONFIG: Record<Extract<ServerRole, "admin" | "member">, { labelId: MessageId }> = {
  admin: { labelId: "agent.detail.roleAdmin" },
  member: { labelId: "agent.detail.roleMember" },
};
const EDITABLE_AGENT_ROLE_OPTIONS: { id: Extract<ServerRole, "admin" | "member">; labelId: MessageId }[] = [
  { id: "admin", labelId: "agent.detail.roleAdmin" },
  { id: "member", labelId: "agent.detail.roleMember" },
];

interface AgentChannelMembership {
  id: string;
  name: string;
  description: string | null;
  type: "channel" | "private" | "joint";
  createdAt: string;
  archivedAt: string | null;
  activityMuted: boolean;
  muteFromSeq: string | number | null;
}

interface AgentChatDataState<T> {
  items: T[];
  loading: boolean;
  error: string;
}

const EMPTY_AGENT_DMS_STATE: AgentChatDataState<AgentDMConversation> = {
  items: [],
  loading: false,
  error: "",
};

const EMPTY_AGENT_CHANNELS_STATE: AgentChatDataState<AgentChannelMembership> = {
  items: [],
  loading: false,
  error: "",
};
const AGENT_CHAT_CHANNEL_PREVIEW_LIMIT = 5;

function visibleAgentChatChannels(items: AgentChannelMembership[]): AgentChannelMembership[] {
  return items.filter((item) => !item.archivedAt);
}

function AgentChatInlineEmpty({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="px-5 pb-4">
      <div className="flex items-center gap-3">
        <IconTile size="sm">{icon}</IconTile>
        <div className="min-w-0">
          <div className="text-callout font-semibold text-foreground-muted">{title}</div>
          <div className="text-caption text-foreground-hint">{description}</div>
        </div>
      </div>
    </div>
  );
}

function AgentChatTab({ agentId }: { agentId: string }) {
  const { formatMessage } = useIntl();
  const formatMessageRef = useRef(formatMessage);
  formatMessageRef.current = formatMessage;
  const nav = useAppNavigate();
  const openChannel = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    const channelId = event.currentTarget.dataset.channelId;
    if (channelId) nav.toChannel(channelId);
  }, [nav]);
  const [dms, setDms] = useState<AgentChatDataState<AgentDMConversation>>(EMPTY_AGENT_DMS_STATE);
  const [channels, setChannels] = useState<AgentChatDataState<AgentChannelMembership>>(EMPTY_AGENT_CHANNELS_STATE);
  const [channelsExpanded, setChannelsExpanded] = useState(false);
  const showCombinedEmptyState = !channels.loading
    && !dms.loading
    && !channels.error
    && !dms.error
    && channels.items.length === 0
    && dms.items.length === 0;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setDms((state) => ({ ...state, loading: true, error: "" }));
      try {
        const { data } = await api.get(`/agents/${agentId}/agent-dms`);
        if (!cancelled) setDms({ items: data, loading: false, error: "" });
      } catch (err: any) {
        if (!cancelled) {
          setDms({ items: [], loading: false, error: err?.response?.data?.error || formatMessageRef.current({ id: "agent.detail.loadAgentDmsFailed" }) });
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setChannels((state) => ({ ...state, loading: true, error: "" }));
      try {
        const { data } = await api.get(`/agents/${agentId}/channels`);
        if (!cancelled) setChannels({ items: visibleAgentChatChannels(data), loading: false, error: "" });
      } catch (err: any) {
        if (!cancelled) {
          setChannels({ items: [], loading: false, error: err?.response?.data?.error || formatMessageRef.current({ id: "agent.detail.loadAgentChannelsFailed" }) });
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const canExpandChannels = channels.items.length > AGENT_CHAT_CHANNEL_PREVIEW_LIMIT;
  const visibleChannels = channelsExpanded
    ? channels.items
    : channels.items.slice(0, AGENT_CHAT_CHANNEL_PREVIEW_LIMIT);
  const toggleChannelsExpanded = useCallback(() => setChannelsExpanded((expanded) => !expanded), []);

  return (
    <div className="flex-1 overflow-y-auto bg-layer-canvas">
      <div className="border-b border-line-hairline bg-layer-canvas px-5 py-3">
        <SectionEyebrow as="div">{formatMessage({ id: "agent.detail.channelsAndDms" })}</SectionEyebrow>
      </div>

      {showCombinedEmptyState ? (
        <EmptyState
          className="px-5 py-14"
          icon={(
            <div className="flex items-center gap-3">
              <Hash size={34} />
              <ChatIcon width={34} height={34} />
            </div>
          )}
          title={formatMessage({ id: "emptyState.noChatsTitle" })}
          description={formatMessage({ id: "emptyState.noChatsDesc" })}
        />
      ) : (
        <>
          <section>
            <div className="px-5 py-3">
              <SectionHeader label={formatMessage({ id: "agent.detail.channels" })} />
              <div className="mt-1 text-caption text-foreground-hint">
                {formatMessage({ id: "agent.detail.channelsDescription" })}
              </div>
            </div>
            {channels.loading ? (
              <div className="px-5 pb-4 text-caption text-foreground-hint">
                {formatMessage({ id: "agent.detail.loadingAgentChannels" })}
              </div>
            ) : channels.error ? (
              <div className="px-5 pb-4">
                <Banner intent="warning" density="sm">{channels.error}</Banner>
              </div>
            ) : channels.items.length === 0 ? (
              <AgentChatInlineEmpty
                icon={<Hash size={18} />}
                title={formatMessage({ id: "emptyState.noChannelsTitle" })}
                description={formatMessage({ id: "emptyState.noChannelsDesc" })}
              />
            ) : (
              <div className="space-y-2 px-4 pb-4">
                {/* DS ListRow › channels in an inset list: raft-ui ListRows
                    with the neutral channel tile (# or lock), the name and its
                    description; a muted channel is the `muted` tone (ink-2
                    name) with its bell-off mark. */}
                <ListRowGroup>
                {visibleChannels.map((item) => (
                  <ListRow
                    key={item.id}
                    tone={item.activityMuted ? "muted" : "default"}
                    data-channel-id={item.id}
                    onClick={openChannel}
                  >
                    <IconTile
                      role="img"
                      aria-label={item.type === "private"
                        ? formatMessage({ id: "agent.detail.privateChannel" })
                        : formatMessage({ id: "agent.detail.channel" })}
                    >
                      {item.type === "private" ? <Lock /> : <Hash />}
                    </IconTile>
                    <ListRowBody>
                      <ListRowTop>
                        <ListRowTitle>{item.name}</ListRowTitle>
                        {item.activityMuted && (
                          <Tooltip content={item.muteFromSeq != null
                              ? formatMessage({ id: "agent.detail.activityMutedFromSeq" }, { seq: item.muteFromSeq })
                              : formatMessage({ id: "agent.detail.activityMuted" })}>
                          <span
                            className="inline-flex shrink-0 items-center text-foreground-hint"
                            aria-label={item.muteFromSeq != null
                              ? formatMessage({ id: "agent.detail.activityMutedFromSeq" }, { seq: item.muteFromSeq })
                              : formatMessage({ id: "agent.detail.activityMuted" })}
                          >
                            <BellOff size={13} aria-hidden="true" />
                          </span>
                          </Tooltip>
                        )}
                      </ListRowTop>
                      {item.description && (
                        <ListRowDescription>{item.description}</ListRowDescription>
                      )}
                    </ListRowBody>
                    {item.type !== "channel" && (
                      <Badge appearance="outline" className="shrink-0">
                        {item.type === "private"
                          ? formatMessage({ id: "agent.detail.private" })
                          : formatMessage({ id: "agent.detail.joint" })}
                      </Badge>
                    )}
                  </ListRow>
                ))}
                </ListRowGroup>
                {canExpandChannels && (
                  <ShowMoreToggle
                    onClick={toggleChannelsExpanded}
                    expanded={channelsExpanded}
                    collapsedLabel={formatMessage({ id: "agent.detail.showAllChannels" }, { count: channels.items.length })}
                    expandedLabel={formatMessage({ id: "agent.detail.showFewer" })}
                    aria-expanded={channelsExpanded}
                    data-testid="agent-channels-show-all"
                  />
                )}
              </div>
            )}
          </section>
          <Separator />

          <section>
            <div className="px-5 py-3">
              <SectionHeader label={formatMessage({ id: "agent.detail.agentDms" })} />
              <div className="mt-1 text-caption text-foreground-hint">
                {formatMessage({ id: "agent.detail.agentDmsDescription" })}
              </div>
            </div>
            {dms.loading ? (
              <div className="px-5 pb-4 text-caption text-foreground-hint">
                {formatMessage({ id: "agent.detail.loadingAgentDms" })}
              </div>
            ) : dms.error ? (
              <div className="px-5 pb-4">
                <Banner intent="warning" density="sm">{dms.error}</Banner>
              </div>
            ) : dms.items.length === 0 ? (
              <AgentChatInlineEmpty
                icon={<DirectMessageIcon width={18} height={18} />}
                title={formatMessage({ id: "emptyState.noAgentDmsTitle" })}
                description={formatMessage({ id: "emptyState.noAgentDmsDesc" })}
              />
            ) : (
              <AgentDMConversationList items={dms.items} />
            )}
          </section>
        </>
      )}
    </div>
  );
}

// Editable environment variables section
function EnvVarsSection({ agent, canManageAgent }: { agent: Agent; canManageAgent: boolean }) {
  const { formatMessage } = useIntl();
  const updateAgent = useAgentStore((s) => s.updateAgent);
  const [editing, setEditing] = useState(false);
  const [entries, setEntries] = useState<EnvVarEntry[]>([]);

  const envVars = agent.envVars;
  const hasVars = envVars && Object.keys(envVars).length > 0;

  const startEditing = () => {
    setEntries(
      envVars
        ? Object.entries(envVars).map(([key, value]) => ({ key, value }))
        : []
    );
    setEditing(true);
  };

  const handleSave = useCallback(async () => {
    const newVars: Record<string, string> = {};
    for (const entry of entries) {
      const k = entry.key.trim();
      if (k) newVars[k] = entry.value;
    }
    await updateAgent(agent.id, {
      envVars: Object.keys(newVars).length > 0 ? newVars : null,
    });
    setEditing(false);
  }, [entries, updateAgent, agent.id]);
  const cancelEditing = useCallback(() => setEditing(false), []);
  const updateEntry = useCallback((index: number, patch: Partial<EnvVarEntry>) => {
    setEntries((current) => current.map((entry, j) => (j === index ? { ...entry, ...patch } : entry)));
  }, []);
  const removeEntry = useCallback((index: number) => {
    setEntries((current) => current.filter((_, j) => j !== index));
  }, []);

  if (!hasVars && !canManageAgent) return null;

  return (
    <div className="w-full">
      <div className="flex items-center gap-2 mb-1">
        <SectionEyebrow as="div">
          {formatMessage({ id: "agent.runtimeConfig.envVars" })}
        </SectionEyebrow>
        {canManageAgent && !editing && (
          <Tooltip content={formatMessage({ id: "agent.detail.editEnvironmentVariables" })}>
            <button
              type="button"
              aria-label={formatMessage({ id: "agent.detail.editEnvironmentVariables" })}
              onClick={startEditing}
              className={INFO_ICON_BUTTON_CLASS}
            >
              <Pencil size={14} />
            </button>
          </Tooltip>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          {entries.map((entry, i) => (
            <EnvVarEntryRow key={i} index={i} entry={entry} onChange={updateEntry} onRemove={removeEntry} />
          ))}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEntries([...entries, { key: "", value: "" }])}
              className="flex items-center gap-1 text-footnote font-semibold text-foreground underline decoration-[1.5px] underline-offset-[3px]"
            >
              <Plus size={14} />
              {formatMessage({ id: "agent.runtimeConfig.addVariable" })}
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm"
              onClick={cancelEditing}
            >
              {formatMessage({ id: "common.confirm.cancel" })}
            </Button>
            <Button variant="accent" size="sm"
              onClick={handleSave}
            >
              {formatMessage({ id: "machine.detail.save" })}
            </Button>
          </div>
        </div>
      ) : hasVars ? (
        <div className="flex flex-wrap gap-2">
          {Object.entries(envVars!).map(([key, value]) => (
            <Tooltip key={key} content={`${key}=${value}`}>
            <span
              className="inline-block rounded-sticker bg-fill-muted px-1.5 py-0.5 font-mono text-mono-meta text-foreground"
            >
              {key}=<span className="text-foreground-hint">{"•".repeat(Math.min(value.length, 8))}</span>
            </span>
            </Tooltip>
          ))}
        </div>
      ) : (
        <p className="text-caption text-foreground-hint">
          {formatMessage({ id: "agent.detail.noEnvironmentVariables" })}
        </p>
      )}
    </div>
  );
}

// Isolated info bar — role/model/reasoning editing state lives here,
// so keystroke re-renders don't cascade to ChatPanel / tabs below.
/** Profile tab: description, machine, model config, env vars, created date */
/**
 * One label | value row of the profile's property lists (Info, Runtime config):
 * the DS PropertyList (raft-ui DescriptionList, horizontal) — label column in
 * ink-3, value in ink; icons follow the label.
 */
function InfoRow({ label, actions, children, testId }: { label: ReactNode; actions?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <DescriptionItem data-testid={testId}>
      <DescriptionTerm>
        <span className="truncate">{label}</span>
        {actions}
      </DescriptionTerm>
      <DescriptionDetails>{children}</DescriptionDetails>
    </DescriptionItem>
  );
}

// The profile hero avatar is the trigger itself: no control frame around the
// sticker (it carries its own ink edge), a focus ring on keyboard focus.
const PROFILE_AVATAR_BUTTON_CLASS = "group/avatar-edit relative shrink-0 rounded-sticker outline-none focus-visible:shadow-focus";
// DS runtime chip (`.rf-runtime`): the cyan-soft Badge in machine type, with a cpu icon.
const RUNTIME_CHIP_CLASS = "font-mono text-mono-meta font-normal";
const INFO_ICON_BUTTON_CLASS = "shrink-0 rounded-sticker text-foreground-muted transition-colors hover:bg-fill-pressed hover:text-foreground";

/** Roles the viewer may assign to this agent (empty when the role is not editable). */
function useEditableAgentRoleOptions(agent: Agent): { id: Extract<ServerRole, "admin" | "member">; label: string }[] {
  const { formatMessage } = useIntl();
  const { role: currentRole } = useServerPermissions();
  const currentAgentServerRole = agent.serverRole === "admin" ? "admin" : agent.serverRole === "member" ? "member" : null;
  return useMemo(
    () => currentAgentServerRole
      ? EDITABLE_AGENT_ROLE_OPTIONS
        .filter((option) => canChangeMemberRole(currentRole, currentAgentServerRole, option.id))
        .map((option) => ({ id: option.id, label: formatMessage({ id: option.labelId }) }))
      : [],
    [currentAgentServerRole, currentRole, formatMessage],
  );
}

/**
 * The profile header's name. It is the agent's display name (falling back to
 * the @name); its pencil opens the profile edit dialog on the name field.
 */
function AgentHeaderName({ agent, onEdit }: { agent: Agent; onEdit?: () => void }) {
  const { formatMessage } = useIntl();
  return (
    <>
      <Tooltip content={agent.displayName || agent.name}>
        {/* PanelTitle source (cindyz 2026-10-10): the detail-block name follows the
            panel-title spec (17 / selected weight / heading family) so the same
            name reads identically in the header and the body. */}
        <PanelTitle className="min-w-0">{agent.displayName || agent.name}</PanelTitle>
      </Tooltip>
      {onEdit && (
        <Tooltip content={formatMessage({ id: "agent.detail.editDisplayName" })}>
          <button
            type="button"
            aria-label={formatMessage({ id: "agent.detail.editDisplayName" })}
            onClick={onEdit}
            className={INFO_ICON_BUTTON_CLASS}
          >
            <Pencil size={14} />
          </button>
        </Tooltip>
      )}
    </>
  );
}

type PendingConfirm = {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  loadingLabel: string;
  confirmVariant: ButtonProps["variant"];
  plainMessage?: boolean;
  maxWidthClass?: string;
  onConfirm: () => Promise<void>;
};

function AgentProfileInfo({ agent, canManageAgent, canChangeAgentRole, onOpenProfile, onEdit, showOperationalInfo = true }: { agent: Agent; canManageAgent: boolean; canChangeAgentRole: boolean; onOpenProfile?: (type: "agent" | "human", id: string) => void; onEdit?: (field: AgentProfileEditField) => void; showOperationalInfo?: boolean }) {
  const archivedMachineName = useArchivedAgentMachineName(agent.deletedAt ? agent.id : null);
  const { formatDate, formatList, formatMessage } = useIntl();
  const formatMessageRef = useRef(formatMessage);
  formatMessageRef.current = formatMessage;
  const updateAgent = useAgentStore((s) => s.updateAgent);
  const fetchExternalAgentStatus = useAgentStore((s) => s.fetchExternalAgentStatus);
  const retryHostedRuntimeProvisioning = useAgentStore((s) => s.retryHostedRuntimeProvisioning);
  const fetchOnboardingIdentityAdoption = useAgentStore((s) => s.fetchOnboardingIdentityAdoption);
  const adoptOnboardingIdentity = useAgentStore((s) => s.adoptOnboardingIdentity);
  const currentServer = useServerStore((s) => s.current);
  const displayState = useAgentDisplayState(agent.id, agent);
  const machines = useMachineStore((s) => s.machines);
  const nav = useAppNavigate();
  const isExternalAgent = agent.external === true || isExternalAgentRuntime(agent.runtime);
  const { formatShortDateTime } = useTimeFormatter();
  const { capabilities } = useServerPermissions();
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  const machineLoadStatus = useMachineStore((s) => s.loadStatus);
  // task #259: while the store has no snapshot yet the Computer row is not rendered, so it
  // cannot flash "No computer assigned" before flipping to the machine (decision 甲, both ends).
  const agentMachineRow = resolveAgentMachineRow(agent.machineId, machines, machineLoadStatus);
  const agentMachine = agentMachineRow.kind === "machine" ? agentMachineRow.machine : null;
  const machineStatus = agentMachine ? agentMachine.status : agent.machineId ? "offline" : null;
  const configRef = useRef<HTMLDivElement>(null);
  const runtimeConfigModalRef = useRef<HTMLDivElement>(null);
  // Recompute only on the runtime-relevant agent fields; depending on the whole
  // `agent` would recompute on every unrelated agent update (activity/status/name)
  // and churn the hydrated form.
  const { envVars: agentEnvVars, model: agentModel, reasoningEffort: agentReasoningEffort, runtime: agentRuntime, runtimeConfig: agentRuntimeConfig } = agent;
  const currentRuntimeConfig = useMemo(() => hydrateRuntimeConfigForm({
    envVars: agentEnvVars,
    model: agentModel,
    reasoningEffort: agentReasoningEffort,
    runtime: agentRuntime,
    runtimeConfig: agentRuntimeConfig,
  }), [agentEnvVars, agentModel, agentReasoningEffort, agentRuntime, agentRuntimeConfig]);
  const currentRuntimeModel = runtimeConfigModelValue(currentRuntimeConfig);
  // Runtime-config draft buffers. The edit form (L1099 `{editingRuntimeConfig && ...}`)
  // is the ONLY render path that reads these, and `startRuntimeConfigEditing` re-seeds
  // every draft from `currentRuntimeConfig` immediately before flipping the editing
  // flag — so while `!editingRuntimeConfig` the drafts are "garbage but unused" and
  // need not track prop drift. The mount-time initializers are intentional cosmetic
  // defaults; they are never read until the next `startRuntimeConfigEditing` seeds them.
  // Async schema arrival reconciles only a newly selected Kimi runtime draft.
  // oxlint-disable react-doctor/no-event-handler
  const [editingRuntimeConfig, setEditingRuntimeConfig] = useState(false);
  const [draftRuntime, setDraftRuntime] = useState(agent.runtime || "claude");
  const [draftModel, setDraftModel] = useState("");
  const [draftCustomModelMode, setDraftCustomModelMode] = useState(false);
  const [draftProviderMode, setDraftProviderMode] = useState<RuntimeProviderMode>("default");
  const [draftProviderApiUrl, setDraftProviderApiUrl] = useState("");
  const [draftProviderApiKey, setDraftProviderApiKey] = useState("");
  const [draftBuiltInProviderMode, setDraftBuiltInProviderMode] = useState<BuiltInProviderMode>(BUILTIN_RUNTIME_DEFAULT_PROVIDER_ID);
  const [draftBuiltInProviderApiKey, setDraftBuiltInProviderApiKey] = useState("");
  const [draftBuiltInProviderBaseUrl, setDraftBuiltInProviderBaseUrl] = useState("");
  const [draftBuiltInProviderSupportsImageInput, setDraftBuiltInProviderSupportsImageInput] = useState(false);
  const [draftLoadLocalPlugins, setDraftLoadLocalPlugins] = useState(false);
  const [draftProviderConnectionId, setDraftProviderConnectionId] = useState("");
  const [editingProviderConnection, setEditingProviderConnection] = useState<ProviderConnectionSummary | null>(null);
  const [draftPiProviderMode, setDraftPiProviderMode] = useState<PiProviderMode>(PI_PROVIDER_CONFIGURED);
  const [draftPiProviderApiKey, setDraftPiProviderApiKey] = useState("");
  const [draftFastMode, setDraftFastMode] = useState(false);
  const [draftCommand, setDraftCommand] = useState("");
  const [draftEnvVarEntries, setDraftEnvVarEntries] = useState<{ key: string; value: string }[]>([]);
  const [runtimeConfigAdvancedOpen, setRuntimeConfigAdvancedOpen] = useState(false);
  const [draftReasoningEffort, setDraftReasoningEffort] = useState<RuntimeReasoningEffort | null>(null);
  const [savingRuntimeConfig, setSavingRuntimeConfig] = useState(false);
  const [runtimeConfigSaveError, setRuntimeConfigSaveError] = useState("");
  const [externalStatus, setExternalStatus] = useState<ExternalAgentStatus | null>(null);
  const [externalStatusError, setExternalStatusError] = useState("");
  const [externalCopiedTarget, setExternalCopiedTarget] = useState<string | null>(null);
  const [externalSetupTab, setExternalSetupTab] = useState<ExternalSetupTab>("hermes");
  const effectiveExternalSetupTab = externalSetupTab;
  const openProfile = useProfileStore((s) => s.openProfile);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const isActive = displayState.isOnline || agent.status === "active";
  const activeRuntime = editingRuntimeConfig ? draftRuntime : currentRuntimeConfig.runtime;
  const runtimeModels = useRuntimeModels(agent.machineId, activeRuntime);
  const currentRuntimeModelPresentation = activeRuntime === currentRuntimeConfig.runtime
    ? projectRuntimeModelLabelPresentation(currentRuntimeConfig.runtime, currentRuntimeModel, runtimeModels, agent.machineId)
    : { kind: "resolved" as const, label: getModelLabel(currentRuntimeConfig.runtime, currentRuntimeModel) };
  const currentRuntimeModelLabel = currentRuntimeModelPresentation.kind === "pending"
    ? formatMessage({ id: "common.loading" })
    : currentRuntimeModelPresentation.label;
  const availableRuntimes = agentMachine?.runtimes || [];
  // Gated on the same flag that governs display, so the loader and the surface
  // cannot drift apart: a remote joint agent shows no operational info and must
  // therefore not trigger this server's private runtime-options fetch either.
  const { options: runtimeAdmissionOptions } = useExistingAgentRuntimeSelectionOptions(
    agent.id,
    availableRuntimes,
    showOperationalInfo,
  );
  const runtimeFormDefinitionRefs = useMemo(
    () => runtimeAdmissionOptions.flatMap((option): RuntimeFormDefinitionRef[] =>
      option.canSelectInThisContext && option.formDefinitionRef ? [option.formDefinitionRef] : []),
    [runtimeAdmissionOptions],
  );
  const runtimeFormDefinitionCatalog = useRuntimeFormDefinitionCatalog(
    showOperationalInfo ? agent.machineId : null,
    runtimeFormDefinitionRefs,
  );
  const draftRuntimeAdmission = runtimeAdmissionOptions.find((option) => option.runtimeId === draftRuntime);
  const draftFormDefinitionRef = draftRuntimeAdmission?.formDefinitionRef;
  const draftFormDefinitionEntry = draftFormDefinitionRef
    ? runtimeFormDefinitionCatalog.entries[runtimeFormDefinitionRefKey(draftFormDefinitionRef)]
    : undefined;
  // Built-in edit keeps its established writeOnly-secret retention path. Kimi
  // has no writeOnly field and uses the same schema renderer on create/edit.
  const draftSchemaBacked = draftRuntime === "kimi-sdk" && draftFormDefinitionRef !== undefined;
  // Protocol v2 edit: the same server-described form as create, pre-filled by the
  // server with this agent's values (writeOnly fields blank = keep). Applies while
  // the draft stays on the agent's saved runtime and that runtime carries the
  // `runtimeFormV2` marker (independent of the v1 `formDefinitionRef`).
  // A saved provider connection is no exception: the v2 form edits it natively
  // (capability provider.saved_connection). Gating on the v1 connection draft
  // made the first provider change in v1 flip the dialog to v2, whose server
  // prefill then discarded that change.
  const runtimeFormV2Flag = useServerFeatureFlag(RUNTIME_FORM_V2_WEB_FLAG_KEY).enabled;
  const v2EditEligible = runtimeFormV2Flag
    && editingRuntimeConfig
    && showOperationalInfo
    && draftRuntime === agent.runtime
    && draftRuntimeAdmission?.runtimeFormV2?.protocolVersion === 2;
  const runtimeFormV2Edit = useRuntimeFormV2(
    v2EditEligible ? agent.machineId : null,
    v2EditEligible ? draftRuntime : null,
    agent.id,
  );
  // A runtime without an editable v2 form (the server answers 404), or whose v2
  // form needs client capabilities this build lacks, stays on v1/legacy.
  const v2EditActive = v2EditEligible && runtimeFormV2Edit.status !== "error" && runtimeFormV2Edit.status !== "unsupported";
  const [v2EditDraft, setV2EditDraft] = useState<RuntimeFormV2Values | null>(null);
  const [v2EditServerErrors, setV2EditServerErrors] = useState<Record<string, string>>({});
  const v2EditInitial = useMemo(
    () => runtimeFormV2Edit.status === "ready" ? initialRuntimeFormV2Values(runtimeFormV2Edit.form, runtimeFormV2Edit.sources) : null,
    [runtimeFormV2Edit],
  );
  const v2EditValues = v2EditDraft ?? v2EditInitial;
  const v2EditChanged = Boolean(v2EditDraft && v2EditInitial && JSON.stringify(v2EditDraft) !== JSON.stringify(v2EditInitial));
  // The v2 form's own save gate: v1's gate reads v1 draft fields the v2 form does not use.
  // A required field whose option source is unavailable cannot be saved (option_source.status),
  // nor a blank secret whose bound fields changed (writeOnlyKeepRequiresUnchanged).
  const v2EditBlocked = runtimeFormV2Edit.status === "ready" && v2EditValues !== null
    && Object.values(validateRuntimeFormV2(runtimeFormV2Edit.form, runtimeFormV2Edit.sources, v2EditValues, { editing: true }))
      .some((code) => code === "source_unavailable" || code === "secret_reentry_required");
  const v2EditSaveDisabled = savingRuntimeConfig || runtimeFormV2Edit.status !== "ready" || !v2EditChanged || v2EditBlocked;
  const changeV2EditValue = useCallback((key: string, value: RuntimeFormV2Value) => {
    if (runtimeFormV2Edit.status !== "ready" || !v2EditValues) return;
    setV2EditServerErrors({});
    setV2EditDraft(applyRuntimeFormV2Change(runtimeFormV2Edit.form, runtimeFormV2Edit.sources, v2EditValues, key, value));
  }, [runtimeFormV2Edit, v2EditValues]);
  const draftFormDefinition = draftSchemaBacked ? draftFormDefinitionEntry?.definition ?? null : null;
  const draftSchemaModelSource = draftFormDefinition?.optionSources.model?.kind === "select"
    ? draftFormDefinition.optionSources.model
    : null;
  // The definition arrives asynchronously after the explicit runtime-change
  // event. Reconcile only that new-runtime draft; existing Kimi values remain
  // visible even when the fresh live source no longer accepts them.
  // oxlint-disable-next-line react-doctor/no-cascading-set-state, react-doctor/no-effect-chain, react-doctor/no-event-handler
  useEffect(() => {
    if (
      !editingRuntimeConfig
      || draftRuntime !== "kimi-sdk"
      || currentRuntimeConfig.runtime === "kimi-sdk"
      || !draftSchemaModelSource
    ) return;
    const selected = draftSchemaModelSource.options.find((option) => option.value === draftModel)
      ?? draftSchemaModelSource.options.find((option) => option.value === draftSchemaModelSource.defaultValue)
      ?? draftSchemaModelSource.options[0];
    if (!selected) return;
    // oxlint-disable-next-line react-doctor/no-derived-state
    if (selected.value !== draftModel) setDraftModel(selected.value);
    const supported = selected.supportedReasoningEfforts ?? [];
    if (draftReasoningEffort !== null && supported.includes(draftReasoningEffort)) return;
    // oxlint-disable-next-line react-doctor/no-derived-state
    setDraftReasoningEffort(selected.defaultReasoningEffort ?? null);
  }, [
    currentRuntimeConfig.runtime,
    draftModel,
    draftReasoningEffort,
    draftRuntime,
    draftSchemaModelSource,
    editingRuntimeConfig,
  ]);
  // oxlint-enable react-doctor/no-event-handler
  const currentRuntimeDeprecated = isRuntimeDeprecated(currentRuntimeConfig.runtime);
  const canViewRuntimeAccountUsage = showOperationalInfo
    && canViewMachineRuntimeAccountUsage(agentMachine, currentUserId, capabilities);
  const providerConnectionCatalog = useProviderConnections(canManageAgent);
  const currentProviderConnectionId = runtimeConfigProviderConnectionId(currentRuntimeConfig);
  const selectedProviderConnection = providerConnectionCatalog.connections.find(
    (connection) => connection.id === draftProviderConnectionId,
  ) ?? null;
  const managedConnectionActive = draftRuntime === "builtin" && Boolean(draftProviderConnectionId);
  const providerConnectionInvalid = managedConnectionActive
    && (
      !providerConnectionCatalog.featureEnabled
      || !selectedProviderConnection
      || !selectedProviderConnection.enabled
      || !selectedProviderConnection.hasCredential
    );
  const existingRuntimeInfo = getExistingAgentRuntimeOptions(currentRuntimeConfig.runtime);
  const runtimeOptions = runtimeAdmissionOptions.flatMap((option) => {
    const runtimeInfo = existingRuntimeInfo.find((runtime) => runtime.id === option.runtimeId);
    return runtimeInfo
      ? [{
          value: runtimeInfo.id,
          label: formatRuntimeLabelWithStatus(runtimeInfo.id, formatMessage) + formatRuntimeAvailabilitySuffix(runtimeAvailabilitySuffix(runtimeInfo, availableRuntimes), formatMessage),
          disabled: !option.canSelectInThisContext,
        }]
      : [];
  });
  const draftRuntimeCanSelect = runtimeAdmissionOptions
    .find((option) => option.runtimeId === draftRuntime)
    ?.canSelectInThisContext === true;

  const [showRoleHelp, setShowRoleHelp] = useState(false);
  const [onboardingIdentityState, setOnboardingIdentityState] = useState<{
    agentId: string | null;
    preview: OnboardingIdentityAdoptionPreview | null;
    error: string;
  }>({ agentId: null, preview: null, error: "" });
  const isCurrentServerOnboardingAgent = Boolean(
    canManageAgent
    && showOperationalInfo
    && currentServer?.onboardingAgentId
    && currentServer.onboardingAgentId === agent.id,
  );

  const externalProfileSlug = agent.name.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || agent.id.slice(0, 8);
  const externalLoginCommand = `raft agent login --server ${getServerUrl()} --agent ${agent.id} --profile-slug ${externalProfileSlug}`;
  const externalCliInstallCommand = "npm i -g @botiverse/raft@latest";
  const externalClaudeSessionPrompt = formatMessage({ id: "agent.externalSetup.connectedPrompt" });
  const externalClaudeStartCommand = [
    `RAFT_EXPECTED_AGENT_ID=${agent.id} RAFT_PROFILE=${externalProfileSlug} claude \\`,
    `  --append-system-prompt '${externalClaudeSessionPrompt}' \\`,
    "  --dangerously-load-development-channels plugin:raft-channel@raft",
  ].join("\n");
  const externalClaudeSetupSteps = [
    {
      title: formatMessage({ id: "agent.detail.externalClaudeInstallTitle" }),
      command: [
        externalCliInstallCommand,
        "claude plugin marketplace add botiverse/raft-external-agents",
        "claude plugin marketplace update raft",
        "claude plugin install raft-channel@raft",
        "claude plugin update raft-channel@raft",
      ].join(" && "),
      description: "",
    },
    {
      title: formatMessage({ id: "agent.detail.externalLoginProfileTitle" }),
      command: externalLoginCommand,
      description: formatMessage({ id: "agent.detail.externalTokenLogin" }),
    },
    {
      title: formatMessage({ id: "agent.detail.externalClaudeStartTitle" }),
      command: externalClaudeStartCommand,
      description: "",
    },
  ];
  const externalClaudeSetupInstruction = externalClaudeSetupSteps
    .map((step, idx) => `${formatMessage({ id: "agent.detail.stepNumber" }, { step: idx + 1 })}: ${step.title}\n${step.command}`)
    .join("\n\n");
  const externalHermesSetupSteps = [
    {
      title: formatMessage({ id: "agent.detail.externalInstallRaftCliTitle" }),
      command: externalCliInstallCommand,
      description: formatMessage({ id: "agent.detail.externalHermesInstallDescription" }),
    },
    {
      title: formatMessage({ id: "agent.detail.externalLoginProfileTitle" }),
      command: externalLoginCommand,
      description: formatMessage({ id: "agent.detail.externalTokenLogin" }),
    },
    {
      title: formatMessage({ id: "agent.detail.externalHermesConfigureTitle" }),
      command: `RAFT_EXPECTED_AGENT_ID=${agent.id} hermes gateway setup`,
      description: formatMessage(
        { id: "agent.detail.externalHermesConfigureDescription" },
        { slug: externalProfileSlug, agentId: agent.id },
      ),
    },
  ];
  const externalHermesSetupInstruction = externalHermesSetupSteps
    .map((step, idx) => `${formatMessage({ id: "agent.detail.stepNumber" }, { step: idx + 1 })}: ${step.title}\n${step.command}`)
    .join("\n\n");
  const externalOtherSetupInstruction = [
    formatMessage({ id: "agent.detail.externalOtherRunInSession" }),
    "",
    externalCliInstallCommand,
    externalLoginCommand,
    "",
    formatMessage({ id: "agent.detail.externalTokenLogin" }),
    "",
    formatMessage({ id: "agent.detail.externalOtherReviewGuide" }, { slug: externalProfileSlug }),
  ].join("\n");
  const activeExternalSetupInstruction = effectiveExternalSetupTab === "claude-code"
    ? externalClaudeSetupInstruction
    : effectiveExternalSetupTab === "hermes"
      ? externalHermesSetupInstruction
      : externalOtherSetupInstruction;
  const externalSetupInstruction = activeExternalSetupInstruction;
  const externalStepSetupSteps = effectiveExternalSetupTab === "claude-code"
    ? externalClaudeSetupSteps
    : effectiveExternalSetupTab === "hermes"
      ? externalHermesSetupSteps
      : null;
  const currentAgentServerRole = agent.serverRole === "admin" ? "admin" : agent.serverRole === "member" ? "member" : null;
  const editableAgentRoleOptions = useEditableAgentRoleOptions(agent);
  const canEditServerRole = canChangeAgentRole && currentAgentServerRole !== null && editableAgentRoleOptions.length > 0;
  const currentAgentServerRoleInfo = currentAgentServerRole ? AGENT_ROLE_CONFIG[currentAgentServerRole] : null;
  // task #261: unrecognized role -> show the name the server sent; no role / deleted -> no chip.
  const serverRoleDisplay = resolveAgentServerRoleDisplay(agent.serverRole, agent.deletedAt);

  useEffect(() => {
    if (!isCurrentServerOnboardingAgent) return;
    let canceled = false;
    void fetchOnboardingIdentityAdoption(agent.id)
      .then((preview) => {
        if (!canceled) setOnboardingIdentityState({ agentId: agent.id, preview, error: "" });
      })
      .catch((err: unknown) => {
        const axiosErr = err as { response?: { data?: { error?: string } } };
        if (!canceled) setOnboardingIdentityState({
          agentId: agent.id,
          preview: null,
          error: axiosErr.response?.data?.error || formatMessageRef.current({ id: "agent.detail.loadOfficialIdentityFailed" }),
        });
      });
    return () => {
      canceled = true;
    };
  }, [agent.avatarUrl, agent.description, agent.displayName, agent.id, agent.name, fetchOnboardingIdentityAdoption, isCurrentServerOnboardingAgent]);

  useEffect(() => {
    if (!isExternalAgent || !canManageAgent) return;
    let canceled = false;
    const loadExternalStatus = async () => {
      setExternalStatusError("");
      try {
        const status = await fetchExternalAgentStatus(agent.id);
        if (!canceled) setExternalStatus(status);
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: { error?: string } } };
        if (!canceled) setExternalStatusError(axiosErr.response?.data?.error || formatMessageRef.current({ id: "agent.detail.loadExternalSetupStatusFailed" }));
      }
    };
    void loadExternalStatus();
    return () => {
      canceled = true;
    };
  }, [agent.id, canManageAgent, fetchExternalAgentStatus, isExternalAgent]);

  // Hosted runtime (antiproton): the provisioning record replaces the manual setup steps.
  const hostedRuntime = externalStatus?.hostedRuntime ?? agent.hostedRuntime ?? null;
  const hostedRuntimeInProgress = hostedRuntime ? describeHostedRuntime(hostedRuntime).inProgress : false;
  useEffect(() => {
    if (!isExternalAgent || !canManageAgent || !hostedRuntimeInProgress) return;
    let canceled = false;
    const timer = setInterval(() => {
      void fetchExternalAgentStatus(agent.id)
        .then((status) => { if (!canceled) setExternalStatus(status); })
        .catch(() => undefined);
    }, HOSTED_RUNTIME_POLL_MS);
    return () => {
      canceled = true;
      clearInterval(timer);
    };
  }, [agent.id, canManageAgent, fetchExternalAgentStatus, hostedRuntimeInProgress, isExternalAgent]);
  const handleRetryHostedRuntime = useCallback(async (options?: { model?: string | null }) => {
    await retryHostedRuntimeProvisioning(agent.id, options);
    setExternalStatus(await fetchExternalAgentStatus(agent.id));
  }, [agent.id, fetchExternalAgentStatus, retryHostedRuntimeProvisioning]);

  const handleCopyExternalCommand = useCallback(async (text: string, target: string) => {
    await copyTextToClipboard(text);
    setExternalCopiedTarget(target);
    window.setTimeout(() => setExternalCopiedTarget(null), 2000);
  }, []);
  const changeExternalSetupTab = useCallback((value: ExternalSetupTab) => {
    setExternalSetupTab(value);
    setExternalCopiedTarget(null);
  }, []);

  const currentOnboardingIdentityPreview = onboardingIdentityState.agentId === agent.id ? onboardingIdentityState.preview : null;
  const currentOnboardingIdentityError = onboardingIdentityState.agentId === agent.id ? onboardingIdentityState.error : "";

  const closeRuntimeConfigEditor = useCallback(() => {
    setV2EditDraft(null);
    setV2EditServerErrors({});
    setEditingRuntimeConfig(false);
    setRuntimeConfigSaveError("");
    setDraftRuntime(currentRuntimeConfig.runtime);
    setDraftModel(currentRuntimeModel);
    setDraftCustomModelMode(currentRuntimeConfig.model.kind === "custom");
    setDraftProviderMode(runtimeConfigProviderMode(currentRuntimeConfig));
    setDraftProviderApiUrl(runtimeConfigApiUrl(currentRuntimeConfig));
    setDraftProviderApiKey(runtimeConfigApiKey(currentRuntimeConfig));
    setDraftBuiltInProviderMode(runtimeConfigBuiltInProviderMode(currentRuntimeConfig));
    setDraftBuiltInProviderApiKey(runtimeConfigBuiltInProviderApiKey(currentRuntimeConfig));
    setDraftBuiltInProviderBaseUrl(runtimeConfigBuiltInProviderBaseUrl(currentRuntimeConfig));
    setDraftBuiltInProviderSupportsImageInput(runtimeConfigBuiltInProviderSupportsImageInput(currentRuntimeConfig));
    setDraftLoadLocalPlugins(currentRuntimeConfig.runtime === "builtin" && currentRuntimeConfig.loadLocalPlugins === true);
    setDraftProviderConnectionId(currentProviderConnectionId);
    setDraftPiProviderMode(runtimeConfigPiProviderMode(currentRuntimeConfig));
    setDraftPiProviderApiKey(runtimeConfigPiProviderApiKey(currentRuntimeConfig));
    setDraftFastMode(runtimeConfigFastMode(currentRuntimeConfig));
    setDraftCommand(runtimeConfigCommand(currentRuntimeConfig));
    setDraftEnvVarEntries(
      currentRuntimeConfig.envVars
        ? Object.entries(currentRuntimeConfig.envVars).map(([key, value]) => ({ key, value }))
        : [],
    );
    setRuntimeConfigAdvancedOpen(false);
    setDraftReasoningEffort(currentRuntimeConfig.reasoningEffort ?? null);
  }, [currentRuntimeConfig, currentRuntimeModel, currentProviderConnectionId]);

  const requestConfirm = useCallback((config: PendingConfirm) => {
    closeRuntimeConfigEditor();
    setPendingConfirm(config);
  }, [closeRuntimeConfigEditor]);
  const closePendingConfirm = useCallback(() => setPendingConfirm(null), []);

  const handleAdoptOnboardingIdentity = useCallback(() => {
    const onboardingIdentityPreview = currentOnboardingIdentityPreview;
    if (!onboardingIdentityPreview || onboardingIdentityPreview.changes.length === 0) return;
    const formatIdentityValue = (value: string | null) => value && value.trim()
      ? value
      : formatMessage({ id: "agent.detail.blank" });
    const grantsServerAdmin = onboardingIdentityPreview.changes.some(
      (change) => change.field === "serverRole" && change.after === "admin",
    );
    requestConfirm({
      title: grantsServerAdmin
        ? formatMessage({ id: "agent.detail.updateIdentityAndAdminRole" })
        : formatMessage({ id: "agent.detail.updateOfficialIdentity" }),
      message: (
        <div className="space-y-4">
          <p className="text-subhead text-foreground-muted">
            {formatMessage({ id: "agent.detail.reviewOfficialIdentityChanges" })}
          </p>
          <dl>
            {onboardingIdentityPreview.changes.map((change, index) => (
              <div
                key={change.field}
                data-onboarding-identity-change={change.field}
                className="grid grid-cols-[96px_minmax(0,1fr)] items-baseline gap-3 pb-3 last:pb-0"
              >
                {index > 0 ? <Separator className="col-span-full" /> : null}
                <dt className="text-footnote font-medium text-foreground-hint">{change.label}</dt>
                <dd className="flex min-w-0 items-center gap-2 text-callout">
                  <span className="min-w-0 break-words text-foreground-hint">{formatIdentityValue(change.before)}</span>
                  <MoveRight aria-hidden="true" size={16} className="shrink-0 text-foreground-hint" />
                  <span className="min-w-0 break-words font-semibold text-foreground">{formatIdentityValue(change.after)}</span>
                </dd>
              </div>
            ))}
          </dl>
          {grantsServerAdmin && (
            <Banner intent="warning" withIcon>
              {formatMessage({ id: "agent.detail.grantsAdminWarning" })}
            </Banner>
          )}
          <p className="text-caption text-foreground-hint">{formatMessage({ id: "agent.detail.customizeAfterIdentityUpdate" })}</p>
        </div>
      ),
      confirmLabel: grantsServerAdmin
        ? formatMessage({ id: "agent.detail.updateIdentityAndRole" })
        : formatMessage({ id: "agent.detail.updateIdentity" }),
      loadingLabel: formatMessage({ id: "agent.detail.updating" }),
      confirmVariant: "primary",
      plainMessage: true,
      maxWidthClass: "max-w-md",
      onConfirm: async () => {
        const result = await adoptOnboardingIdentity(agent.id);
        setOnboardingIdentityState({ agentId: agent.id, preview: result, error: "" });
      },
    });
  }, [adoptOnboardingIdentity, agent.id, currentOnboardingIdentityPreview, formatMessage, requestConfirm]);

  const createdDate = formatDate(agent.createdAt, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const draftSupportsReasoning = REASONING_EFFORT_RUNTIMES.has(draftRuntime)
    && (draftRuntime !== "kimi-sdk" || draftSchemaBacked);
  const legacyKimiReasoningRequiresUpgrade = draftRuntime === "kimi-sdk"
    && !draftSchemaBacked
    && currentRuntimeConfig.runtime === "kimi-sdk"
    && currentRuntimeConfig.reasoningEffort !== null
    && draftModel !== currentRuntimeModel;
  const reasoningDisplayValue = draftReasoningEffort || formatMessage({ id: "agent.runtimeConfig.default" });
  const draftSupportsApiUrl = supportsRuntimeApiUrl(draftRuntime);
  const draftSupportsFastMode = supportsRuntimeFastMode(draftRuntime);
  const currentProviderApiUrl = runtimeConfigApiUrl(currentRuntimeConfig);
  const currentProviderApiKey = runtimeConfigApiKey(currentRuntimeConfig);
  const currentBuiltInProviderMode = runtimeConfigBuiltInProviderMode(currentRuntimeConfig);
  const currentBuiltInProviderApiKey = runtimeConfigBuiltInProviderApiKey(currentRuntimeConfig);
  const currentBuiltInProviderBaseUrl = runtimeConfigBuiltInProviderBaseUrl(currentRuntimeConfig);
  const currentBuiltInProviderSupportsImageInput = runtimeConfigBuiltInProviderSupportsImageInput(currentRuntimeConfig);
  const currentLoadLocalPlugins = currentRuntimeConfig.runtime === "builtin" && currentRuntimeConfig.loadLocalPlugins === true;
  const currentPiProviderMode = runtimeConfigPiProviderMode(currentRuntimeConfig);
  const currentPiProviderApiKey = runtimeConfigPiProviderApiKey(currentRuntimeConfig);
  const currentCustomModelMode = currentRuntimeConfig.model.kind === "custom";
  const currentProviderMode = runtimeConfigProviderMode(currentRuntimeConfig);
  const currentFastMode = runtimeConfigFastMode(currentRuntimeConfig);
  const currentCommand = runtimeConfigCommand(currentRuntimeConfig);
  const draftProviderApiUrlRequired = draftSupportsApiUrl && draftProviderMode === "custom";
  const draftProviderApiUrlInvalid = draftProviderApiUrlRequired
    ? !/^https?:\/\//i.test(draftProviderApiUrl.trim())
    : draftProviderApiUrl.trim().length > 0 && !/^https?:\/\//i.test(draftProviderApiUrl.trim());
  const draftProviderApiKeyInvalid = draftProviderApiUrlRequired && !draftProviderApiKey.trim();
  const draftRetainsBuiltInProviderApiKey = supportsRuntimeBuiltInProvider(draftRuntime)
    && currentRuntimeConfig.runtime === "builtin"
    && draftRuntime === "builtin"
    && draftBuiltInProviderMode === currentBuiltInProviderMode
    && (
      !isBuiltInGatewayProviderMode(draftBuiltInProviderMode)
      || draftBuiltInProviderBaseUrl.trim() === currentBuiltInProviderBaseUrl.trim()
    )
    && !draftBuiltInProviderApiKey.trim();
  const draftBuiltInProviderApiKeyInvalid = isBuiltInProviderApiKeyInvalid({
    builtInProviderSupported: supportsRuntimeBuiltInProvider(draftRuntime),
    managedConnectionActive,
    apiKey: draftBuiltInProviderApiKey,
    retainsExistingKey: draftRetainsBuiltInProviderApiKey,
  });
  const draftPiProviderApiKeyInvalid = supportsRuntimePiProvider(draftRuntime)
    && draftPiProviderMode !== PI_PROVIDER_CONFIGURED
    && !draftPiProviderApiKey.trim();
  const draftBuiltInProviderBaseUrlRequired = supportsRuntimeBuiltInProvider(draftRuntime)
    && !managedConnectionActive
    && isBuiltInGatewayProviderMode(draftBuiltInProviderMode);
  const draftBuiltInProviderBaseUrlInvalid = draftBuiltInProviderBaseUrlRequired && !/^https?:\/\//i.test(draftBuiltInProviderBaseUrl.trim());
  const draftConnectionGateway = selectedProviderConnection
    ? isBuiltInGatewayProviderMode(selectedProviderConnection.providerId)
    : false;
  const draftCustomModelInvalid = (draftCustomModelMode || draftBuiltInProviderBaseUrlRequired || draftConnectionGateway) && !draftModel.trim();
  const draftSchemaSelectedModel = draftSchemaModelSource?.options.find((option) => option.value === draftModel);
  const draftRetainsBuiltInPresetSelection =
    currentRuntimeConfig.runtime === "builtin" &&
    draftRuntime === "builtin" &&
    !isBuiltInGatewayProviderMode(currentBuiltInProviderMode) &&
    draftBuiltInProviderMode === currentBuiltInProviderMode &&
    draftModel === currentRuntimeModel &&
    !draftCustomModelMode;
  const draftSchemaEffortInvalid = draftSchemaBacked
    && draftReasoningEffort !== null
    && !(draftSchemaSelectedModel?.supportedReasoningEfforts ?? []).includes(draftReasoningEffort);
  const draftModelSourceInvalid = draftSchemaBacked
    ? !draftSchemaSelectedModel || draftSchemaEffortInvalid
    : !runtimeModelSelectionIsRunnable({
        runtime: draftRuntime,
        source: runtimeModels.source,
        model: draftModel,
        modelIgnored: runtimeIgnoresModel(draftRuntime),
        customMode: draftCustomModelMode,
        customAllowed: supportsRuntimeCustomModelName(draftRuntime),
        providerCatalog: draftRuntime === "pi" && draftPiProviderMode !== PI_PROVIDER_CONFIGURED,
        persistedModel: draftRetainsBuiltInPresetSelection ? currentRuntimeModel : undefined,
        builtInPreset:
          supportsRuntimeBuiltInProvider(draftRuntime) &&
          !draftConnectionGateway &&
          !draftBuiltInProviderBaseUrlRequired,
      });
  const draftEnvVars = useMemo(() => {
    const next: Record<string, string> = {};
    for (const entry of draftEnvVarEntries) {
      const key = entry.key.trim();
      if (key) next[key] = entry.value;
    }
    return Object.keys(next).length > 0 ? next : null;
  }, [draftEnvVarEntries]);
  const currentEnvVarsJson = JSON.stringify(currentRuntimeConfig.envVars ?? null);
  const draftEnvVarsJson = JSON.stringify(draftEnvVars);
  const runtimeConfigChanged =
    draftRuntime !== currentRuntimeConfig.runtime
    || draftModel !== currentRuntimeModel
    || draftCustomModelMode !== currentCustomModelMode
    || draftProviderMode !== currentProviderMode
    || draftProviderApiUrl.trim() !== currentProviderApiUrl
    || draftProviderApiKey.trim() !== currentProviderApiKey
    || draftBuiltInProviderMode !== currentBuiltInProviderMode
    || draftBuiltInProviderApiKey.trim() !== currentBuiltInProviderApiKey
    || draftBuiltInProviderBaseUrl.trim() !== currentBuiltInProviderBaseUrl
    || draftBuiltInProviderSupportsImageInput !== currentBuiltInProviderSupportsImageInput
    || draftLoadLocalPlugins !== currentLoadLocalPlugins
    || draftProviderConnectionId !== currentProviderConnectionId
    || draftPiProviderMode !== currentPiProviderMode
    || draftPiProviderApiKey.trim() !== currentPiProviderApiKey
    || draftFastMode !== currentFastMode
    || draftCommand.trim() !== currentCommand
    || (draftReasoningEffort ?? null) !== (currentRuntimeConfig.reasoningEffort ?? null)
    || draftEnvVarsJson !== currentEnvVarsJson;
  const runtimeConfigSaveDisabled = isRuntimeConfigSaveDisabled({
    saving: savingRuntimeConfig,
    changed: runtimeConfigChanged,
    runtimeCanSelect: draftRuntimeCanSelect,
    providerConnectionInvalid,
    providerApiUrlInvalid: draftProviderApiUrlInvalid,
    providerApiKeyInvalid: draftProviderApiKeyInvalid,
    builtInProviderApiKeyInvalid: draftBuiltInProviderApiKeyInvalid,
    piProviderApiKeyInvalid: draftPiProviderApiKeyInvalid,
    builtInProviderBaseUrlInvalid: draftBuiltInProviderBaseUrlInvalid,
    customModelInvalid: draftCustomModelInvalid,
    modelSourceInvalid: draftModelSourceInvalid || legacyKimiReasoningRequiresUpgrade,
  });
  const modelOptions = (() => {
    const options = runtimeModels.models.map((m) => ({ value: m.id, label: catalogModelLabel(useServerStore.getState().current?.id, agent.machineId, draftRuntime, m.id) ?? m.label }));
    if (runtimeModels.source.kind === "live" && !draftCustomModelMode && draftModel && !options.some((option) => option.value === draftModel)) {
      options.push({
        value: draftModel,
        label: formatMessage(
          { id: "agent.detail.modelNotInComputerConfig" },
          { model: getModelLabel(draftRuntime, draftModel) },
        ),
      });
    }
    return options;
  })();
  const draftModelInfo = runtimeModels.models.find((m) => m.id === draftModel);
  const draftModelSuggestionOnly = draftModelInfo?.verified === "suggestion_only";

  // Change the drafted model and reconcile reasoning against the new model's
  // declared supportedReasoningEfforts (e.g. switching to GPT-5.6 luna drops an
  // Ultra selection down to Medium).
  const runtimeModelList = runtimeModels.models;
  const changeDraftModel = useCallback((nextModel: string) => {
    setDraftModel(nextModel);
    if (draftRuntime !== "kimi-sdk") {
      setDraftReasoningEffort((prev) => reconcileReasoningEffort(
        draftRuntime,
        nextModel,
        prev as ReasoningEffort | null,
        runtimeModelList,
      ));
    }
  }, [draftRuntime, runtimeModelList]);

  const startRuntimeConfigEditing = () => {
    setRuntimeConfigSaveError("");
    setDraftRuntime(currentRuntimeConfig.runtime);
    setDraftModel(currentRuntimeModel);
    setDraftCustomModelMode(currentRuntimeConfig.model.kind === "custom");
    setDraftProviderMode(runtimeConfigProviderMode(currentRuntimeConfig));
    setDraftProviderApiUrl(runtimeConfigApiUrl(currentRuntimeConfig));
    setDraftProviderApiKey(runtimeConfigApiKey(currentRuntimeConfig));
    setDraftBuiltInProviderMode(runtimeConfigBuiltInProviderMode(currentRuntimeConfig));
    setDraftBuiltInProviderApiKey(runtimeConfigBuiltInProviderApiKey(currentRuntimeConfig));
    setDraftBuiltInProviderBaseUrl(runtimeConfigBuiltInProviderBaseUrl(currentRuntimeConfig));
    setDraftBuiltInProviderSupportsImageInput(runtimeConfigBuiltInProviderSupportsImageInput(currentRuntimeConfig));
    setDraftLoadLocalPlugins(currentRuntimeConfig.runtime === "builtin" && currentRuntimeConfig.loadLocalPlugins === true);
    setDraftProviderConnectionId(currentProviderConnectionId);
    setDraftPiProviderMode(runtimeConfigPiProviderMode(currentRuntimeConfig));
    setDraftPiProviderApiKey(runtimeConfigPiProviderApiKey(currentRuntimeConfig));
    setDraftFastMode(runtimeConfigFastMode(currentRuntimeConfig));
    setDraftCommand(runtimeConfigCommand(currentRuntimeConfig));
    setDraftEnvVarEntries(
      currentRuntimeConfig.envVars
        ? Object.entries(currentRuntimeConfig.envVars).map(([key, value]) => ({ key, value }))
        : [],
    );
    setRuntimeConfigAdvancedOpen(false);
    setDraftReasoningEffort(currentRuntimeConfig.reasoningEffort ?? null);
    setEditingRuntimeConfig(true);
  };

  const changeDraftProviderConnection = useCallback((connection: ProviderConnectionSummary | null) => {
    setDraftProviderConnectionId(connection?.id ?? "");
    if (!connection) {
      if (draftProviderConnectionId) {
        setDraftBuiltInProviderApiKey("");
        setDraftBuiltInProviderBaseUrl("");
        setDraftBuiltInProviderSupportsImageInput(false);
      }
      return;
    }
    setDraftBuiltInProviderApiKey("");
    setDraftBuiltInProviderBaseUrl(connection.endpointUrl ?? "");
    setDraftBuiltInProviderSupportsImageInput(connection.supportsImageInput === true);
    setDraftBuiltInProviderMode(connection.providerId);
    const nextModel = reconcileBuiltInProviderModelSelection({
      providerId: connection.providerId,
      currentModel: draftModel,
    });
    setDraftModel(nextModel.model);
    setDraftCustomModelMode(nextModel.customModelMode);
  }, [draftModel, draftProviderConnectionId]);

  const changeDraftRuntime = useCallback((id: string) => {
    setDraftRuntime(id);
    const nextModel = getDefaultModel(id);
    setDraftModel(nextModel);
    setDraftCustomModelMode(false);
    setDraftProviderMode("default");
    setDraftProviderApiUrl("");
    setDraftProviderApiKey("");
    setDraftBuiltInProviderMode(BUILTIN_RUNTIME_DEFAULT_PROVIDER_ID);
    setDraftBuiltInProviderApiKey("");
    setDraftBuiltInProviderBaseUrl("");
    setDraftBuiltInProviderSupportsImageInput(false);
    setDraftLoadLocalPlugins(false);
    setDraftProviderConnectionId("");
    setDraftPiProviderMode(PI_PROVIDER_CONFIGURED);
    setDraftPiProviderApiKey("");
    setDraftFastMode(false);
    setDraftCommand("");
    if (!REASONING_EFFORT_RUNTIMES.has(id)) {
      setDraftReasoningEffort(null);
    } else {
      setDraftReasoningEffort(reconcileReasoningEffort(id, nextModel, null));
    }
  }, []);

  const changeDraftBuiltInProviderMode = useCallback((next: BuiltInProviderMode) => {
    setDraftBuiltInProviderMode(next);
    setDraftBuiltInProviderSupportsImageInput(false);
    setDraftLoadLocalPlugins(false);
    if (isBuiltInGatewayProviderMode(next)) {
      setDraftModel("");
      setDraftCustomModelMode(true);
      return;
    }
    setDraftBuiltInProviderBaseUrl("");
    const defaultModel = builtInProviderDefaultModel(next);
    if (defaultModel) {
      setDraftModel(defaultModel);
      setDraftCustomModelMode(false);
    }
  }, []);

  const changeDraftPiProviderMode = useCallback((next: PiProviderMode) => {
    setDraftPiProviderMode(next);
    // Switching to a builtin provider locks the Model picker
    // to that provider's SDK first-class set; reset draftModel
    // to the provider's default so the picker shows a valid
    // value.
    if (next !== PI_PROVIDER_CONFIGURED) {
      const defaultModel = piBuiltinProviderDefaultModel(next);
      if (defaultModel) {
        setDraftModel(defaultModel);
        setDraftCustomModelMode(false);
      }
    }
  }, []);

  const runtimeFormV2EditProps = useMemo(() => v2EditActive ? {
    state: runtimeFormV2Edit,
    values: v2EditValues,
    onChange: changeV2EditValue,
    serverErrors: v2EditServerErrors,
    editing: true,
  } : undefined, [changeV2EditValue, runtimeFormV2Edit, v2EditActive, v2EditServerErrors, v2EditValues]);

  const closeRoleHelp = useCallback(() => setShowRoleHelp(false), []);
  const closeEditingProviderConnection = useCallback(() => setEditingProviderConnection(null), []);
  const refreshProviderConnections = providerConnectionCatalog.refresh;
  const completeEditingProviderConnection = useCallback(async () => {
    setEditingProviderConnection(null);
    await refreshProviderConnections();
  }, [refreshProviderConnections]);

  const saveRuntimeConfiguration = async (
    nextConfig: {
      runtime: string;
      model: string;
      runtimeConfig: RuntimeConfig;
      reasoningEffort?: ReasoningEffort | null;
      formDefinitionRef?: RuntimeFormDefinitionRef;
    },
    restartMode?: "restart" | "session",
  ) => {
    await updateAgent(
      agent.id,
      {
        runtime: nextConfig.runtime,
        model: nextConfig.model,
        runtimeConfig: nextConfig.runtimeConfig,
        ...(nextConfig.reasoningEffort !== undefined
          ? { reasoningEffort: nextConfig.reasoningEffort }
          : {}),
        ...(nextConfig.formDefinitionRef ? { formDefinitionRef: nextConfig.formDefinitionRef } : {}),
      },
      restartMode ? { restartMode } : undefined,
    );
  };

  const saveRuntimeFormV2Edit = async () => {
    if (runtimeFormV2Edit.status !== "ready" || !v2EditValues) return;
    if (!v2EditChanged) {
      closeRuntimeConfigEditor();
      return;
    }
    const { form, sources } = runtimeFormV2Edit;
    // Field errors are already shown beside the fields; nothing to send yet.
    if (Object.keys(validateRuntimeFormV2(form, sources, v2EditValues, { editing: true })).length > 0) return;
    const fields = {
      formDefinitionRef: { protocolVersion: 2 as const, runtimeId: draftRuntime },
      formValues: runtimeFormV2Submission(form, v2EditValues, sources),
    };
    const save = async (restartMode?: "restart") => {
      try {
        await updateAgent(agent.id, fields, restartMode ? { restartMode } : undefined);
        setV2EditDraft(null);
      } catch (err: unknown) {
        const data = (err as { response?: { data?: { error?: string; issues?: Array<{ pointer?: string }> } } }).response?.data;
        const fieldErrors: Record<string, string> = {};
        for (const issue of data?.issues ?? []) {
          const key = issue.pointer?.startsWith("/formValues/") ? issue.pointer.slice("/formValues/".length) : "";
          if (key) fieldErrors[key] = data?.error ?? "";
        }
        setV2EditServerErrors(fieldErrors);
        setRuntimeConfigSaveError(data?.error ?? formatMessage({ id: "agent.detail.runtimeConfigInvalid" }));
        throw err;
      }
    };
    if (!isActive) {
      setSavingRuntimeConfig(true);
      try {
        await save();
        closeRuntimeConfigEditor();
      } catch {
        // Shown beside the fields and in the banner.
      } finally {
        setSavingRuntimeConfig(false);
      }
      return;
    }
    const changedLabels = form.fields
      .filter((field) => JSON.stringify(v2EditValues[field.key]) !== JSON.stringify(v2EditInitial?.[field.key]))
      .map((field) => field.label);
    requestConfirm({
      title: formatMessage({ id: "agent.detail.restartToApplyRuntimeConfig" }),
      message: formatMessage(
        { id: "agent.detail.restartToApplyRuntimeConfigMessage" },
        {
          changes: formatList(changedLabels, { type: "conjunction" }),
          model: typeof v2EditValues.model === "string" ? getModelLabel(draftRuntime, v2EditValues.model) : "",
          reasoning: "",
          mode: "",
        },
      ),
      confirmLabel: formatMessage({ id: "agent.detail.restartAgent" }),
      loadingLabel: formatMessage({ id: "machine.detail.restarting" }),
      confirmVariant: "warning",
      onConfirm: async () => {
        await save("restart");
      },
    });
  };

  const handleSaveRuntimeConfiguration = async () => {
    setRuntimeConfigSaveError("");
    if (v2EditActive) {
      await saveRuntimeFormV2Edit();
      return;
    }
    if (!runtimeConfigChanged) {
      closeRuntimeConfigEditor();
      return;
    }

    if (runtimeConfigSaveDisabled) return;

    const currentRuntime = currentRuntimeConfig.runtime;
    const runtimeChanged = draftRuntime !== currentRuntime;
    const modelChanged = draftModel !== currentRuntimeModel;
    const customModelModeChanged = draftCustomModelMode !== currentCustomModelMode;
    const providerChanged = draftProviderMode !== currentProviderMode
      || draftProviderApiUrl.trim() !== currentProviderApiUrl
      || draftProviderApiKey.trim() !== currentProviderApiKey
      || draftBuiltInProviderMode !== currentBuiltInProviderMode
      || draftBuiltInProviderApiKey.trim() !== currentBuiltInProviderApiKey
      || draftBuiltInProviderBaseUrl.trim() !== currentBuiltInProviderBaseUrl
      || draftBuiltInProviderSupportsImageInput !== currentBuiltInProviderSupportsImageInput
      || draftProviderConnectionId !== currentProviderConnectionId
      || draftPiProviderMode !== currentPiProviderMode
      || draftPiProviderApiKey.trim() !== currentPiProviderApiKey;
    const fastModeChanged = draftFastMode !== currentFastMode;
    const commandChanged = draftCommand.trim() !== currentCommand;
    const reasoningChanged = (draftReasoningEffort ?? null) !== (currentRuntimeConfig.reasoningEffort ?? null);
    const envVarsChanged = draftEnvVarsJson !== currentEnvVarsJson;
    const nextReasoningLabel = draftSupportsReasoning
      ? reasoningDisplayValue
      : formatMessage({ id: "agent.detail.notAvailable" });
    const nextModeLabel = draftSupportsFastMode && draftFastMode
      ? formatMessage({ id: "agent.detail.inFastMode" })
      : "";
    let nextRuntimeConfig: RuntimeConfig;
    try {
      const builtRuntimeConfig = draftSchemaBacked && draftFormDefinition
        ? buildSchemaDrivenKimiConfig({
            definition: draftFormDefinition,
            model: draftModel,
            reasoningEffort: draftReasoningEffort,
            envVars: draftEnvVars,
          })
        : managedConnectionActive && selectedProviderConnection
        ? buildManagedConnectionRuntimeConfig({
            loadLocalPlugins: draftLoadLocalPlugins,
            connectionId: selectedProviderConnection.id,
            providerId: selectedProviderConnection.providerId,
            model: draftModel,
            envVars: draftEnvVars,
          })
        : buildRuntimeConfig({
        runtime: draftRuntime,
        model: draftModel,
        customModelMode: draftCustomModelMode,
        customModelName: draftCustomModelMode ? draftModel : undefined,
        providerMode: draftProviderMode,
        providerApiUrl: draftProviderApiUrl,
        providerApiKey: draftProviderApiKey,
        builtInProviderMode: draftBuiltInProviderMode,
        // A placeholder only satisfies the local pure builder. It is removed
        // from the request immediately below; the server alone retains the
        // existing writeOnly value after checking provider identity.
        builtInProviderApiKey: draftRetainsBuiltInProviderApiKey
          ? "retained-by-server"
          : draftBuiltInProviderApiKey,
        builtInProviderBaseUrl: draftBuiltInProviderBaseUrl,
        builtInProviderSupportsImageInput: draftBuiltInProviderSupportsImageInput,
        loadLocalPlugins: draftLoadLocalPlugins,
        piProviderMode: draftPiProviderMode,
        piProviderApiKey: draftPiProviderApiKey,
        fastMode: draftSupportsFastMode ? draftFastMode : false,
        reasoningEffort: draftSupportsReasoning ? draftReasoningEffort as ReasoningEffort | null : null,
        envVars: draftEnvVars,
        command: draftCommand,
          });
      const legacyCompatibleRuntimeConfig = draftRuntime === "kimi-sdk" && !draftSchemaBacked
        ? (() => {
            const { reasoningEffort: _unmanagedReasoningEffort, ...configWithoutReasoningEffort } = builtRuntimeConfig;
            return configWithoutReasoningEffort as RuntimeConfig;
          })()
        : builtRuntimeConfig;
      if (
        draftRetainsBuiltInProviderApiKey
        && legacyCompatibleRuntimeConfig.runtime === "builtin"
        && legacyCompatibleRuntimeConfig.provider.kind !== "connection"
      ) {
        const { apiKey: _writeOnly, ...providerWithoutSecret } = legacyCompatibleRuntimeConfig.provider;
        nextRuntimeConfig = {
          ...legacyCompatibleRuntimeConfig,
          provider: providerWithoutSecret,
        } as RuntimeConfig;
      } else {
        nextRuntimeConfig = legacyCompatibleRuntimeConfig;
      }
    } catch (error: unknown) {
      setRuntimeConfigSaveError(
        error instanceof RuntimeConfigBuildError
          ? formatRuntimeConfigBuildError(error, formatMessage)
          : formatMessage({ id: "agent.detail.runtimeConfigInvalid" }),
      );
      return;
    }
    const nextConfig = {
      runtime: draftRuntime,
      model: draftModel,
      runtimeConfig: nextRuntimeConfig,
      reasoningEffort: draftRuntime === "kimi-sdk"
        ? draftSchemaBacked ? null : undefined
        : draftSupportsReasoning ? draftReasoningEffort as ReasoningEffort | null : null,
      ...(draftSchemaBacked && draftFormDefinitionRef
        ? { formDefinitionRef: draftFormDefinitionRef }
        : {}),
    };

    if (runtimeChanged) {
      const fromRuntimeLabel = getRuntimeDisplayName(currentRuntime);
      const nextRuntimeLabel = getRuntimeDisplayName(draftRuntime);
      const nextModelLabel = getModelLabel(draftRuntime, draftModel);
      requestConfirm({
        title: formatMessage({ id: "agent.detail.switchRuntimeConfig" }),
        message: isActive
          ? formatMessage(
              { id: "agent.detail.switchRuntimeActiveMessage" },
              { from: fromRuntimeLabel, to: nextRuntimeLabel, model: nextModelLabel, reasoning: draftSupportsReasoning ? nextReasoningLabel : "", mode: nextModeLabel },
            )
          : formatMessage(
              { id: "agent.detail.switchRuntimeInactiveMessage" },
              { from: fromRuntimeLabel, to: nextRuntimeLabel, model: nextModelLabel, reasoning: draftSupportsReasoning ? nextReasoningLabel : "", mode: nextModeLabel },
            ),
        confirmLabel: isActive
          ? formatMessage({ id: "agent.detail.resetRuntimeSession" })
          : formatMessage({ id: "agent.detail.saveRuntimeChange" }),
        loadingLabel: isActive
          ? formatMessage({ id: "agent.detail.resetting" })
          : formatMessage({ id: "agent.detail.applying" }),
        confirmVariant: "warning",
        onConfirm: async () => {
          await saveRuntimeConfiguration(nextConfig, "session");
        },
      });
      return;
    }

    if (!isActive) {
      setSavingRuntimeConfig(true);
      try {
        await saveRuntimeConfiguration(nextConfig);
        closeRuntimeConfigEditor();
      } finally {
        setSavingRuntimeConfig(false);
      }
      return;
    }

    // tygg/Tenny 2026-07-10: a Codex model switch resets the native runtime
    // session (Codex `thread/resume` pins the resumed thread's model, so a plain
    // restart keeps the old model — root of the 5.5→5.6 switch-not-applying
    // report). Warn about the session/context reset and save as "session". A
    // reasoning-effort-only change falls through to the restart branch below
    // (context preserved). Codex-scoped; model+effort together reset once here.
    if (draftRuntime === "codex" && (modelChanged || customModelModeChanged)) {
      requestConfirm({
        title: formatMessage({ id: "agent.detail.switchModelResetSession" }),
        message: formatMessage(
          { id: "agent.detail.switchModelResetMessage" },
          // "none" (not "") is the ICU select sentinel: an empty string does not
          // match a select key, so `reasoning: ""` renders the empty parenthetical
          // "( reasoning)". Same pattern as migration.error.bundleTooLarge.
          { model: getModelLabel(draftRuntime, draftModel), reasoning: draftSupportsReasoning ? nextReasoningLabel : "none" },
        ),
        confirmLabel: formatMessage({ id: "agent.detail.reset" }),
        loadingLabel: formatMessage({ id: "agent.detail.resetting" }),
        confirmVariant: "warning",
        onConfirm: async () => {
          await saveRuntimeConfiguration(nextConfig, "session");
        },
      });
      return;
    }

    const changeLabels: string[] = [];
    if (modelChanged || customModelModeChanged) changeLabels.push(formatMessage({ id: "agent.runtimeConfig.model" }));
    if (providerChanged) changeLabels.push(formatMessage({ id: "agent.runtimeConfig.provider" }));
    if (draftLoadLocalPlugins !== currentLoadLocalPlugins) changeLabels.push(formatMessage({ id: "agent.runtimeConfig.loadLocalPlugins" }));
    if (fastModeChanged) changeLabels.push(formatMessage({ id: "agent.runtimeConfig.mode" }));
    if (commandChanged) changeLabels.push(formatMessage({ id: "agent.runtimeConfig.command" }));
    if (reasoningChanged) changeLabels.push(formatMessage({ id: "agent.runtimeConfig.reasoning" }));
    if (envVarsChanged) changeLabels.push(formatMessage({ id: "agent.runtimeConfig.envVars" }));
    const changeSummary = formatList(changeLabels, { type: "conjunction" });
    requestConfirm({
      title: formatMessage({ id: "agent.detail.restartToApplyRuntimeConfig" }),
      message: formatMessage(
        { id: "agent.detail.restartToApplyRuntimeConfigMessage" },
        { changes: changeSummary, model: getModelLabel(draftRuntime, draftModel), reasoning: draftSupportsReasoning ? nextReasoningLabel : "", mode: nextModeLabel },
      ),
      confirmLabel: formatMessage({ id: "agent.detail.restartAgent" }),
      loadingLabel: formatMessage({ id: "machine.detail.restarting" }),
      confirmVariant: "warning",
      onConfirm: async () => {
        await saveRuntimeConfiguration(nextConfig, "restart");
      },
    });
  };

  return (
    <>
      {/* Onboarding identity adoption. The display name itself is edited in the
          profile header (AgentHeaderName), which shows the same value. */}
      {(currentOnboardingIdentityPreview?.canAdopt || currentOnboardingIdentityError) && (
        <div className="px-5 pt-4">
          {currentOnboardingIdentityPreview?.canAdopt && (
            <Button variant="accent" size="sm"
              type="button"
              onClick={handleAdoptOnboardingIdentity}
            >
              {formatMessage({ id: "agent.detail.updateOfficialIdentity" })}
            </Button>
          )}
          {currentOnboardingIdentityError && (
            <div className="mt-2 text-footnote font-semibold text-warning-strong">{currentOnboardingIdentityError}</div>
          )}
        </div>
      )}

      {/* Description */}
      <div className="px-5 py-3">
        <div className="flex items-center gap-2 mb-1">
          <SectionEyebrow as="div">
            {formatMessage({ id: "machine.detail.description" })}
          </SectionEyebrow>
          {canManageAgent && onEdit && (
            <Tooltip content={formatMessage({ id: "agent.detail.editDescription" })}>
              <button
                type="button"
                aria-label={formatMessage({ id: "agent.detail.editDescription" })}
                onClick={() => onEdit("description")}
                className={INFO_ICON_BUTTON_CLASS}
              >
                <Pencil size={14} />
              </button>
            </Tooltip>
          )}
        </div>
        <p className="text-subhead text-foreground">
          {agent.description || (
            <span className="text-foreground-hint">{formatMessage({ id: "machine.detail.noDescription" })}</span>
          )}
        </p>
      </div>

      {showOperationalInfo && isExternalAgent && canManageAgent && (
        <>
        <Separator />
        <div className="px-5 py-4">
          <SectionEyebrow as="div" className="mb-2">
            {formatMessage({ id: "agent.detail.externalSetup" })}
          </SectionEyebrow>
          <Card className="block space-y-3 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                appearance="soft"
                variant={externalStatus?.setupState === "connected" ? "success" : externalStatus?.setupState === "credential_minted" ? "information" : "muted"}
              >
                <StatusDot
                  presence={externalStatus?.setupState === "connected" ? "online" : externalStatus?.setupState === "credential_minted" ? "external" : "offline"}
                  className="shrink-0"
                />
                {externalStatus?.setupState === "connected"
                  ? formatMessage({ id: "machine.detail.connected" })
                  : externalStatus?.setupState === "credential_minted"
                    ? formatMessage({ id: "agent.detail.credentialMinted" })
                    : formatMessage({ id: "agent.detail.waitingForLogin" })}
              </Badge>
              {externalStatus?.credentialLastUsedAt && (
                <span className="font-mono text-mono-meta text-foreground-hint">
                  {formatMessage(
                    { id: "agent.detail.lastUsed" },
                    { time: formatShortDateTime(externalStatus.credentialLastUsedAt) },
                  )}
                </span>
              )}
            </div>
            {hostedRuntime ? (
              <HostedRuntimeStatus summary={hostedRuntime} onRetry={handleRetryHostedRuntime} />
            ) : (<>
            {(capabilities.issueAgentCredentials || (agent.creatorType === "user" && agent.creatorId === currentUserId)) && (
              <ExternalAgentToken key={agent.id} agentId={agent.id} />
            )}
            <ExternalSetupTabSegmentedControl
              value={effectiveExternalSetupTab}
              onValueChange={changeExternalSetupTab}
            />
            {externalStepSetupSteps ? (
              <div className="space-y-3">
                <p className="text-footnote font-semibold text-foreground-muted">
                    {formatMessage({ id: "agent.detail.runStepsInTerminal" })}
                </p>
                <ol className="space-y-4">
                  {externalStepSetupSteps.map((step, idx) => {
                    const copyTarget = `${effectiveExternalSetupTab}-step-${idx + 1}`;
                    return (
                      <li key={step.title} className="space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <SectionEyebrow>
                            {formatMessage({ id: "agent.detail.stepNumber" }, { step: idx + 1 })}
                          </SectionEyebrow>
                          <ExternalSetupCopyButton text={step.command} target={copyTarget} onCopy={handleCopyExternalCommand}>
                            {externalCopiedTarget === copyTarget
                              ? formatMessage({ id: "agent.detail.copied" })
                              : formatMessage({ id: "agent.detail.copyStep" })}
                          </ExternalSetupCopyButton>
                        </div>
                        <p className="text-callout font-semibold text-foreground">{step.title}</p>
                        <div className="break-all rounded-control border border-line-hairline bg-layer-code px-3 py-2 font-mono text-mono-code text-foreground whitespace-pre-wrap">
                          {step.command}
                        </div>
                        {step.description && (
                          <p className="text-caption text-foreground-hint">{step.description}</p>
                        )}
                      </li>
                    );
                  })}
                </ol>
                <p className="text-caption text-foreground-hint">
                    {formatMessage({ id: "agent.detail.raftProfileRequired" })}
                </p>
                {effectiveExternalSetupTab === "claude-code" ? (
                  <p className="text-caption text-foreground-hint">
                    {formatMessage({ id: "agent.detail.claudeCodeKeepRunning" })}
                  </p>
                ) : effectiveExternalSetupTab === "hermes" ? (
                  <p className="text-caption text-foreground-hint">
                    {formatMessage({ id: "agent.detail.hermesGatewayDescription" })}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="break-all rounded-container border border-line-hairline bg-layer-code px-3 py-2 font-mono text-mono-code text-foreground whitespace-pre-wrap">
                  {externalOtherSetupInstruction}
                </div>
                <p className="text-caption text-foreground-hint">
                      {formatMessage({ id: "agent.detail.otherAgentRuntimeDescription" })}
                </p>
              </div>
            )}
            </>)}
            <div className="flex flex-wrap items-center gap-2">
              {!hostedRuntime && effectiveExternalSetupTab === "other-agents" && (
                <ExternalSetupCopyButton text={externalSetupInstruction} target="setup" onCopy={handleCopyExternalCommand}>
                  {externalCopiedTarget === "setup"
                    ? formatMessage({ id: "agent.detail.copied" })
                    : formatMessage({ id: "agent.detail.copySetup" })}
                </ExternalSetupCopyButton>
              )}
              {externalStatusError && (
                <span className="text-footnote font-semibold text-warning-strong">{externalStatusError}</span>
              )}
            </div>
          </Card>
        </div>
        </>
      )}

      {showOperationalInfo && isExternalAgent && canManageAgent && hostedRuntime?.state === "active" && (
        <>
          <AgentHostedRuntimeModel key={`model-${agent.id}`} agentId={agent.id} />
          <AgentConnections key={agent.id} agentId={agent.id} />
          <AgentHostedRuntimeUsage key={`usage-${agent.id}`} agentId={agent.id} />
        </>
      )}

      {showOperationalInfo && (
        <>
          {/* Info */}
          <Separator />
          <div className="px-5 py-4">
            <SectionEyebrow as="div" className="mb-3">
              {formatMessage({ id: "machine.detail.info" })}
            </SectionEyebrow>
            <DescriptionList direction="horizontal">
              {/* Role */}
              <InfoRow
                label={formatMessage({ id: "agent.detail.role" })}
                actions={
                  <>
                    <Tooltip content={formatMessage({ id: "agent.detail.rolePermissions" })}>
                      <button type="button" onClick={() => setShowRoleHelp(true)} className={INFO_ICON_BUTTON_CLASS}>
                        <HelpCircle size={14} />
                      </button>
                    </Tooltip>
                    {canEditServerRole && onEdit && (
                      <Tooltip content={formatMessage({ id: "agent.detail.editRole" })}>
                        <button
                          type="button"
                          aria-label={formatMessage({ id: "agent.detail.editRole" })}
                          onClick={() => onEdit("role")}
                          className={INFO_ICON_BUTTON_CLASS}
                        >
                          <Pencil size={14} />
                        </button>
                      </Tooltip>
                    )}
                  </>
                }
              >
                {currentAgentServerRoleInfo ? (
                  <span>{formatMessage({ id: currentAgentServerRoleInfo.labelId })}</span>
                ) : serverRoleDisplay.kind === "unrecognized" ? (
                  <Tooltip content={agent.serverRole ?? ""}>
                    <span className="min-w-0 truncate">{serverRoleDisplay.label}</span>
                  </Tooltip>
                ) : null}
              </InfoRow>
              {/* Computer: name, connection and version each get a row, so a long
                  (wrapping) computer name never has the status wedged into it. */}
              <InfoRow label={formatMessage({ id: "machine.detail.computer" })}>
                {isExternalAgent ? (
                  <span className="text-foreground-muted">{formatMessage({ id: "agent.detail.externalRuntime" })}</span>
                ) : agentMachineRow.kind === "pending" ? null : agentMachine ? (
                  // Long names truncate; the full name shows on hover.
                  <Tooltip content={agentMachine.name}>
                    <button
                      onClick={() => { useProfileStore.getState().closeProfile(); useThreadStore.getState().closeThread(); nav.toMachine(agentMachine.id); }}
                      className="block max-w-full truncate text-left font-mono text-foreground hover:underline"
                    >
                      {agentMachine.name}
                    </button>
                  </Tooltip>
                ) : archivedMachineName ? (
                  // An archived agent has no Computer; say where it last ran.
                  <span className="text-foreground-muted" data-testid="agent-archived-last-computer">
                    {formatMessage({ id: "agent.detail.lastComputer" }, { name: archivedMachineName })}
                  </span>
                ) : (
                  <span className="text-foreground-hint">
                    {formatMessage({ id: "agent.detail.noComputerAssigned" })}
                  </span>
                )}
              </InfoRow>
              {!isExternalAgent && agentMachine && (
                <>
                  {/* "Computer status", not "Status": the header already shows the agent's own
                      activity, and these are two different things. */}
                  <InfoRow label={formatMessage({ id: "agent.detail.computerStatus" })} testId="agent-computer-connection">
                    <span className="flex items-center gap-1.5">
                      <StatusDot
                        presence={machineStatus === "online" ? "online" : "offline"}
                        className="shrink-0"
                      />
                      {machineStatus === "online"
                        ? formatMessage({ id: "machine.detail.connected" })
                        : formatMessage({ id: "machine.detail.offline" })}
                    </span>
                  </InfoRow>
                  <InfoRow label={formatMessage({ id: "machine.detail.computerVersion" })} testId="agent-computer-version">
                    <span className="font-mono"><MachineRunLabel machine={agentMachine} /></span>
                  </InfoRow>
                </>
              )}
              {/* Created */}
              <InfoRow label={formatMessage({ id: "machine.detail.created" })}>
                <span className="font-mono">{createdDate}</span>
              </InfoRow>
              {/* Creator */}
              <InfoRow label={formatMessage({ id: "agent.detail.creator" })}>
                {agent.creator ? (
                  <Tooltip content={agent.creator.displayName || agent.creator.name}>
                  <button
                    type="button"
                    onClick={() => {
                      const type = agent.creator!.type === "human" ? "human" : "agent";
                      (onOpenProfile ?? openProfile)(type, agent.creator!.id);
                    }}
                    className="flex max-w-full items-center gap-2 text-left hover:underline"
                  >
                    {agent.creator.type === "human" ? (
                      <AvatarSlot
                        context="creator-link"
                        type="human"
                        humanAvatarUrl={agent.creator.avatarUrl}
                        gravatarHash={agent.creator.gravatarHash}
                      />
                    ) : (
                      <AvatarSlot
                        context="creator-link"
                        type="agent"
                        agentAvatarUrl={agent.creator.avatarUrl}
                      />
                    )}
                    <span className="min-w-0 truncate">{agent.creator.displayName || agent.creator.name}</span>
                    <span className="min-w-0 flex-1 max-w-fit truncate font-mono text-mono-meta text-foreground-hint">@{agent.creator.name}</span>
                  </button>
                  </Tooltip>
                ) : (
                  <span className="text-foreground-hint">
                    {formatMessage({ id: "agent.detail.noCreatorAssigned" })}
                  </span>
                )}
              </InfoRow>
            </DescriptionList>
          </div>

          {!isExternalAgent && (
            <>
            <Separator />
            <div ref={configRef} className="px-5 py-4">
              <div className="w-full">
                <div className="flex items-center gap-2 mb-3">
                  <SectionEyebrow as="div">
                    {formatMessage({ id: "agent.detail.runtimeConfig" })}
                  </SectionEyebrow>
                  {canManageAgent && !editingRuntimeConfig && (
                    <Tooltip content={formatMessage({ id: "agent.detail.editRuntimeConfig" })}>
                    <button
                      type="button"
                      aria-label={formatMessage({ id: "agent.detail.editRuntimeConfig" })}
                      onClick={startRuntimeConfigEditing}
                      className={INFO_ICON_BUTTON_CLASS}
                    >
                      <Pencil size={14} />
                    </button>
                    </Tooltip>
                  )}
                </div>
                {/* Vertical label | value rows (same as Info); values keep their original styling. */}
                <DescriptionList direction="horizontal">
                  <InfoRow label={formatMessage({ id: "agent.runtimeConfig.runtime" })}>
                    <RuntimeAccountUsageGateChip
                        enabled={canViewRuntimeAccountUsage}
                        runtimeId={currentRuntimeConfig.runtime}
                        runtimeVersion={agentMachine?.runtimeVersions?.[currentRuntimeConfig.runtime]}
                        serverId={currentServer?.id ?? null}
                        machineId={agentMachine?.id ?? ""}
                        appearance="soft"
                        variant="information"
                        className={RUNTIME_CHIP_CLASS}
                      >
                        {/* A plain string child: the usage chip derives its accessible
                            name from it, so the cpu icon lives on the hero chip only. */}
                        {formatRuntimeLabelWithStatus(currentRuntimeConfig.runtime, formatMessage)}
                      </RuntimeAccountUsageGateChip>
                  </InfoRow>
                  {currentRuntimeDeprecated && (
                    <Banner intent="warning" density="sm" className="col-span-full my-1">
                      {formatMessage({ id: "agent.detail.deprecatedRuntimeWarning" })}
                    </Banner>
                  )}
                  <InfoRow label={formatMessage({ id: "agent.runtimeConfig.model" })}>
                    <span className="min-w-0 break-all font-mono">{currentRuntimeModelLabel}</span>
                  </InfoRow>
                  {REASONING_EFFORT_RUNTIMES.has(currentRuntimeConfig.runtime) && (
                    <InfoRow label={formatMessage({ id: "agent.runtimeConfig.reasoning" })}>
                      <span>
                        {currentRuntimeConfig.reasoningEffort
                          ? formatMessage({ id: reasoningEffortLabelId(currentRuntimeConfig.reasoningEffort) ?? "agent.runtimeConfig.default" })
                          : formatMessage({ id: "agent.runtimeConfig.default" })}
                      </span>
                    </InfoRow>
                  )}
                  {supportsRuntimeFastMode(currentRuntimeConfig.runtime) && (
                    <InfoRow label={formatMessage({ id: "agent.runtimeConfig.mode" })}>
                      <span>
                        {runtimeConfigFastMode(currentRuntimeConfig)
                          ? formatMessage({ id: "agent.runtimeConfig.fastMode" })
                          : formatMessage({ id: "agent.runtimeConfig.default" })}
                      </span>
                    </InfoRow>
                  )}
                  {currentRuntimeConfig.runtime === "claude" && (
                    <>
                      <InfoRow label={formatMessage({ id: "agent.runtimeConfig.provider" })}>
                        {currentProviderApiUrl
                            ? <span className="min-w-0 break-all font-mono">{currentProviderApiUrl}</span>
                            : <span className="text-foreground-hint">{formatMessage({ id: "agent.runtimeConfig.default" })}</span>}
                      </InfoRow>
                      <InfoRow label={formatMessage({ id: "agent.runtimeConfig.command" })}>
                        {currentCommand
                            ? <span className="min-w-0 break-all font-mono">{currentCommand}</span>
                            : <span className="text-foreground-hint">{formatMessage({ id: "agent.runtimeConfig.default" })}</span>}
                      </InfoRow>
                    </>
                  )}
                </DescriptionList>
                <div className="mt-3">
                  <EnvVarsSection agent={agent} canManageAgent={false} />
                </div>
              </div>
            </div>
            </>
          )}

        </>
      )}

      {pendingConfirm && (
        <ConfirmDialog
          title={pendingConfirm.title}
          message={pendingConfirm.message}
          confirmLabel={pendingConfirm.confirmLabel}
          loadingLabel={pendingConfirm.loadingLabel}
          confirmVariant={pendingConfirm.confirmVariant}
          plainMessage={pendingConfirm.plainMessage}
          maxWidthClass={pendingConfirm.maxWidthClass}
          chromeLocale="active"
          onConfirm={pendingConfirm.onConfirm}
          onClose={closePendingConfirm}
          layer={1}
        />
      )}

      {showRoleHelp && (
        <RolePermissionHelpDialog
          subject="agent"
          onClose={closeRoleHelp}
        />
      )}

      {editingRuntimeConfig && (
        <Modal onClose={closeRuntimeConfigEditor} layer={1}>
          <DialogSurface
            ref={runtimeConfigModalRef}
            className="w-full max-w-md p-5"
            data-testid="agent-runtime-config-dialog"
          >
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-headline text-foreground">{formatMessage({ id: "agent.detail.editRuntimeConfig" })}</h2>
              <CloseButton onClick={closeRuntimeConfigEditor}>
                <X size={20} />
              </CloseButton>
            </div>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSaveRuntimeConfiguration();
              }}
            >
              <RuntimeConfigFields
                runtime={draftRuntime}
                onRuntimeChange={changeDraftRuntime}
                runtimeOptions={runtimeOptions}
                model={draftModel}
                persistedModel={
                  draftRetainsBuiltInPresetSelection
                    ? currentRuntimeModel
                    : undefined
                }
                onModelChange={changeDraftModel}
                customModelMode={draftCustomModelMode}
                onCustomModelModeChange={setDraftCustomModelMode}
                modelOptions={modelOptions}
                runtimeModels={runtimeModels}
                rescanDisabled={!agent.machineId}
                providerMode={draftProviderMode}
                onProviderModeChange={setDraftProviderMode}
                providerApiUrl={draftProviderApiUrl}
                onProviderApiUrlChange={setDraftProviderApiUrl}
                providerApiKey={draftProviderApiKey}
                onProviderApiKeyChange={setDraftProviderApiKey}
                builtInProviderMode={draftBuiltInProviderMode}
                onBuiltInProviderModeChange={changeDraftBuiltInProviderMode}
                builtInProviderApiKey={draftBuiltInProviderApiKey}
                onBuiltInProviderApiKeyChange={setDraftBuiltInProviderApiKey}
                builtInProviderBaseUrl={draftBuiltInProviderBaseUrl}
                onBuiltInProviderBaseUrlChange={setDraftBuiltInProviderBaseUrl}
                loadLocalPlugins={draftLoadLocalPlugins}
                onLoadLocalPluginsChange={setDraftLoadLocalPlugins}
                builtInProviderSupportsImageInput={draftBuiltInProviderSupportsImageInput}
                onBuiltInProviderSupportsImageInputChange={setDraftBuiltInProviderSupportsImageInput}
                piProviderMode={draftPiProviderMode}
                onPiProviderModeChange={changeDraftPiProviderMode}
                piProviderApiKey={draftPiProviderApiKey}
                onPiProviderApiKeyChange={setDraftPiProviderApiKey}
                fastMode={draftFastMode}
                onFastModeChange={setDraftFastMode}
                command={draftCommand}
                onCommandChange={setDraftCommand}
                reasoningEffort={draftReasoningEffort}
                onReasoningEffortChange={setDraftReasoningEffort}
                envVarEntries={draftEnvVarEntries}
                onEnvVarEntriesChange={setDraftEnvVarEntries}
                envVarsMode="advanced"
                advancedOpen={runtimeConfigAdvancedOpen}
                onAdvancedOpenChange={setRuntimeConfigAdvancedOpen}
                envVarsHint={formatMessage({ id: "agent.detail.envVarsInjectedHint" })}
                selectedModelSuggestionOnly={draftModelSuggestionOnly}
                selectPortalContainer={runtimeConfigModalRef}
                managedConnectionActive={managedConnectionActive}
                providerConnections={providerConnectionCatalog.connections}
                providerConnectionId={draftProviderConnectionId}
                onProviderConnectionChange={changeDraftProviderConnection}
                onEditProviderConnection={capabilities.manageExternalAuth ? setEditingProviderConnection : undefined}
                schemaBacked={draftSchemaBacked || v2EditActive}
                runtimeFormV2={runtimeFormV2EditProps}
                formDefinition={draftFormDefinition}
                formDefinitionLoading={draftSchemaBacked && runtimeFormDefinitionCatalog.loading}
                formDefinitionError={draftSchemaBacked && !runtimeFormDefinitionCatalog.loading && Boolean(draftFormDefinitionEntry?.error)}
              />

              {runtimeConfigSaveError ? (
                <Banner intent="warning" density="sm">
                  {runtimeConfigSaveError}
                </Banner>
              ) : null}

              {legacyKimiReasoningRequiresUpgrade ? (
                <Banner intent="warning" density="sm" data-testid="kimi-reasoning-upgrade-required">
                  {formatMessage({ id: "agent.runtimeConfig.kimiReasoningUpgradeRequired" })}
                </Banner>
              ) : null}

              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" size="lg"
                  type="button"
                  onClick={closeRuntimeConfigEditor}
                  disabled={savingRuntimeConfig}
                >
                  {formatMessage({ id: "common.confirm.cancel" })}
                </Button>
                {v2EditActive ? (
                  <Button variant="accent" size="lg"
                    type="submit"
                    disabled={v2EditSaveDisabled}
                  >
                    {formatMessage({ id: "agent.detail.saveRuntimeConfig" })}
                  </Button>
                ) : (
                  <Button variant="accent" size="lg"
                    type="submit"
                    disabled={runtimeConfigSaveDisabled}
                  >
                    {formatMessage({ id: "agent.detail.saveRuntimeConfig" })}
                  </Button>
                )}
              </div>
            </form>
          </DialogSurface>
        </Modal>
      )}
      {editingProviderConnection && (
        <EditProviderConnectionModal
          key={editingProviderConnection.id}
          connection={editingProviderConnection}
          providerOptions={providerConnectionCatalog.providerOptions}
          onClose={closeEditingProviderConnection}
          onCompleted={completeEditingProviderConnection}
        />
      )}
    </>
  );
}

// Isolated start/stop button — subscribes to activity for this agent only.
function AgentStartStopButton({ agentId, onShowStopConfirm }: { agentId: string; onShowStopConfirm: () => void }) {
  const { formatMessage } = useIntl();
  const displayState = useAgentDisplayState(agentId);
  const startAgent = useAgentStore((s) => s.startAgent);
  const isOnline = displayState.isOnline;
  const handleStart = useCallback(() => startAgent(agentId), [startAgent, agentId]);
  return (
    <Button variant="outline" size="lg"
      onClick={isOnline ? onShowStopConfirm : handleStart}
      className="flex w-full items-center justify-center gap-2"
    >
      {isOnline ? <Square size={14} /> : <Play size={14} />}
      {isOnline
        ? formatMessage({ id: "agent.detail.stopAgent" })
        : formatMessage({ id: "agent.detail.startAgent" })}
    </Button>
  );
}

// DS StatusChip presence washes: online lime, busy yellow, error orange, offline stone.
const PRESENCE_CHIP_VARIANT = {
  online: "success",
  thinking: "primary",
  working: "primary",
  error: "warning",
  offline: "muted",
} as const satisfies Record<AgentActivity, BadgeProps["variant"]>;

// Isolated status badge — subscribes to activity for this agent only.
function AgentStatusBadge({ agentId, showDetail, fallbackStatus, externalStatus }: { agentId: string; showDetail: boolean; fallbackStatus?: Agent["status"]; externalStatus?: ExternalAgentStatus | null }) {
  const intl = useIntl();
  const { formatMessage } = intl;
  const rawDisplayState = useAgentDisplayState(agentId, fallbackStatus ? { status: fallbackStatus } : undefined);
  const activityState = useAgentCurrentActivityState(agentId);
  // task #1123: a failed start carries a typed reason; pick catalog copy by
  // reason (never by parsing the detail text) and let it stand in for the
  // daemon's detail so the existing offline + runtime_unavailable text path
  // (which keeps the detail) renders it. See formatSpawnFailureDetail.
  const spawnFailure = rawDisplayState.activityDetailKind === "runtime_unavailable"
    ? activityState?.spawnFailure
    : undefined;
  const spawnFailureText = formatSpawnFailureDetail(formatMessage, spawnFailure, rawDisplayState.activityDetail ?? "");
  const displayState = spawnFailureText
    ? { ...rawDisplayState, activityDetail: spawnFailureText }
    : rawDisplayState;

  // External agents: presence = credential seen within the online window
  // (same rule as every other agent dot); managers also see setup state.
  // While seen with a non-idle activity (thinking/working/error from forwarded
  // activity events) the badge renders exactly like a managed agent's.
  const externalActivityShown = displayState.isExternal && displayState.isOnline && displayState.activity !== "online";
  if (displayState.isExternal && !externalActivityShown) {
    const setupState = externalStatus?.setupState;
    const lastSeenRelative = !displayState.isOnline
      ? formatRelativeTime(displayState.lastSeenAt, intl.locale)
      : null;
    const activityPresence: StatusDotPresence = displayState.isOnline
      ? "online"
      : setupState === "waiting_for_login"
        ? "offline"
        : "external";
    const chipVariant: BadgeProps["variant"] = displayState.isOnline
      ? "success"
      : setupState === "waiting_for_login"
        ? "muted"
        : "information";
    let externalText = formatMessage({ id: "agent.detail.external" });
    if (showDetail && setupState === "waiting_for_login") {
      externalText = formatMessage({ id: "agent.detail.externalSetupRequired" });
    } else if (displayState.isOnline) {
      externalText = formatMessage({ id: "agent.detail.externalOnline" });
    } else if (lastSeenRelative) {
      externalText = formatMessage({ id: "agent.detail.externalLastActive" }, { time: lastSeenRelative });
    } else if (showDetail && (setupState === "credential_minted" || setupState === "connected")) {
      externalText = formatMessage({ id: "agent.detail.externalNoRaftActivity" });
    } else if (showDetail && externalStatus) {
      externalText = formatMessage({ id: "agent.detail.externalNotConfigured" });
    }
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <Badge appearance="soft" variant={chipVariant} className="max-w-full">
          <StatusDot presence={activityPresence} className="shrink-0" />
          <Tooltip content={externalText}><span className="min-w-0 truncate">
            {externalText}
          </span></Tooltip>
        </Badge>
      </div>
    );
  }

  const activityText = showDetail
    ? formatActivityText(
      formatMessage,
      displayState.activity,
      displayState.activityDetail,
      displayState.activityDetailKind,
    )
    : formatActivityText(formatMessage, displayState.activity, "");
  // task #1116: when the daemon reports deliveries the runtime never consumed,
  // surface the typed counts (ids/classes only) in a truncating sibling so a
  // human can see the observation without opening the trajectory log.
  const deliveryConsumption = showDetail && displayState.activityDetailKind === "delivery_unconsumed"
    ? activityState?.deliveryConsumption
    : undefined;
  const wakeCrashLoop = showDetail && displayState.activityDetailKind === "wake_crash_loop_blocked"
    ? activityState?.wakeCrashLoop
    : undefined;
  const deliveryConsumptionText = deliveryConsumption
    ? formatMessage(
      { id: "activity.status.deliveryUnconsumedDetail" },
      {
        count: deliveryConsumption.unconsumedDeliveries,
        episode: deliveryConsumption.episode,
        path: deliveryConsumption.lastDeliveryPath ?? "unknown",
      },
    )
    : wakeCrashLoop
      ? formatMessage(
        { id: "activity.status.wakeCrashLoopBlockedDetail" },
        {
          count: wakeCrashLoop.earlyExitCount,
          episode: wakeCrashLoop.episode,
          exitKind: wakeCrashLoop.lastExitKind ?? "unknown",
          signal: wakeCrashLoop.lastSignal ? ` ${wakeCrashLoop.lastSignal}` : "",
        },
      )
      : null;
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Badge appearance="soft" variant={PRESENCE_CHIP_VARIANT[displayState.activity]} className="max-w-full">
        <StatusDot activity={displayState.activity} className="shrink-0" />
        <Tooltip content={activityText}><span className="min-w-0 truncate">
          {activityText}
        </span></Tooltip>
      </Badge>
      {deliveryConsumptionText && (
        <Tooltip content={deliveryConsumptionText}><span className="min-w-0 truncate font-mono text-mono-meta text-foreground-hint">
          {deliveryConsumptionText}
        </span></Tooltip>
      )}
    </div>
  );
}

const NO_ROLE_OPTIONS: ReturnType<typeof useEditableAgentRoleOptions> = [];
const AGENT_HEADER_CONTAINER_PROPS = { className: "agent-profile-header-container" };

// Isolated header component — only re-renders on activity changes for this agent,
// without triggering re-render of ChatPanel / tabs below.
function AgentDetailHeader({ agent, canControlAgentRuntime, canStopHostedTurn, canMessageAgent, onMessage, onClose, onBack, onShowResetDialog, onShowStopConfirm }: {   agent: Agent;
  canControlAgentRuntime: boolean;
  /** A hosted agent the viewer may control: one "stop current turn" command. */
  canStopHostedTurn: boolean;
  canMessageAgent: boolean;
  onMessage: () => void;
  onClose?: () => void;
  onBack?: () => void;
  onShowResetDialog: () => void;
  onShowStopConfirm: () => void;
}) {
  const { formatMessage } = useIntl();
  const slug = useServerStore((s) => s.current?.slug);
  // Two render modes for AgentDetailPanel:
  //   - Standalone route `/agent/<id>` — back falls back to /members rail.
  //   - Overlay (`?profile=agent:<id>` driven by ProfilePanel + useProfileStore)
  //     — `onClose` is closeProfile; back should close the overlay so the
  //     user lands on the underlying channel/DM, NOT skip to /members.
  // See useMobileBack JSDoc for the cold-start permalink scenario fixed
  // by this branch (#proj-mobile:b1c622e5 stdrc 2026-05-08).
  const responsiveBack = useMobileBack(onClose ?? (slug ? `/s/${slug}/members` : "/"));
  const headerBack = onBack ?? responsiveBack;
  const displayState = useAgentDisplayState(agent.id, agent);
  const currentServerId = useServerStore((s) => s.current?.id);
  const startAgent = useAgentStore((s) => s.startAgent);
  const stopHostedAgentTurn = useAgentStore((s) => s.stopHostedAgentTurn);
  const isOnline = displayState.isOnline;
  const isDeleted = !!agent.deletedAt;
  const isExternalAgent = agent.external === true || isExternalAgentRuntime(agent.runtime);
  // Pinned by agentVisibility.test.ts as the...
  // stay in member-view mode" contract. Currently the rendered JSX dropped
  // the surfacing branch in a recent layout pass, so the value is unread —
  // `void` keeps it lint-clean without breaking the contract test that
  // guards the source-server resolution shape for future re-introduction.
  const sourceServerLabel =
    currentServerId && agent.serverId && agent.serverId !== currentServerId
      ? agent.serverName || agent.serverSlug || null
      : null;
  void sourceServerLabel;
  const handleStartStop = useCallback(() => {
    if (isOnline) onShowStopConfirm();
    else void startAgent(agent.id);
  }, [agent.id, isOnline, onShowStopConfirm, startAgent]);
  const handleStopHostedTurn = useCallback(() => {
    void stopHostedTurnWithFeedback(() => stopHostedAgentTurn(agent.id), formatMessage);
  }, [agent.id, formatMessage, stopHostedAgentTurn]);
  const mobileBackTitle = formatMessage({ id: "common.announcement.back" });
  const mobileBackProps = useMemo(
    () => ({ "data-testid": "agent-mobile-back", title: mobileBackTitle }),
    [mobileBackTitle],
  );
  const headerTitle = agent.displayName || agent.name;
  const titleClickProps = useMemo(() => ({ title: headerTitle }), [headerTitle]);

  const overflowActions = !isDeleted ? (
    <AgentProfileOverflowMenu
      canMessageAgent={canMessageAgent}
      canControlAgentRuntime={canControlAgentRuntime && !isExternalAgent}
      isOnline={isOnline}
      messageLabel={formatMessage({ id: "agent.detail.directMessage" })}
      onMessage={onMessage}
      onStartStop={handleStartStop}
      onRestartReset={onShowResetDialog}
      onStopHostedTurn={canStopHostedTurn ? handleStopHostedTurn : undefined}
      responsive
    />
  ) : null;
  const actions = (
    <>
      {overflowActions}
      {onClose && (
        <PanelAction
          onClick={onClose}
          className={onBack ? "flex" : "hidden md:flex"}
          aria-label={formatMessage({ id: "common.close" })}
          title={formatMessage({ id: "common.close" })}
        >
          <X />
        </PanelAction>
      )}
    </>
  );

  return (
    <PanelHeader
      onMobileBack={headerBack}
      backButtonVisibility={onBack ? "always" : "responsive"}
      mobileBackProps={mobileBackProps}
      iconSlot={
        <AvatarSlot
          context="panel-header"
          type="agent"
          agentAvatarUrl={agent.avatarUrl}
          className={isDeleted ? "grayscale opacity-60" : ""}
        />
      }
      iconAlwaysVisible
      iconKind="avatar"
      title={headerTitle}
      // Handle parity with the human profile header (cindyz 2026-10-10, #737):
      // title = display name, subtitle = the weaker @handle in the same meta spec.
      subtitle={`@${agent.name}`}
      subtitleClassName={PROFILE_HANDLE_FONT_CLASS}
      titleClickProps={titleClickProps}
      titleSuffix={
        isDeleted ? (
          <div className="flex min-w-0 items-center gap-1.5">
            <Badge appearance="soft" variant="muted" className="shrink-0">
              {formatMessage({ id: "agent.detail.deleted" })}
            </Badge>
          </div>
        ) : undefined
      }
      containerProps={AGENT_HEADER_CONTAINER_PROPS}
      actions={actions}
    />
  );
}

export default function AgentDetailPanel({ agent, onClose, onBack, onOpenProfile }: { agent: Agent; onClose?: () => void; onBack?: () => void; onOpenProfile?: (type: "agent" | "human", id: string) => void }) {
  const { formatMessage } = useIntl();
  const formatMessageRef = useRef(formatMessage);
  formatMessageRef.current = formatMessage;
  const stopAgent = useAgentStore((s) => s.stopAgent);
  const openDM = useChannelStore((s) => s.openDM);
  const { role: currentRole, capabilities } = useServerPermissions();
  const nav = useAppNavigate();
  const activityState = useAgentCurrentActivityState(agent.id);
  const activityLog = useAgentStore((s) => s.activityLogs[agent.id] ?? EMPTY_ACTIVITY_LOG);
  const machines = useMachineStore((s) => s.machines);
  const currentServer = useServerStore((s) => s.current);
  const currentUser = useAuthStore((s) => s.user);
  const agentMachine = agent.machineId ? machines.find((m) => m.id === agent.machineId) : null;
  const isRemoteJointAgent = Boolean(currentServer?.id && agent.serverId && agent.serverId !== currentServer.id);
  const isBoundedPublicProjection = isRemoteJointAgent || agent.profileProjection === "channel_summary";
  const isExternalAgent = agent.external === true || isExternalAgentRuntime(agent.runtime);

  // Which profile field the edit dialog opened on; null = closed.
  const [editField, setEditField] = useState<AgentProfileEditField | null>(null);
  const editableRoleOptions = useEditableAgentRoleOptions(agent);
  const [startError, setStartError] = useState("");
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const fetchExternalAgentStatus = useAgentStore((s) => s.fetchExternalAgentStatus);
  const [panelExternalStatus, setPanelExternalStatus] = useState<ExternalAgentStatus | null>(null);
  const canManageAgent = !isBoundedPublicProjection && canViewAgentPrivateSurfaces(
    agent,
    currentUser?.id,
    capabilities.editAgents,
  );
  // Archive actions (archive, delete its workspace) need deleteAgents or creator.
  const canArchiveAgent = !isBoundedPublicProjection && canViewAgentPrivateSurfaces(
    agent,
    currentUser?.id,
    capabilities.deleteAgents,
  );
  const canControlAgentRuntime = !isBoundedPublicProjection && !isExternalAgent && canViewAgentPrivateSurfaces(
    agent,
    currentUser?.id,
    capabilities.controlAgentRuntime,
  );
  // Same authority as stop; only a hosted agent that is up has a turn to stop.
  const canStopHostedTurn = !isBoundedPublicProjection && isExternalAgent && agent.hostedRuntime?.state === "active"
    && canViewAgentPrivateSurfaces(agent, currentUser?.id, capabilities.controlAgentRuntime);
  const canResetAgentWorkspace = !isBoundedPublicProjection && !isExternalAgent && canViewAgentPrivateSurfaces(
    agent,
    currentUser?.id,
    capabilities.resetAgentWorkspace,
  );
  const canManageServer = !isBoundedPublicProjection && capabilities.manageExternalAuth;
  // Approve, deny, grant and revoke app access: the agent's creator or an owner/admin.
  const canManageAgentAccess = !isBoundedPublicProjection && canViewAgentPrivateSurfaces(
    agent,
    currentUser?.id,
    capabilities.manageExternalAuth,
  );
  const canChangeAgentRole = !isBoundedPublicProjection && capabilities.changeMemberRoles;
  useEffect(() => {
    if (!isExternalAgent || isBoundedPublicProjection) return;
    let canceled = false;
    const load = async () => {
      try {
        const status = await fetchExternalAgentStatus(agent.id);
        if (!canceled) setPanelExternalStatus(status);
      } catch {
        if (!canceled) setPanelExternalStatus(null);
      }
    };
    void load();
    return () => { canceled = true; };
  }, [agent.id, fetchExternalAgentStatus, isBoundedPublicProjection, isExternalAgent]);

  const diagnosticCopyController = useCopyText({
    resetKey: agent.id,
    timeoutMs: 2_000,
  });
  const [searchParams, setSearchParams] = useLiveSearchParams();
  const location = useLocation();
  const canViewPrivateAgentSurfaces = canViewAgentPrivateSurfaces(
    agent,
    currentUser?.id,
    canManageAgent,
  );
  // External agents: the diagnostic copy text is built from the server's
  // external-agent diagnostics (presence, status, push, pulls, provisioning).
  const fetchExternalAgentDiagnostics = useAgentStore((s) => s.fetchExternalAgentDiagnostics);
  // Keyed by agent: a switch to another agent never shows the previous one's facts.
  const [loadedExternalDiagnostics, setLoadedExternalDiagnostics] = useState<{ agentId: string; view: ExternalAgentDiagnosticsView } | null>(null);
  const externalDiagnostics = loadedExternalDiagnostics?.agentId === agent.id ? loadedExternalDiagnostics.view : null;
  useEffect(() => {
    if (!isExternalAgent || isBoundedPublicProjection || !canViewPrivateAgentSurfaces) return;
    let canceled = false;
    fetchExternalAgentDiagnostics(agent.id)
      // A body without the view's shape (e.g. an older server) counts as unavailable.
      .then((view) => { if (!canceled && view?.presence && view.status && view.push) setLoadedExternalDiagnostics({ agentId: agent.id, view }); })
      .catch(() => undefined);
    return () => { canceled = true; };
  }, [agent.id, canViewPrivateAgentSurfaces, fetchExternalAgentDiagnostics, isBoundedPublicProjection, isExternalAgent]);
  const hasRuntimeError = activityState?.activity === "error" || Boolean(agent.lastRuntimeError);
  const rawRuntimeError = hasRuntimeError
    ? (activityState?.activity === "error" ? activityState.activityDetail : agent.lastRuntimeError?.message) ?? ""
    : "";
  // #688(d): surface the authoritative typed diagnostic (errorClass/reason/
  // fingerprint) that the daemon+server persisted, when present — instead of
  // re-deriving only from message text. Falls back to the message classifier
  // for untyped/legacy error authority.
  const typedRuntimeError =
    agent.lastRuntimeError?.errorClass && agent.lastRuntimeError.errorReason
      ? agent.lastRuntimeError
      : null;
  const typedRuntimeErrorErrKind: RuntimeErrorKind | null =
    typedRuntimeError && (typedRuntimeError.errorReason === "auth_failed" || typedRuntimeError.errorClass === "AuthError")
      ? "authFailed"
      : typedRuntimeError
          && (typedRuntimeError.errorReason === "model_tool_args_invalid"
            || typedRuntimeError.errorClass === "ToolArgumentParseError")
        ? "toolArgsInvalid"
        : null;
  // Runtime-error sentinel: known stable runtime errors map to catalog copy;
  // unknown errors keep the raw text / generic fallback (never mistranslated).
  const runtimeErrorKind = typedRuntimeErrorErrKind ?? (rawRuntimeError ? classifyRuntimeError(rawRuntimeError) : null);
  // task #735: a "not installed" classification only keeps the install copy
  // when the start failure's typed carrier confirms the miss (lookupReason
  // "not_on_path"). A timed-out/denied/failed lookup — and an old daemon that
  // carries no reason — is unresolved, never "install it".
  const startLookupDisplay = runtimeErrorKind === "notInstalled"
    ? runtimeLookupDisplayForReason(
        activityState?.spawnFailure?.reason === "runtime_not_found"
          ? activityState.spawnFailure.lookupReason
          : undefined,
      )
    : null;
  const activityErrorText = startLookupDisplay && startLookupDisplay !== "confirmed_missing"
    ? formatMessage(
        { id: RUNTIME_LOOKUP_DISPLAY_MESSAGE_ID[startLookupDisplay] },
        { runtimeName: getRuntimeDisplayName(agent.runtime) },
      )
    : runtimeErrorKind
    ? formatMessage({ id: RUNTIME_ERROR_LABEL_ID[runtimeErrorKind] })
    : hasRuntimeError
      ? formatActivityText(formatMessage, "error", rawRuntimeError)
      : formatMessage({ id: "activity.status.agentErrorFallback" });
  const activityFallbackErrorText = formatMessage({ id: "activity.status.agentErrorFallback" });
  // The raw diagnostic stays available for the copy button even when the
  // banner shows the classified catalog message.
  const diagnosticErrorMessage = hasRuntimeError && canViewPrivateAgentSurfaces
    ? (typedRuntimeError
      ? [rawRuntimeError, `class=${typedRuntimeError.errorClass} reason=${typedRuntimeError.errorReason} fingerprint=${typedRuntimeError.fingerprint}`].filter(Boolean).join("\n")
      : rawRuntimeError)

    : null;

  // Reactive cleanup: close the delete-confirm dialog if the agent gets
  // deleted externally (socket/another tab) while the dialog is open. The
  // setShowDeleteConfirm(false) is a deliberate response to a prop change,
  // not a mirror-prop pattern. Lifting the dialog state up would force a
  // wider refactor with no behavior benefit.
  useEffect(() => {
    // oxlint-disable-next-line react-doctor/no-event-handler -- YMNNE-family: pre-existing non-bug site grandfathered; rule now gates new code (see docs/frontend/render-cost-contract.md)
    if (agent.deletedAt && showDeleteConfirm) {
      // oxlint-disable-next-line react-doctor/no-adjust-state-on-prop-change, react-doctor/no-chain-state-updates -- YMNNE-family: pre-existing non-bug site grandfathered; rule now gates new code (see docs/frontend/render-cost-contract.md)
      setShowDeleteConfirm(false);
    }
  }, [agent.deletedAt, showDeleteConfirm]);

  const visibleAgentTabs = useMemo(
    () => AGENT_TABS.filter((tab) => {
      // An archived agent keeps its profile and a read-only workspace.
      if (agent.deletedAt) return tab === "profile" || (tab === "workspace" && canViewPrivateAgentSurfaces);
      if (PUBLIC_AGENT_TABS.has(tab)) return true;
      if (tab === "mcp") return canManageAgent;
      return canViewPrivateAgentSurfaces;
    }),
    [agent.deletedAt, canManageAgent, canViewPrivateAgentSurfaces],
  );
  const visibleAgentTabItems = useMemo(
    () => AGENT_PANEL_TABS.filter((tab) => visibleAgentTabs.includes(tab.id)),
    [visibleAgentTabs],
  );
  const agentPanelTabOrder = useServerStore((s) => s.sidebarOrder.agentPanelTabOrder);
  const updateSidebarOrder = useServerStore((s) => s.updateSidebarOrder);
  const normalizedAgentPanelTabOrder = useMemo(
    () => agentPanelTabOrder.map((tab) => tab === "channels" || tab === "dms" ? "chat" : tab),
    [agentPanelTabOrder],
  );
  const orderedAgentTabs = useOrderedTabs(visibleAgentTabItems, normalizedAgentPanelTabOrder);
  const reorderAgentTabs = useCallback((nextOrder: AgentTab[]) => {
    void updateSidebarOrder({ agentPanelTabOrder: nextOrder });
  }, [updateSidebarOrder]);
  const orderedAgentTabIds = useMemo(() => orderedAgentTabs.map((tab) => tab.id), [orderedAgentTabs]);
  const defaultAgentTab: AgentTab = visibleAgentTabs.includes("profile")
    ? "profile"
    : visibleAgentTabs[0] ?? "profile";
  const rawTab = searchParams.get("agentTab");
  const isFullPageAgentRoute = /^\/s\/[^/]+\/agent\/[^/]+$/.test(location.pathname);
  const legacyFullPageTab = isFullPageAgentRoute ? searchParams.get("tab") : null;
  const resolvedTab = rawTab ?? legacyFullPageTab;
  const activeTab: AgentTab = orderedAgentTabs.some((tab) => tab.id === resolvedTab) ? (resolvedTab as AgentTab) : defaultAgentTab;
  const setActiveTab = useCallback((tab: AgentTab) => {
    // Agent detail tabs keep their own scoped query key. We still strip the
    // legacy generic `tab` when it holds an old agent- or sidebar-tab value so
    // old shared URLs normalize onto `agentTab` + `sidebarTab`.
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (tab === defaultAgentTab) next.delete("agentTab");
      else next.set("agentTab", tab);
      if (isFullPageAgentRoute) {
        const legacyTab = next.get("tab");
        if (legacyTab === "machines") {
          next.set(SIDEBAR_TAB_QUERY_PARAM, "members");
          next.delete("tab");
        } else if (legacyTab && AGENT_TABS.includes(legacyTab as AgentTab)) {
          next.delete("tab");
        }
      }
      return next;
    }, { replace: true });
  }, [defaultAgentTab, isFullPageAgentRoute, setSearchParams]);


  // Find existing DM channel for this agent (for Message button)
  const dmChannels = useChannelStore((s) => s.dmChannels);
  const dmChannel = useMemo(
    () => dmChannels.find((c) => c.peerId === agent.id),
    [dmChannels, agent.id]
  );

  const getDiagnosticInfo = useCallback(() => buildAgentDiagnosticInfo({
    agent,
    serverId: currentServer?.id,
    machine: agentMachine,
    activityState,
    activityLog,
    errorMessage: diagnosticErrorMessage,
    externalDiagnostics,
    formatMessage,
  }), [activityLog, activityState, agent, agentMachine, currentServer?.id, diagnosticErrorMessage, externalDiagnostics, formatMessage]);
  const handleDiagnosticCopyError = useCallback(() => {
    setStartError(formatMessage({ id: "agent.detail.copyDiagnosticInfoFailed" }));
  }, [formatMessage]);

  // The runtime banner's compact diagnostic copy: the RUI CopyableCodeAction
  // reads its value from the visually hidden CopyableCode, and this state
  // drives its tooltip. The profile tab's full-width control keeps its own
  // lifecycle via diagnosticCopyController.
  const diagnosticInfoText = useMemo(() => getDiagnosticInfo(), [getDiagnosticInfo]);
  const [diagnosticIconCopied, setDiagnosticIconCopied] = useState(false);
  const diagnosticIconResetRef = useRef<unknown>(null);
  const markDiagnosticIconCopied = useCallback(() => {
    clearClockTimeout(diagnosticIconResetRef.current);
    setDiagnosticIconCopied(true);
    diagnosticIconResetRef.current = setClockTimeout(
      () => setDiagnosticIconCopied(false),
      DEFAULT_COPY_FEEDBACK_TIMEOUT_MS,
    );
  }, []);

  const [reminderItems, setReminderItems] = useState<ReminderSummary[]>([]);
  const [remindersLoading, setRemindersLoading] = useState(true);
  const [remindersError, setRemindersError] = useState<string | null>(null);

  // Reminders are a PRIVATE agent surface. A peer-server agent's public profile
  // must not make this server fetch them, and a caught error is not the same as
  // a request that was never sent. The scope key also fences stale responses: an
  // in-flight load started for one (viewer server, agent) must never commit
  // after a switch. (task #21)
  const reminderScopeKey = `${currentServer?.id ?? ""}:${agent.id}`;
  const reminderScopeRef = useRef(reminderScopeKey);
  reminderScopeRef.current = reminderScopeKey;

  const loadReminders = useCallback(async () => {
    if (!canViewPrivateAgentSurfaces) {
      // Clear rather than leave a previous agent's private reminders on screen.
      setReminderItems([]);
      setRemindersError(null);
      setRemindersLoading(false);
      return;
    }
    // Capture the key ITSELF, not a ref read: that is what makes it a real
    // input to this callback (the lint was right — a dependency the body never
    // uses is not a dependency). The ref is only for the post-await comparison.
    const startedScope = reminderScopeKey;
    // Drop the previous scope's rows BEFORE awaiting. Re-issuing the request is
    // not enough: while the new scope loads, stale private rows from the old
    // server stayed on screen.
    setReminderItems([]);
    setRemindersLoading(true);
    setRemindersError(null);
    try {
      const { data } = await api.get("/reminders", {
        params: {
          ownerAgentId: agent.id,
          status: "scheduled",
        },
      });
      if (reminderScopeRef.current !== startedScope) return;
      setReminderItems((data?.reminders ?? []) as ReminderSummary[]);
    } catch (err: any) {
      if (reminderScopeRef.current !== startedScope) return;
      setRemindersError(err.response?.data?.error || formatMessageRef.current({ id: "agent.detail.loadRemindersFailed" }));
    } finally {
      if (reminderScopeRef.current === startedScope) setRemindersLoading(false);
    }
    // `reminderScopeKey` is a DEPENDENCY, not just a ref read: the viewer server
    // is part of load ownership, so switching servers must re-run this loader
    // even when the private-permission boolean happens to be unchanged.
    // Without it the ref updates but nothing reloads, and stale rows/loading
    // survive the switch. (task #21 review)
  }, [agent.id, canViewPrivateAgentSurfaces, reminderScopeKey]);

  // Async-loader: kicks `loadReminders` on mount + agent change. Same FP
  // family as PR #2530's useChannelMembers / AgentSkills async loaders.
  // oxlint-disable-next-line react-doctor/no-cascading-set-state
  useEffect(() => {
    void loadReminders();
  }, [loadReminders]);

  // Socket listener: handles fire/snooze/cancel/update events for the active
  // agent's reminders. Three setState calls inside the event handlers are
  // reactive to server-pushed events, NOT a derived-from-prop pattern.
  // oxlint-disable-next-line react-doctor/no-cascading-set-state
  useEffect(() => {
    // Same gate as the loader: no private socket subscriptions or reconnect
    // refetch for a peer-server agent's public profile.
    if (!canViewPrivateAgentSurfaces) return;
    const socket = getSocket();
    // Fire: one-shot reminders disappear; recurring reminders stay in the list
    // but advance to the next scheduled fire time (server sends nextFireAt).
    const handleReminderFired = (data: {
      reminderId: string;
      ownerAgentId: string;
      nextFireAt?: string | null;
    }) => {
      if (data.ownerAgentId !== agent.id) return;
      setReminderItems((current) => {
        if (!data.nextFireAt) {
          return current.filter((item) => item.reminderId !== data.reminderId);
        }
        return current.map((item) =>
          item.reminderId === data.reminderId ? { ...item, fireAt: data.nextFireAt! } : item,
        );
      });
    };
    const handleReminderScheduled = (data: { reminder: ReminderSummary }) => {
      if (data.reminder?.ownerAgentId !== agent.id) return;
      setReminderItems((current) => {
        // Ignore non-scheduled payloads defensively; only scheduled reminders
        // belong in the pending list (the API query filters status=scheduled).
        if (data.reminder.status !== "scheduled") return current;
        // Upsert: replace if we already have this id, else append + sort asc
        // by fireAt so the next-firing reminder stays on top.
        const without = current.filter((item) => item.reminderId !== data.reminder.reminderId);
        const next = [...without, data.reminder];
        next.sort((a, b) => a.fireAt.localeCompare(b.fireAt));
        return next;
      });
    };
    const handleReminderCanceled = (data: { reminderId: string; ownerAgentId: string }) => {
      if (data.ownerAgentId !== agent.id) return;
      setReminderItems((current) => current.filter((item) => item.reminderId !== data.reminderId));
    };
    const handleReconnect = () => {
      void loadReminders();
    };

    socket.on("reminder:fired", handleReminderFired);
    socket.on("reminder:scheduled", handleReminderScheduled);
    socket.on("reminder:canceled", handleReminderCanceled);
    socket.on("connect", handleReconnect);
    return () => {
      socket.off("reminder:fired", handleReminderFired);
      socket.off("reminder:scheduled", handleReminderScheduled);
      socket.off("reminder:canceled", handleReminderCanceled);
      socket.off("connect", handleReconnect);
    };
  }, [agent.id, canViewPrivateAgentSurfaces, reminderScopeKey, loadReminders]);

  const handleOpenReminderMsgRef = useCallback(
    (permalink: string) => {
      const parsed = parseRaftPermalink(permalink, window.location.hostname);
      if (!parsed) {
        // Anchor outside the app (shouldn't happen — msgPermalink is
        // server-built against APP_URL) — fall back to a full navigation.
        window.location.href = permalink;
        return;
      }
      if (parsed.threadParentMessageId) {
        nav.toThreadMessage(
          parsed.channelId,
          parsed.threadParentMessageId,
          parsed.messageId,
          parsed.routeKind,
        );
      } else if (parsed.routeKind === "dm") {
        nav.toDmMessage(parsed.channelId, parsed.messageId);
      } else {
        nav.toMessage(parsed.channelId, parsed.messageId);
      }
    },
    [nav],
  );

  const handleRetryReminders = useCallback(async () => {
    await loadReminders();
  }, [loadReminders]);

  const handleStop = useCallback(async () => {
    setStartError("");
    try {
      await stopAgent(agent.id);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setStartError(axiosErr.response?.data?.error || formatMessage({ id: "agent.detail.stopAgentFailed" }));
    }
  }, [agent.id, formatMessage, stopAgent]);

  const handleMessage = useCallback(async () => {
    useProfileStore.getState().closeProfile();
    useThreadStore.getState().closeThread();
    if (dmChannel) {
      nav.toDm(dmChannel.id);
    } else if (!agent.deletedAt) {
      const ch = await openDM(agent.id);
      if (ch) nav.toDm(ch.id);
    }
  }, [agent.deletedAt, agent.id, dmChannel, nav, openDM]);
  const openResetDialog = useCallback(() => setShowResetDialog(true), []);
  const closeResetDialog = useCallback(() => setShowResetDialog(false), []);
  const openStopConfirm = useCallback(() => setShowStopConfirm(true), []);
  const closeStopConfirm = useCallback(() => setShowStopConfirm(false), []);
  const openReportDialog = useCallback(() => setShowReportDialog(true), []);
  const closeReportDialog = useCallback(() => setShowReportDialog(false), []);
  const openDeleteConfirm = useCallback(() => setShowDeleteConfirm(true), []);
  const closeDeleteConfirm = useCallback(() => setShowDeleteConfirm(false), []);
  const editAvatar = useCallback(() => setEditField("avatar"), []);
  const editDisplayName = useCallback(() => setEditField("displayName"), []);
  const closeEditField = useCallback(() => setEditField(null), []);
  const agentAvatarUrl = agent.avatarUrl;
  const agentTitle = agent.displayName || agent.name;
  const viewAvatar = useCallback(() => {
    useImageLightboxStore.getState().openImage(agentAvatarUrl!, agentTitle);
  }, [agentAvatarUrl, agentTitle]);

  return (
    <ProfilePanelBody className="flex min-h-0 flex-1 flex-col bg-layer-canvas font-sans">
      {/* Header — isolated component to prevent activity changes from re-rendering ChatPanel */}
      <AgentDetailHeader
        agent={agent}
        canControlAgentRuntime={canControlAgentRuntime}
        canStopHostedTurn={canStopHostedTurn}
        canMessageAgent={!isBoundedPublicProjection}
        onClose={onClose}
        onBack={onBack}
        onMessage={handleMessage}
        onShowResetDialog={openResetDialog}
        onShowStopConfirm={openStopConfirm}
      />

      {/* Start error: a raft-ui PanelNotice, the strip under the head closed
          by the same seam the head draws above it. */}
      {startError && (
        <PanelNotice>
          <Tooltip content={startError}><PanelNoticeContent render={<span />} className="truncate">{startError}</PanelNoticeContent></Tooltip>
          <PanelNoticeActions>
            <button
              onClick={() => setStartError("")}
              className={INFO_ICON_BUTTON_CLASS}
            >
              <X size={16} />
            </button>
          </PanelNoticeActions>
        </PanelNotice>
      )}

      {/* Agent runtime error banner — error detail leaks via Socket.io
          `agent:activity` to all server members, so for non-creators we
          fall back to a generic message and hide the "View logs" link. */}
      {hasRuntimeError && (
        <PanelNotice>
          <StatusDot presence="error" className="mt-[5px] shrink-0" />
          <Tooltip content={canViewPrivateAgentSurfaces ? activityErrorText : activityFallbackErrorText}><PanelNoticeContent render={<span />} className="line-clamp-2 break-words">
            {canViewPrivateAgentSurfaces
              ? activityErrorText
              : activityFallbackErrorText}
          </PanelNoticeContent></Tooltip>
          {canViewPrivateAgentSurfaces && (
            <PanelNoticeActions>
              <Tooltip content={diagnosticIconCopied ? formatMessage({ id: "agent.detail.copied" }) : formatMessage({ id: "agent.detail.copyInfo" })}>
                <CopyableCodeRoot
                  size="sm"
                  copied={diagnosticIconCopied}
                  onCopy={markDiagnosticIconCopied}
                  className="w-auto shrink-0"
                  // The Tooltip trigger merge keeps a child's declared data-slot;
                  // without it the action's own closest() lookup for the root fails.
                  data-slot="copyable-code-root"
                >
                  <CopyableCode className="sr-only" aria-hidden="true">{diagnosticInfoText}</CopyableCode>
                  <CopyableCodeAction
                    aria-label={diagnosticIconCopied ? formatMessage({ id: "agent.detail.copied" }) : formatMessage({ id: "agent.detail.copyInfo" })}
                  />
                </CopyableCodeRoot>
              </Tooltip>
              {activeTab !== "activity" && (
                <button
                  type="button"
                  onClick={() => setActiveTab("activity")}
                  className="whitespace-nowrap text-footnote font-semibold text-foreground underline decoration-[1.5px] underline-offset-[3px]"
                >
                  {formatMessage({ id: "agent.detail.viewLogs" })}
                </button>
              )}
            </PanelNoticeActions>
          )}
        </PanelNotice>
      )}

      {/* Tab bar — the same raft-ui chrome as the chat panel tabs. raft-ui's
          tab row scrolls itself when the tabs do not fit (wheel too), fades
          at the hidden side and keeps the selected tab in view. */}
      <div className="min-w-0 max-w-full">
        <ConversationPanelTabs
          render={<Tabs<AgentTab> value={activeTab} onValueChange={setActiveTab} />}
        >
          <SortableTabsList<AgentTab>
            value={orderedAgentTabIds}
            onReorder={reorderAgentTabs}
          >
            {orderedAgentTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <SortableTabsTab
                  key={tab.id}
                  value={tab.id}
                  data-testid={`panel-tab-${tab.id}`}
                >
                  <Icon />
                  <TabsLabel>{formatMessage({ id: tab.labelId })}</TabsLabel>
                </SortableTabsTab>
              );
            })}
          </SortableTabsList>
        </ConversationPanelTabs>
      </div>

      {/* Tab content — fills remaining space */}
      {activeTab === "profile" ? (
        <div className="flex-1 overflow-y-auto bg-layer-canvas">
          {isRemoteJointAgent && (agent.serverName || agent.serverSlug) && (
              <>
              <div className="px-5 py-3">
              <SectionEyebrow as="div" className="mb-1">
                {formatMessage({ id: "agent.detail.from" })}
              </SectionEyebrow>
                <div className="text-subhead font-semibold text-foreground">{agent.serverName || agent.serverSlug}</div>
            </div>
              <Separator />
              </>
          )}
          {/* Profile hero — the DS ScreenAgent hero: the big square pixel sticker
              (the panel's one piece of brand art, hard sticker shadow from the
              AvatarSlot recipe), then name, @handle, the agent tag + runtime chip,
              and the presence chip. */}
          <div className="flex items-start gap-4 px-5 py-5">
            {canManageAgent ? (
              <Tooltip content={formatMessage({ id: "agent.detail.changeAvatar" })}>
              <button
                type="button"
                aria-label={formatMessage({ id: "agent.detail.changeAvatar" })}
                data-testid="agent-change-avatar"
                onClick={editAvatar}
                className={PROFILE_AVATAR_BUTTON_CLASS}
              >
                <AvatarSlot context="profile-hero" type="agent" agentAvatarUrl={agent.avatarUrl} />
                <AvatarEditVeil icon={Pencil} />
              </button>
              </Tooltip>
            ) : isCustomAvatar(agent.avatarUrl) && !agent.deletedAt ? (
              <Tooltip content={formatMessage({ id: "agent.detail.viewAvatar" })}>
              <button
                type="button"
                onClick={viewAvatar}
                className={PROFILE_AVATAR_BUTTON_CLASS}
                aria-label={formatMessage({ id: "agent.detail.viewAvatar" })}
              >
                <AvatarSlot context="profile-hero" type="agent" agentAvatarUrl={agent.avatarUrl} />
              </button>
              </Tooltip>
            ) : (
              <AvatarSlot
                context="profile-hero"
                type="agent"
                agentAvatarUrl={agent.avatarUrl}
                className={agent.deletedAt ? "grayscale opacity-60" : undefined}
              />
            )}
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex min-w-0 items-center gap-2">
                <AgentHeaderName
                  agent={agent}
                  onEdit={canManageAgent && !agent.deletedAt ? editDisplayName : undefined}
                />
              </div>
              {/* The hover title duplicates the visible handle but is load-bearing
                  for the i18n literal gate: scripts/i18n-literal-baseline.json audits
                  this exact template literal (protocol class), so removing the
                  attribute would force a three-baseline ratchet. Kept deliberately. */}
              <div className={`truncate text-mono-meta ${PROFILE_HANDLE_FONT_CLASS} text-foreground-hint`} title={`@${agent.name}`}>@{agent.name}</div>
              {/* Identity tags: what it is (agent) and, where operational info is
                  visible, what it runs on (the DS runtime chip). */}
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
                <Badge appearance="outline">{formatMessage({ id: "sidebar.findConversationAgentTag" })}</Badge>
                {!isBoundedPublicProjection && agent.runtime && (
                  <Badge appearance="soft" variant="information" className={RUNTIME_CHIP_CLASS} data-testid="agent-profile-runtime-chip">
                    <Cpu size={14} aria-hidden="true" />
                    {getRuntimeDisplayName(agent.runtime)}
                  </Badge>
                )}
              </div>
              {/* Live activity has its own line under the handle, so it never squeezes the name. */}
              {!agent.deletedAt && (
                <div className="mt-1.5 min-w-0">
                  <AgentStatusBadge agentId={agent.id} fallbackStatus={agent.status} showDetail={canViewPrivateAgentSurfaces} externalStatus={isExternalAgent ? panelExternalStatus : undefined} />
                </div>
              )}
            </div>
          </div>


          {editField && (
            <AgentProfileEditDialog
              agent={agent}
              open
              field={editField}
              onClose={closeEditField}
              roleOptions={canChangeAgentRole && !agent.deletedAt ? editableRoleOptions : NO_ROLE_OPTIONS}
            />
          )}

          {/* Profile info: description, computer, created */}
          <AgentProfileInfo
            agent={agent}
            onEdit={canManageAgent && !agent.deletedAt ? setEditField : undefined}
            canManageAgent={canManageAgent && !agent.deletedAt}
            canChangeAgentRole={canChangeAgentRole && !agent.deletedAt}
            onOpenProfile={onOpenProfile}
            showOperationalInfo={!isBoundedPublicProjection}
          />

          {/* Skills */}
          {canViewPrivateAgentSurfaces && !agent.deletedAt && (
            <>
              <Separator />
              <AgentSkills agentId={agent.id} embedded />
            </>
          )}

          {/* A cloud agent keeps the section only to show the end of its move to the cloud. */}
          {canManageAgent && !agent.deletedAt && (!isExternalAgent || agent.hostedRuntime) && (
            <AgentMigrationSection agent={agent} arrivalOnly={isExternalAgent} />
          )}

          {agent.deletedAt && canViewPrivateAgentSurfaces && (
            <AgentArchiveSection agent={agent} canManage={canArchiveAgent} />
          )}

          {/* Actions */}
          {canManageAgent && !agent.deletedAt && (
            <>
            <Separator />
            <div className="px-5 py-4">
              <SectionEyebrow as="div" className="mb-3">
                {formatMessage({ id: "agent.detail.actions" })}
              </SectionEyebrow>
              <div className="space-y-2">
                {!isExternalAgent && (
                  <>
                    <AgentStartStopButton agentId={agent.id} onShowStopConfirm={openStopConfirm} />
                    <Button variant="outline" size="lg"
                      onClick={openResetDialog}
                      className="flex w-full items-center justify-center gap-2"
                    >
                      <RotateCcw size={14} />
                      {formatMessage({ id: "agent.detail.restartReset" })}
                    </Button>
                  </>
                )}
                <CopyButton
                  controller={diagnosticCopyController}
                  text={getDiagnosticInfo}
                  onCopyError={handleDiagnosticCopyError}
                >
                  {({ copied, disabled, onClick, onMouseDown }) => (
                    <Button variant="outline" size="lg"
                      onClick={onClick}
                      onMouseDown={onMouseDown}
                      disabled={disabled}
                      className="flex w-full items-center justify-center gap-2"
                    >
                      {copied ? <Check size={14} /> : <Clipboard size={14} />}
                      {copied
                        ? formatMessage({ id: "agent.detail.diagnosticInfoCopied" })
                        : formatMessage({ id: "agent.detail.copyDiagnosticInfo" })}
                    </Button>
                  )}
                </CopyButton>
                {FEEDBACK_EXPORT_ENABLED && (
                  <Button variant="outline" size="lg"
                    onClick={openReportDialog}
                    className="flex w-full items-center justify-center gap-2"
                  >
                    <Bug size={14} />
                    {formatMessage({ id: "agent.reportIssue.title" })}
                  </Button>
                )}
                {canArchiveAgent && (
                  <Button variant="danger" size="lg"
                    onClick={openDeleteConfirm}
                    className="flex w-full items-center justify-center gap-2"
                    data-testid="agent-archive-button"
                  >
                    <Archive size={14} />
                    {formatMessage({ id: "agent.detail.deleteAgent" })}
                  </Button>
                )}
              </div>
            </div>
            </>
          )}
        </div>
      ) : activeTab === "chat" ? (
        <AgentChatTab key={agent.id} agentId={agent.id} />
      ) : activeTab === "reminders" ? (
        <AgentRemindersSection
          variant="tab"
          reminders={reminderItems}
          loading={remindersLoading}
          error={remindersError}
          onRetry={handleRetryReminders}
          onOpenMsgRef={handleOpenReminderMsgRef}
        />
      ) : activeTab === "workspace" ? (
        <AgentWorkspace agentId={agent.id} compact={!!onClose} hosted={isExternalAgent} />
      ) : activeTab === "activity" ? (
        <div className="flex min-h-0 flex-1 flex-col bg-layer-canvas">
          <AgentActivityLog agentId={agent.id} machineId={agent.machineId} />
        </div>
      ) : activeTab === "integrations" ? (
        <AgentAppAccessTab agentId={agent.id} canManageAgentAccess={canManageAgentAccess} />
      ) : activeTab === "mcp" ? (
        <AgentMcpTab agentId={agent.id} canManageServer={canManageServer} />
      ) : null}

      {canControlAgentRuntime && showResetDialog && (
        <ResetAgentDialog
          agentId={agent.id}
          agentName={agent.displayName || agent.name}
          canFullReset={canResetAgentWorkspace}
          memberRuntimeOnly={currentRole === "member"}
          onClose={closeResetDialog}
        />
      )}

      {canManageAgent && showReportDialog && (
        <ReportIssueDialog
          agent={agent}
          dmChannelId={dmChannel?.id}
          onClose={closeReportDialog}
        />
      )}

      {canControlAgentRuntime && showStopConfirm && (
        <ConfirmDialog
          title={formatMessage({ id: "agent.detail.stopAgent" })}
          message={formatMessage(
            { id: "agent.detail.stopAgentConfirmMessage" },
            { name: agent.displayName || agent.name },
          )}
          confirmLabel={formatMessage({ id: "agent.detail.stopAgent" })}
          loadingLabel={formatMessage({ id: "agent.detail.stopping" })}
          confirmVariant="warning"
          chromeLocale="active"
          onConfirm={handleStop}
          onClose={closeStopConfirm}
        />
      )}

      {canArchiveAgent && showDeleteConfirm && (
        <AgentArchiveDialog agent={agent} onClose={closeDeleteConfirm} />
      )}
    </ProfilePanelBody>
  );
}
