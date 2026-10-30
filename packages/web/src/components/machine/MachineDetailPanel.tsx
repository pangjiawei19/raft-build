import { Input, Textarea, Card, Badge, Button, CopyableCode, CopyableCodeAction, InlineCode, PanelTitle, Separator, Spinner, Status, IconTile, ListRowGroup } from "@botiverse/raft-ui";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { useIntl } from "react-intl";
import { Trash2, Monitor, Check, RefreshCw, FolderOpen, Play, Plus, X, Pencil, Square, RotateCcw, CheckCircle, AlertCircle, Terminal, ChevronRight, ArrowLeftRight } from "lucide-react";
import DialogCard from "../ui/DialogCard";
import Banner from "../ui/Banner";
import { machineDiskLowPresentation } from "../../utils/machineDiskPresentation";
import ProgressBar from "../ui/ProgressBar";
import { clearClockTimeout, compareComputerVersions, currentTimeMs, getMachineRuntimeDisplayOptions, isComputerSemver, isRemoteUpgradeSupported, runtimeAvailabilitySuffix, setClockTimeout } from "@botiverse/raft-shared";
import { formatRuntimeAvailabilitySuffix, formatRuntimeLabelWithStatus } from "../../utils/runtimeAvailabilityLabel";
import { useMachineStore } from "../../store/machineStore";
import { BULK_CHANGE_MODEL_WEB_FLAG_KEY, REMOTE_COMPUTER_UPGRADE_V2_FLAG_KEY, useServerFeatureFlag } from "../../store/serverFeatureFlags";
import { useBulkChangeModelReceiptStore } from "../../store/bulkChangeModelReceiptStore";
import type { BulkChangeReceipt, BulkUnfinishedAgent } from "../../store/bulkChangeModelReceiptStore";
import { formatBulkModelLabel } from "./bulkChangeModelPlan";
import type { BulkModelTarget } from "./bulkChangeModelPlan";
import BulkChangeModelDialog from "./BulkChangeModelDialog";
import type { Machine, MachineUpgradeRequest, MachineWorkspaceEntry } from "../../store/machineStore";
import { computeAgentDisplayState, selectAgentActivitiesSlice, useAgentStore } from "../../store/agentStore";
import type { Agent } from "../../store/agentStore";
import { useServerStore } from "../../store/serverStore";
import { useProfileStore } from "../../store/profileStore";
import { useAuthStore } from "../../store/authStore";
import api from "../../api/client";
import { useAppNavigate, useMobileBack } from "../../hooks/useAppNavigate";
import { useServerPermissions } from "../../hooks/useServerPermissions";
import { getServerUrl } from "../../utils/server";
import { formatRelativeTime } from "../../utils/relativeTime";
import { getComputerCommands } from "../../utils/computerSetupCommand";
import { getComputerVersionFact } from "../../utils/computerVersionFact";
import { useComputerUpgradeReconnect } from "../../hooks/useComputerUpgradeReconnect";
import { canViewMachineRuntimeAccountUsage } from "../../utils/machineRuntimeUsageVisibility";
import ConfirmDialog from "../ConfirmDialog";
import { trackAgentCreateOpened } from "../../analytics/journey";
import CreateAgentDialog from "../agent/CreateAgentDialog";
import Tooltip from "../ui/Tooltip";
import PanelHeader from "../ui/PanelHeader";
import SectionEyebrow from "../ui/SectionEyebrow";
import SectionHeader from "../ui/SectionHeader";
import KeyValueRow from "../ui/KeyValueRow";
import AvatarSlot from "../ui/AvatarSlot";
import SurfaceListItem from "../ui/SurfaceListItem";
import { RuntimeAccountUsageGateChip } from "./RuntimeAccountUsageChip";
import ComputerReleaseNotesAffordance from "./ComputerReleaseNotesAffordance";
import { formatFileSizeBytes } from "../../utils/fileSizePresentation";
import { CommandCopyRoot } from "./CommandCopyRoot";
import { WorkspaceDeleteButton } from "./WorkspaceDeleteButton";
import { useRuntimeRescan } from "./useRuntimeRescan";
import { BulkResetOptionCard } from "./BulkResetOptionCard";
import { MachineAgentRow } from "./MachineAgentRow";

const EMPTY_WORKSPACES: MachineWorkspaceEntry[] = [];

// Raft Design System type roles used across this panel. Space Grotesk is what
// people say; Space Mono is what machines write (versions, paths, sizes,
// hostnames, runtimes, commands).
/** A quiet line where a list or value is empty (13/18, ink-3). */
const DETAIL_EMPTY_NOTE_CLASS_NAME = "text-footnote text-foreground-hint";
/** Explanatory copy above a control or a command (13/18, ink-2). */
const DETAIL_HELP_CLASS_NAME = "text-footnote text-foreground-muted";
/** A sentence about something that went wrong but can be fixed (orange ink). */
const DETAIL_PROBLEM_CLASS_NAME = "text-footnote text-warning-strong";
/** The label of one step / one command line (field label: 13/18 600). */
const DETAIL_STEP_LABEL_CLASS_NAME = "text-footnote font-semibold text-foreground";
/** A UI text button (Raft DS: ink, 1.5px underline, 600). */
const DETAIL_TEXT_BUTTON_CLASS_NAME =
  "rounded-sticker text-footnote font-semibold text-foreground underline decoration-[1.5px] underline-offset-[3px] outline-none hover:bg-fill-pressed focus-visible:shadow-focus";
/** Layout only: raft-ui's CopyableCode draws the Raft DS command line. */
const COMMAND_LINE_CLASS_NAME = "min-w-0 flex-1";

/** Workspace status → its Raft DS status light (active online, an orphan is
 *  the problem, stopped / deleted are offline stone). */
function workspaceStatusTone(status: MachineWorkspaceEntry["status"]): "success" | "warning" | "default" {
  if (status === "active") return "success";
  if (status === "orphan") return "warning";
  return "default";
}

/** The "cannot delete" notice has nothing to confirm; OK only closes it. */
function acknowledgeCannotDelete() {}

/** A refused Upgrade click, mapped from the server's code (never its text). */
type UpgradeRefusal = "web_upgrade_off" | "too_old" | "not_allowed" | "unknown";

function upgradeRefusalFromCode(code: string | undefined): UpgradeRefusal {
  switch (code) {
    case "remote_upgrade_disabled":
      return "web_upgrade_off";
    case "computer_remote_upgrade_unsupported":
      return "too_old";
    case "computer_broadcast_not_eligible":
      return "not_allowed";
    default:
      return "unknown";
  }
}
export type CommandCopyTarget =
  | "computer-install"
  | "computer-setup"
  | "computer-install-restart"
  | "terminal-status"
  | "terminal-doctor"
  | "terminal-restart";

// A filesystem path, not prose. Daemons before 1.0.46 do not report it and
// only ever kept workspaces under ~/.slock/agents/.
function workspaceLocation(ws: MachineWorkspaceEntry): string {
  return ws.displayPath ?? `~/.slock/agents/${ws.directoryName}/`;
}

function WorkspacesSection({ machineId, canManageMachines }: { machineId: string; canManageMachines: boolean }) {
  const { formatDate, formatMessage } = useIntl();
  const scanMachineWorkspaces = useMachineStore((s) => s.scanMachineWorkspaces);
  const deleteMachineWorkspace = useMachineStore((s) => s.deleteMachineWorkspace);
  const workspaces = useMachineStore((s) => s.machineWorkspaces[machineId]) ?? EMPTY_WORKSPACES;
  const loading = useMachineStore((s) => s.machineWorkspacesLoading[machineId]) ?? false;
  const [scanned, setScanned] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const deleteEntry = deleteTarget
    ? workspaces.find((w: MachineWorkspaceEntry) => w.directoryName === deleteTarget)
    : null;

  const handleScan = useCallback(async () => {
    await scanMachineWorkspaces(machineId);
    setScanned(true);
  }, [machineId, scanMachineWorkspaces]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    await deleteMachineWorkspace(machineId, deleteTarget);
    setDeleteTarget(null);
  }, [deleteMachineWorkspace, deleteTarget, machineId]);
  const closeDeleteDialog = useCallback(() => setDeleteTarget(null), []);

  const formatWorkspaceStatus = (status: MachineWorkspaceEntry["status"]) => {
    switch (status) {
      case "active":
        return formatMessage({ id: "machine.detail.workspaceStatus.active" });
      case "stopped":
        return formatMessage({ id: "machine.detail.workspaceStatus.stopped" });
      case "deleted":
        return formatMessage({ id: "machine.detail.workspaceStatus.deleted" });
      case "orphan":
        return formatMessage({ id: "machine.detail.workspaceStatus.orphan" });
      default:
        return status;
    }
  };

  const sortedWorkspaces = [...workspaces].sort((a: MachineWorkspaceEntry, b: MachineWorkspaceEntry) => {
    const order: Record<string, number> = { orphan: 0, deleted: 1, stopped: 2, active: 3 };
    return (order[a.status] ?? 3) - (order[b.status] ?? 3);
  });

  const orphanCount = workspaces.filter((w: MachineWorkspaceEntry) => w.status === "orphan").length;
  const deletedCount = workspaces.filter((w: MachineWorkspaceEntry) => w.status === "deleted").length;

  return (
    <div>
      <SectionHeader
        className="mb-2"
        icon={<FolderOpen size={14} className="text-foreground-muted" />}
        label={formatMessage({ id: "machine.detail.agentWorkspaces" })}
        action={
          <Button size="sm"
            variant="outline"
            onClick={handleScan}
            disabled={loading}
          >
            {loading ? <Spinner size="xs" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
            {loading
              ? formatMessage({ id: "machine.detail.scanning" })
              : scanned
                ? formatMessage({ id: "machine.detail.rescan" })
                : formatMessage({ id: "machine.detail.scan" })}
          </Button>
        }
      />

      {!scanned && !loading && (
        <div className={DETAIL_EMPTY_NOTE_CLASS_NAME}>
          {formatMessage({ id: "machine.detail.workspacesPrompt" })}
        </div>
      )}

      {scanned && workspaces.length === 0 && (
        <div className={DETAIL_EMPTY_NOTE_CLASS_NAME}>
          {formatMessage({ id: "machine.detail.noWorkspaceDirectories" })}
        </div>
      )}

      {scanned && orphanCount > 0 && (
        <Banner intent="warning" density="sm" className="mb-2">
          {formatMessage(
            { id: "machine.detail.orphanWorkspaceBanner" },
            { count: orphanCount, strong: (chunks) => <strong key="strong">{chunks}</strong> },
          )}
        </Banner>
      )}

      {scanned && deletedCount > 0 && (
        <Banner intent="info" density="sm" live={false} className="mb-2">
          {formatMessage(
            { id: "machine.detail.deletedWorkspaceBanner" },
            { count: deletedCount, strong: (chunks) => <strong key="strong">{chunks}</strong> },
          )}
        </Banner>
      )}

      {sortedWorkspaces.length > 0 && (
        // One row per workspace (surface, hairline, container radius). A row
        // with no matching agent is the problem: orange-soft; a retained
        // deleted agent's row sits on the sunken surface.
        <div className="space-y-1.5">
          {sortedWorkspaces.map((ws: MachineWorkspaceEntry) => (
            <div
              key={ws.directoryName}
              className={`flex items-center gap-3 rounded-container border border-line-hairline px-3 py-2.5 ${
                ws.status === "orphan"
                  ? "bg-warning-soft"
                  : ws.status === "deleted"
                    ? "bg-fill-muted"
                    : "bg-layer-card"
              }`}
            >
              <FolderOpen size={16} className="shrink-0 text-foreground-muted" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-callout font-semibold text-foreground">
                    {ws.agentName || ws.directoryName}
                  </span>
                  {/* Raft DS StatusChip: soft wash + square pixel + one word. */}
                  <Badge appearance="soft" variant={workspaceStatusTone(ws.status)}>
                    <Status size="md" variant={workspaceStatusTone(ws.status)} aria-hidden="true" />
                    {formatWorkspaceStatus(ws.status)}
                  </Badge>
                </div>
                <div className="mt-0.5 break-all font-mono text-mono-meta text-foreground-hint">
                  {workspaceLocation(ws)}
                </div>
                {ws.status === "deleted" && (
                  <div className="mt-0.5 text-caption text-foreground-muted">
                    {formatMessage({ id: "machine.detail.agentDeletedWorkspaceRetained" })}
                  </div>
                )}
                {ws.status === "orphan" && (
                  <div className="mt-0.5 text-caption font-semibold text-warning-strong">
                    {formatMessage({ id: "machine.detail.noMatchingAgentRecord" })}
                  </div>
                )}
                <div className="mt-0.5 flex items-center gap-3 font-mono text-mono-meta text-foreground-hint">
                  <span>{formatFileSizeBytes(ws.totalSizeBytes, formatMessage)}</span>
                  <span>{formatMessage({ id: "machine.detail.fileCount" }, { count: ws.fileCount })}</span>
                  <span>
                    {formatMessage(
                      { id: "machine.detail.modifiedDate" },
                      {
                        date: formatDate(ws.lastModified, {
                          month: "short",
                          day: "numeric",
                        }),
                      },
                    )}
                  </span>
                </div>
              </div>
              {canManageMachines && (
                <WorkspaceDeleteButton directoryName={ws.directoryName} onRequestDelete={setDeleteTarget} />
              )}
            </div>
          ))}
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={formatMessage({ id: "machine.detail.deleteWorkspaceTitle" })}
          message={formatMessage(
            { id: "machine.detail.deleteWorkspaceMessage" },
            { name: deleteEntry?.agentName || deleteTarget },
          )}
          confirmLabel={formatMessage({ id: "machine.detail.deleteWorkspaceTitle" })}
          loadingLabel={formatMessage({ id: "machine.detail.deleting" })}
          onConfirm={handleDelete}
          onClose={closeDeleteDialog}
        />
      )}
    </div>
  );
}

type BulkAgentAction = "start" | "stop" | "restart" | "session" | "full";
export type BulkResetMode = "restart" | "session" | "full";

export interface BulkResetOption {
  mode: BulkResetMode;
  label: string;
  desc: string;
  selectedClass: string;
}

// Isolated component — subscribes to current display-state projections only for agents on this machine,
// preventing activity changes from re-rendering the entire MachineDetailPanel.
function MachineAgentList({ machine, canManageMachines, canViewRuntimeAccountUsage }: { machine: Machine; canManageMachines: boolean; canViewRuntimeAccountUsage: boolean }) {
  const { formatMessage } = useIntl();
  const allAgents = useAgentStore((s) => s.agents);
  const startAgent = useAgentStore((s) => s.startAgent);
  const stopAgent = useAgentStore((s) => s.stopAgent);
  const resetAgent = useAgentStore((s) => s.resetAgent);
  const nav = useAppNavigate();
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(() => new Set());
  const [bulkAction, setBulkAction] = useState<BulkAgentAction | null>(null);
  const [bulkError, setBulkError] = useState("");
  const [showResetOptions, setShowResetOptions] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [bulkResetMode, setBulkResetMode] = useState<BulkResetMode>("restart");
  const bulkChangeModelEnabled = useServerFeatureFlag(BULK_CHANGE_MODEL_WEB_FLAG_KEY).enabled;
  const [bulkModelDialog, setBulkModelDialog] = useState<
    { agentIds: string[]; retry?: { target: BulkModelTarget; unfinished: BulkUnfinishedAgent[] } } | null
  >(null);
  const bulkReceipt = useBulkChangeModelReceiptStore((s) => s.receipts[machine.id]);
  const bulkHighlight = useBulkChangeModelReceiptStore((s) => s.highlights[machine.id]);
  const recordBulkReceipt = useBulkChangeModelReceiptStore((s) => s.record);
  const clearBulkReceipt = useBulkChangeModelReceiptStore((s) => s.clear);
  // One-shot deadlines (success banner 5 s, row highlight 3 s): re-render once
  // when the nearest one passes; a remount after it shows nothing.
  const [bulkClock, setBulkClock] = useState(() => currentTimeMs());
  const nextBulkDeadline = Math.min(
    bulkReceipt?.kind === "success" && bulkReceipt.bannerUntil > bulkClock ? bulkReceipt.bannerUntil : Infinity,
    bulkHighlight && bulkHighlight.until > bulkClock ? bulkHighlight.until : Infinity,
  );
  useEffect(() => {
    if (!Number.isFinite(nextBulkDeadline)) return;
    const timer = setClockTimeout(() => setBulkClock(currentTimeMs()), Math.max(0, nextBulkDeadline - currentTimeMs()) + 20);
    return () => clearClockTimeout(timer);
  }, [nextBulkDeadline]);

  const machineAgents = useMemo(
    () => allAgents.filter((a) => !a.deletedAt && a.machineId === machine.id),
    [allAgents, machine.id],
  );
  // Subscribe via the store's named stable slice selector and compute display
  // states in render. Building this map inside a store selector returned
  // fresh objects per snapshot -> useShallow never equal -> React #185
  // (2026-07-07 prod incident). The slice values are store-held objects, so
  // this subscription only fires on real activity changes.
  const activitiesSlice = useAgentStore(selectAgentActivitiesSlice);
  const displayStateFor = useCallback(
    (agent: Agent) => computeAgentDisplayState(allAgents, activitiesSlice, agent.id, agent),
    [activitiesSlice, allAgents],
  );
  const selectedAgents = useMemo(
    () => machineAgents.filter((a) => selectedAgentIds.has(a.id)),
    [machineAgents, selectedAgentIds],
  );
  const selectedOfflineAgents = useMemo(
    () => selectedAgents.filter((a) => !displayStateFor(a).isOnline),
    [displayStateFor, selectedAgents],
  );
  const selectedOnlineAgents = useMemo(
    () => selectedAgents.filter((a) => displayStateFor(a).isOnline),
    [displayStateFor, selectedAgents],
  );
  const machineAgentIdKey = machineAgents.map((a) => a.id).join("\0");
  const selectedCount = selectedAgents.length;
  const allSelected = machineAgents.length > 0 && selectedCount === machineAgents.length;
  const canStartLike = machine.status === "online";
  const bulkResetOptions = useMemo<BulkResetOption[]>(() => [
    {
      mode: "restart",
      label: formatMessage({ id: "machine.detail.bulkRestart" }),
      desc: formatMessage({ id: "machine.detail.bulkRestartDescription" }),
      selectedClass: "bg-info-soft",
    },
    {
      mode: "session",
      label: formatMessage({ id: "machine.detail.bulkResetSession" }),
      desc: formatMessage({ id: "machine.detail.bulkResetSessionDescription" }),
      selectedClass: "bg-warning-soft",
    },
    {
      mode: "full",
      label: formatMessage({ id: "machine.detail.bulkFullReset" }),
      desc: formatMessage({ id: "machine.detail.bulkFullResetDescription" }),
      selectedClass: "bg-danger-soft",
    },
  ], [formatMessage]);

  // `selectedAgentIds` is a user-driven multi-select Set; this effect cleans
  // stale ids when the underlying agent set shrinks (socket-pushed). The
  // functional updater reads `current` and computes the next Set against
  // `validIds` — NOT a mirror-prop pattern (no single source prop), it's a
  // stale-cleanup. react-doctor's no-derived-state suggested fix
  // (compute during render) can't express "drop ids that have disappeared
  // since last user selection."
  // Keyed on `machineAgentIdKey`, not `machineAgents`: the id key only changes when the
  // set of agents on this machine does, while the array follows every agent-store update.
  useEffect(() => {
    const validIds = new Set(machineAgentIdKey.split("\0"));
    // oxlint-disable-next-line react-doctor/no-derived-state
    setSelectedAgentIds((current) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of current) {
        if (validIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [machineAgentIdKey]);

  const toggleAgentSelection = useCallback((agentId: string) => {
    setSelectedAgentIds((current) => {
      const next = new Set(current);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }, []);

  const selectAllAgents = useCallback(() => {
    setSelectionMode(true);
    setSelectedAgentIds(new Set(machineAgents.map((a) => a.id)));
  }, [machineAgents]);

  const clearAllAgents = useCallback(() => setSelectedAgentIds(new Set()), []);

  const clearSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedAgentIds(new Set());
    setBulkError("");
  }, []);

  const runBulkAction = useCallback(async (action: BulkAgentAction) => {
    const targets =
      action === "start"
        ? selectedOfflineAgents
        : action === "stop"
          ? selectedOnlineAgents
          : selectedAgents;
    if (targets.length === 0) return;

    setBulkAction(action);
    setBulkError("");
    try {
      const results = await Promise.allSettled(
        targets.map((agent) => {
          if (action === "start") return startAgent(agent.id);
          if (action === "stop") return stopAgent(agent.id);
          return resetAgent(agent.id, action);
        })
      );
      const failed = results.filter((result) => result.status === "rejected").length;
      if (failed > 0) {
        setBulkError(formatMessage({ id: "machine.detail.bulkActionFailed" }, { failed, total: targets.length }));
      } else {
        clearSelection();
        setShowResetOptions(false);
      }
    } finally {
      setBulkAction(null);
    }
  }, [
    clearSelection,
    formatMessage,
    resetAgent,
    selectedAgents,
    selectedOfflineAgents,
    selectedOnlineAgents,
    startAgent,
    stopAgent,
  ]);
  const startSelectedAgents = useCallback(() => runBulkAction("start"), [runBulkAction]);
  const stopSelectedAgents = useCallback(() => runBulkAction("stop"), [runBulkAction]);
  const resetSelectedAgents = useCallback(() => runBulkAction(bulkResetMode), [bulkResetMode, runBulkAction]);
  const openAgent = useCallback((agentId: string) => nav.toAgent(agentId), [nav]);
  const enterSelectionMode = useCallback(() => setSelectionMode(true), []);
  const openCreateAgent = useCallback(() => {
    trackAgentCreateOpened("computer_detail");
    setShowCreateAgent(true);
  }, []);
  const closeCreateAgent = useCallback(() => setShowCreateAgent(false), []);
  const openStopConfirm = useCallback(() => setShowStopConfirm(true), []);
  const closeStopConfirm = useCallback(() => setShowStopConfirm(false), []);
  const openResetOptions = useCallback(() => setShowResetOptions(true), []);
  const closeResetOptions = useCallback(() => setShowResetOptions(false), []);
  const isAgentRunning = useCallback((agent: Agent) => displayStateFor(agent).isOnline, [displayStateFor]);
  const openBulkModel = useCallback(() => {
    setBulkModelDialog({ agentIds: selectedAgents.map((a) => a.id) });
  }, [selectedAgents]);
  const closeBulkModel = useCallback(() => setBulkModelDialog(null), []);
  const retryBulkModel = useCallback(() => {
    if (bulkReceipt?.kind !== "partial") return;
    setBulkModelDialog({
      agentIds: bulkReceipt.unfinished.map((item) => item.agentId),
      retry: { target: bulkReceipt.target, unfinished: bulkReceipt.unfinished },
    });
  }, [bulkReceipt]);
  const finishBulkModel = useCallback((receipt: BulkChangeReceipt, highlightedAgentIds: string[]) => {
    const now = currentTimeMs();
    recordBulkReceipt(machine.id, receipt, highlightedAgentIds, now);
    setBulkClock(now);
    setBulkModelDialog(null);
    clearSelection();
  }, [clearSelection, machine.id, recordBulkReceipt]);
  const dismissBulkReceipt = useCallback(() => clearBulkReceipt(machine.id), [clearBulkReceipt, machine.id]);
  const bulkModelAgents = useMemo(
    () => (bulkModelDialog ? machineAgents.filter((a) => bulkModelDialog.agentIds.includes(a.id)) : []),
    [bulkModelDialog, machineAgents],
  );
  const highlightedIds = bulkHighlight && bulkHighlight.until > bulkClock ? bulkHighlight.agentIds : null;
  const showBulkSuccess = bulkReceipt?.kind === "success" && bulkReceipt.bannerUntil > bulkClock;
  const bulkTargetLabel = bulkReceipt
    ? formatBulkModelLabel(bulkReceipt.target.runtime, bulkReceipt.target.model, true)
    : "";


  return (
    <>
      <div>
        <SectionHeader
          className="mb-3 flex-wrap gap-y-2"
          label={formatMessage({ id: "machine.detail.agentsOnComputer" })}
          count={machineAgents.length}
          action={
            <div className="flex items-center gap-1.5">
              {canManageMachines && machineAgents.length > 0 && (
                selectionMode ? (
                  <>
                    <Button size="sm"
                      variant="outline"
                      type="button"
                      onClick={allSelected ? clearAllAgents : selectAllAgents}
                    >
                      <Check size={16} />
                      {allSelected
                        ? formatMessage({ id: "machine.detail.clearAll" })
                        : formatMessage({ id: "machine.detail.selectAll" })}
                    </Button>
                    <Button size="sm"
                      variant="ghost"
                      type="button"
                      onClick={clearSelection}
                    >
                      <X size={16} />
                      {formatMessage({ id: "common.confirm.cancel" })}
                    </Button>
                  </>
                ) : (
                  <Button size="sm"
                    variant="outline"
                    type="button"
                    onClick={enterSelectionMode}
                  >
                    <Check size={16} />
                    {formatMessage({ id: "machine.detail.select" })}
                  </Button>
                )
              )}
              {canManageMachines && !selectionMode && (
                // Not this page's single pink action (that is Upgrade): an ink-line
                // button, like New Task in a channel.
                <Button size="sm"
                  variant="outline"
                  onClick={openCreateAgent}
                >
                  <Plus size={16} />
                  {formatMessage({ id: "machine.detail.create" })}
                </Button>
              )}
            </div>
          }
        />
        {machineAgents.length === 0 ? (
          <div className={DETAIL_EMPTY_NOTE_CLASS_NAME}>
            {formatMessage({ id: "machine.detail.noAgentsAssigned" })}
          </div>
        ) : (
          <div className="space-y-2">
            {bulkChangeModelEnabled && showBulkSuccess && bulkReceipt?.kind === "success" && (
              <Banner
                intent="success"
                density="sm"
                withIcon
                data-testid="bulk-model-success-banner"
                actions={
                  <Button size="icon-sm" variant="ghost" type="button" onClick={dismissBulkReceipt} aria-label={formatMessage({ id: "machine.detail.bulkModel.dismiss" })}>
                    <X size={14} />
                  </Button>
                }
              >
                <span className="font-bold">
                  {formatMessage({ id: "machine.detail.bulkModel.successBanner" }, { count: bulkReceipt.changedAgentIds.length, target: bulkTargetLabel })}
                </span>
                {bulkReceipt.skippedAgentIds.length > 0 && (
                  <> {formatMessage({ id: "machine.detail.bulkModel.successSkipped" }, { count: bulkReceipt.skippedAgentIds.length })}</>
                )}
              </Banner>
            )}
            {bulkChangeModelEnabled && bulkReceipt?.kind === "partial" && (
              <Banner
                intent="warning"
                density="sm"
                withIcon
                data-testid="bulk-model-partial-banner"
                actions={
                  <div className="flex items-center gap-1.5">
                    {canManageMachines && (
                      <Button size="sm" variant="outline" type="button" onClick={retryBulkModel} data-testid="bulk-model-try-again">
                        {formatMessage({ id: "machine.detail.bulkModel.tryAgain" })}
                      </Button>
                    )}
                    <Button size="icon-sm" variant="ghost" type="button" onClick={dismissBulkReceipt} aria-label={formatMessage({ id: "machine.detail.bulkModel.dismiss" })}>
                      <X size={14} />
                    </Button>
                  </div>
                }
              >
                <span className="font-bold">
                  {formatMessage({ id: "machine.detail.bulkModel.partialBanner" }, { failed: bulkReceipt.unfinished.length, total: bulkReceipt.total })}
                </span>
              </Banner>
            )}
            {canManageMachines && selectedCount > 0 && (
              // The bulk toolbar is about the selected rows: the selection's
              // cyan-soft wash (SurfaceListItem selected).
              <SurfaceListItem selected interactive={false} className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <SectionEyebrow tone="ink" className="mr-auto">
                    {formatMessage({ id: "machine.detail.selectedCount" }, { count: selectedCount })}
                  </SectionEyebrow>
                  <Tooltip content={
                      !canStartLike
                        ? formatMessage({ id: "machine.detail.mustBeOnlineToStartAgents" })
                        : formatMessage({ id: "machine.detail.startSelectedOfflineAgents" })
                    }>
                  <Button size="sm"
                    variant="success"
                    type="button"
                    onClick={startSelectedAgents}
                    disabled={bulkAction !== null || selectedOfflineAgents.length === 0 || !canStartLike}
                  >
                    <Play size={16} />
                    {bulkAction === "start"
                      ? formatMessage({ id: "machine.detail.starting" })
                      : formatMessage({ id: "machine.detail.start" })}
                  </Button>
                  </Tooltip>
                  <Tooltip content={formatMessage({ id: "machine.detail.stopSelectedOnlineAgents" })}>
                  <Button size="sm"
                    variant="outline"
                    type="button"
                    onClick={openStopConfirm}
                    disabled={bulkAction !== null || selectedOnlineAgents.length === 0}
                  >
                    <Square size={16} />
                    {formatMessage({ id: "machine.detail.stop" })}
                  </Button>
                  </Tooltip>
                  <Tooltip content={
                      !canStartLike
                        ? formatMessage({ id: "machine.detail.mustBeOnlineToRestartAgents" })
                        : formatMessage({ id: "machine.detail.restartOrResetSelectedAgents" })
                    }>
                  <Button size="sm"
                    variant="outline"
                    type="button"
                    onClick={openResetOptions}
                    disabled={bulkAction !== null || !canStartLike}
                  >
                    <RotateCcw size={16} />
                    {formatMessage({ id: "machine.detail.restartReset" })}
                  </Button>
                  </Tooltip>
                  {bulkChangeModelEnabled && (
                    <Tooltip content={formatMessage({ id: "machine.detail.bulkModel.tooltip" })}>
                    <Button size="sm"
                      variant="outline"
                      type="button"
                      onClick={openBulkModel}
                      disabled={bulkAction !== null || selectedCount === 0}
                      data-testid="bulk-change-model-button"
                    >
                      <ArrowLeftRight size={16} />
                      {formatMessage({ id: "machine.detail.bulkModel.button" })}
                    </Button>
                    </Tooltip>
                  )}
                </div>
                {bulkError && (
                  <Banner intent="warning" density="sm" className="mt-2">
                    {bulkError}
                  </Banner>
                )}
              </SurfaceListItem>
            )}
            {/* DS ListRow › `rf-list--inset`: the agents are one card with
                hairlines between rows (AvatarListRow is a raft-ui ListRow). */}
            <ListRowGroup>
              {machineAgents.map((agent) => (
                <MachineAgentRow
                  key={agent.id}
                  agent={agent}
                  displayState={displayStateFor(agent)}
                  selectionMode={selectionMode}
                  selected={selectedAgentIds.has(agent.id)}
                  canManageMachines={canManageMachines}
                  onToggleSelection={toggleAgentSelection}
                  onOpenAgent={openAgent}
                  highlighted={!!highlightedIds?.includes(agent.id)}
                />
              ))}
            </ListRowGroup>
          </div>
        )}
      </div>

      {canManageMachines && showCreateAgent && (
        <CreateAgentDialog
          defaultMachineId={machine.id}
          onClose={closeCreateAgent}
        />
      )}

      {bulkModelDialog && bulkModelAgents.length > 0 && (
        <BulkChangeModelDialog
          machine={machine}
          agents={bulkModelAgents}
          isRunning={isAgentRunning}
          canViewUsage={canViewRuntimeAccountUsage}
          retry={bulkModelDialog.retry}
          onClose={closeBulkModel}
          onOpenAgent={openAgent}
          onFinished={finishBulkModel}
        />
      )}

      {showResetOptions && (
        <DialogCard title={formatMessage({ id: "machine.detail.restartAgentCount" }, { count: selectedCount })} onClose={closeResetOptions}>
            <div className="space-y-3">
              {bulkResetOptions.map((opt) => (
                <BulkResetOptionCard
                  key={opt.mode}
                  option={opt}
                  selected={bulkResetMode === opt.mode}
                  disabled={bulkAction !== null}
                  onSelect={setBulkResetMode}
                />
              ))}
            </div>
            {bulkResetMode === "full" && (
              <Banner intent="destructive" density="sm" withIcon className="mt-3">
                {formatMessage({ id: "machine.detail.fullResetWarning" })}
              </Banner>
            )}
            {/* Raft DS Dialog: Cancel (ghost) on the left, the confirm's colour
                says the consequence — restarting or resetting the session
                interrupts but recovers (orange); a full reset cannot be undone (red). */}
            <div className="mt-5 flex justify-end gap-2">
              <Button size="lg"
                variant="ghost"
                type="button"
                onClick={closeResetOptions}
              >
                {formatMessage({ id: "common.confirm.cancel" })}
              </Button>
              <Button size="lg"
                variant={bulkResetMode === "full" ? "danger" : "warning"}
                type="button"
                onClick={resetSelectedAgents}
                disabled={bulkAction !== null}
              >
                <RotateCcw size={16} />
                {bulkAction
                  ? formatMessage({ id: "machine.detail.restarting" })
                  : bulkResetOptions.find((opt) => opt.mode === bulkResetMode)!.label}
              </Button>
            </div>
        </DialogCard>
      )}

      {showStopConfirm && (
        <ConfirmDialog
          title={formatMessage({ id: "machine.detail.stopAgentsTitle" })}
          message={formatMessage({ id: "machine.detail.stopAgentsMessage" }, { count: selectedOnlineAgents.length })}
          confirmLabel={formatMessage({ id: "machine.detail.stopAgentsTitle" })}
          loadingLabel={formatMessage({ id: "machine.detail.stopping" })}
          confirmVariant="warning"
          onConfirm={stopSelectedAgents}
          onClose={closeStopConfirm}
        />
      )}
    </>
  );
}

export default function MachineDetailPanel({
  machine,
  hideHeader = false,
  deploymentEnv = import.meta.env?.VITE_DEPLOYMENT_ENV,
}: {
  machine: Machine;
  hideHeader?: boolean;
  deploymentEnv?: string;
}) {
  const { formatDate, formatMessage, locale } = useIntl();
  const formatMessageRef = useRef(formatMessage);
  formatMessageRef.current = formatMessage;
  const deleteMachine = useMachineStore((s) => s.deleteMachine);
  const renameMachine = useMachineStore((s) => s.renameMachine);
  const updateMachineDetails = useMachineStore((s) => s.updateMachineDetails);
  const latestComputerVersion = useMachineStore((s) => s.latestComputerVersion);
  const latestComputerReleaseNotes = useMachineStore((s) => s.latestComputerReleaseNotes);
  // "Is it up to date" is the web's own comparison with the latest published
  // version, independent of whether web upgrade is switched on.
  const computerVersionFact = getComputerVersionFact(machine, latestComputerVersion);
  const diskLow = machineDiskLowPresentation(machine, formatMessage);
  // "What's new" follows the "v… available" hint, with or without an
  // Upgrade button (artin). Online: in the action row. Offline (no action
  // row): beside the hint. Display only; not gated by remote_computer_upgrade_v2.
  // Only notes for exactly the version the page offers (the policy's upgrade
  // target when it has one, else the latest published version). Shared by
  // both placements so the offline one can't show mismatched notes.
  const releaseNotesForUpdate = computerVersionFact.kind === "outdated"
    && latestComputerReleaseNotes
    && latestComputerReleaseNotes.version === computerVersionFact.availableVersion
    ? latestComputerReleaseNotes
    : null;
  const openProfile = useProfileStore((s) => s.openProfile);
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);
  const allAgents = useAgentStore((s) => s.agents);
  const { capabilities } = useServerPermissions();
  const machineAgents = allAgents.filter((a) => !a.deletedAt && a.machineId === machine.id);
  const serverId = useServerStore((s) => s.current?.id ?? null);
  const serverSlug = useServerStore((s) => s.current?.slug);
  const onMobileBack = useMobileBack(serverSlug ? `/s/${serverSlug}/settings` : "/");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // Collapsed-by-default install/setup fallback on the offline Computer
  // recovery card. The primary path remains start/status/doctor, while this
  // plainly labelled escape hatch also works when the binary is not installed.
  const [showRecoverySetup, setShowRecoverySetup] = useState(false);
  const [recoveryGuideContext, setRecoveryGuideContext] = useState<{
    machineId: string;
    status: Machine["status"];
  }>({ machineId: machine.id, status: machine.status });
  const [recoveryGuideDisclosure, setRecoveryGuideDisclosure] = useState<boolean | null>(null);
  const recoveryGuideContentId = `computer-recovery-guide-content-${useId()}`;
  if (recoveryGuideContext.machineId !== machine.id || recoveryGuideContext.status !== machine.status) {
    setRecoveryGuideContext({ machineId: machine.id, status: machine.status });
    setRecoveryGuideDisclosure(null);
  }
  const [copiedCommand, setCopiedCommand] = useState<CommandCopyTarget | null>(null);
  const [editingName, setEditingName] = useState(false);
  // Per-machine Computer operation progress (upgrade/restart) — from machineStore.
  // oxlint-disable-next-line react-doctor/no-event-handler -- per-machine hot-slice selector mandated by the Render-cost contract (docs/frontend/render-cost-contract.md): it must close over the machine.id prop to subscribe to ONLY this machine's progress entry. Subscribing to the whole computerOperationProgress record to avoid the prop would re-render this panel on every machine's progress change — the exact cost the contract forbids. Heuristic false positive, YMNNE-family.
  const computerOperationProgress = useMachineStore((s) => s.computerOperationProgress[machine.id] ?? null);
  const setComputerOperation = useMachineStore((s) => s.setComputerOperation);
  // draftName is only read while editingName=true. handleStartRename seeds
  // it from machine.name before flipping editingName, so an empty initial
  // value never reaches the rendered input. Initializing with the prop
  // would freeze the mirror on first mount and is what react-doctor's
  // no-derived-useState guards against.
  const [draftName, setDraftName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [editingDescription, setEditingDescription] = useState(false);
  const [draftDescription, setDraftDescription] = useState("");
  const [savingDescription, setSavingDescription] = useState(false);
  const [descriptionError, setDescriptionError] = useState("");
  const descriptionInputRef = useRef<HTMLTextAreaElement>(null);

  const serverUrl = getServerUrl();
  const savedKey = localStorage.getItem(`slock_machine_apikey_${machine.id}`);
  // Validate cached key against server's apiKeyPrefix to detect stale keys
  const isKeyValid = savedKey && machine.apiKeyPrefix && savedKey.startsWith(machine.apiKeyPrefix);
  if (savedKey && !isKeyValid) {
    localStorage.removeItem(`slock_machine_apikey_${machine.id}`);
  }
  const setupMachineId = machine.isComputer ? null : machine.id;
  const computerCommands = getComputerCommands(serverSlug, deploymentEnv, serverUrl, {
    legacyApiKey: isKeyValid ? savedKey : null,
    // Identity-carried migration (task #239): this page knows WHICH row the
    // computer is, so the setup command adopts it directly (--machine <id>) —
    // no fingerprint matching, works after key rotation. Legacy rows only;
    // Computer rows keep the plain setup command.
    machineId: setupMachineId,
  });
  const windowsMachine = machine.os?.toLowerCase().startsWith("win") ?? false;
  const windowsComputerCommands = getComputerCommands(serverSlug, deploymentEnv, serverUrl, {
    legacyApiKey: isKeyValid ? savedKey : null,
    machineId: setupMachineId,
    platform: "windows",
  });
  const computerFreshInstallCommands = getComputerCommands(serverSlug, deploymentEnv, serverUrl, {
    legacyApiKey: isKeyValid ? savedKey : null,
    machineId: setupMachineId,
    // No version pin: the installer resolves the latest release itself, and a
    // pin copied from a page opened before a release would install the older one.
    platform: windowsMachine ? "windows" : "mac-linux",
  });
  const machineComputerCommands = windowsMachine ? windowsComputerCommands : computerCommands;
  const computerSetupCommand = machineComputerCommands?.setup ?? null;
  const computerInstall = machineComputerCommands?.install ?? null;
  const computerFreshInstall = computerFreshInstallCommands?.install ?? null;
  const computerInstallRestartCommand = computerFreshInstallCommands?.restartService ?? null;
  // Address recovery to the current server. Restart handles both local
  // failure shapes the server sees as "offline": a stopped service (stop is
  // a no-op, then start) and a live runner whose server connection is stuck.
  // The CLI's supervisor restart can cycle other managed runners in the same
  // home; taking this from the command bundle keeps staging/slockdev on their
  // per-server RAFT_HOME + binary path.
  const computerRecoveryRestartCommand = machineComputerCommands?.restart ?? null;
  const terminalStatusCommands = machineComputerCommands
    ? [
        { command: machineComputerCommands.status, target: "terminal-status" as const },
        { command: machineComputerCommands.doctor, target: "terminal-doctor" as const },
      ]
    : [];
  const terminalRestartCommand = machineComputerCommands?.restart ?? null;
  // A user choice applies only to the current machine + current health state.
  // When either changes, fall back to the product default immediately: healthy
  // Computers stay collapsed, while an offline Computer exposes recovery.
  const showRecoveryGuide = recoveryGuideDisclosure ?? machine.status !== "online";
  const canManageMachines = machine.computerAttachedByCurrentUser === true
    || (currentUserId !== null && machine.creator?.id === currentUserId)
    || [
    capabilities.editMachines,
    capabilities.controlComputers,
    capabilities.removeMachines,
    capabilities.rotateMachineKeys,
    capabilities.createAgents,
    capabilities.migrateAgents,
    ].some(Boolean);
  const canViewRuntimeAccountUsage = canViewMachineRuntimeAccountUsage(machine, currentUserId, capabilities);
  // task #1268: explicit detection state from the server (never inferred from an empty list).
  const rescanRuntimes = useMachineStore((s) => s.rescanRuntimes);
  const { state: rescanState, rescan: onRescanRuntimes } = useRuntimeRescan(machine.id, rescanRuntimes);
  const runtimeDetection = machine.runtimeDetection ?? null;
  // Endpoint-equivalent eligibility (servers.ts rescan route: machine creator
  // or the editMachines capability) — never the broader canManageMachines.
  const canRescanRuntimes = capabilities.editMachines
    || machine.computerAttachedByCurrentUser === true
    || (currentUserId !== null && machine.creator?.id === currentUserId);
  const detectionReasonLabel = (reason: "deadline" | "child_failed" | "cancelled" | undefined) =>
    formatMessage({ id: `machine.detail.runtimeDetection.reason.${reason ?? "child_failed"}` });
  const handleDelete = useCallback(async () => {
    await deleteMachine(machine.id);
    setShowDeleteConfirm(false);
  }, [deleteMachine, machine.id]);
  const openDeleteConfirm = useCallback(() => setShowDeleteConfirm(true), []);
  const closeDeleteConfirm = useCallback(() => setShowDeleteConfirm(false), []);

  const handleCopy = useCallback((target: CommandCopyTarget) => {
    setCopiedCommand(target);
    setTimeout(() => {
      setCopiedCommand((current) => (current === target ? null : current));
    }, 2000);
  }, []);



  // Remote Computer controls (managed Computer only). The server relays
  // a command to the machine's live connection, which forwards it to the
  // Computer service IPC (restart = restart-service). Remote upgrade v2 is a
  // request row settled by the machine's reconnect; see handleRemoteUpgradeV2.
  // Restart uses an indeterminate bar until the machine comes back online.
  const remoteUpgradeV2Enabled = useServerFeatureFlag(REMOTE_COMPUTER_UPGRADE_V2_FLAG_KEY).enabled;
  const upgradeRequest = machine.upgradeRequest ?? null;
  // A web upgrade restarts the Computer, so it drops offline until the new
  // version reconnects. While the upgrade is in flight that is the restart,
  // not an outage: say so instead of "Offline", for UPGRADE_RECONNECT_GRACE_MS.
  // Past the grace the plain offline card returns with a "didn't reconnect"
  // note; the server's verdict still lands later. Shared with the sidebar row.
  const {
    inFlight: upgradeInFlight,
    reconnecting: upgradeReconnecting,
    overdue: upgradeReconnectOverdue,
  } = useComputerUpgradeReconnect(machine);
  // Below the first v2-capable Computer release (or version unknown) the web
  // cannot drive the upgrade; the same fail-closed shape as the server guard.
  const remoteUpgradeSupported = (machine.remoteUpgradeSupported ?? isRemoteUpgradeSupported(machine.computerVersion)) === true;
  // A refused Upgrade click holds only while every live input that decides
  // whether the one-click upgrade is offered stays the same as when it was
  // refused: this machine and version, the web-upgrade flag, the server's
  // policy (eligibility, reason, revision, target) and whether this version
  // supports remote upgrade. The first change drops it for good (also when a
  // later snapshot matches the refused one again, e.g. a release lookup that
  // failed briefly and recovered), so the card follows the live answer.
  const upgradeAvailabilityKey = JSON.stringify([
    machine.id,
    machine.computerVersion ?? null,
    remoteUpgradeV2Enabled,
    remoteUpgradeSupported,
    machine.computerUpgradeAvailable ?? null,
    machine.computerBroadcastPolicy?.eligibility ?? null,
    machine.computerBroadcastPolicy?.reasonCode ?? null,
    machine.computerBroadcastPolicy?.policyRevision ?? null,
    machine.computerBroadcastPolicy?.targetVersion ?? null,
  ]);
  const [upgradeRefusalState, setUpgradeRefusalState] = useState<{
    availabilityKey: string;
    refusal: UpgradeRefusal;
  } | null>(null);
  if (upgradeRefusalState && upgradeRefusalState.availabilityKey !== upgradeAvailabilityKey) {
    setUpgradeRefusalState(null);
  }
  const upgradeRefusal = upgradeRefusalState?.availabilityKey === upgradeAvailabilityKey
    ? upgradeRefusalState.refusal
    : null;
  const consentedTargetVersion = machine.computerBroadcastPolicy?.targetVersion ?? null;
  // The last request's outcome only while the Computer is still below that
  // request's target: a later manual upgrade makes a failure / no-response
  // line stale.
  const requestOutcomeStillTrue = Boolean(
    upgradeRequest
    && (upgradeRequest.state === "failed" || upgradeRequest.state === "no_response")
    && machine.computerVersion
    && isComputerSemver(machine.computerVersion)
    && isComputerSemver(upgradeRequest.targetVersion)
    && compareComputerVersions(machine.computerVersion, upgradeRequest.targetVersion) < 0,
  );
  const statusCommandText = machineComputerCommands?.status ?? "raft-computer status";
  const statusCommand = <InlineCode>{statusCommandText}</InlineCode>;
  // Click → POST → refreshed row with `upgradeRequest.state === "pending"`
  // takes a moment; without this the button gave no feedback until then.
  // Per-machine store slice (not component state) so a remount mid-request
  // still shows the request in flight and cannot submit it twice.
  // oxlint-disable-next-line react-doctor/no-event-handler -- per-machine hot-slice selector (docs/frontend/render-cost-contract.md), same shape as computerOperationProgress above.
  const upgradeSubmittingVersion = useMachineStore((s) => s.computerUpgradeSubmitting[machine.id] ?? null);
  const handleRemoteUpgradeV2 = useCallback(async () => {
    const serverId = useServerStore.getState().current?.id;
    if (!serverId || !consentedTargetVersion) return;
    const store = useMachineStore.getState();
    if (store.computerUpgradeSubmitting[machine.id]) return;
    store.setComputerUpgradeSubmitting(machine.id, consentedTargetVersion);
    setUpgradeRefusalState(null);
    try {
      const { data } = await api.post<{ upgradeRequest?: MachineUpgradeRequest }>(
        `/servers/${serverId}/machines/${machine.id}/computer/upgrade`,
        { targetVersion: consentedTargetVersion },
        { headers: { "X-Server-Id": serverId } },
      );
      // Keep the accepted request: the page says "upgrading" from this answer,
      // not from whichever later refresh happens to carry the pending row.
      if (data?.upgradeRequest) useMachineStore.getState().setComputerUpgradeAccepted(machine.id, data.upgradeRequest);
      // Hold the in-flight state until the refreshed row (with the server's
      // pending request) lands, so the button doesn't flash back meanwhile.
      await useMachineStore.getState().loadMachines();
    } catch (err) {
      const code = (err as { response?: { data?: { code?: unknown } } })?.response?.data?.code;
      setUpgradeRefusalState({
        availabilityKey: upgradeAvailabilityKey,
        refusal: upgradeRefusalFromCode(typeof code === "string" ? code : undefined),
      });
      void useMachineStore.getState().loadMachines();
    } finally {
      useMachineStore.getState().setComputerUpgradeSubmitting(machine.id, null);
    }
  }, [consentedTargetVersion, machine.id, upgradeAvailabilityKey]);
  const handleRemoteUpgradeV2Click = useCallback(() => {
    void handleRemoteUpgradeV2();
  }, [handleRemoteUpgradeV2]);
  const handleComputerRestart = useCallback(async () => {
    const serverId = useServerStore.getState().current?.id;
    if (!serverId) return;
    // Optimistically enter progress state before the POST returns.
    setComputerOperation(machine.id, { operation: "restart" });
    try {
      const { data } = await api.post(
        `/servers/${serverId}/machines/${machine.id}/computer/restart`,
        {},
        { headers: { "X-Server-Id": serverId } },
      );
      const requestId = (data as { requestId?: string })?.requestId;
      if (requestId) {
        setComputerOperation(machine.id, { operation: "restart", requestId });
      }
    } catch (err) {
      const errorData = (err as { response?: { data?: { code?: string; error?: string } } })?.response?.data;
      const code = errorData?.code;
      const serverError = typeof errorData?.error === "string" && errorData.error.trim().length > 0
        ? errorData.error
        : null;
      let errorMsg = serverError ?? formatMessage({ id: "machine.detail.restartRequestFailed" });
      if (code === "computer_offline") {
        errorMsg = formatMessage({ id: "machine.detail.computerOffline" });
      }
      setComputerOperation(machine.id, { operation: "restart", done: true, error: errorMsg });
      // Auto-clear error after 4s so the button reappears.
      setTimeout(() => setComputerOperation(machine.id, null), 4000);
    }
  }, [formatMessage, machine.id, setComputerOperation]);
  const handleComputerRestartClick = useCallback(() => {
    void handleComputerRestart();
  }, [handleComputerRestart]);
  // Clear terminal operation state after a display pause.
  useEffect(() => {
    if (computerOperationProgress?.done) {
      const t = setTimeout(() => setComputerOperation(machine.id, null), 3000);
      return () => clearTimeout(t);
    }
  }, [computerOperationProgress?.done, machine.id, setComputerOperation]);

  // Safety timeout: if an operation is in progress but no WS frames arrive
  // (e.g. HTTP server down, daemon didn't receive the command), reset to
  // buttons after 60s so the user isn't stuck with no way to retry.
  useEffect(() => {
    if (computerOperationProgress && !computerOperationProgress.done) {
      const t = setTimeout(() => {
        setComputerOperation(machine.id, {
          ...computerOperationProgress,
          done: true,
          error: formatMessageRef.current({ id: "machine.detail.restartTimedOut" }),
        });
      }, 60_000);
      return () => clearTimeout(t);
    }
  }, [computerOperationProgress, machine.id, setComputerOperation]);

  const handleStartRename = useCallback(() => {
    setDraftName(machine.name);
    setNameError("");
    setEditingName(true);
  }, [machine.name]);

  const handleSaveRename = useCallback(async () => {
    const nextName = draftName.trim();
    if (!nextName) {
      setNameError(formatMessage({ id: "machine.detail.computerNameRequired" }));
      return;
    }
    if (nextName === machine.name) {
      setEditingName(false);
      setDraftName(machine.name);
      return;
    }
    setNameError("");
    setSavingName(true);
    try {
      await renameMachine(machine.id, nextName);
      setEditingName(false);
    } catch {
      setNameError(formatMessage({ id: "machine.detail.renameComputerFailed" }));
    } finally {
      setSavingName(false);
    }
  }, [draftName, formatMessage, machine.id, machine.name, renameMachine]);
  const handleSaveRenameClick = useCallback(() => {
    void handleSaveRename();
  }, [handleSaveRename]);

  const handleCancelRename = useCallback(() => {
    setDraftName(machine.name);
    setNameError("");
    setEditingName(false);
  }, [machine.name]);

  const handleNameChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setDraftName(e.target.value.replace(/[\r\n]+/g, " "));
    if (nameError) setNameError("");
  }, [nameError]);

  const handleNameKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleSaveRename();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      handleCancelRename();
    }
  }, [handleCancelRename, handleSaveRename]);

  const handleStartEditDescription = useCallback(() => {
    setDraftDescription(machine.description ?? "");
    setDescriptionError("");
    setEditingDescription(true);
  }, [machine.description]);

  const handleSaveDescription = useCallback(async () => {
    const nextDescription = draftDescription.trim();
    if (nextDescription.length > 500) {
      setDescriptionError(formatMessage({ id: "machine.detail.descriptionTooLong" }));
      return;
    }
    const currentDescription = machine.description ?? "";
    if (nextDescription === currentDescription) {
      setEditingDescription(false);
      setDraftDescription(currentDescription);
      return;
    }
    setDescriptionError("");
    setSavingDescription(true);
    try {
      await updateMachineDetails(machine.id, { description: nextDescription || null });
      setEditingDescription(false);
    } catch {
      setDescriptionError(formatMessage({ id: "machine.detail.updateDescriptionFailed" }));
    } finally {
      setSavingDescription(false);
    }
  }, [draftDescription, formatMessage, machine.description, machine.id, updateMachineDetails]);
  const handleSaveDescriptionClick = useCallback(() => {
    void handleSaveDescription();
  }, [handleSaveDescription]);

  const handleCancelDescription = useCallback(() => {
    setDraftDescription(machine.description ?? "");
    setDescriptionError("");
    setEditingDescription(false);
  }, [machine.description]);

  const handleDescriptionChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setDraftDescription(e.target.value);
    if (descriptionError) setDescriptionError("");
  }, [descriptionError]);

  const handleDescriptionKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void handleSaveDescription();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      handleCancelDescription();
    }
  }, [handleCancelDescription, handleSaveDescription]);

  const mobileBackProps = useMemo(() => ({
    "data-testid": "machine-mobile-back",
    title: formatMessage({ id: "common.announcement.back" }),
  }), [formatMessage]);

  const createdDate = formatDate(machine.createdAt, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const lastHeartbeatText = formatRelativeTime(machine.lastHeartbeat, locale);
  const lastHeartbeatParenthetical = lastHeartbeatText
    ? formatMessage({ id: "machine.detail.lastSeenParenthetical" }, { time: lastHeartbeatText })
    : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col font-sans">
      {!hideHeader && (
        <PanelHeader
          title={machine.name}
          icon={<Monitor size={18} />}
          iconAlwaysVisible
          onMobileBack={onMobileBack}
          mobileBackProps={mobileBackProps}
        />
      )}

      <div className="flex-1 overflow-y-auto bg-layer-canvas">
        {/* Profile info — machine tile + name + status chip + hostname.
            A computer is a thing, not a person: a neutral square tile. */}
        <div className="flex items-start gap-4 px-5 py-5">
          <IconTile size="lg">
            <Monitor aria-hidden="true" />
          </IconTile>
          <div className="min-w-0 flex-1 space-y-1">
            <PanelTitle className="min-w-0">{machine.name}</PanelTitle>
            {/* Raft DS StatusChip: soft wash, square pixel, one word — online
                lime, a web upgrade's reconnect is busy (yellow), offline stone. */}
            <div className="flex min-w-0 items-center gap-2">
              <Badge
                appearance="soft"
                variant={machine.status === "online" ? "success" : upgradeReconnecting ? "primary" : "muted"}
                className="shrink-0"
              >
                <Status
                  size="md"
                  variant={machine.status === "online" ? "success" : upgradeReconnecting ? "primary" : "default"}
                  aria-hidden="true"
                />
                <span data-testid="machine-connection-status">
                  {machine.status === "online"
                    ? formatMessage({ id: "machine.detail.connected" })
                    : upgradeReconnecting
                      ? formatMessage({ id: "machine.detail.upgradeV2.inProgress" })
                      : formatMessage({ id: "machine.detail.offline" })}
                </span>
              </Badge>
            </div>
            {machine.hostname && (
              <div className="truncate font-mono text-mono-meta text-foreground-hint">{machine.hostname}</div>
            )}
          </div>
        </div>
        <Separator />

        {/* Host slot (desktop task #124): local controls for the machine the
            Electron shell runs on (start / stop / restart / reinstall the
            Computer service) are portaled in here by the desktop, so they live
            where every machine's actions live — the detail panel — instead of
            inside the sidebar row. Empty (zero-height) on the web. */}
        <div data-testid="machine-detail-local-slot" data-machine-id={machine.id} className="empty:hidden" />

        {diskLow && (
          <div className="px-5 pt-4">
            <Banner
              intent="warning"
              density="sm"
              title={formatMessage({ id: "machine.diskLow.bannerTitle" }, { free: diskLow.free, percent: diskLow.freePercent })}
              data-testid="machine-detail-disk-low"
            >
              {formatMessage({ id: "machine.diskLow.bannerBody" })}
            </Banner>
          </div>
        )}

        {/* Name */}
        <div className="px-5 py-4">
          <div className="flex items-center gap-2 mb-1">
            <SectionEyebrow as="div">
              {formatMessage({ id: "machine.detail.name" })}
            </SectionEyebrow>
            {canManageMachines && !editingName && (
              <Tooltip content={formatMessage({ id: "machine.detail.editComputerName" })}>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={handleStartRename}
                aria-label={formatMessage({ id: "machine.detail.editComputerName" })}
              >
                <Pencil size={14} />
              </Button>
              </Tooltip>
            )}
          </div>
          {canManageMachines && editingName ? (
            <div className="space-y-2">
              <Input
                ref={nameInputRef}
                value={draftName}
                onChange={handleNameChange}
                onKeyDown={handleNameKeyDown}
                className="w-full"
                placeholder={formatMessage({ id: "machine.detail.computerName" })}
                autoFocus
                disabled={savingName}
              />
            <div className="flex items-center gap-1.5">
              <Button size="sm"
                  variant="accent"
                  onClick={handleSaveRenameClick}
                  disabled={savingName}
                >
                  {formatMessage({ id: "machine.detail.save" })}
                </Button>
                <Button size="sm"
                  variant="ghost"
                  onClick={handleCancelRename}
                  disabled={savingName}
                >
                {formatMessage({ id: "common.confirm.cancel" })}
              </Button>
            </div>
            {nameError && (
              <div className="text-caption text-danger-strong">
                {nameError}
              </div>
            )}
            </div>
          ) : (
            <p className="text-callout text-foreground">{machine.name}</p>
          )}
        </div>
        <Separator />

        {/* Description */}
        <div className="px-5 py-4">
          <div className="flex items-center gap-2 mb-1">
            <SectionEyebrow as="div">
              {formatMessage({ id: "machine.detail.description" })}
            </SectionEyebrow>
            {canManageMachines && !editingDescription && (
              <Tooltip content={formatMessage({ id: "machine.detail.editComputerDescription" })}>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={handleStartEditDescription}
                aria-label={formatMessage({ id: "machine.detail.editComputerDescription" })}
              >
                <Pencil size={14} />
              </Button>
              </Tooltip>
            )}
          </div>
          {canManageMachines && editingDescription ? (
            <div className="space-y-2">
              <Textarea
                ref={descriptionInputRef}
                value={draftDescription}
                onChange={handleDescriptionChange}
                onKeyDown={handleDescriptionKeyDown}
                className="min-h-20 w-full resize-y"
                placeholder={formatMessage({ id: "machine.detail.descriptionPlaceholder" })}
                maxLength={500}
                autoFocus
                disabled={savingDescription}
              />
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Button size="sm"
                    variant="accent"
                    onClick={handleSaveDescriptionClick}
                    disabled={savingDescription}
                  >
                    {formatMessage({ id: "machine.detail.save" })}
                  </Button>
                  <Button size="sm"
                    variant="ghost"
                    onClick={handleCancelDescription}
                    disabled={savingDescription}
                  >
                    {formatMessage({ id: "common.confirm.cancel" })}
                  </Button>
                </div>
                <span className="font-mono text-mono-meta text-foreground-hint">
                  {draftDescription.length}/500
                </span>
              </div>
              {descriptionError && (
                <div className="text-caption text-danger-strong">
                  {descriptionError}
                </div>
              )}
            </div>
          ) : (
            <p className={`whitespace-pre-wrap text-callout ${machine.description ? "text-foreground" : "text-foreground-hint"}`}>
              {machine.description || formatMessage({ id: "machine.detail.noDescription" })}
            </p>
          )}
        </div>
        <Separator />

        {/* Info */}
        <div className="px-5 py-4">
          <SectionEyebrow as="div" className="mb-3">
            {formatMessage({ id: "machine.detail.info" })}
          </SectionEyebrow>
          {/* Raft DS PropertyList (stacked): label 13/18 500 ink-3 above each
              value; what machines write (OS, versions, runtimes, dates) in
              Space Mono. KeyValueRow owns the label/value type. */}
          <div className="space-y-3">
            {/* OS */}
            {machine.os && <KeyValueRow label={formatMessage({ id: "machine.detail.osLabel" })} value={machine.os} mono />}
            {/* Version — a managed Computer shows its `@botiverse/raft-computer`
                version (computerVersion), which is the one release number
                (docs/operations/computer-release-version.md). Rows connected
                with the retired standalone daemon show no version: there is no
                daemon release line left to compare against. */}
            {machine.isComputer && (
              <KeyValueRow
                label={formatMessage({ id: "machine.detail.computerVersion" })}
                value={
                  machine.computerVersion ? (
                    <div>
                      <span className={`font-mono ${computerVersionFact.kind === "outdated" ? "font-bold text-warning-strong" : "text-foreground"}`}>
                        v{machine.computerVersion}
                      </span>
                      {computerVersionFact.kind === "current" && (
                        <>
                          {" "}
                          <span className="text-caption text-foreground-hint">
                            · {formatMessage({ id: "machine.detail.upToDate" })}
                          </span>
                        </>
                      )}
                      {computerVersionFact.kind === "outdated" && (
                        <>
                          {" "}
                          <span className="text-caption font-bold text-warning-strong">
                            · {formatMessage(
                              { id: "machine.detail.versionAvailable" },
                              { version: computerVersionFact.availableVersion },
                            )}
                          </span>
                        </>
                      )}
                      {releaseNotesForUpdate && machine.status !== "online" && (
                        <>
                          {" "}
                          <ComputerReleaseNotesAffordance notes={releaseNotesForUpdate} />
                        </>
                      )}
                    </div>
                  ) : machine.status === "online" ? (
                    <span className="text-foreground-hint">
                      {formatMessage({ id: "machine.detail.readingVersion" })}
                    </span>
                  ) : (
                    <span className="text-foreground-hint">—</span>
                  )
                }
              />
            )}
            {/* Online, not a manager, newer version exists: say who can act
                (the offline card has its own admin-only line). */}
            {machine.isComputer && !canManageMachines && machine.status === "online" && computerVersionFact.kind === "outdated" && (
              <p className={DETAIL_HELP_CLASS_NAME} data-testid="computer-upgrade-ask-admin">
                {formatMessage(
                  { id: "machine.detail.upgradeStatus.askAdmin" },
                  { version: computerVersionFact.availableVersion },
                )}
              </p>
            )}
            {/* task #1268: detection state. pending / incomplete keep the last confirmed list below. */}
            {machine.status === "online" && runtimeDetection && runtimeDetection.status !== "complete" && (
              <div className={`flex flex-wrap items-center gap-2 ${DETAIL_HELP_CLASS_NAME}`} data-testid="machine-runtime-detection">
                {runtimeDetection.status === "pending" && <Spinner size="sm" aria-hidden="true" />}
                <span>
                  {runtimeDetection.status === "pending"
                    ? formatMessage({ id: "machine.detail.runtimeDetection.pending" })
                    : (runtimeDetection.unfinishedRuntimes ?? []).length > 0
                      ? formatMessage(
                          { id: "machine.detail.runtimeDetection.incomplete" },
                          { reason: detectionReasonLabel(runtimeDetection.reason), runtimes: (runtimeDetection.unfinishedRuntimes ?? []).map((id) => formatRuntimeLabelWithStatus(id, formatMessage)).join(", ") },
                        )
                      : formatMessage({ id: "machine.detail.runtimeDetection.incompleteNone" }, { reason: detectionReasonLabel(runtimeDetection.reason) })}
                </span>
                {runtimeDetection.status === "incomplete" && canRescanRuntimes && (
                  <Button size="sm" variant="outline" disabled={rescanState.status === "running"} onClick={onRescanRuntimes} data-testid="machine-runtime-detection-rescan">
                    {formatMessage({ id: rescanState.status === "running" ? "machine.detail.runtimeDetection.rescanning" : "machine.detail.runtimeDetection.rescan" })}
                  </Button>
                )}
                {runtimeDetection.status === "incomplete" && !canRescanRuntimes && (
                  <span data-testid="machine-runtime-detection-rescan-hint">{formatMessage({ id: "machine.detail.runtimeDetection.rescanNotAllowed" })}</span>
                )}
                {rescanState.status === "failed" && (
                  <span className="text-warning-strong" data-testid="machine-runtime-detection-rescan-error">
                    {formatMessage({ id: `machine.detail.runtimeDetection.rescanFailed.${rescanState.error === "forbidden" ? "forbidden" : "generic"}` })}
                  </span>
                )}
              </div>
            )}
            {/* Detected Runtimes — Raft DS runtime tags drawn by the badge
                recipe: cyan-soft when detected, stone-soft when not. */}
            <KeyValueRow
              label={formatMessage({ id: "machine.detail.detectedRuntimes" })}
              value={
                <div className="flex items-center gap-1.5 flex-wrap">
                  {getMachineRuntimeDisplayOptions().map((r) => {
                    const detected = machine.runtimes.includes(r.id);
                    return (
                      <RuntimeAccountUsageGateChip
                        key={r.id}
                        enabled={detected && canViewRuntimeAccountUsage}
                        runtimeId={r.id}
                        runtimeVersion={machine.runtimeVersions?.[r.id]}
                        serverId={serverId}
                        machineId={machine.id}
                        appearance="soft"
                        variant={detected ? "information" : "muted"}
                      >
                        {formatRuntimeLabelWithStatus(r.id, formatMessage)}{formatRuntimeAvailabilitySuffix(runtimeAvailabilitySuffix(r, machine.runtimes), formatMessage)}
                      </RuntimeAccountUsageGateChip>
                    );
                  })}
                </div>
              }
            />
            <div className="flex flex-wrap gap-x-8 gap-y-3">
              {/* Created */}
              <KeyValueRow
                label={formatMessage({ id: "machine.detail.created" })}
                value={createdDate}
                mono
              />
              {/* Creator — managed Computers only; raw daemon rows preserve
                  their existing Created-only presentation. */}
              {machine.isComputer && (
                <KeyValueRow
                  label={formatMessage({ id: "agent.detail.creator" })}
                  valueClassName="flex items-center gap-2"
                  value={
                    machine.creator ? (
                      <button
                        type="button"
                        onClick={() => openProfile("human", machine.creator!.id)}
                        className="-mx-1.5 flex min-w-0 items-center gap-1.5 rounded-chip px-1.5 py-0.5 text-callout text-foreground outline-none hover:bg-fill-pressed focus-visible:shadow-focus"
                      >
                        <AvatarSlot
                          context="creator-link"
                          type="human"
                          humanAvatarUrl={machine.creator.avatarUrl}
                          gravatarHash={machine.creator.gravatarHash}
                        />
                        <span className="truncate font-semibold">{machine.creator.displayName || machine.creator.name}</span>
                        <span className="font-mono text-mono-meta text-foreground-hint">
                          {formatMessage({ id: "common.handle" }, { name: machine.creator.name })}
                        </span>
                      </button>
                    ) : (
                      <span className="text-foreground-hint">
                        {formatMessage({ id: "agent.detail.noCreatorAssigned" })}
                      </span>
                    )
                  }
                />
              )}
            </div>
          </div>
        </div>
        <Separator />

        <div className="px-5 py-4 space-y-6">
          {/* Rows connected with the retired standalone daemon: the only
              offered action is migrating to Raft Computer (task #239 v2.3
              §19.web). The former "keep using the legacy daemon" section is
              gone with the daemon's npm release; the structure stays
              intent-stable and never restructures on credential state (the
              generate-jump defect class, #wg-raft-computer:5473a4ca). */}
          {!machine.isComputer && canManageMachines && (
            <div className="space-y-6">
              {computerSetupCommand && computerInstall && (
                <div data-testid="computer-migrate-block">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <SectionEyebrow as="div">
                      {formatMessage(
                        { id: "machine.detail.migrateToComputer" },
                        { platform: windowsMachine ? formatMessage({ id: "machine.detail.windowsX64Suffix" }) : "" },
                      )}
                    </SectionEyebrow>
                    {windowsMachine ? <Badge.Experimental /> : null}
                  </div>
                  <p className={`mb-2 ${DETAIL_HELP_CLASS_NAME}`}>
                    {formatMessage(
                      { id: "machine.detail.migrateDescription" },
                      {
                        platform: windowsMachine
                          ? formatMessage({ id: "machine.detail.windowsPowerShell" })
                          : formatMessage({ id: "machine.detail.macLinux" }),
                      },
                    )}
                  </p>
                  <div className="space-y-3">
                    {([
                      ["computer-install", formatMessage({ id: "machine.detail.installStep" }), computerInstall],
                      ["computer-setup", formatMessage({ id: "machine.detail.setupStep" }), computerSetupCommand],
                    ] as const).map(([target, label, command]) => (
                      <div key={target}>
                        <div className={`mb-1 ${DETAIL_STEP_LABEL_CLASS_NAME}`}>{label}</div>
                        <CommandCopyRoot target={target} copied={copiedCommand === target} onCopy={handleCopy}>
                          <CopyableCode className={COMMAND_LINE_CLASS_NAME}>
                            {command}
                          </CopyableCode>
                          <Tooltip content={formatMessage({ id: "machine.detail.copyCommandLabel" }, { label })}>
                            <CopyableCodeAction
                              aria-label={formatMessage({ id: "machine.detail.copyCommandLabel" }, { label })}
                              className="shrink-0"
                            />
                          </Tooltip>
                        </CommandCopyRoot>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {!machine.isComputer && !canManageMachines && machine.status === "offline" && (
            <div>
              <SectionEyebrow as="div" className="mb-2">
                {formatMessage({ id: "machine.detail.connection" })}
              </SectionEyebrow>
              <div className={DETAIL_HELP_CLASS_NAME}>
                {formatMessage({ id: "machine.detail.connectCommandsAdminOnly" })}
              </div>
            </div>
          )}

          {/* Read-before-acting notice (Raft DS Banner, info): the computer is
              restarting into the new version. Part of the page, not news. */}
          {upgradeReconnecting && (
            <Banner
              intent="info"
              live={false}
              data-testid="computer-upgrade-reconnecting"
              icon={<Spinner size="xs" aria-hidden="true" className="mt-1 shrink-0" />}
              title={formatMessage(
                { id: "machine.detail.upgradeStatus.reconnecting" },
                { version: upgradeInFlight?.targetVersion ?? "" },
              )}
            >
              {canManageMachines
                ? formatMessage(
                  { id: "machine.detail.upgradeStatus.reconnectingHint" },
                  { command: statusCommand },
                )
                : null}
            </Banner>
          )}

          {machine.isComputer && machine.status !== "online" && !upgradeReconnecting && (
            <div data-testid="computer-recovery-card">
              <div className="mb-2 flex items-center gap-2">
                <Terminal size={16} className="text-foreground-muted" aria-hidden="true" />
                <SectionEyebrow as="div">{formatMessage({ id: "machine.detail.bringComputerOnline" })}</SectionEyebrow>
              </div>

              {upgradeReconnectOverdue && (
                <p className={`mb-2 ${DETAIL_PROBLEM_CLASS_NAME}`} data-testid="computer-upgrade-reconnect-overdue">
                  {formatMessage(
                    { id: "machine.detail.upgradeStatus.reconnectOverdue" },
                    { version: upgradeInFlight?.targetVersion ?? "" },
                  )}
                </p>
              )}

              {canManageMachines ? (
                <div className="space-y-4">
                  {/* The server already settled the last web upgrade as
                      failed / no response: say so here too, not only on the
                      online card. */}
                  {requestOutcomeStillTrue && (
                    <p className={DETAIL_PROBLEM_CLASS_NAME} data-testid="computer-upgrade-request-outcome">
                      {upgradeRequest?.state === "failed"
                        ? formatMessage(
                            { id: "machine.detail.upgradeStatus.failed" },
                            { version: machine.computerVersion, command: statusCommand },
                          )
                        : formatMessage(
                            { id: "machine.detail.upgradeStatus.noResponse" },
                            { command: statusCommand },
                          )}
                    </p>
                  )}
                  {/* Primary remedy — a local command, platform-independent.
                      Web remote restart/upgrade only works while online (live
                      WS relay), so an offline Computer cannot get a web button. */}
                  {computerRecoveryRestartCommand && (
                    <div>
                      <p className={`mb-2 ${DETAIL_HELP_CLASS_NAME}`}>
                        {formatMessage({ id: "machine.detail.recoveryRestartDescription" }, { serverSlug })}
                      </p>
                      <CommandCopyRoot target="terminal-restart" copied={copiedCommand === "terminal-restart"} onCopy={handleCopy}>
                        <CopyableCode
                          className={COMMAND_LINE_CLASS_NAME}
                          data-testid="computer-recovery-restart"
                        >
                          {computerRecoveryRestartCommand}
                        </CopyableCode>
                        <Tooltip content={formatMessage({ id: "machine.detail.copyCommand" })}>
                          <CopyableCodeAction
                            aria-label={formatMessage({ id: "machine.detail.copyCommand" })}
                            className="shrink-0"
                          />
                        </Tooltip>
                      </CommandCopyRoot>
                    </div>
                  )}

                  {/* Diagnostics — reuse the existing status/doctor commands. */}
                  <div>
                    <p className={`mb-2 ${DETAIL_HELP_CLASS_NAME}`}>
                      {formatMessage({ id: "machine.detail.offlineDiagnosticsPrompt" })}
                    </p>
                    <div className="space-y-2">
                      {terminalStatusCommands.map(({ command, target }) => (
                        <CommandCopyRoot key={command} target={target} copied={copiedCommand === target} onCopy={handleCopy}>
                          <CopyableCode
                            className={COMMAND_LINE_CLASS_NAME}
                            data-testid={`computer-recovery-${target === "terminal-status" ? "status" : "doctor"}`}
                          >
                            {command}
                          </CopyableCode>
                          <Tooltip content={formatMessage({ id: "machine.detail.copyCommand" })}>
                            <CopyableCodeAction
                              aria-label={formatMessage({ id: "machine.detail.copyCommand" })}
                              className="shrink-0"
                            />
                          </Tooltip>
                        </CommandCopyRoot>
                      ))}
                    </div>
                  </div>

                  {/* last-seen — let the user judge if the machine is just
                      off; no offline-reason guessing (frontend can't tell). */}
                  {machine.lastHeartbeat && (
                    <p className={DETAIL_HELP_CLASS_NAME}>
                      {formatMessage(
                        { id: "machine.detail.lastSeen" },
                        { time: lastHeartbeatText },
                      )}
                    </p>
                  )}

                  {/* Secondary: an explicit command-not-found path exposes
                      install + setup without displacing the normal start path. */}
                  <div>
                    <Separator className="mb-3" />
                    <button
                      type="button"
                      onClick={() => setShowRecoverySetup((v) => !v)}
                      className={DETAIL_TEXT_BUTTON_CLASS_NAME}
                      aria-expanded={showRecoverySetup}
                      data-testid="computer-recovery-setup-toggle"
                    >
                      {showRecoverySetup
                        ? formatMessage({ id: "machine.detail.hideInstallSetupCommands" })
                        : formatMessage({ id: "machine.detail.commandNotFoundSetup" })}
                    </button>
                    {showRecoverySetup && computerInstall && computerSetupCommand && (
                      <div className="mt-2 space-y-3">
                        <p className={DETAIL_HELP_CLASS_NAME}>
                          {formatMessage({ id: "machine.detail.installSetupDescription" })}
                          {windowsMachine ? ` ${formatMessage({ id: "machine.detail.windowsInstallerX64Only" })}` : ""}
                        </p>
                        {([
                          ["computer-install", formatMessage({ id: "machine.detail.installStep" }), computerInstall],
                          ["computer-setup", formatMessage({ id: "machine.detail.setupStep" }), computerSetupCommand],
                        ] as const).map(([target, label, command]) => (
                          <div key={target}>
                            <div className={`mb-1 ${DETAIL_STEP_LABEL_CLASS_NAME}`}>{label}</div>
                            <CommandCopyRoot target={target} copied={copiedCommand === target} onCopy={handleCopy}>
                              <CopyableCode
                                className={COMMAND_LINE_CLASS_NAME}
                                data-testid={target === "computer-install" ? "computer-recovery-install" : "computer-recovery-setup"}
                              >
                                {command}
                              </CopyableCode>
                              <Tooltip content={
                                  target === "computer-install"
                                    ? formatMessage({ id: "machine.detail.copyInstallCommand" })
                                    : formatMessage({ id: "machine.detail.copySetupCommand" })
                                }>
                                <CopyableCodeAction
                                  aria-label={
                                    target === "computer-install"
                                      ? formatMessage({ id: "machine.detail.copyInstallCommand" })
                                      : formatMessage({ id: "machine.detail.copySetupCommand" })
                                  }
                                  className="shrink-0"
                                />
                              </Tooltip>
                            </CommandCopyRoot>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <p className={DETAIL_HELP_CLASS_NAME}>
                  {formatMessage(
                    { id: "machine.detail.offlineAdminOnly" },
                    { time: lastHeartbeatParenthetical },
                  )}
                </p>
              )}
            </div>
          )}

          {/* Agents on this machine — isolated to prevent activity re-renders */}
          <MachineAgentList machine={machine} canManageMachines={canManageMachines} canViewRuntimeAccountUsage={canViewRuntimeAccountUsage} />

          {/* Agent Workspaces — only when machine is online */}
          {machine.status === "online" && (
            <div className="mt-2">
              <Separator className="mb-4" />
              <WorkspacesSection machineId={machine.id} canManageMachines={canManageMachines} />
            </div>
          )}

          {/* Actions */}
          {canManageMachines && (
            <div className="mt-2">
              <Separator className="mb-4" />
              <SectionEyebrow as="div" className="mb-3">
                {formatMessage({ id: "machine.detail.actions" })}
              </SectionEyebrow>
              {/* Remote restart / upgrade — managed Computer only (a raw
                  daemon has no remotely-controllable service). Online-only:
                  offline recovery is the recovery card's job (task #247). */}
              {machine.isComputer && machine.status === "online" && (
                <Card className="p-4 mb-3" data-testid="computer-service-actions">
                  <div className="mb-1 text-subhead font-bold text-foreground">
                    {formatMessage({ id: "machine.detail.computer" })}
                  </div>
                  {computerOperationProgress ? (
                    /* Progress mode — show bar instead of buttons */
                    <div className="space-y-2">
                      {computerOperationProgress.done ? (
                        <div className={`flex items-center gap-2 font-mono text-mono-meta ${computerOperationProgress.error ? "text-warning-strong" : "text-foreground-muted"}`}>
                          {computerOperationProgress.error ? (
                            <AlertCircle size={14} className="shrink-0" />
                          ) : (
                            <CheckCircle size={14} className="shrink-0" />
                          )}
                          {computerOperationProgress.error
                            ? (
                              computerOperationProgress.error === "restart_failed"
                                ? formatMessage({ id: "machine.restartFailed" })
                                : computerOperationProgress.error
                            )
                            : formatMessage({ id: "machine.detail.restarted" })}
                        </div>
                      ) : (
                        <>
                          <ProgressBar
                            value={computerOperationProgress.progressValue ?? null}
                            tone="cyan"
                            label={computerOperationProgress.message ?? formatMessage({ id: "machine.detail.restarting" })}
                          />
                        </>
                      )}
                    </div>
                  ) : (
                    /* Default mode — one status sentence, then exactly one
                       next step: a button, or the commands to run on that
                       machine (never both). */
                    (() => {
                      const policy = machine.computerBroadcastPolicy;
                      const policyTargetVersion = policy?.targetVersion ?? null;
                      // Web upgrade is off when this client's flag is off or the
                      // server's broadcast gate is closed (same flag server-side).
                      const broadcastGated = policy?.reasonCode === "broadcast_disabled"
                        || policy?.reasonCode === "broadcast_gate_unavailable";
                      const webUpgradeOn = remoteUpgradeV2Enabled && !broadcastGated;
                      const oneClickTarget = machine.computerUpgradeAvailable === true
                        && policy?.eligibility === "eligible"
                        && policyTargetVersion
                        ? policyTargetVersion
                        : null;
                      type CardState =
                        | { kind: "reading" }
                        | { kind: "cannotCheck" }
                        | { kind: "upToDate" }
                        | { kind: "upgrading"; version: string }
                        | { kind: "oneClick"; version: string }
                        | { kind: "commands"; version: string; sentence: "runCommands" | "refusedNotAllowed" };
                      const cardState: CardState = (() => {
                        const fact = computerVersionFact;
                        if (fact.kind === "unknown") return { kind: "reading" };
                        if (fact.kind === "cannotCheck") return { kind: "cannotCheck" };
                        if (fact.kind === "current") return { kind: "upToDate" };
                        const version = fact.availableVersion;
                        if (upgradeInFlight) return { kind: "upgrading", version: upgradeInFlight.targetVersion };
                        if (upgradeSubmittingVersion) return { kind: "upgrading", version: upgradeSubmittingVersion };
                        if (upgradeRefusal === "not_allowed") return { kind: "commands", version, sentence: "refusedNotAllowed" };
                        // Web upgrade off or refused, or this version too old for
                        // it: the same "run these two commands" state.
                        if (upgradeRefusal === "web_upgrade_off" || upgradeRefusal === "too_old") return { kind: "commands", version, sentence: "runCommands" };
                        if (webUpgradeOn && remoteUpgradeSupported && oneClickTarget) return { kind: "oneClick", version: oneClickTarget };
                        return { kind: "commands", version, sentence: "runCommands" };
                      })();
                      const statusSentence = (() => {
                        switch (cardState.kind) {
                          case "reading":
                            return formatMessage({ id: "machine.detail.upgradeStatus.readingVersion" });
                          case "cannotCheck":
                            return formatMessage({ id: "machine.detail.upgradeStatus.cannotCheck" });
                          case "upToDate":
                            return formatMessage({ id: "machine.detail.upgradeStatus.upToDate" });
                          case "upgrading":
                            return formatMessage({ id: "machine.detail.upgradeStatus.inProgress" }, { version: cardState.version });
                          case "oneClick":
                            return formatMessage({ id: "machine.detail.upgradeStatus.available" }, { version: cardState.version });
                          case "commands":
                            return formatMessage({ id: `machine.detail.upgradeStatus.${cardState.sentence}` }, { version: cardState.version });
                        }
                      })();
                      // Install the latest release, then restart.
                      const upgradeCommands = cardState.kind === "commands" ? computerFreshInstallCommands : null;
                      const upgradeInstallCommand = upgradeCommands?.install ?? null;
                      const upgradeRestartCommand = upgradeCommands?.restartService ?? null;
                      // The last request's outcome only while the Computer is
                      // still below that request's target: a later manual
                      // upgrade makes a failure / no-response line stale.
                      const machineVersion = machine.computerVersion ?? null;
                      const outcomeLine = cardState.kind === "oneClick" && upgradeRefusal === "unknown"
                        ? formatMessage({ id: "machine.detail.upgradeStatus.refusedUnknown" })
                        : cardState.kind !== "upgrading" && cardState.kind !== "upToDate" && requestOutcomeStillTrue
                          ? upgradeRequest?.state === "failed"
                            ? formatMessage(
                                { id: "machine.detail.upgradeStatus.failed" },
                                { version: machineVersion, command: statusCommand },
                              )
                            : formatMessage(
                                { id: "machine.detail.upgradeStatus.noResponse" },
                                { command: statusCommand },
                              )
                          : null;
                      return (
                        <>
                          <p className={`mb-3 ${DETAIL_HELP_CLASS_NAME}`} data-testid="computer-upgrade-status">
                            {statusSentence}
                          </p>
                          <div className="flex flex-wrap items-center gap-2" data-testid="computer-upgrade-actions">
                            {cardState.kind !== "upgrading" && (
                              <Tooltip content={formatMessage({ id: "machine.detail.restartTooltip" })}>
                              <Button size="sm"
                                variant="outline"
                                onClick={handleComputerRestartClick}
                              >
                                <RotateCcw size={16} />
                                {formatMessage({ id: "machine.detail.restart" })}
                              </Button>
                              </Tooltip>
                            )}
                            {cardState.kind === "upToDate" && webUpgradeOn && (
                              <Tooltip content={formatMessage({ id: "machine.detail.computerAlreadyLatest" })}>
                              <Button size="sm"
                                variant="outline"
                                disabled
                              >
                                <CheckCircle size={16} />
                                {formatMessage({ id: "machine.detail.upToDate" })}
                              </Button>
                              </Tooltip>
                            )}
                            {/* The one pink action on this page: the upgrade the
                                computer is waiting for. */}
                            {cardState.kind === "oneClick" && (
                              <Tooltip content={formatMessage({ id: "machine.detail.upgradeToVersion" }, { version: cardState.version })}>
                              <Button size="sm"
                                variant="accent"
                                onClick={handleRemoteUpgradeV2Click}
                              >
                                <Play size={16} />
                                {formatMessage({ id: "machine.detail.upgradeToVersion" }, { version: cardState.version })}
                              </Button>
                              </Tooltip>
                            )}
                            {cardState.kind === "upgrading" && (
                              <Button size="sm"
                                variant="outline"
                                disabled
                              >
                                <Spinner size="xs" aria-hidden="true" />
                                {formatMessage({ id: "machine.detail.upgradeV2.inProgress" })}
                              </Button>
                            )}
                            {releaseNotesForUpdate && <ComputerReleaseNotesAffordance notes={releaseNotesForUpdate} />}
                          </div>
                          {outcomeLine && (
                            <p className={`mt-2 ${DETAIL_PROBLEM_CLASS_NAME}`} data-testid="computer-upgrade-request-outcome">
                              {outcomeLine}
                            </p>
                          )}
                          {cardState.kind === "commands" && upgradeInstallCommand && upgradeRestartCommand && (
                            <ol className="mt-3 space-y-3" data-testid="computer-upgrade-commands">
                              <li>
                                <div className={`mb-1 ${DETAIL_STEP_LABEL_CLASS_NAME}`}>
                                  {formatMessage({ id: "machine.detail.upgradeCommands.installStep" })}
                                </div>
                                <CommandCopyRoot target="computer-install" copied={copiedCommand === "computer-install"} onCopy={handleCopy}>
                                  <CopyableCode
                                    className={COMMAND_LINE_CLASS_NAME}
                                    data-testid="computer-upgrade-fresh-install"
                                  >
                                    {upgradeInstallCommand}
                                  </CopyableCode>
                                  <Tooltip content={formatMessage({ id: "machine.detail.copyInstallCommand" })}>
                                    <CopyableCodeAction
                                      aria-label={formatMessage({ id: "machine.detail.copyInstallCommand" })}
                                      className="shrink-0"
                                    />
                                  </Tooltip>
                                </CommandCopyRoot>
                              </li>
                              <li>
                                <div className={`mb-1 ${DETAIL_STEP_LABEL_CLASS_NAME}`}>
                                  {formatMessage({ id: "machine.detail.upgradeCommands.restartStep" })}
                                </div>
                                <CommandCopyRoot target="computer-install-restart" copied={copiedCommand === "computer-install-restart"} onCopy={handleCopy}>
                                  <CopyableCode
                                    className={COMMAND_LINE_CLASS_NAME}
                                    data-testid="computer-upgrade-fresh-restart"
                                  >
                                    {upgradeRestartCommand}
                                  </CopyableCode>
                                  <Tooltip content={formatMessage({ id: "machine.computer.freshInstallUpgrade.copyRestart" })}>
                                    <CopyableCodeAction
                                      aria-label={formatMessage({ id: "machine.computer.freshInstallUpgrade.copyRestart" })}
                                      className="shrink-0"
                                    />
                                  </Tooltip>
                                </CommandCopyRoot>
                              </li>
                            </ol>
                          )}
                        </>
                      );
                    })()
                  )}
                  <div className="mt-4" data-testid="computer-terminal-verification">
                    <Separator className="mb-4" />
                    <div className="mb-2 flex items-center gap-2">
                      <Terminal size={16} className="text-foreground-muted" aria-hidden="true" />
                      <SectionEyebrow as="div">
                        {formatMessage({ id: "machine.detail.verifyFromTerminal" })}
                      </SectionEyebrow>
                    </div>
                    <p className={`mb-2 ${DETAIL_HELP_CLASS_NAME}`}>
                      {formatMessage({ id: "machine.detail.verifyFromTerminalDescription" })}
                    </p>
                    <div className="space-y-2">
                      {terminalStatusCommands.map(({ command, target }) => (
                        <CommandCopyRoot key={command} target={target} copied={copiedCommand === target} onCopy={handleCopy}>
                          <CopyableCode className={COMMAND_LINE_CLASS_NAME}>
                            {command}
                          </CopyableCode>
                          <Tooltip content={formatMessage({ id: "machine.detail.copyCommand" })}>
                            <CopyableCodeAction
                              aria-label={formatMessage({ id: "machine.detail.copyCommand" })}
                              className="shrink-0"
                            />
                          </Tooltip>
                        </CommandCopyRoot>
                      ))}
                    </div>
                    {terminalRestartCommand && (
                      <>
                        <p className={`mb-2 mt-3 ${DETAIL_HELP_CLASS_NAME}`}>
                          {formatMessage({ id: "machine.detail.webButtonsNotResponding" })}
                        </p>
                        <CommandCopyRoot target="terminal-restart" copied={copiedCommand === "terminal-restart"} onCopy={handleCopy}>
                          <CopyableCode className={COMMAND_LINE_CLASS_NAME}>
                            {terminalRestartCommand}
                          </CopyableCode>
                          <Tooltip content={formatMessage({ id: "machine.detail.copyCommand" })}>
                            <CopyableCodeAction
                              aria-label={formatMessage({ id: "machine.detail.copyCommand" })}
                              className="shrink-0"
                            />
                          </Tooltip>
                        </CommandCopyRoot>
                      </>
                    )}
                  </div>
                </Card>
              )}
              {machine.isComputer && machineComputerCommands && computerFreshInstall && computerInstallRestartCommand && terminalRestartCommand && (
                <Card className="mb-3 p-4" data-testid="computer-recovery-guide">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 text-left"
                    aria-expanded={showRecoveryGuide}
                    aria-controls={recoveryGuideContentId}
                    aria-label={formatMessage(
                      {
                        id: showRecoveryGuide
                          ? "machine.detail.hideRecoveryGuide"
                          : "machine.detail.showRecoveryGuide",
                      },
                    )}
                    onClick={() => setRecoveryGuideDisclosure(!showRecoveryGuide)}
                  >
                    <span className="flex items-center gap-2">
                      <Terminal size={16} className="text-foreground-muted" aria-hidden="true" />
                      <SectionEyebrow>{formatMessage({ id: "machine.detail.recoveryGuide" })}</SectionEyebrow>
                    </span>
                    <ChevronRight
                      size={16}
                      aria-hidden="true"
                      className={`shrink-0 text-foreground-muted transition-transform motion-reduce:transition-none ${showRecoveryGuide ? "rotate-90" : ""}`}
                      data-testid="computer-recovery-guide-chevron"
                    />
                  </button>
                  {showRecoveryGuide && (
                    <div
                      id={recoveryGuideContentId}
                      className="mt-3"
                      data-testid="computer-recovery-guide-content"
                    >
                      <Separator className="mb-3" />
                      <p className={`mb-4 ${DETAIL_HELP_CLASS_NAME}`}>
                        {formatMessage({ id: "machine.detail.recoveryGuideDescription" })}
                      </p>
                      <ol className="space-y-4">
                        <li>
                          <div className="mb-2">
                            <div className={DETAIL_STEP_LABEL_CLASS_NAME}>
                              {formatMessage({ id: "machine.detail.restartStep" })}
                            </div>
                            <p className={DETAIL_HELP_CLASS_NAME}>
                              {formatMessage({ id: "machine.detail.restartStepDescription" })}
                            </p>
                          </div>
                          <CommandCopyRoot target="terminal-restart" copied={copiedCommand === "terminal-restart"} onCopy={handleCopy}>
                            <CopyableCode
                              className={COMMAND_LINE_CLASS_NAME}
                              data-testid="computer-recovery-guide-restart"
                            >
                              {terminalRestartCommand}
                            </CopyableCode>
                            <Tooltip content={formatMessage({ id: "machine.detail.copyCommand" })}>
                              <CopyableCodeAction
                                aria-label={formatMessage({ id: "machine.detail.copyCommand" })}
                                className="shrink-0"
                              />
                            </Tooltip>
                          </CommandCopyRoot>
                        </li>
                        <li>
                          <div className="mb-2">
                            <div className={DETAIL_STEP_LABEL_CLASS_NAME}>
                              {formatMessage(
                                { id: "machine.detail.freshInstallStep" },
                                { platform: windowsMachine ? formatMessage({ id: "machine.detail.windowsX64Suffix" }) : "" },
                              )}
                            </div>
                            <p className={DETAIL_HELP_CLASS_NAME}>
                              {formatMessage({ id: "machine.computer.recovery.freshInstallDescription" })}
                            </p>
                          </div>
                          <CommandCopyRoot target="computer-install" copied={copiedCommand === "computer-install"} onCopy={handleCopy}>
                            <CopyableCode
                              className={COMMAND_LINE_CLASS_NAME}
                              data-testid="computer-recovery-guide-install"
                            >
                              {computerFreshInstall}
                            </CopyableCode>
                            <Tooltip content={formatMessage({ id: "machine.detail.copyFreshInstallCommand" })}>
                              <CopyableCodeAction
                                aria-label={formatMessage({ id: "machine.detail.copyFreshInstallCommand" })}
                                className="shrink-0"
                              />
                            </Tooltip>
                          </CommandCopyRoot>
                        </li>
                        <li>
                          <div className="mb-2">
                            <div className={DETAIL_STEP_LABEL_CLASS_NAME}>
                              {formatMessage({ id: "machine.computer.recovery.restartAfterInstallStep" })}
                            </div>
                            <p className={DETAIL_HELP_CLASS_NAME}>
                              {formatMessage({ id: "machine.computer.recovery.restartAfterInstallDescription" })}
                            </p>
                          </div>
                          <CommandCopyRoot target="computer-install-restart" copied={copiedCommand === "computer-install-restart"} onCopy={handleCopy}>
                            <CopyableCode
                              className={COMMAND_LINE_CLASS_NAME}
                              data-testid="computer-recovery-guide-restart-after-install"
                            >
                              {computerInstallRestartCommand}
                            </CopyableCode>
                            <Tooltip content={formatMessage({ id: "machine.computer.freshInstallUpgrade.copyRestart" })}>
                              <CopyableCodeAction
                                aria-label={formatMessage({ id: "machine.computer.freshInstallUpgrade.copyRestart" })}
                                className="shrink-0"
                              />
                            </Tooltip>
                          </CommandCopyRoot>
                        </li>
                      </ol>
                    </div>
                  )}
                </Card>
              )}
              <Card className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-subhead font-bold text-foreground">
                      {formatMessage({ id: "machine.detail.deleteComputer" })}
                    </div>
                    <p className={`mt-0.5 ${DETAIL_HELP_CLASS_NAME}`}>
                      {formatMessage({ id: "machine.detail.deleteComputerDescription" })}
                    </p>
                  </div>
                  <Button size="sm"
                    variant="danger"
                    onClick={openDeleteConfirm}
                    className="ml-4 shrink-0"
                  >
                    <Trash2 size={16} />
                    {formatMessage({ id: "machine.detail.deleteComputer" })}
                  </Button>
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>

      {showDeleteConfirm && (
        machineAgents.length > 0 ? (
          <ConfirmDialog
            title={formatMessage({ id: "machine.detail.cannotDeleteComputer" })}
            message={formatMessage({ id: "machine.detail.cannotDeleteComputerMessage" }, { count: machineAgents.length })}
            confirmLabel={formatMessage({ id: "common.announcement.ok" })}
            confirmVariant="outline"
            hideCancel
            onConfirm={acknowledgeCannotDelete}
            onClose={closeDeleteConfirm}
          />
        ) : (
          <ConfirmDialog
            title={formatMessage({ id: "machine.detail.deleteComputer" })}
            message={formatMessage({ id: "machine.detail.deleteComputerMessage" }, { name: machine.name })}
            confirmLabel={formatMessage({ id: "machine.detail.deleteComputer" })}
            loadingLabel={formatMessage({ id: "machine.detail.deleting" })}
            onConfirm={handleDelete}
            onClose={closeDeleteConfirm}
          />
        )
      )}

    </div>
  );
}
