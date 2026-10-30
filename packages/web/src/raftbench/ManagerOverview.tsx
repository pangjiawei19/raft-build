import { useCallback, useEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { Button, Card } from "@botiverse/raft-ui";
import { BarChart3, CircleHelp, Wallet } from "lucide-react";
import { useAuthStore } from "../store/authStore";
import { useServerStore } from "../store/serverStore";
import { formatUsdAmount } from "../utils/usdAmount";
import { canUseRaftBench } from "./access";
import { loadCostComparison } from "./costMetrics";
import { loadTaskPeriods, loadTaskSnapshot } from "./periodMetrics";
import type { TaskPeriods, TaskSnapshot } from "./periodMetrics";
import type { CostComparison } from "./costMetrics";

type Load<T> = { kind: "idle" | "loading" | "error" | "unavailable" } | { kind: "ready"; value: T };
export default function ManagerOverview({ channelId }: { channelId: string | null }) {
  const intl = useIntl(), { formatMessage: t, formatNumber } = intl;
  const server = useServerStore((s) => s.current), epoch = useServerStore((s) => s.serverEpoch), principal = useAuthStore((s) => s.user?.id ?? null);
  const [taskState, setTasks] = useState<Load<TaskPeriods>>({ kind: "idle" });
  const [snapshotState, setSnapshot] = useState<Load<TaskSnapshot>>({ kind: "idle" });
  const [costState, setCosts] = useState<Load<CostComparison>>({ kind: "idle" });
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => { pending.current?.abort(); }, []);
  const load = useCallback(async () => {
    if (!server || !principal || !canUseRaftBench(server.role)) return;
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller;
    const now = new Date().toISOString();
    const current = () => !controller.signal.aborted && useAuthStore.getState().user?.id === principal && useServerStore.getState().current?.id === server.id && useServerStore.getState().serverEpoch === epoch && canUseRaftBench(useServerStore.getState().current?.role);
    setTasks({ kind: "loading" }); setSnapshot({ kind: "loading" }); setCosts({ kind: "loading" });
    await Promise.allSettled([
      loadTaskSnapshot(server.id, channelId, controller.signal).then((value) => { if (current()) setSnapshot({ kind: "ready", value }); }).catch(() => { if (current()) setSnapshot({ kind: "error" }); }),
      loadTaskPeriods(server.id, now, channelId, controller.signal).then((value) => { if (current()) setTasks({ kind: "ready", value }); }).catch(() => { if (current()) setTasks({ kind: "error" }); }),
      loadCostComparison(server.id, now, controller.signal).then((value) => { if (current()) setCosts({ kind: "ready", value }); }).catch((e: unknown) => { if (current()) setCosts({ kind: (e as { response?: { status?: number } }).response?.status === 404 ? "unavailable" : "error" }); }),
    ]);
  }, [server, principal, epoch, channelId]);
  useEffect(() => { void load(); }, [load]);
  const hours = (v: number | null) => v === null ? t({ id: "raftbench.unavailableValue" }) : t({ id: "raftbench.hours" }, { value: formatNumber(v, { maximumFractionDigits: 1 }) });
  return <Card className="overflow-hidden p-0" data-testid="raftbench-manager-overview">
    <div className="flex flex-wrap items-center justify-between gap-3 bg-info-soft p-4 md:p-5"><div className="flex items-center gap-3"><BarChart3 aria-hidden="true" size={24} /><div><h2 className="text-headline">{t({ id: "raftbench.managerTitle" })}</h2><p className="text-caption">{t({ id: "raftbench.metricsCue" })}</p></div></div><Button onClick={load} disabled={snapshotState.kind === "loading" || taskState.kind === "loading" || costState.kind === "loading"}>{t({ id: "raftbench.loadOverview" })}</Button></div>
    <div className="space-y-5 p-4 md:p-5">
    <div><h3 className="font-bold">{t({ id: "raftbench.snapshotTitle" })}</h3></div>
    {snapshotState.kind === "loading" && <p role="status" className="mt-2">{t({ id: "raftbench.loadingTasks" })}</p>}
    {snapshotState.kind === "error" && <p role="alert" className="mt-2 text-danger-strong">{t({ id: "raftbench.taskAggregateError" })}</p>}
    {snapshotState.kind === "ready" && <div data-testid="raftbench-task-snapshot" className="mt-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{([
        ["raftbench.snapshotTotal", snapshotState.value.total], ["raftbench.snapshotReview", snapshotState.value.inReview],
        ["raftbench.snapshotProgress", snapshotState.value.inProgress], ["raftbench.snapshotTodo", snapshotState.value.todo],
        ["raftbench.snapshotDone", snapshotState.value.done], ["raftbench.snapshotClosed", snapshotState.value.closed],
      ] as const).map(([label, value]) => <div key={label} className="rounded-container bg-layer-sidebar p-3"><p className="text-caption">{t({ id: label })}</p><p className="mt-1 text-title tabular-nums">{formatNumber(value)}</p>{label !== "raftbench.snapshotTotal" && snapshotState.value.total > 0 && <div className="mt-2 h-1.5 overflow-hidden rounded bg-layer-canvas" aria-hidden="true"><div className="h-full rounded bg-brand" style={{ width: `${Math.min(100, value / snapshotState.value.total * 100)}%` }} /></div>}</div>)}</div>
      {snapshotState.value.durationSamples > 0 && <p className="mt-3 text-callout">{t({ id: "raftbench.snapshotDurations" }, {
        median: hours(snapshotState.value.medianHours), p90: hours(snapshotState.value.p90Hours), count: snapshotState.value.durationSamples,
      })}</p>}
      <details className="mt-3 text-caption text-foreground-hint"><summary className="cursor-pointer font-semibold text-foreground">{t({ id: "raftbench.methodDetails" })}</summary><p className="mt-2">{t({ id: "raftbench.snapshotHelp" })}</p><p className="mt-1">{t({ id: "raftbench.snapshotDates" }, {
        first: snapshotState.value.firstCreatedAt?.slice(0, 10) ?? "—", latest: snapshotState.value.latestCreatedAt?.slice(0, 10) ?? "—",
        updated: snapshotState.value.latestUpdatedAt?.slice(0, 10) ?? "—", surfaces: snapshotState.value.surfaces,
      })}</p>
      <p className="mt-1 text-caption text-foreground-hint">{t({ id: "raftbench.snapshotCreators" }, {
        human: formatNumber(snapshotState.value.humanCreated), agent: formatNumber(snapshotState.value.agentCreated),
      })}</p>
      </details>
    </div>}
    <h3 className="font-bold">{t({ id: "raftbench.periodTitle" })}</h3>
    {taskState.kind === "loading" && <p role="status" className="mt-3">{t({ id: "raftbench.loadingTasks" })}</p>}
    {taskState.kind === "error" && <p role="alert" className="mt-3 text-danger-strong">{t({ id: "raftbench.taskAggregateError" })}</p>}
    {taskState.kind === "ready" && <div data-testid="raftbench-task-comparison" className="mt-4">
      {taskState.value.current.completed === 0 && taskState.value.previous.completed === 0 ? <p role="status" className="text-callout">{t({ id: "raftbench.noCompletedTasks" })}</p> : <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{([
        ["raftbench.periodDone", `${taskState.value.current.completed} / ${taskState.value.previous.completed}`],
        ["raftbench.periodMedian", `${hours(taskState.value.current.medianHours)} / ${hours(taskState.value.previous.medianHours)}`],
        ["raftbench.periodMean", `${hours(taskState.value.current.meanHours)} / ${hours(taskState.value.previous.meanHours)}`],
      ] as const).map(([label, value]) => <Card key={label} className="p-3"><p className="text-caption">{t({ id: label })}</p><p className="mt-2 text-title tabular-nums">{value}</p></Card>)}</div>}
    </div>}
    <h3 className="flex items-center gap-2 font-bold"><Wallet aria-hidden="true" size={18} />{t({ id: "raftbench.costTitle" })}</h3>
    {costState.kind === "loading" && <p role="status" className="mt-2">{t({ id: "raftbench.loadingCosts" })}</p>}
    {costState.kind === "error" && <p role="alert" className="mt-2 text-danger-strong">{t({ id: "raftbench.error" })}</p>}
    {costState.kind === "unavailable" && <p role="status" className="mt-2">{t({ id: "raftbench.costUnavailable" })}</p>}
    {costState.kind === "ready" && <><p data-testid="raftbench-cost-comparison" className="mt-2 text-title tabular-nums">{formatUsdAmount(intl, costState.value.currentUsd)} / {formatUsdAmount(intl, costState.value.previousUsd)}</p><p className="mt-2 text-caption text-foreground-hint">{t({ id: costState.value.estimated ? "settings.hostedSpend.noteEstimated" : "settings.hostedSpend.note" })}</p>{costState.value.unpriced && <p role="status" className="mt-2 text-warning-strong">{t({ id: "settings.hostedSpend.unpriced" })}</p>}</>}
    <details className="text-caption text-foreground-hint"><summary className="flex cursor-pointer items-center gap-2 font-semibold text-foreground"><CircleHelp aria-hidden="true" size={16} />{t({ id: "raftbench.methodDetails" })}</summary><div className="mt-2 space-y-1"><p>{t({ id: "raftbench.periodHelp" })}</p>{taskState.kind === "ready" && <><p>{t({ id: "raftbench.aggregateCoverage" }, { count: taskState.value.surfaces })}</p><p>{t({ id: "raftbench.periodLimits" }, { current: taskState.value.current.durationSamples, previous: taskState.value.previous.durationSamples })}</p></>}<p>{t({ id: "raftbench.costHelp" })}</p><p>{t({ id: "raftbench.managerGaps" })}</p></div></details>
    </div>
  </Card>;
}
