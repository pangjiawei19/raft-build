import { ChevronRight } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import type { MouseEvent } from "react";
import { useIntl } from "react-intl";
import { Popover, PopoverContent, PopoverTrigger } from "@botiverse/raft-ui";
import { nextLiveAgentActivityExpiry } from "../../utils/liveAgentActivity";
import type { LiveAgentActivityItem } from "../../utils/liveAgentActivity";
import { useLiveAgentActivityStore } from "../../store/liveAgentActivityStore";
import { useAppearanceStore } from "../../store/appearanceStore";
import { formatActivityTextDescriptor } from "../../utils/activity";
import { useAppNavigate } from "../../hooks/useAppNavigate";
import AvatarSlot from "../ui/AvatarSlot";

const MAX_FACES = 3;

/** Live activity belongs to one workspace: start over when it changes. */
export function useClearLiveAgentActivityOnServerChange(serverId: string | undefined) {
  useLayoutEffect(() => {
    useLiveAgentActivityStore.getState().clear();
  }, [serverId]);
}

/**
 * Who is working right now (Raft Design System › AgentActivity): a summary in
 * the header of the place you are looking at — a stack of up to three agent
 * faces and a count. It opens "Working now": one row per working agent, what
 * it is doing, and a way to its profile. Nothing blinks.
 *
 * An agent is listed while the live-activity store has it thinking or working;
 * the "Live agent activity" appearance setting hides the summary. With nobody
 * working it takes no space.
 */
export function WorkingNowSummary({
  variant = "count",
  onFrame = false,
  className = "",
}: {
  /** `count`: faces + a number (sidebar head, phone home bar). `full`: faces + "2 agents working" + chevron (under a large title). */
  variant?: "count" | "full";
  /** Sitting on the frame (the phone Home bar): on-frame ink and the frame's pressed wash. */
  onFrame?: boolean;
  className?: string;
}) {
  const items = useLiveAgentActivityStore((state) => state.items);
  const visible = useAppearanceStore((state) => state.showLiveAgentActivityBar);
  const { formatMessage } = useIntl();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  usePruneExpiredLiveActivity(items);

  if (!visible || items.length === 0) {
    return null;
  }

  const summary = formatMessage({ id: "layout.workingNow.summary" }, { count: items.length });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-testid="working-now-summary"
        aria-label={summary}
        className={[
          "relative inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-control px-1.5",
          onFrame
            ? "text-foreground-on-frame transition-colors hover:bg-fill-frame-pressed active:bg-fill-frame-pressed data-popup-open:bg-fill-frame-pressed"
            : "text-foreground transition-colors hover:bg-fill-pressed active:bg-fill-pressed data-popup-open:bg-fill-pressed",
          "outline-none focus-visible:shadow-focus",
          "after:absolute after:inset-x-0 after:-inset-y-1.5",
          variant === "full" ? "gap-2 pr-2 text-footnote font-semibold" : "font-mono text-mono-meta",
          className,
        ].join(" ")}
      >
        <WorkingFaces items={items} />
        {variant === "full" ? summary : items.length}
        {variant === "full" ? <ChevronRight size={14} aria-hidden="true" className="text-foreground-hint" /> : null}
      </PopoverTrigger>
      {open ? (
        <PopoverContent
          align="end"
          role="dialog"
          aria-label={formatMessage({ id: "layout.workingNow.title" })}
          className="w-[300px] p-0"
          data-testid="working-now-list"
        >
          <WorkingNowList items={items} onNavigate={close} />
        </PopoverContent>
      ) : null}
    </Popover>
  );
}

function WorkingNowList({ items, onNavigate }: { items: LiveAgentActivityItem[]; onNavigate: () => void }) {
  const { formatMessage } = useIntl();
  const nav = useAppNavigate();
  const openAgent = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    const agentId = event.currentTarget.dataset.agentId;
    if (!agentId) return;
    onNavigate();
    nav.toAgent(agentId);
  }, [nav, onNavigate]);
  return (
    <div className="flex flex-col">
      <div className="flex min-h-11 items-center border-b border-line-seam px-4 text-headline">
        {formatMessage({ id: "layout.workingNow.title" })}
      </div>
      <ul className="flex max-h-[min(60vh,420px)] flex-col overflow-y-auto py-1.5">
        {items.map((item) => {
          const text = item.textDescriptor
            ? formatActivityTextDescriptor(formatMessage, item.textDescriptor)
            : item.text;
          return (
            <li key={item.agentId}>
              <button
                type="button"
                data-agent-id={item.agentId}
                onClick={openAgent}
                className="flex w-full items-start gap-3 px-4 py-2 text-left outline-none hover:bg-brand-soft focus-visible:bg-brand-soft"
              >
                <AvatarSlot
                  context="compact-row"
                  type="agent"
                  agentAvatarUrl={item.agentAvatarUrl}
                  presence={item.activity === "error" ? "error" : "busy"}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-callout font-bold text-foreground">{item.agentName}</span>
                  <span className="line-clamp-2 text-footnote text-foreground-muted">{text}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The stack of agents at work (DS AgentActivity `rf-stack`): up to three 19px
 * faces, each laid 5px over the one before. Decorative: the count or sentence
 * beside it says who.
 *
 * Not raft-ui's AvatarGroup yet: that part is the members stack (`rf-avatars`,
 * a ring cut around every face in `--layer-canvas`) and always renders a div,
 * while this stack has no ring and sits inside a button or a header's <p>.
 */
/**
 * Up to three faces, in the order the agents started (the store keeps that
 * order), so the stack changes only when someone starts or stops. A face that
 * joins slides and fades in (DS: 180-220ms, the slide easing); with reduced
 * motion it simply appears.
 */
export function WorkingFaces({ items }: { items: readonly LiveAgentActivityItem[] }) {
  return (
    <span className="flex shrink-0 items-center -space-x-[5px]" aria-hidden="true" data-testid="working-faces">
      {items.slice(0, MAX_FACES).map((item) => (
        <span
          key={item.agentId}
          className="flex motion-safe:transition-[opacity,translate] motion-safe:duration-200 motion-safe:ease-slide motion-safe:starting:-translate-x-1 motion-safe:starting:opacity-0"
        >
          <AvatarSlot context="face-stack" type="agent" agentAvatarUrl={item.agentAvatarUrl} />
        </span>
      ))}
    </span>
  );
}

/**
 * Rows leave on their own: an idle agent after its grace, a silent one after
 * the safety window. Prune at the earliest of those moments.
 */
function usePruneExpiredLiveActivity(items: readonly LiveAgentActivityItem[]) {
  const prune = useCallback(() => useLiveAgentActivityStore.getState().pruneExpired(), []);
  const nextExpiry = nextLiveAgentActivityExpiry(items);
  useEffect(() => {
    if (nextExpiry === null) return;
    const timeout = window.setTimeout(prune, Math.max(0, nextExpiry - Date.now()) + 50);
    return () => window.clearTimeout(timeout);
  }, [nextExpiry, prune]);
}

export default WorkingNowSummary;
