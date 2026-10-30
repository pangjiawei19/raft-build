import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { Hash, Lock, Search } from "lucide-react";

import AvatarSlot from "../ui/AvatarSlot";

import type { Channel } from "../../store/channelStore";
import type { Agent } from "../../store/agentStore";
import type { ServerMember } from "../../store/serverStore";
import {
  buildFinderResults,
  finderSearchEntries,
  rankFinderResults,
} from "./conversationFinderModel";
import type { FinderResult } from "./conversationFinderModel";
import { dismissLayerProps } from "../ui/dismissLayer";

// "Find a conversation…" — a name-based jump box pinned above the sidebar
// scroll surface (Slack parity, #kabi-desktop). Fuzzy-matches channels, DMs,
// agents, and people over the stores already loaded in the Sidebar; NO
// message-content search and NO keyboard shortcut by design. Selecting a
// result jumps to that conversation (people/agents open their DM). The dedup
// and ranking live in `conversationFinderModel.ts` (unit tested).

interface SidebarConversationFinderProps {
  channels: Channel[];
  dmChannels: Channel[];
  agents: Agent[];
  members: ServerMember[];
  /** Current user id, excluded from people results (no self-DM). */
  currentUserId?: string | null;
  onOpenChannel: (channelId: string) => void;
  onOpenDm: (dmChannelId: string) => void;
  onOpenAgentDm: (agentId: string) => void;
  onOpenHumanDm: (userId: string) => void;
}

export function SidebarConversationFinder({
  channels,
  dmChannels,
  agents,
  members,
  currentUserId,
  onOpenChannel,
  onOpenDm,
  onOpenAgentDm,
  onOpenHumanDm,
}: SidebarConversationFinderProps) {
  const { formatMessage } = useIntl();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isComposing, setIsComposing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Build the searchable universe once per store change. People/agents that
  // already have a DM channel are represented by that DM (dedup by peer id) so
  // each conversation appears once.
  const agentTag = formatMessage({ id: "sidebar.findConversationAgentTag" });
  const entries = useMemo(
    () =>
      finderSearchEntries(
        buildFinderResults({ channels, dmChannels, agents, members, currentUserId, agentTag }),
      ),
    [channels, dmChannels, agents, members, currentUserId, agentTag],
  );

  const trimmed = query.trim();
  const ranked = useMemo(() => rankFinderResults(trimmed, entries), [trimmed, entries]);

  const showDropdown = open && trimmed.length > 0;

  // Reset the highlighted row when the query changes. Done during render via a
  // ref (not a useEffect) so there's no derived-state effect or post-render
  // state-update chain; `activeRow` is the value to use for this render.
  const activeQueryRef = useRef(trimmed);
  let activeRow = activeIndex;
  if (activeQueryRef.current !== trimmed) {
    activeQueryRef.current = trimmed;
    activeRow = 0;
    setActiveIndex(0);
  }

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }, []);

  const select = useCallback(
    (result: FinderResult | undefined) => {
      if (!result) return;
      switch (result.kind) {
        case "channel":
          onOpenChannel(result.channelId);
          break;
        case "dm":
          onOpenDm(result.dmChannelId);
          break;
        case "agent":
          onOpenAgentDm(result.agentId);
          break;
        case "human":
          onOpenHumanDm(result.userId);
          break;
      }
      close();
      inputRef.current?.blur();
    },
    [onOpenChannel, onOpenDm, onOpenAgentDm, onOpenHumanDm, close],
  );

  // Dismiss on outside click.
  useEffect(() => {
    if (!showDropdown) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [showDropdown, close]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      inputRef.current?.blur();
      return;
    }
    if (!showDropdown || ranked.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % ranked.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + ranked.length) % ranked.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      select(ranked[activeRow]);
    }
  };

  return (
    <div ref={rootRef} className="relative shrink-0 px-2 pt-2.5 pb-2">
      {/* DS Search field (`.rf-search`), at the sidebar's 36px row height: a
          1.5px ink control edge on the surface layer, the focus ring on the box. */}
      <div className="flex h-9 min-w-0 items-center gap-2 rounded-control border-[1.5px] border-line-strong bg-layer-card px-2.5 focus-within:shadow-focus">
        <Search size={16} className="shrink-0 text-foreground-hint" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={(event) => {
            setIsComposing(false);
            setQuery(event.currentTarget.value);
          }}
          placeholder={formatMessage({ id: "sidebar.findConversationPlaceholder" })}
          aria-label={formatMessage({ id: "sidebar.findConversationPlaceholder" })}
          data-testid="sidebar-conversation-finder-input"
          className="min-w-0 flex-1 bg-transparent font-sans text-subhead text-foreground outline-none placeholder:text-foreground-hint"
        />
      </div>

      {showDropdown && (
        <div
          {...dismissLayerProps}
          className="absolute inset-x-2 top-full z-30 mt-1 max-h-[min(60vh,22rem)] overflow-y-auto rounded-container bg-layer-popover p-1.5 text-foreground shadow-float ring-1 ring-line-seam"
          data-testid="sidebar-conversation-finder-results"
        >
          {ranked.length === 0 ? (
            <div className="px-2.5 py-2 font-sans text-callout text-foreground-hint">
              {formatMessage({ id: "sidebar.findConversationEmpty" })}
            </div>
          ) : (
            ranked.map((result, index) => (
              <button
                key={result.key}
                type="button"
                // Use pointerdown so the click lands before the input's blur
                // tears the dropdown down.
                onPointerDown={(event) => {
                  event.preventDefault();
                  select(result);
                }}
                onMouseEnter={() => setActiveIndex(index)}
                // DS Menu/Search row: 36 tall, 14/20 500; the keyboard
                // highlight (and hover) is yellow-soft — a pointer, not a value.
                className={`flex min-h-9 w-full items-center gap-2.5 rounded-control px-2.5 py-1.5 text-left font-sans text-callout font-medium text-foreground transition-colors ${
                  index === activeRow ? "bg-brand-soft" : "hover:bg-brand-soft"
                }`}
              >
                <FinderResultIcon result={result} />
                {/* Constrained text group (task #100): shrinks to the space left
                    after the icon; inside, the grid gives the LABEL priority (it
                    grows to its natural width but never past the group) and the
                    sublabel (description) takes the remainder and yields first —
                    a shrink-0 45% sublabel had squeezed "proj-frontend" and
                    "proj-frontend-perf" both down to "proj-fr…". */}
                <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-baseline gap-2">
                  <span className="min-w-0 truncate font-medium text-foreground">
                    {result.label}
                  </span>
                  {result.sublabel && (
                    <span className="min-w-0 truncate text-caption text-foreground-hint">
                      {result.sublabel}
                    </span>
                  )}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function FinderResultIcon({ result }: { result: FinderResult }) {
  if (result.kind === "channel") {
    // A channel is a place, not a "who": a bare # (private: lock), ink-3.
    return result.private ? (
      <Lock size={16} className="shrink-0 text-foreground-hint" />
    ) : (
      <Hash size={16} className="shrink-0 text-foreground-hint" />
    );
  }
  // DMs / agents / people reuse the app's avatar primitive at the same size
  // the sidebar rows use, so results read exactly like the lists they open.
  if (result.kind === "agent" || (result.kind === "dm" && result.peerIsAgent)) {
    return <AvatarSlot context="sidebar-list" type="agent" agentAvatarUrl={result.avatarUrl} />;
  }
  return (
    <AvatarSlot
      context="sidebar-list"
      type="human"
      humanAvatarUrl={result.avatarUrl}
      gravatarHash={result.gravatarHash}
      humanPlaceholder={!result.avatarUrl && !result.gravatarHash}
    />
  );
}
