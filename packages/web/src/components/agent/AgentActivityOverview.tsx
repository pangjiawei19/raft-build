import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useIntl } from "react-intl";
import type { IntlShape } from "react-intl";
import { AlertTriangle, FlaskConical, History, MessageSquare } from "lucide-react";
import { Badge, Button, Card, CardContent, OtterIndicator, Status, Text } from "@botiverse/raft-ui";
import type { Presence } from "@botiverse/raft-ui";
import type { ActivityActionKind, ActivityTurnSummary, ActivityTurnTrigger } from "@botiverse/raft-shared";
import api from "../../api/client";
import { getSocket } from "../../api/socket";
import { useAgentCurrentActivityState } from "../../store/agentStore";
import type { Message } from "../../store/messageStore";
import { useTimeFormatter } from "../../hooks/useTimeFormatter";
import { useAppNavigate } from "../../hooks/useAppNavigate";
import { registerActivityTrajectoryLiveReload, registerActivityTrajectoryReconnectReload } from "../../utils/activityTrajectoryRecovery";
import { formatActivityText } from "../../utils/activity";
import EmptyState from "../ui/EmptyState";
import { RefText } from "./RefText";
import type { MessageId } from "../../i18n/messages";

/** A turn as the server returns it: a trigger the viewer cannot see comes back hidden. */
export type TurnSummaryView = Omit<ActivityTurnSummary, "trigger"> & {
  /** Row id from the server (absent from older servers). */
  id?: string;
  trigger?: (ActivityTurnTrigger & { hidden?: undefined }) | { hidden: "private_channel" | "dm" };
};

type TurnProblem = ActivityTurnSummary["problems"][number];

/**
 * Tests or checks that ran and reported failures are ordinary work (run, see
 * failures, fix), shown as process information, not as a step that went
 * wrong (Tenny). Only failed tool calls, other non-zero exits and held sends
 * count.
 */
export function countsAsProblem(problem: TurnProblem): boolean {
  return !(problem.reason === "exit_nonzero" && problem.kind === "run_checks");
}

export function turnProblemCount(turn: TurnSummaryView): number {
  return Math.max(0, turn.problemCount - turn.problems.filter((problem) => !countsAsProblem(problem)).length);
}

interface SummaryPage {
  summaries: TurnSummaryView[];
  next?: string;
}

const PAGE_SIZE = 30;

export function formatTurnDuration(formatMessage: IntlShape["formatMessage"], ms: number): string {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  if (totalSeconds < 60) return formatMessage({ id: "activity.overview.duration.seconds" }, { seconds: totalSeconds });
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return formatMessage({ id: "activity.overview.duration.minutes" }, { minutes: totalMinutes, seconds: totalSeconds % 60 });
  return formatMessage({ id: "activity.overview.duration.hours" }, { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 });
}

/**
 * Who woke the turn, in words a person reads: "replying to @Tenny in
 * #proj-runtime" (the channel a link, as in the raw log), a thread in a
 * channel, a DM from someone, or only the kind of place when the viewer
 * cannot see it.
 */
export function formatTurnTrigger(formatMessage: IntlShape["formatMessage"], trigger: TurnSummaryView["trigger"]): ReactNode | null {
  if (!trigger) return null;
  if (trigger.hidden !== undefined) {
    return formatMessage({ id: trigger.hidden === "dm" ? "activity.overview.trigger.dm" : "activity.overview.trigger.privateChannel" });
  }
  const target = trigger.target;
  if (!target) return null;
  if (target.startsWith("agent-event:")) return formatMessage({ id: "activity.overview.trigger.appEvent" });
  const sender = trigger.sender ? `@${trigger.sender}` : null;
  const dm = /^dm:(@[^:]+)/.exec(target);
  if (dm) return formatMessage({ id: "activity.overview.trigger.dmFrom" }, { peer: dm[1] });
  const [channelName, threadShortId] = target.split(":");
  const channel = <RefText text={channelName ?? target} />;
  if (!sender) return formatMessage({ id: "activity.overview.trigger.target" }, { channel });
  return formatMessage({ id: threadShortId ? "activity.overview.trigger.thread" : "activity.overview.trigger.message" }, { sender, channel });
}

/**
 * "02:38–02:44" from two clock strings: one time when both are the same
 * minute, and a shared day-period word ("上午", "AM") written once.
 */
export function formatClockRange(start: string, end: string): { start: string; end?: string } {
  if (start === end) return { start };
  const prefix = /^\D+/.exec(start)?.[0];
  if (prefix && end.startsWith(prefix)) return { start, end: end.slice(prefix.length) };
  const suffix = /\D+$/.exec(start)?.[0];
  if (suffix && end.endsWith(suffix)) return { start: start.slice(0, -suffix.length), end };
  return { start, end };
}

/** "ran 3 commands, read a file" from the turn's action counts (fixed wording per kind). */
export function formatTurnActions(intl: IntlShape, actions: ActivityTurnSummary["actions"]): string {
  if (actions.length === 0) return intl.formatMessage({ id: "activity.overview.actions.none" });
  const parts = actions.map(({ kind, count }) => intl.formatMessage({ id: `activity.overview.action.${kind satisfies ActivityActionKind}` as MessageId }, { count }));
  return intl.formatList(parts, { type: "conjunction" }) as string;
}

/** The status chip's square pixel (DS StatusChip: a word plus its fixed
 *  status colour): raft-ui Status with the outcome's presence light. */
function OutcomePixel({ presence }: { presence: Presence }) {
  return <Status aria-hidden="true" presence={presence} />;
}

function OutcomeBadge({ turn }: { turn: TurnSummaryView }) {
  const { formatMessage } = useIntl();
  const problems = turnProblemCount(turn);
  if (turn.outcome === "completed" && problems === 0) {
    return (
      <Badge variant="success" appearance="soft">
        <OutcomePixel presence="online" />
        {formatMessage({ id: "activity.overview.outcome.completed" })}
      </Badge>
    );
  }
  if (turn.outcome === "completed") {
    // Steps that went wrong along the way are not a failed turn: amber, not red (Tenny).
    return (
      <Badge variant="warning" appearance="soft">
        <OutcomePixel presence="error" />
        {formatMessage({ id: "activity.overview.outcome.completedWithProblems" }, { count: problems })}
      </Badge>
    );
  }
  if (turn.outcome === "failed") {
    // A problem, not an irreversible consequence: orange (DS rule 5), never red.
    return (
      <Badge variant="warning" appearance="soft">
        <OutcomePixel presence="error" />
        {formatMessage({ id: "activity.overview.outcome.failed" })}
      </Badge>
    );
  }
  return (
    <Badge variant="muted" appearance="soft">
      <OutcomePixel presence="offline" />
      {formatMessage({ id: turn.outcome === "interrupted" ? "activity.overview.outcome.interrupted" : "activity.overview.outcome.unknown" })}
    </Badge>
  );
}

function ProblemLine({ problem }: { problem: TurnProblem }) {
  const { formatMessage } = useIntl();
  const { formatClock } = useTimeFormatter();
  const time = formatClock(problem.at);
  // A test run that reports failures is ordinary work, not an agent error: lighter wording (Tenny).
  const text = problem.reason === "send_held"
    ? formatMessage({ id: "activity.overview.problem.sendHeld" }, { time })
    : problem.reason === "exit_nonzero" && problem.kind === "run_checks"
      ? formatMessage({ id: "activity.overview.problem.checksFailed" }, { time })
      : problem.reason === "exit_nonzero"
        ? formatMessage({ id: "activity.overview.problem.exitNonzero" }, { time, code: problem.exitCode ?? "" })
        : formatMessage({ id: "activity.overview.problem.callFailed" }, { time });
  return (
    <div className="flex items-center gap-1.5 text-caption text-foreground-muted" data-testid="activity-overview-problem">
      {countsAsProblem(problem)
        ? <AlertTriangle size={14} aria-hidden="true" className="shrink-0 text-warning-strong" />
        : <FlaskConical size={14} aria-hidden="true" className="shrink-0 text-foreground-hint" />}
      <span>{text}</span>
    </div>
  );
}

type ReplyState = { status: "loading" } | { status: "loaded"; message: Message } | { status: "unavailable" };

/** The turn's last reply, fetched by id under the message's own permissions. */
function LastReply({ messageId, count }: { messageId: string; count: number }) {
  const { formatMessage } = useIntl();
  const { formatClock } = useTimeFormatter();
  const [state, setState] = useState<ReplyState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    void api.get(`/messages/context/${messageId}`, { params: { before: 0, after: 0 } })
      .then(({ data }) => {
        if (cancelled) return;
        const payload = data as { messages?: Message[]; targetMessageId?: string };
        const target = (payload.messages ?? []).find((message) => message.id === (payload.targetMessageId ?? messageId));
        setState(target ? { status: "loaded", message: target } : { status: "unavailable" });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, [messageId]);

  const label = state.status === "loaded"
    ? formatMessage({ id: "activity.overview.reply.labelAt" }, { time: formatClock(state.message.createdAt) })
    : formatMessage({ id: "activity.overview.reply.label" });
  return (
    <Card className="flex flex-col gap-1 p-3" data-testid="activity-overview-reply">
      <span className="flex items-center gap-1 text-caption text-foreground-hint">
        <MessageSquare size={14} aria-hidden="true" className="shrink-0" />
        {label}
        {count > 1 ? <span>{formatMessage({ id: "activity.overview.reply.count" }, { count })}</span> : null}
      </span>
      <span className="line-clamp-3 whitespace-pre-line break-words text-callout text-foreground">
        {state.status === "loaded"
          ? state.message.content
          : formatMessage({ id: state.status === "loading" ? "activity.overview.reply.loading" : "activity.overview.reply.unavailable" })}
      </span>
    </Card>
  );
}

function TurnSection({ turn }: { turn: TurnSummaryView }) {
  const intl = useIntl();
  const { formatClock } = useTimeFormatter();
  const trigger = formatTurnTrigger(intl.formatMessage, turn.trigger);
  const range = formatClockRange(formatClock(turn.startedAt), formatClock(turn.endedAt));
  return (
    <section className="flex flex-col gap-2" data-testid="activity-overview-turn">
      <div className="flex flex-wrap items-baseline gap-2">
        <Text.Heading className="font-mono text-mono-code font-bold tracking-normal text-foreground">{range.end === undefined ? range.start : intl.formatMessage({ id: "activity.overview.turn.range" }, { start: range.start, end: range.end })}</Text.Heading>
        {/* The outcome sits right after the time so it stays on the first line (Kirby). */}
        <OutcomeBadge turn={turn} />
        <span className="text-caption text-foreground-hint">
          {trigger
            ? intl.formatMessage({ id: "activity.overview.turn.triggerAndDuration" }, { trigger: <span>{trigger}</span>, duration: formatTurnDuration(intl.formatMessage, turn.endedAt - turn.startedAt) })
            : intl.formatMessage({ id: "activity.overview.turn.took" }, { duration: formatTurnDuration(intl.formatMessage, turn.endedAt - turn.startedAt) })}
        </span>
      </div>
      <span className="text-callout text-foreground-muted">{formatTurnActions(intl, turn.actions)}</span>
      {turn.problems.map((problem, index) => <ProblemLine key={`${problem.at}-${index}`} problem={problem} />)}
      {turn.problemCount > turn.problems.length ? (
        <span className="text-caption text-foreground-hint">
          {intl.formatMessage({ id: "activity.overview.problem.more" }, { count: turn.problemCount - turn.problems.length })}
        </span>
      ) : null}
      {turn.lastReplyMessageId
        ? <LastReply messageId={turn.lastReplyMessageId} count={turn.messagesSent} />
        : <span className="text-caption text-foreground-hint">{intl.formatMessage({ id: "activity.overview.reply.none" })}</span>}
    </section>
  );
}

function NowCard({ agentId, turns }: { agentId: string; turns: TurnSummaryView[] }) {
  const { formatMessage } = useIntl();
  const { formatClock } = useTimeFormatter();
  const current = useAgentCurrentActivityState(agentId);
  const activity = current?.activity ?? "offline";
  const last = turns[0];
  const lastTrigger = last ? formatTurnTrigger(formatMessage, last.trigger) : null;
  const steps = turns.reduce((sum, turn) => sum + turn.toolCalls, 0);
  const problems = turns.reduce((sum, turn) => sum + turnProblemCount(turn), 0);
  return (
    <Card data-testid="activity-overview-now">
      <CardContent className="flex items-center gap-4 py-5">
        <OtterIndicator
          status={activity === "working" || activity === "thinking" ? "process" : activity === "error" ? "error" : "wait"}
          width={56}
          height={56}
        />
        <div className="flex min-w-0 flex-col gap-1">
          <Text.Heading className="text-headline font-bold tracking-normal">{formatActivityText(formatMessage, activity, current?.activityDetail, current?.detailKind)}</Text.Heading>
          {last ? (
            <Text.Sans className="text-callout text-foreground-muted">
              {lastTrigger
                ? formatMessage({ id: "activity.overview.now.lastTurnFor" }, { time: formatClock(last.endedAt), trigger: <span>{lastTrigger}</span> })
                : formatMessage({ id: "activity.overview.now.lastTurn" }, { time: formatClock(last.endedAt) })}
            </Text.Sans>
          ) : null}
          {turns.length > 0 ? (
            <Text.Sans className="text-caption text-foreground-hint">
              {formatMessage({ id: "activity.overview.now.stats" }, { turns: turns.length, steps, problems })}
            </Text.Sans>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Activity tab "Overview" (task #17): what the agent is doing now, then one
 * block per finished turn, newest first, from the per-turn summaries. Detail
 * stays in the raw log (`onShowRaw`).
 */
export default function AgentActivityOverview({
  agentId,
  machineId,
  hasRawActivity,
  onShowRaw,
}: {
  agentId: string;
  machineId?: string | null;
  hasRawActivity: boolean;
  onShowRaw: () => void;
}) {
  const { formatMessage } = useIntl();
  const { toMachine } = useAppNavigate();
  const [turns, setTurns] = useState<TurnSummaryView[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");

  const loadLatest = useCallback(async (id: string) => {
    try {
      const { data } = await api.get<SummaryPage>(`/agents/${id}/activity-summaries`, { params: { limit: PAGE_SIZE } });
      setTurns(data.summaries);
      setNext(data.next);
      setStatus("loaded");
    } catch {
      setStatus((previous) => (previous === "loaded" ? previous : "error"));
    }
  }, []);

  const loadEarlier = useCallback(() => {
    if (!next) return;
    void api.get<SummaryPage>(`/agents/${agentId}/activity-summaries`, { params: { limit: PAGE_SIZE, before: next } })
      .then(({ data }) => {
        setTurns((previous) => [...previous, ...data.summaries]);
        setNext(data.next);
      })
      .catch(() => undefined);
  }, [agentId, next]);
  const retry = useCallback(() => {
    void loadLatest(agentId);
  }, [agentId, loadLatest]);
  const openComputer = useCallback(() => {
    if (machineId) toMachine(machineId);
  }, [machineId, toMachine]);

  // The parent keys this component by agent, so state starts fresh per agent.
  useEffect(() => {
    void loadLatest(agentId);
  }, [agentId, loadLatest]);

  // A finished turn arrives with the agent's activity push; refresh the same way the raw log does.
  useEffect(() => registerActivityTrajectoryLiveReload({ socket: getSocket(), agentId, loadTrajectoryLog: loadLatest }), [agentId, loadLatest]);
  useEffect(() => registerActivityTrajectoryReconnectReload({ socket: getSocket(), agentId, loadTrajectoryLog: loadLatest }), [agentId, loadLatest]);

  if (status === "error") {
    return (
      <EmptyState
        className="flex flex-1 flex-col items-center justify-center"
        icon={<History size={36} />}
        title={formatMessage({ id: "activity.overview.loadError" })}
        action={<Button size="sm" variant="outline" onClick={retry}>{formatMessage({ id: "activity.overview.retry" })}</Button>}
      />
    );
  }
  if (status === "loaded" && turns.length === 0 && !hasRawActivity) {
    return (
      <EmptyState
        className="flex flex-1 flex-col items-center justify-center"
        icon={<History size={36} />}
        title={formatMessage({ id: "emptyState.noActivityTitle" })}
        description={formatMessage({ id: "emptyState.noActivityDesc" })}
      />
    );
  }
  if (status === "loaded" && turns.length === 0) {
    return (
      <EmptyState
        className="flex flex-1 flex-col items-center justify-center"
        icon={<History size={36} />}
        title={formatMessage({ id: "activity.overview.empty.title" })}
        description={formatMessage({ id: machineId ? "activity.overview.empty.upgradeDesc" : "activity.overview.empty.externalDesc" })}
        action={(
          <div className="flex flex-wrap justify-center gap-2">
            {machineId ? (
              <Button size="sm" variant="outline" onClick={openComputer} data-testid="activity-overview-open-computer">
                {formatMessage({ id: "activity.overview.empty.openComputer" })}
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={onShowRaw}>{formatMessage({ id: "activity.overview.empty.showRaw" })}</Button>
          </div>
        )}
      />
    );
  }
  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 py-4" data-testid="activity-overview">
      <NowCard agentId={agentId} turns={turns} />
      {turns.map((turn) => <TurnSection key={turn.id ?? `${turn.startedAt}-${turn.endedAt}`} turn={turn} />)}
      {next ? (
        <Button size="sm" variant="ghost" className="self-start" onClick={loadEarlier}>
          {formatMessage({ id: "activity.overview.loadMore" })}
        </Button>
      ) : null}
    </div>
  );
}
