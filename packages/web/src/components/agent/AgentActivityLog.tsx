import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useIntl } from "react-intl";
import { Badge, SegmentedControl, SegmentedControlItem, SegmentedControlLabel, Status } from "@botiverse/raft-ui";
import type { Presence } from "@botiverse/raft-ui";
import { useAgentStore } from "../../store/agentStore";
import type { TrajectoryLogEntry } from "../../store/agentStore";
import { getSocket } from "../../api/socket";
import { registerActivityTrajectoryLiveReload, registerActivityTrajectoryReconnectReload } from "../../utils/activityTrajectoryRecovery";
import { getToolLogLabel, shouldHideToolStartInActivityLog } from "@botiverse/raft-shared";
import type { AgentActivity, AgentActivityDetailKind, SubagentLineage } from "@botiverse/raft-shared";
import { Activity, ChevronRight } from "lucide-react";
import EmptyState from "../ui/EmptyState";
import AgentActivityOverview from "./AgentActivityOverview";
import { ACTIVITY_OVERVIEW_WEB_FLAG_KEY, useServerFeatureFlag } from "../../store/serverFeatureFlags";
import { useTimeFormatter } from "../../hooks/useTimeFormatter";
import { RefText, ThreadRefNoticeProvider } from "./RefText";
import type { MessageId } from "../../i18n/messages";
import { activityPresence } from "../../utils/activity";

const EMPTY_LOG: TrajectoryLogEntry[] = [];

function isVisibleTrajectoryEntry(item: TrajectoryLogEntry): boolean {
  return item.entry.kind !== "tool_start" || !shouldHideToolStartInActivityLog(item.entry.toolName);
}

// APM 1.6 6b: a lineage-bearing row (explicit parent_tool_use_id / task lineage
// preserved on the entry by the daemon) is marked as subagent activity. We keep
// the log FLAT — rows without lineage render exactly as before, and we never
// synthesize a subagent group/card. Lineage-bearing rows just gain a small
// inline "Subagent" badge (with the bounded role, never any prompt/output).
function subagentLineage(item: TrajectoryLogEntry): SubagentLineage["subagent"] | undefined {
  return (item.entry as SubagentLineage).subagent;
}

function SubagentBadge({ subagentType }: { subagentType?: string }) {
  const { formatMessage } = useIntl();
  return (
    <Badge appearance="outline" variant="default" className="ml-1.5 align-middle">
      {subagentType
        ? formatMessage({ id: "activity.log.subagentWithType" }, { type: subagentType })
        : formatMessage({ id: "activity.log.subagent" })}
    </Badge>
  );
}

const ACTIVITY_LABEL_IDS: Record<string, MessageId> = {
  online: "activity.log.status.idle",
  thinking: "activity.log.status.thinking",
  working: "activity.log.status.working",
};


// "Stopped" is reserved for manual/reconcile-driven stops. Other offline causes
// (machine disconnect, crash, unknown) show their own labels so a transient
// disconnect doesn't look like a terminal state in the activity log.
function resolveOfflineLabelId(detailKind?: AgentActivityDetailKind): MessageId {
  if (detailKind === "stopped") return "activity.log.status.stopped";
  if (detailKind === "machine_disconnected") return "activity.log.status.disconnected";
  if (detailKind === "runtime_crashed") return "activity.log.status.crashed";
  return "activity.log.status.offline";
}

function resolveStatusDisplay(
  activity: AgentActivity,
  detail: string,
  detailKind?: AgentActivityDetailKind,
): { primary: MessageId | { raw: string }; secondary: string } {
  if (activity === "working" && detailKind === "starting") {
    return { primary: "activity.log.status.starting", secondary: "" };
  }

  if (activity === "online") {
    const lifecycleLabel: MessageId | null = detailKind === "computer_started"
      ? "activity.log.status.started"
      : detailKind === "computer_restarted"
        ? "activity.log.status.restarted"
        : detailKind === "computer_upgraded"
          ? "activity.log.status.upgraded"
          : null;
    if (lifecycleLabel) return { primary: lifecycleLabel, secondary: "" };
  }

  if (activity === "error" && detailKind === "computer_operation_failed") {
    return { primary: "activity.log.status.computerOperationFailed", secondary: detail };
  }

  if (activity === "offline") {
    const primary = resolveOfflineLabelId(detailKind);
    const primaryFallback = detailKind === "stopped"
      ? "Stopped"
      : detailKind === "machine_disconnected"
        ? "Disconnected"
        : detailKind === "runtime_crashed"
          ? "Crashed"
          : "Offline";
    const stoppedReason = detailKind === "stopped" && detail && detail !== primaryFallback ? detail : "";
    // For most offline rows, the label already encodes the cause, so detail would
    // duplicate. Stopped rows now carry a second-level reason that distinguishes
    // user stop from Computer shutdown without adding a new detailKind enum.
    return {
      primary,
      secondary: detailKind === "runtime_crashed"
        ? detail
        : stoppedReason
          ? ` - ${stoppedReason}`
          : "",
    };
  }

  return { primary: ACTIVITY_LABEL_IDS[activity] || { raw: activity }, secondary: detail };
}

type FormatTimestamp = (timestamp: number) => string;

// DS Timeline, activity-log variant (`.rf-tl.rf-tl--log`): one square presence
// pixel per entry, strung on a hairline; title and detail in Space Mono, the
// time on the right. Hand-rolled: raft-ui's Timeline has no log variant.
const LOG_ITEM_CLASS = [
  "relative grid grid-cols-[9px_minmax(0,1fr)_auto] gap-x-3 py-1.5",
  "before:absolute before:top-0 before:bottom-0 before:left-1 before:border-l before:border-line-hairline",
  "first:before:top-4 last:before:bottom-auto last:before:h-4 only:before:hidden",
].join(" ");
// The entry's presence light (raft-ui Status: busy yellow, error orange, online
// lime, offline stone; never animated), centred on the first 20px line and
// knocked out of the timeline's hairline.
const LOG_PIXEL_CLASS = "z-[1] mt-[5.5px] shadow-[0_0_0_2px_var(--layer-canvas)]";
const LOG_TITLE_CLASS = "font-mono text-mono-code text-foreground-muted wrap-anywhere";
const LOG_DETAIL_CLASS = "mt-0.5 font-mono text-mono-meta text-foreground-hint wrap-anywhere";
const LOG_TIME_CLASS = "font-mono text-mono-meta leading-5 whitespace-nowrap text-foreground-hint";

function LogItem({ presence, timestamp, formatTimestamp, children }: { presence: Presence; timestamp: number; formatTimestamp: FormatTimestamp; children: ReactNode }) {
  return (
    <li className={LOG_ITEM_CLASS}>
      <Status aria-hidden="true" presence={presence} className={LOG_PIXEL_CLASS} />
      <div className="min-w-0">{children}</div>
      <span className={LOG_TIME_CLASS}>{formatTimestamp(timestamp)}</span>
    </li>
  );
}

/** A titled entry whose detail clamps to two lines until the title is clicked (only when long). */
function ExpandableEntry({ presence, title, text, timestamp, formatTimestamp, subagent, children }: { presence: Presence; title: string; text: string; timestamp: number; formatTimestamp: FormatTimestamp; subagent?: SubagentLineage["subagent"]; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 200;

  return (
    <LogItem presence={presence} timestamp={timestamp} formatTimestamp={formatTimestamp}>
      <button
        type="button"
        onClick={() => isLong && setExpanded(!expanded)}
        className={`flex items-center gap-1 text-left ${LOG_TITLE_CLASS} ${isLong ? "hover:text-foreground" : "cursor-default"}`}
      >
        {title}
        {subagent && <SubagentBadge subagentType={subagent.subagentType} />}
        {isLong && (
          <ChevronRight
            size={14}
            className={`shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
          />
        )}
      </button>
      <p
        className={`${LOG_DETAIL_CLASS} whitespace-pre-wrap ${
          !expanded && isLong ? "line-clamp-2" : ""
        }`}
      >
        {children}
      </p>
    </LogItem>
  );
}

function ThinkingEntry({ text, timestamp, formatTimestamp }: { text: string; timestamp: number; formatTimestamp: FormatTimestamp }) {
  const { formatMessage } = useIntl();
  return (
    <ExpandableEntry presence="busy" title={formatMessage({ id: "activity.log.thinking" })} text={text} timestamp={timestamp} formatTimestamp={formatTimestamp}>
      {text}
    </ExpandableEntry>
  );
}

function ToolStartEntry({ toolName, toolInput, timestamp, formatTimestamp, subagent }: { toolName: string; toolInput: string; timestamp: number; formatTimestamp: FormatTimestamp; subagent?: SubagentLineage["subagent"] }) {
  return (
    <LogItem presence="busy" timestamp={timestamp} formatTimestamp={formatTimestamp}>
      <span className={`block ${LOG_TITLE_CLASS}`}>
        {getToolLogLabel(toolName)}
        {subagent && <SubagentBadge subagentType={subagent.subagentType} />}
      </span>
      {toolInput && (
        <span className={`block break-all ${LOG_DETAIL_CLASS}`}>{toolInput}</span>
      )}
    </LogItem>
  );
}

function TextEntry({ text, timestamp, formatTimestamp }: { text: string; timestamp: number; formatTimestamp: FormatTimestamp }) {
  const { formatMessage } = useIntl();
  return (
    <ExpandableEntry presence="online" title={formatMessage({ id: "activity.log.output" })} text={text} timestamp={timestamp} formatTimestamp={formatTimestamp}>
      {text}
    </ExpandableEntry>
  );
}

function SystemEntry({ title, text, timestamp, formatTimestamp, subagent }: { title: string; text: string; timestamp: number; formatTimestamp: FormatTimestamp; subagent?: SubagentLineage["subagent"] }) {
  return (
    <ExpandableEntry presence="error" title={title} text={text} timestamp={timestamp} formatTimestamp={formatTimestamp} subagent={subagent}>
      <RefText text={text} />
    </ExpandableEntry>
  );
}

function SlockActionEntry({ title, text, timestamp, formatTimestamp }: { title: string; text: string; timestamp: number; formatTimestamp: FormatTimestamp }) {
  return (
    <ExpandableEntry presence="online" title={title} text={text} timestamp={timestamp} formatTimestamp={formatTimestamp}>
      {/* Ref linkification is scoped to the structured-metadata entry
          kinds — SlockAction (slock-cli target: #channel:shortid …),
          System, and Status — where a #channel / thread / dm token is a
          real navigation target. NOT Output/Thinking/Tool: those are
          free-form agent text where #x is incidental and linkifying it
          is noise. task #266 follow-up, xxchan #proj-uiux:2921feaf. */}
      <RefText text={text} />
    </ExpandableEntry>
  );
}

function StatusEntry({ activity, detail, detailKind, timestamp, formatTimestamp, subagent }: { activity: AgentActivity; detail: string; detailKind?: AgentActivityDetailKind; timestamp: number; formatTimestamp: FormatTimestamp; subagent?: SubagentLineage["subagent"] }) {
  const { formatMessage } = useIntl();
  const { primary, secondary } = resolveStatusDisplay(activity, detail, detailKind);
  const primaryText = typeof primary === "string" ? formatMessage({ id: primary }) : primary.raw;
  return (
    <LogItem presence={activityPresence(activity)} timestamp={timestamp} formatTimestamp={formatTimestamp}>
      <span className={`block ${LOG_TITLE_CLASS}`}>
        <span>{primaryText}</span>
        {subagent && <SubagentBadge subagentType={subagent.subagentType} />}
        {secondary && (
          <span className="ml-1.5 break-words text-foreground-hint">
            <RefText text={secondary} />
          </span>
        )}
      </span>
    </LogItem>
  );
}

function CompactionEntry({ phase, timestamp, formatTimestamp }: { phase: "started" | "finished"; timestamp: number; formatTimestamp: FormatTimestamp }) {
  const { formatMessage } = useIntl();
  const isStarted = phase === "started";

  return (
    <LogItem presence={isStarted ? "busy" : "online"} timestamp={timestamp} formatTimestamp={formatTimestamp}>
      <span className={`block ${LOG_TITLE_CLASS}`}>
        {formatMessage({ id: isStarted ? "activity.log.compactionStarted" : "activity.log.compactionFinished" })}
      </span>
    </LogItem>
  );
}

function TrajectoryItem({ item, formatTimestamp }: { item: TrajectoryLogEntry; formatTimestamp: FormatTimestamp }) {
  const { entry, timestamp } = item;
  const subagent = subagentLineage(item);

  switch (entry.kind) {
    case "thinking":
      return <ThinkingEntry text={entry.text} timestamp={timestamp} formatTimestamp={formatTimestamp} />;
    case "tool_start":
      return <ToolStartEntry toolName={entry.toolName} toolInput={entry.toolInput} timestamp={timestamp} formatTimestamp={formatTimestamp} subagent={subagent} />;
    case "text":
      return <TextEntry text={entry.text} timestamp={timestamp} formatTimestamp={formatTimestamp} />;
    case "slock_action":
      return <SlockActionEntry title={entry.title} text={entry.text} timestamp={timestamp} formatTimestamp={formatTimestamp} />;
    case "system":
      return <SystemEntry title={entry.title} text={entry.text} timestamp={timestamp} formatTimestamp={formatTimestamp} subagent={subagent} />;
    case "compaction_started":
      return <CompactionEntry phase="started" timestamp={timestamp} formatTimestamp={formatTimestamp} />;
    case "compaction_finished":
      return <CompactionEntry phase="finished" timestamp={timestamp} formatTimestamp={formatTimestamp} />;
    case "status":
      return <StatusEntry activity={entry.activityKind ?? entry.activity} detail={entry.detail} detailKind={entry.detailKind} timestamp={timestamp} formatTimestamp={formatTimestamp} subagent={subagent} />;
  }
}

function RawActivityLog({ agentId }: { agentId: string }) {
  const { formatMessage } = useIntl();
  const log = useAgentStore((s) => s.trajectoryLogs[agentId] ?? EMPTY_LOG);
  const visibleLog = log.filter(isVisibleTrajectoryEntry);
  const loadTrajectoryLog = useAgentStore((s) => s.loadTrajectoryLog);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { formatClockWithSeconds } = useTimeFormatter();
  const formatTimestamp = useCallback(
    (timestamp: number) => formatClockWithSeconds(timestamp).toUpperCase(),
    [formatClockWithSeconds],
  );

  // Ephemeral notice when a (legitimate) thread ref can't be resolved at
  // click time — mirrors MessageItem's threadRefNotice behaviour.
  const [threadRefNotice, setThreadRefNotice] = useState<MessageId | null>(null);
  const threadRefNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showThreadRefNotice = useCallback((message: MessageId) => {
    if (threadRefNoticeTimerRef.current) clearTimeout(threadRefNoticeTimerRef.current);
    setThreadRefNotice(message);
    threadRefNoticeTimerRef.current = setTimeout(() => {
      setThreadRefNotice(null);
      threadRefNoticeTimerRef.current = null;
    }, 4000);
  }, []);
  useEffect(() => () => {
    if (threadRefNoticeTimerRef.current) clearTimeout(threadRefNoticeTimerRef.current);
  }, []);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView();
  }, [log.length]);

  useEffect(() => {
    void loadTrajectoryLog(agentId);
  }, [agentId, loadTrajectoryLog]);

  useEffect(() => {
    const socket = getSocket();
    return registerActivityTrajectoryReconnectReload({
      socket,
      agentId,
      loadTrajectoryLog,
    });
  }, [agentId, loadTrajectoryLog]);

  useEffect(() => {
    const socket = getSocket();
    return registerActivityTrajectoryLiveReload({
      socket,
      agentId,
      loadTrajectoryLog,
    });
  }, [agentId, loadTrajectoryLog]);

  if (visibleLog.length === 0) {
    return (
      <EmptyState
        className="flex flex-1 flex-col items-center justify-center bg-layer-canvas"
        icon={<Activity size={36} />}
        title={formatMessage({ id: "emptyState.noActivityTitle" })}
        description={formatMessage({ id: "emptyState.noActivityDesc" })}
      />
    );
  }

  return (
    <ThreadRefNoticeProvider onNotice={showThreadRefNotice}>
      <div className="flex flex-1 flex-col min-h-0 bg-layer-canvas">
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <ol className="m-0 flex list-none flex-col p-0">
            {visibleLog.map((item, i) => (
              <TrajectoryItem key={`${item.timestamp}-${i}`} item={item} formatTimestamp={formatTimestamp} />
            ))}
          </ol>
          <div ref={bottomRef} />
        </div>
        {threadRefNotice ? (
          <div className="shrink-0 bg-warning-soft px-4 py-2 text-callout text-foreground">
            {formatMessage({ id: threadRefNotice })}
          </div>
        ) : null}
      </div>
    </ThreadRefNoticeProvider>
  );
}

type ActivityView = "overview" | "raw";

/**
 * The Activity tab. Behind `activity_overview_web_v0` it opens on the
 * per-turn Overview (task #17) with the raw log one toggle away; without the
 * flag it is the raw log, as before.
 */
export default function AgentActivityLog({ agentId, machineId }: { agentId: string; machineId?: string | null }) {
  const { formatMessage } = useIntl();
  const overviewEnabled = useServerFeatureFlag(ACTIVITY_OVERVIEW_WEB_FLAG_KEY).enabled;
  const [view, setView] = useState<ActivityView>("overview");
  const hasRawActivity = useAgentStore((s) => (s.trajectoryLogs[agentId]?.length ?? 0) > 0);
  const showRaw = useCallback(() => setView("raw"), []);
  const loadTrajectoryLog = useAgentStore((s) => s.loadTrajectoryLog);
  // The overview needs to know whether the agent has any raw activity at all
  // (to tell "no turns yet" from "this computer records no turns").
  useEffect(() => {
    if (overviewEnabled) void loadTrajectoryLog(agentId);
  }, [agentId, loadTrajectoryLog, overviewEnabled]);
  if (!overviewEnabled) return <RawActivityLog agentId={agentId} />;
  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="flex shrink-0 items-center px-4 pt-3">
        <SegmentedControl<ActivityView>
          value={view}
          aria-label={formatMessage({ id: "activity.overview.view.label" })}
          onValueChange={setView}
        >
          <SegmentedControlItem value="overview" data-testid="activity-view-overview">
            <SegmentedControlLabel>{formatMessage({ id: "activity.overview.view.overview" })}</SegmentedControlLabel>
          </SegmentedControlItem>
          <SegmentedControlItem value="raw" data-testid="activity-view-raw">
            <SegmentedControlLabel>{formatMessage({ id: "activity.overview.view.raw" })}</SegmentedControlLabel>
          </SegmentedControlItem>
        </SegmentedControl>
      </div>
      {view === "overview"
        ? <AgentActivityOverview key={agentId} agentId={agentId} machineId={machineId} hasRawActivity={hasRawActivity} onShowRaw={showRaw} />
        : <RawActivityLog agentId={agentId} />}
    </div>
  );
}
