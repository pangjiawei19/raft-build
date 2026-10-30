// Current workspace = a short bar under its avatar (Discord's pill, laid flat
// for a top bar): "you are here" without a heavy ring; nothing moves on switch.
export function WorkspaceStripCurrentMark({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute -bottom-[6px] left-1/2 h-[3px] -translate-x-1/2 rounded-[2px] transition-[width,opacity] duration-150 ${
        on ? "w-3.5 bg-foreground opacity-100" : "w-1.5 bg-foreground-muted opacity-0 group-hover/ws:opacity-60"
      }`}
    />
  );
}
