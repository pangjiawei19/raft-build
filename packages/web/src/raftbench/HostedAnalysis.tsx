import type { ChangeEvent, MouseEvent } from "react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { useIntl } from "react-intl";
import { Button, Card, Input } from "@botiverse/raft-ui";
import type { RaftbenchReport, HostedAgentModelView } from "@botiverse/raft-shared";
import api from "../api/client";
import { useAppNavigate } from "../hooks/useAppNavigate";
import { useServerStore } from "../store/serverStore";
import { useAuthStore } from "../store/authStore";
import { canUseRaftBench } from "./access";

type Dashboard = {
  historyFrom?: string | null;
  progress?: { readMessages: number; completedBatches: number; scannedThroughAt: string | null };
  coverage?: { totalMessages: number; windowMessages: number; earliestAt: string | null; latestAt: string | null; from: string; to: string; checkedAt: string } | null;
  enabled: boolean; revision: number; channelIds: string[]; agentId: string | null;
  provisioning: { state: string; error: string | null; profile: string | null } | null;
  intervalMinutes: number;
  run: { runId: string; status: string; from: string; to: string; updatedAt: string; fetchedMessages: number; skippedRanges?: Array<{ from: string; to: string; messages: number | null }>; stopReason: string; exhausted: boolean; failureReason: string | null; report: Pick<RaftbenchReport, "status" | "reason" | "gaps" | "patterns"> | null } | null;
  pagination: { page: number; pageCount: number; total: number; pageSize: number };
};
type Option = { value: string; label: string };
type ServiceAgent = { agentId: string; name: string; state: string | null; ready: boolean };
type View = { data: Dashboard | null; loading: boolean; saving: boolean; failed: boolean };
const initial: View = { data: null, loading: true, saving: false, failed: false };
const statusKeys = { stale: "raftbench.aiStale", queued: "raftbench.aiQueued", running: "raftbench.aiReading", ready: "raftbench.aiReady", partial: "raftbench.aiPartial", failed: "raftbench.aiFailed" } as const;
const kindKeys = { repeated_clarification: "raftbench.aiClarification", repeated_attempt: "raftbench.aiRepeated", unsupported_completion: "raftbench.aiUnsupported", successful_practice: "raftbench.aiSuccessful" } as const;
const intentKeys = { active: "raftbench.aiActive", deliberately_paused: "raftbench.aiPaused", unknown: "raftbench.aiUnknown" } as const;
export default function HostedAnalysis({ allowed, options, onEnabled }: { allowed: boolean; options: Option[]; onEnabled: (value: boolean) => void }) {
  const { formatMessage: t, formatDate, formatTime, formatNumber } = useIntl();
  const server = useServerStore(s => s.current), epoch = useServerStore(s => s.serverEpoch), principal = useAuthStore(s => s.user?.id ?? null);
  const nav = useAppNavigate();
  const [view, update] = useReducer((state: View, patch: Partial<View>) => ({ ...state, ...patch }), initial);
  const [page, setPage] = useState(1);
  const [model, setModel] = useState<{ agentId: string; label: string | null } | null>(null);
  const [serviceAgents, setServiceAgents] = useState<ServiceAgent[]>([]);
  const [selection, select] = useState<string[] | null>(null);
  const [historyDate, setHistoryDate] = useState<string | null>(null);
  useEffect(() => { select(null); setHistoryDate(null); setServiceAgents([]); }, [server?.id, epoch, principal]);
  const pending = useRef<AbortController | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const saving = useRef(false);
  const reading = useRef(false);
  const current = useCallback(() => allowed && useServerStore.getState().current?.id === server?.id && useServerStore.getState().serverEpoch === epoch && useAuthStore.getState().user?.id === principal && canUseRaftBench(useServerStore.getState().current?.role), [allowed, server?.id, epoch, principal]);
  const load = useCallback(async () => {
    if (!current() || !server || saving.current || reading.current) return;
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller; reading.current = true;
    try {
      const { data } = await api.get<Dashboard>("/raftbench", { params: { page }, signal: controller.signal, headers: { "X-Server-Id": server.id } });
      if (!controller.signal.aborted && current()) { update({ data, loading: false, failed: false }); onEnabled(data.enabled); }
      try {
        const { data: listed } = await api.get<{ agents: ServiceAgent[] }>("/raftbench/agents", { signal: controller.signal, headers: { "X-Server-Id": server.id } });
        if (!controller.signal.aborted && current()) setServiceAgents(listed.agents ?? []);
      } catch { if (!controller.signal.aborted && current()) setServiceAgents([]); }
    } catch {
      if (!controller.signal.aborted && current()) { update({ data: null, loading: false, failed: true }); onEnabled(false); }
    } finally { if (pending.current === controller) reading.current = false; }
  }, [current, server, page, onEnabled]);
  useEffect(() => {
    void load(); const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 5000);
    return () => { window.clearInterval(timer); pending.current?.abort(); reading.current = false; mutation.current?.abort(); };
  }, [load]);
  const data = allowed ? view.data : null;
  const agentId = data?.enabled && data.provisioning?.state === "active" ? data.agentId : null;
  useEffect(() => {
    if (!agentId || !current()) return;
    const controller = new AbortController();
    const read = async () => {
      try {
        const { data: value } = await api.get<HostedAgentModelView>(`/agents/${agentId}/hosted-runtime/model`, { signal: controller.signal });
        if (!controller.signal.aborted && current()) setModel({ agentId, label: value.label ?? value.model ?? value.defaultLabel ?? value.default });
      } catch { if (!controller.signal.aborted && current()) setModel({ agentId, label: null }); }
    };
    void read(); const timer = window.setInterval(() => { void read(); }, 60_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [agentId, current]);
  const selected = selection ?? (data?.channelIds.length ? data.channelIds : options.slice(0, 50).map(o => o.value));
  const dateValue = historyDate ?? data?.historyFrom?.slice(0, 10) ?? new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const invalidHistory = historyDate !== null && (!historyDate || !Number.isFinite(Date.parse(`${historyDate}T00:00:00Z`)) || Date.parse(`${historyDate}T00:00:00Z`) >= Date.now());
  const createServiceAgent = useCallback(async () => {
    if (!current() || !server || view.saving) return;
    saving.current = true; update({ saving: true, failed: false });
    try {
      await api.post("/raftbench/agents", {}, { headers: { "X-Server-Id": server.id } });
    } catch { if (current()) update({ failed: true }); }
    finally { saving.current = false; if (current()) { update({ saving: false }); void load(); } }
  }, [current, server, view.saving, load]);
  const assignAgent = useCallback(async (agentId: string) => {
    if (!current() || !server || !data || view.saving || !selected.length || invalidHistory || (data.revision > 0 && (selection !== null || historyDate !== null))) return;
    saving.current = true; update({ saving: true, failed: false });
    try {
      await api.put("/raftbench/assignment", { agentId, expectedRevision: data.revision, ...(data.revision === 0 ? { channelIds: selected, historyFrom: new Date(`${dateValue}T00:00:00Z`).toISOString() } : {}) }, { headers: { "X-Server-Id": server.id } });
      setPage(1); onEnabled(true);
    } catch { if (current()) update({ failed: true }); }
    finally { saving.current = false; if (current()) { update({ saving: false }); void load(); } }
  }, [current, server, data, view.saving, selected, invalidHistory, selection, historyDate, dateValue, onEnabled, load]);
  const openAgentCard = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    const id = event.currentTarget.dataset.agent;
    if (id) nav.toAgent(id);
  }, [nav]);
  const assignAgentFromCard = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    const id = event.currentTarget.dataset.agent;
    if (id) void assignAgent(id);
  }, [assignAgent]);
  const save = useCallback(async (enabled: boolean, startDate = historyDate) => {
    if (!current() || !data || !server) return;
    saving.current = true;
    update({ saving: true, failed: false });
    const controller = new AbortController(); pending.current?.abort(); reading.current = false; mutation.current = controller;
    try {
      await api.put("/raftbench", { enabled, channelIds: selected, expectedRevision: data.revision, ...(enabled && startDate ? { historyFrom: new Date(`${startDate}T00:00:00Z`).toISOString() } : {}) }, { signal: controller.signal, headers: { "X-Server-Id": server.id } });
      if (!controller.signal.aborted && current()) { update({ data: { ...data, enabled, run: null } }); select(null); setHistoryDate(null); setPage(1); onEnabled(enabled); saving.current = false; await load(); }
    } catch { if (!controller.signal.aborted && current()) update({ failed: true }); }
    finally { saving.current = false; if (!controller.signal.aborted && current()) update({ saving: false }); }
  }, [current, data, server, selected, historyDate, onEnabled, load]);
  const toggle = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const id = event.currentTarget.value;
    select(selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id].slice(0, 50));
  }, [selected]);
  const previous = useCallback(() => setPage(value => Math.max(1, value - 1)), []);
  const next = useCallback(() => setPage(value => value + 1), []);
  const openEvidence = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    const { channel, message } = event.currentTarget.dataset;
    if (channel && message) nav.toMessage(channel, message);
  }, [nav]);
  const toggleAnalysis = useCallback(() => { if (data) void save(!data.enabled); }, [data, save]);
  const applySettings = useCallback(() => { void save(true); }, [save]);
  const changeHistory = useCallback((event: ChangeEvent<HTMLInputElement>) => setHistoryDate(event.currentTarget.value), []);
  const chooseHistory = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    const days = Number(event.currentTarget.dataset.days);
    if ([7, 30, 90].includes(days)) setHistoryDate(new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10));
  }, []);
  const changed = selection !== null || historyDate !== null;
  const emptyRange = !!data?.coverage && data.coverage.totalMessages > 0 && data.coverage.windowMessages === 0;
  const availableHistory = data?.coverage?.latestAt?.slice(0, 10);
  const analyzeAvailableHistory = useCallback(() => {
    if (availableHistory) void save(true, availableHistory);
  }, [availableHistory, save]);
  const run = data?.run;
  const emptyScan = emptyRange && !run?.failureReason && !run?.report?.patterns.length && !data?.progress?.readMessages && !run?.fetchedMessages;
  const noMaterial = !!run?.report && run.fetchedMessages === 0 && !(data?.progress?.readMessages) && !run.failureReason;
  const busy = data?.enabled && data.provisioning?.state !== "failed" && (!run || run.status === "queued" || run.status === "running");
  const stamp = (value: string) => `${formatDate(value)} ${formatTime(value, { hour: "numeric", minute: "2-digit" })}`;
  return <Card className="min-w-0 overflow-hidden border-line-hairline bg-layer-canvas p-0" data-testid="raftbench-hosted-analysis">
    <div className="flex flex-wrap items-center justify-between gap-3 bg-success-soft p-4 md:p-5"><div className="flex items-center gap-3"><Sparkles aria-hidden="true" size={24} /><div><h2 className="text-headline">{t({ id: "raftbench.aiTitle" })}</h2><p className="text-caption">{t({ id: "raftbench.aiCue" })}</p></div></div>
      <Button onClick={toggleAnalysis} disabled={!allowed || !data || view.saving || (!data.enabled && (!selected.length || invalidHistory))}>{t({ id: view.saving ? "raftbench.aiSaving" : data?.enabled ? "raftbench.aiDisable" : "raftbench.aiEnable" })}</Button>
    </div>
    <div className="p-4 md:p-5">
    {view.loading && <p role="status" className="mt-3">{t({ id: "raftbench.aiLoading" })}</p>}
    {view.failed && <p role="alert" className="mt-3 text-danger-strong">{t({ id: "raftbench.aiError" })}</p>}
    {data && <details className="mt-4 rounded-container border border-line-hairline p-3" open={!data.agentId}>
      <summary className="cursor-pointer font-semibold">{t({ id: "raftbench.agentCardTitle" })}</summary>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p className="text-caption text-foreground-hint">{t({ id: "raftbench.agentCardHelp" })}</p><Button size="sm" onClick={createServiceAgent} disabled={view.saving}>{t({ id: "raftbench.createServiceAgent" })}</Button></div>
      {serviceAgents.length > 0 && <ul className="mt-3 space-y-2">{serviceAgents.map(agent => <li key={agent.agentId} className="flex flex-wrap items-center justify-between gap-2 rounded border border-line-hairline p-2 text-callout"><div><button className="font-semibold underline" data-agent={agent.agentId} onClick={openAgentCard}>{agent.name}</button><p className="text-caption text-foreground-hint">{data.agentId === agent.agentId ? t({ id: "raftbench.assignedAgent" }) : agent.ready ? t({ id: "raftbench.agentReady" }) : t({ id: "raftbench.agentProvisioning" })}</p></div>{data.agentId !== agent.agentId && <Button size="sm" data-agent={agent.agentId} disabled={!agent.ready || view.saving || !selected.length || invalidHistory || (data.revision > 0 && (selection !== null || historyDate !== null))} onClick={assignAgentFromCard}>{t({ id: "raftbench.assignAgent" })}</Button>}</li>)}</ul>}
      <p className="mt-2 text-caption text-foreground-hint">{t({ id: "raftbench.computerComing" })}</p>
    </details>}
    <details className="mt-4" open={!data?.enabled}><summary className="cursor-pointer text-callout font-semibold">{t({ id: "raftbench.aiSettings" })}</summary><fieldset className="mt-3" disabled={view.saving}><legend className="text-callout font-semibold">{t({ id: "raftbench.aiSources" })}</legend><p className="mt-1 text-caption text-foreground-hint">{t({ id: "raftbench.aiConsent" })}</p><p className="mt-1 text-caption text-foreground-hint">{t({ id: "raftbench.aiRuntime" })}</p><div className="mt-2 grid max-h-44 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">{options.map(option => <label key={option.value} className="flex min-w-0 items-center gap-2 text-callout"><input type="checkbox" checked={selected.includes(option.value)} value={option.value} onChange={toggle} /><span className="truncate">{option.label}</span></label>)}</div>
      <div className="mt-4"><label htmlFor="raftbench-history-from" className="block text-callout font-semibold">{t({ id: "raftbench.aiHistoryFrom" })}</label><Input id="raftbench-history-from" className="mt-2 w-full sm:w-auto" type="date" value={dateValue} max={new Date().toISOString().slice(0, 10)} onChange={changeHistory} /><div className="mt-2 flex flex-wrap gap-2">{[7, 30, 90].map(days => <Button key={days} size="sm" data-days={days} onClick={chooseHistory}>{t({ id: "raftbench.aiHistoryDays" }, { days })}</Button>)}</div><p className="mt-2 text-caption text-foreground-hint">{t({ id: "raftbench.aiHistoryHelp" })}</p></div>
      {data?.enabled && changed && <Button className="mt-3" onClick={applySettings} disabled={!selected.length || invalidHistory}>{t({ id: "raftbench.aiApplyScope" })}</Button>}
    </fieldset></details>
    {data?.enabled && data.progress && data.progress.readMessages > 0 && <div className="mt-4" role="status"><p className="font-semibold">{data.coverage ? t({ id: "raftbench.aiCumulativeRead" }, { count: data.progress.readMessages, total: data.coverage.windowMessages, batches: data.progress.completedBatches }) : t({ id: "raftbench.aiCumulativeUnknown" }, { count: data.progress.readMessages, batches: data.progress.completedBatches })}</p><p className="mt-1 text-caption text-foreground-hint">{t({ id: "raftbench.aiProgressiveHelp" })}</p></div>}
    {data?.coverage && <div className="mt-4 rounded-container border border-line-hairline p-3 text-callout" role="status"><p>{t({ id: "raftbench.aiCoverageCounts" }, { total: data.coverage.totalMessages, count: data.coverage.windowMessages })}</p><p className="mt-1 text-caption text-foreground-hint">{data.coverage.latestAt ? t({ id: "raftbench.aiLatestSource" }, { time: stamp(data.coverage.latestAt) }) : t({ id: "raftbench.aiSourceEmpty" })}</p><p className="mt-1 text-caption text-foreground-hint">{t({ id: "raftbench.aiWindow" }, { from: stamp(data.coverage.from), to: stamp(data.coverage.to) })}</p>{emptyRange && <div className="mt-3"><p>{t({ id: "raftbench.aiOutsideWindow" })}</p>{data.enabled && availableHistory && <><p className="mt-2 text-caption text-foreground-hint">{t({ id: "raftbench.aiAvailableHistoryHelp" }, { count: data.coverage.totalMessages })}</p><Button className="mt-3" onClick={analyzeAvailableHistory} disabled={view.saving || changed}>{t({ id: "raftbench.aiAnalyzeAvailableHistory" }, { date: availableHistory })}</Button></>}</div>}</div>}
    {data?.enabled && <p className="mt-2 text-caption text-foreground-hint">{t({ id: "raftbench.aiModel" }, { model: model?.agentId === data.agentId && model.label ? model.label : t({ id: "raftbench.aiUnknown" }) })}</p>}
    {data?.enabled && <p className="mt-3 text-caption text-foreground-hint">{t({ id: "raftbench.aiCadence" }, { count: data.intervalMinutes, sources: data.channelIds.length })}</p>}
    {data?.enabled && data.provisioning?.state === "failed" && <p role="alert" className="mt-3 text-danger-strong">{t({ id: "raftbench.aiProvisionFailed" })}</p>}
    {busy && !emptyScan && <div className="mt-4" role="status" aria-live="polite"><p className="text-callout font-semibold">{t({ id: data?.provisioning?.state === "failed" ? "raftbench.aiProvisionFailed" : data?.provisioning?.state !== "active" ? "raftbench.aiProvisioning" : !run || run.status === "queued" ? "raftbench.aiQueued" : run.stopReason === "more_pages" ? "raftbench.aiReading" : "raftbench.aiAnalyzing" })}</p><div className="mt-2 h-2 overflow-hidden rounded bg-layer-sidebar" role="progressbar" aria-label={t({ id: "raftbench.aiProgress" })} aria-valuetext={t({ id: data?.progress ? "raftbench.aiBatchReadCount" : "raftbench.aiReadCount" }, { count: run?.fetchedMessages ?? 0 })}><div className="h-full w-1/3 animate-pulse rounded bg-brand" /></div><p className="mt-2 text-caption text-foreground-hint">{t({ id: data?.progress ? "raftbench.aiBatchProgress" : "raftbench.aiReadUnknown" }, { count: run?.fetchedMessages ?? 0 })}</p></div>}
    {run?.skippedRanges && run.skippedRanges.length > 0 && <div role="status" className="mt-3 rounded-container bg-warning-soft p-3 text-callout text-warning-strong">{run.skippedRanges.map((range, index) => <p key={`${range.from}-${index}`}>{t({ id: "raftbench.aiSkippedWindow" }, { from: stamp(range.from), to: stamp(range.to), count: range.messages === null ? t({ id: "raftbench.aiUnknown" }) : formatNumber(range.messages) })}</p>)}</div>}
    {run && !emptyScan && <div className="mt-4"><div className="flex flex-wrap justify-between gap-2 text-caption text-foreground-hint"><span>{t({ id: "raftbench.aiWindow" }, { from: stamp(run.from), to: stamp(run.to) })}</span><span>{t({ id: data?.progress ? "raftbench.aiBatchReadCount" : "raftbench.aiReadCount" }, { count: run.fetchedMessages })}</span></div>
      {!busy && <p className="mt-3 font-semibold">{t({ id: noMaterial ? "raftbench.aiNoMaterial" : statusKeys[run.status as keyof typeof statusKeys] ?? "raftbench.aiUnknown" })}</p>}
      {run.failureReason && <p role="alert" className="mt-2 text-callout text-warning-strong">{run.failureReason}</p>}
      {run.report?.reason && run.report.reason !== run.failureReason && <p className="mt-2 break-words text-callout text-warning-strong">{run.fetchedMessages === 0 && (data?.progress?.readMessages ?? 0) > 0 ? t({ id: "raftbench.aiNoNewMessages" }) : run.report.reason}</p>}
      {run.report && <><p className="mt-2 text-caption text-foreground-hint">{t({ id: "raftbench.aiLimits" })}</p>{run.report.patterns.length === 0 && <p className="mt-4 text-callout">{t({ id: noMaterial ? "raftbench.aiNoMaterialHelp" : "raftbench.aiNoPatterns" })}</p>}
        <ol className="mt-3 space-y-3">{run.report.patterns.map((pattern, index) => <li key={`${run.runId}-${page}-${index}`} className="min-w-0 rounded-container border border-line-hairline p-3"><h3 className="font-semibold">{t({ id: kindKeys[pattern.kind] })}</h3><p className="mt-1 break-words text-callout">{pattern.explanation}</p><p className="mt-2 text-caption text-foreground-hint">{t({ id: pattern.evidenceLevel === "insufficient" ? "raftbench.aiInsufficient" : "raftbench.aiConversationOnly" })}</p><p className="mt-2 text-caption text-foreground-hint">{t({ id: "raftbench.aiIntent" }, { intent: t({ id: intentKeys[pattern.intent] }) })}</p><div className="mt-2 flex flex-wrap gap-2">{[...pattern.evidence.map(ref => ({ ref, counter: false })), ...pattern.counterevidence.map(ref => ({ ref, counter: true }))].map(({ ref, counter }) => { const source = options.find(option => option.label.replace(/^#/, "") === ref.target.slice(1)); return source ? <Button key={`${counter}-${ref.target}-${ref.messageId}`} size="sm" data-channel={source.value} data-message={ref.messageId} onClick={openEvidence}>{t({ id: "raftbench.aiEvidenceRef" }, { label: t({ id: counter ? "raftbench.aiCounterEvidence" : "raftbench.aiEvidence" }), target: ref.target, message: ref.messageId.slice(0, 8) })}</Button> : <span key={`${counter}-${ref.target}-${ref.messageId}`} className="text-caption">{t({ id: "raftbench.aiSourceUnavailable" })}</span>; })}</div>{pattern.counterevidence.length > 0 && <p className="mt-2 text-caption">{t({ id: "raftbench.aiCounter" }, { count: pattern.counterevidence.length })}</p>}{pattern.suggestion && <div className="mt-3 rounded bg-layer-sidebar p-2 text-callout"><p className="font-semibold">{t({ id: "raftbench.aiProposal" })}</p><p className="mt-1 whitespace-pre-wrap break-words">{pattern.suggestion}</p></div>}</li>)}</ol>
        <nav className="mt-4 flex flex-wrap items-center justify-between gap-3" aria-label={t({ id: "raftbench.aiPages" })}><Button disabled={data.pagination.page <= 1 || data.pagination.page !== page} onClick={previous}>{t({ id: "raftbench.aiPrevious" })}</Button><span className="text-callout">{t({ id: "raftbench.aiPage" }, { page: formatNumber(data.pagination.page), total: formatNumber(data.pagination.pageCount), count: data.pagination.total })}</span><Button disabled={data.pagination.page >= data.pagination.pageCount || data.pagination.page !== page} onClick={next}>{t({ id: "raftbench.aiNext" })}</Button></nav></>}
    </div>}
    </div>
  </Card>;
}
