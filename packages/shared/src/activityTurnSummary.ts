/**
 * Per-turn activity summary (task #17, RFC 069 §6 summary row).
 *
 * One record per agent turn: when it ran, how it ended, who woke the agent,
 * what kinds of work it did (counts), which steps did not go as planned and
 * the id of its last reply. It carries no tool input, output or message body:
 * the Activity overview reads only these records, and a reply's text is
 * fetched by message id under the message's own visibility rules.
 *
 * The daemon (managed agents) and the server (external / hosted agents) build
 * it with the same accumulator below, so both producers emit one shape.
 */
import type { AgentActivityDetailKind, AgentActivityKind, TrajectoryEntry } from "./index";
import { normalizeToolDisplayInvocation, resolveToolSemantic, type ToolSemantic } from "./toolDisplay";

/**
 * What a tool call did, for a friendly count ("ran 3 commands, read a file").
 * The first ten values are OAR's `ToolActionKind` (`@botiverse/oar/observe`)
 * so an OAR-hosted runtime maps one to one; the rest are Raft's own: Raft CLI
 * actions and a split of shell commands into version control and checks.
 */
export const ACTIVITY_ACTION_KINDS = [
  "run_command",
  "read_file",
  "edit_file",
  "search",
  "web",
  "fetch",
  "subagent",
  "mcp",
  "wait",
  "other",
  "send_message",
  "read_messages",
  "raft_action",
  "version_control",
  "run_checks",
] as const;
export type ActivityActionKind = (typeof ACTIVITY_ACTION_KINDS)[number];

export const ACTIVITY_TURN_OUTCOMES = ["completed", "failed", "interrupted", "unknown"] as const;
export type ActivityTurnOutcome = (typeof ACTIVITY_TURN_OUTCOMES)[number];

/** Why a step counts as not going as planned. */
export const ACTIVITY_PROBLEM_REASONS = [
  /** The tool call itself failed (`ok: false`). */
  "call_failed",
  /** The command ran and exited non-zero (`ok` true or unknown, `exitCode` ≠ 0). */
  "exit_nonzero",
  /** A message send was held as a draft (unread messages in the target). */
  "send_held",
] as const;
export type ActivityProblemReason = (typeof ACTIVITY_PROBLEM_REASONS)[number];

export interface ActivityTurnProblem {
  kind: ActivityActionKind;
  reason: ActivityProblemReason;
  exitCode?: number;
  /** Epoch ms when the step ended. */
  at: number;
}

export interface ActivityTurnTrigger {
  /** Raft target the waking message came from, e.g. `#proj-runtime:9b526607` or `dm:@alice`. */
  target?: string;
  /**
   * The channel / DM / thread the message was posted in. Readers check the
   * viewer's access with it and show a private channel or DM they cannot see
   * without its name.
   */
  channelId?: string;
  /** Sender handle without `@`. */
  sender?: string;
  messageId?: string;
}

export interface ActivityTurnSummary {
  v: 1;
  /** Epoch ms, producer clock. */
  startedAt: number;
  endedAt: number;
  outcome: ActivityTurnOutcome;
  trigger?: ActivityTurnTrigger;
  /** Tool calls by kind, each kind once, in first-seen order. */
  actions: { kind: ActivityActionKind; count: number }[];
  toolCalls: number;
  /** At most ACTIVITY_TURN_PROBLEM_LIMIT, oldest first; `problemCount` is the full count. */
  problems: ActivityTurnProblem[];
  problemCount: number;
  messagesSent: number;
  lastReplyMessageId?: string;
}

export const ACTIVITY_TURN_PROBLEM_LIMIT = 20;

const SEMANTIC_ACTION: Partial<Record<ToolSemantic, ActivityActionKind>> = {
  send_message: "send_message",
  check_messages: "read_messages",
  wait_for_message: "read_messages",
  receive_message: "read_messages",
  read_history: "read_messages",
  search_messages: "read_messages",
  read_file: "read_file",
  view_file: "read_file",
  write_file: "edit_file",
  edit_file: "edit_file",
  bash: "run_command",
  glob: "search",
  grep: "search",
  web_fetch: "fetch",
  web_search: "web",
  collab_tool_call: "subagent",
};

const RAFT_SEMANTICS = new Set<ToolSemantic>([
  "list_server", "list_tasks", "create_tasks", "claim_tasks", "unclaim_task", "update_task_status",
  "add_channel_member", "join_channel", "leave_channel", "upload_file", "todo_write",
  "schedule_reminder", "list_reminders", "cancel_reminder",
]);

// Leading `cd x &&`, `export A=b;` and `A=b ` prefixes that do not say what a command does.
const COMMAND_PREFIX = /^(?:\s*(?:cd\s+[^;&|]+(?:&&|;)|export\s+[^;&|]+(?:&&|;)|[A-Za-z_][A-Za-z0-9_]*=\S*\s+))+/;
const CHECK_COMMAND = /(?:^|[\s;&|/(])(?:vitest|jest|mocha|pytest|playwright|tsc|oxlint|eslint|ruff|mypy|cargo\s+(?:test|check|clippy)|go\s+(?:test|vet)|(?:npm|pnpm|yarn|bun)\s+(?:(?:--filter|-F)\s+\S+\s+)?(?:run\s+)?(?:test|typecheck|lint|check)\b|node\s+--test|run-vitest)/;
const VCS_COMMAND = /^(?:git|stamp|gh|jj|hg)\s/;
const READ_COMMAND = /^(?:cat|head|tail|less|wc|sed\s+-n|nl|stat|file)\b/;
const SEARCH_COMMAND = /^(?:grep|rg|ag|find|fd|ls|tree)\b/;

/**
 * Split a shell command into a friendlier kind by its leading program. A fixed
 * table, first match wins; anything else stays `run_command`. Raft CLI calls
 * never reach here: they resolve to their own semantic first.
 */
export function classifyShellCommand(command: string): ActivityActionKind {
  const body = command.replace(COMMAND_PREFIX, "").trimStart();
  const firstLine = body.split("\n", 1)[0] ?? "";
  if (CHECK_COMMAND.test(firstLine)) return "run_checks";
  if (VCS_COMMAND.test(firstLine)) return "version_control";
  if (READ_COMMAND.test(firstLine)) return "read_file";
  if (SEARCH_COMMAND.test(firstLine)) return "search";
  return "run_command";
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  if (!text.startsWith("{")) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * Classify one tool call from what a `tool_start` entry carries: the tool name
 * and its input, either the daemon's summary (for a shell tool, the command
 * text) or, from external hooks, the tool input as JSON.
 */
export function classifyToolCall(toolName: string, toolInput: string): ActivityActionKind {
  const input = parseJsonObject(toolInput) ?? { command: toolInput };
  const command = typeof input.command === "string" ? input.command : toolInput;
  const invocation = normalizeToolDisplayInvocation(toolName, input);
  const semantic = resolveToolSemantic(invocation.toolName) ?? resolveToolSemantic(toolName);
  if (semantic === "bash") return classifyShellCommand(command);
  if (semantic && SEMANTIC_ACTION[semantic]) return SEMANTIC_ACTION[semantic]!;
  if (semantic && RAFT_SEMANTICS.has(semantic)) return "raft_action";
  if (toolName.startsWith("mcp__") || toolName.includes("/")) return "mcp";
  return "other";
}

/**
 * Folds one turn's activity into an ActivityTurnSummary. Feed it the turn's
 * trajectory entries in order (live, as the daemon produces them, or replayed
 * from storage) plus the send results; `finish` returns the record.
 */
export class ActivityTurnAccumulator {
  private readonly counts = new Map<ActivityActionKind, number>();
  private readonly openCalls = new Map<string, ActivityActionKind>();
  private readonly unmatched: ActivityActionKind[] = [];
  private readonly problems: ActivityTurnProblem[] = [];
  private problemCount = 0;
  private toolCalls = 0;
  private messagesSent = 0;
  private lastReplyMessageId: string | undefined;

  constructor(
    private readonly startedAt: number,
    private readonly trigger?: ActivityTurnTrigger,
  ) {}

  addEntry(entry: TrajectoryEntry, at: number): void {
    if (entry.kind === "tool_start") {
      const kind = classifyToolCall(entry.toolName, entry.toolInput);
      this.counts.set(kind, (this.counts.get(kind) ?? 0) + 1);
      this.toolCalls += 1;
      if (entry.callId) this.openCalls.set(entry.callId, kind);
      else this.unmatched.push(kind);
      return;
    }
    if (entry.kind !== "status" || entry.detailKind !== "tool_end" || !entry.tool) return;
    const { callId, ok, exitCode } = entry.tool;
    let kind: ActivityActionKind = "other";
    if (callId && this.openCalls.has(callId)) {
      kind = this.openCalls.get(callId)!;
      this.openCalls.delete(callId);
    } else if (this.unmatched.length > 0) {
      kind = this.unmatched.shift()!;
    }
    if (ok === false) this.addProblem({ kind, reason: "call_failed", ...(exitCode !== undefined ? { exitCode } : {}), at });
    else if (exitCode !== undefined && exitCode !== 0) this.addProblem({ kind, reason: "exit_nonzero", exitCode, at });
  }

  /** A `raft message send` the server accepted (state `sent`). */
  noteMessageSent(messageId: string | undefined): void {
    this.messagesSent += 1;
    if (messageId) this.lastReplyMessageId = messageId;
  }

  /** A `raft message send` the server held as a draft. */
  noteSendHeld(at: number): void {
    this.addProblem({ kind: "send_message", reason: "send_held", at });
  }

  finish(outcome: ActivityTurnOutcome, endedAt: number): ActivityTurnSummary {
    return {
      v: 1,
      startedAt: this.startedAt,
      endedAt: Math.max(endedAt, this.startedAt),
      outcome,
      ...(this.trigger && Object.keys(this.trigger).length > 0 ? { trigger: { ...this.trigger } } : {}),
      actions: [...this.counts].map(([kind, count]) => ({ kind, count })),
      toolCalls: this.toolCalls,
      problems: [...this.problems],
      problemCount: this.problemCount,
      messagesSent: this.messagesSent,
      ...(this.lastReplyMessageId ? { lastReplyMessageId: this.lastReplyMessageId } : {}),
    };
  }

  private addProblem(problem: ActivityTurnProblem): void {
    this.problemCount += 1;
    if (this.problems.length < ACTIVITY_TURN_PROBLEM_LIMIT) this.problems.push(problem);
  }
}

export interface LoggedActivityRow {
  /** Epoch ms the row was recorded at (for external agents: the event's own time). */
  timestamp: number;
  entry: TrajectoryEntry;
}

export interface LoggedTurn {
  /** Index in `rows` of the entry that opened the turn; its key identifies the turn. */
  startIndex: number;
  summary: ActivityTurnSummary;
}

/**
 * Rebuild turn summaries from stored activity rows (the server's path for
 * agents without a daemon). Rows are folded in timestamp order (stable for
 * ties), so events that arrived late or out of order land in their turn.
 * A turn opens at a row `turnStart` accepts (a start while a turn is open
 * is part of that turn: a status report saying "working" again mid-turn)
 * and closes at the first later row `turnEnd` gives an outcome for; a turn
 * still open at the end of `rows` is not returned. `sends` are the messages the agent sent (time + id); each
 * counts in the turn whose time span contains it.
 */
export function summarizeTurnsFromLog(
  rows: readonly LoggedActivityRow[],
  options: {
    turnStart: (entry: TrajectoryEntry) => ActivityTurnTrigger | null;
    turnEnd: (entry: TrajectoryEntry) => ActivityTurnOutcome | null;
    /**
     * Ends that a status stream may take back: if a row `turnStart` accepts
     * follows within `softEndGraceMs`, the turn goes on (a reported "online"
     * blip between two "working" reports is one turn, not two).
     */
    softEnd?: (entry: TrajectoryEntry) => boolean;
    softEndGraceMs?: number;
    sends?: readonly { at: number; messageId?: string }[];
  },
): LoggedTurn[] {
  const ordered = rows.map((row, index) => ({ ...row, index })).sort((a, b) => a.timestamp - b.timestamp || a.index - b.index);
  const sends = [...(options.sends ?? [])].sort((a, b) => a.at - b.at);
  const grace = options.softEndGraceMs ?? 0;
  const resumesSoon = (position: number) => {
    const endedAt = ordered[position]!.timestamp;
    for (let next = position + 1; next < ordered.length && ordered[next]!.timestamp - endedAt <= grace; next += 1) {
      if (options.turnStart(ordered[next]!.entry)) return true;
    }
    return false;
  };
  const turns: LoggedTurn[] = [];
  let open: { startIndex: number; acc: ActivityTurnAccumulator; startedAt: number } | null = null;
  for (const [position, row] of ordered.entries()) {
    const trigger: ActivityTurnTrigger | null = open ? null : options.turnStart(row.entry);
    if (trigger) {
      open = { startIndex: row.index, acc: new ActivityTurnAccumulator(row.timestamp, Object.keys(trigger).length > 0 ? trigger : undefined), startedAt: row.timestamp };
      continue;
    }
    if (!open) continue;
    open.acc.addEntry(row.entry, row.timestamp);
    const outcome = options.turnEnd(row.entry);
    if (outcome && !(outcome === "completed" && options.softEnd?.(row.entry) && resumesSoon(position))) {
      for (const send of sends) {
        if (send.at >= open.startedAt && send.at <= row.timestamp) open.acc.noteMessageSent(send.messageId);
      }
      turns.push({ startIndex: open.startIndex, summary: open.acc.finish(outcome, row.timestamp) });
      open = null;
    }
  }
  return turns;
}

/**
 * Per-agent turn summaries for the Activity overview (task #17). A turn opens
 * when an idle agent is handed a message, folds every trajectory entry the
 * daemon publishes for that agent, and closes on the frame that says the turn
 * is over (idle, stopped, crashed); that frame then carries the summary entry.
 */
export class TurnSummaryTracker {
  private readonly open = new Map<string, ActivityTurnAccumulator>();

  /**
   * A new turn. If the previous one never reached an end frame (a lost idle, a
   * daemon that missed the end), it closes here and its summary is returned so
   * the caller can publish it with the turn-start frame.
   */
  begin(agentId: string, now: number, trigger: ActivityTurnTrigger | undefined, previousOutcome: ActivityTurnOutcome = "unknown"): TrajectoryEntry[] {
    const previous = this.finish(agentId, previousOutcome, now);
    this.open.set(agentId, new ActivityTurnAccumulator(now, trigger));
    return previous;
  }

  /** Fold published entries; a turn already running when the daemon started is picked up here, without a trigger. */
  observe(agentId: string, entries: readonly TrajectoryEntry[], now: number): void {
    const relevant = entries.filter((entry) => entry.kind === "tool_start" || (entry.kind === "status" && entry.detailKind === "tool_end"));
    if (relevant.length === 0) return;
    let acc = this.open.get(agentId);
    if (!acc) {
      acc = new ActivityTurnAccumulator(now);
      this.open.set(agentId, acc);
    }
    for (const entry of relevant) acc.addEntry(entry, now);
  }

  noteSendOutcome(agentId: string, outcome: { state: "sent"; messageId?: string } | { state: "held" }, now: number): void {
    const acc = this.open.get(agentId);
    if (!acc) return;
    if (outcome.state === "sent") acc.noteMessageSent(outcome.messageId);
    else acc.noteSendHeld(now);
  }

  /** Close the open turn, if any, and return its summary entry (empty when none was open). */
  finish(agentId: string, outcome: ActivityTurnOutcome, now: number): TrajectoryEntry[] {
    const acc = this.open.get(agentId);
    if (!acc) return [];
    this.open.delete(agentId);
    return [{ kind: "turn_summary", summary: acc.finish(outcome, now) }];
  }
}

/** Whether a published activity ends the turn, and how. */
export function turnOutcomeForActivity(activityKind: AgentActivityKind, detailKind: AgentActivityDetailKind | undefined): ActivityTurnOutcome | null {
  if (activityKind === "online" && detailKind === "idle") return "completed";
  if (activityKind !== "offline") return null;
  if (detailKind === "runtime_crashed" || detailKind === "runtime_unavailable") return "failed";
  return "interrupted";
}
