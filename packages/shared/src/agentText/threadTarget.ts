// The thread-target check (glimpse G2-5): a top-level send under a target
// whose thread this model context read more recently than the target itself
// may be a reply meant for that thread. Same words for the CLI and the SDK;
// each passes its own ways forward (the CLI keeps the message as a draft, the
// SDK resumes the call with `targetConfirmed`).

export interface AgentThreadTargetPaths {
  /** Lines (already indented) that send the message to the thread instead. */
  toThread: string[];
  /** The line that introduces keeping the top-level send, and its (indented) lines. */
  confirm: { label: string; lines: string[] };
}

export function formatAgentThreadTargetCheck(target: string, threadTarget: string, paths: AgentThreadTargetPaths): string {
  return [
    `Possible thread target mismatch: your latest read context under ${target} is ${threadTarget}, but this send targets ${target} top-level.`,
    "This guard is intentionally narrow: moving a thread conclusion to the parent channel can be correct, but it is uncommon enough to confirm once.",
    "",
    "If this reply belongs in the thread, send the message to the thread target instead:",
    ...paths.toThread,
    "",
    paths.confirm.label,
    ...paths.confirm.lines,
  ].join("\n");
}
