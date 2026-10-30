import { useCallback } from "react";
import { GitBranch, Hash, Lock, LogIn, UserPlus } from "lucide-react";
import { useIntl } from "react-intl";
import { Checkbox, Button, Spinner, IconTile } from "@botiverse/raft-ui";
import type { Channel } from "../../store/channelStore";
import AvatarSlot from "../ui/AvatarSlot";
import {
  MAX_FORWARD_DESTINATIONS,
  localSelectionKey,
  searchSelectionKey,
  targetIcon,
  targetLabel,
  targetPickerLabel,
} from "./forwardComposerModel";
import type { ForwardSearchTarget, SelectedDestination } from "./forwardComposerModel";

// DS ListRow in a picker: no frame, the row presses like any list row; the
// chosen value is the check (and a bolder name), never a colour wash.
const FORWARD_TARGET_ROW_CLASS = "flex min-h-11 w-full min-w-0 items-center gap-3 rounded-control px-2 py-1.5 text-left text-subhead text-foreground outline-none transition-colors focus-visible:shadow-focus";
// A channel is a place, not a face: the neutral DS channel tile (raft-ui
// IconTile at the 27px step, the compact-row avatars' size beside it).
const FORWARD_TARGET_HINT_CLASS = "flex shrink-0 items-center gap-1 text-caption text-foreground-hint";

type Props = {
  currentServerId: string;
  isSearchMode: boolean;
  lowerQuery: string;
  searchResults: ForwardSearchTarget[];
  searchLoading: boolean;
  searchFailed: boolean;
  filteredTargets: Channel[];
  channelTargets: Channel[];
  dmTargets: Channel[];
  channelLocalMembership: Record<string, boolean | undefined>;
  selectedDestinations: Map<string, SelectedDestination>;
  joinInFlight: boolean;
  isMobile: boolean;
  mobileMultiSelect: boolean;
  chooseDestination: (entry: SelectedDestination, disabled: boolean) => void;
  retrySearch: (query: string) => void;
};

export default function ForwardComposerTargetList({
  currentServerId,
  isSearchMode,
  lowerQuery,
  searchResults,
  searchLoading,
  searchFailed,
  filteredTargets,
  channelTargets,
  dmTargets,
  channelLocalMembership,
  selectedDestinations,
  joinInFlight,
  isMobile,
  mobileMultiSelect,
  chooseDestination,
  retrySearch,
}: Props) {
  const { formatMessage } = useIntl();
  const showCheckbox = !isMobile || mobileMultiSelect;
  const handleRetrySearch = useCallback(() => retrySearch(lowerQuery), [retrySearch, lowerQuery]);

  const renderSearchTarget = (target: ForwardSearchTarget) => {
    const key = searchSelectionKey(currentServerId, target);
    const selected = selectedDestinations.has(key);
    const selectedResolvedChannelId = selectedDestinations.get(key)?.resolvedChannelId;
    const joinedChannelId = target.requiredAction === "join_channel"
      ? channelTargets.find((channel) => channel.id === target.channelId)?.id
        ?? (target.channelId && channelLocalMembership[target.channelId] === true ? target.channelId : undefined)
      : undefined;
    const existingDmId = target.requiredAction === "create_dm"
      ? dmTargets.find((channel) => channel.peerId === target.id)?.id
      : undefined;
    const resolvedChannelId = selectedResolvedChannelId ?? joinedChannelId ?? existingDmId;
    const unavailable = !target.canForwardNow && target.requiredAction === null;
    const disabled = joinInFlight || unavailable || (!selected && selectedDestinations.size >= MAX_FORWARD_DESTINATIONS);
    const toggle = () => chooseDestination({ key, label: target.title, searchTarget: target, resolvedChannelId }, disabled);
    return (
      <div
        key={key}
        role={showCheckbox ? "checkbox" : "button"}
        tabIndex={disabled ? -1 : 0}
        aria-checked={showCheckbox ? selected : undefined}
        aria-disabled={disabled}
        aria-label={formatMessage({ id: showCheckbox ? "message.forwardComposer.selectTargetAria" : "message.forwardComposer.forwardToAria" }, { target: target.title })}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key !== " " && event.key !== "Enter") return;
          event.preventDefault();
          toggle();
        }}
        className={`${FORWARD_TARGET_ROW_CLASS} ${
          unavailable ? "cursor-not-allowed text-foreground-disabled" : `hover:bg-fill-pressed ${selected ? "font-bold" : "font-medium"}`
        }`}
        data-testid={`forward-search-target-${target.type}-${target.id}`}
      >
        {showCheckbox && <Checkbox checked={selected} disabled={disabled} tabIndex={-1} aria-hidden className="pointer-events-none" />}
        {target.type === "channel" ? (
          <IconTile size="sm">
            {target.channelType === "joint" ? <GitBranch /> : target.channelType === "private" ? <Lock /> : <Hash />}
          </IconTile>
        ) : (
          <span className="shrink-0">
            {target.type === "dm" && (
              <AvatarSlot
                context="compact-row"
                type={target.subtitle === "agent" ? "agent" : "human"}
                agentAvatarUrl={target.subtitle === "agent" ? target.avatarUrl : null}
                humanAvatarUrl={target.subtitle !== "agent" ? target.avatarUrl : null}
                humanPlaceholder={target.subtitle !== "agent" && !target.avatarUrl}
              />
            )}
            {target.type === "agent" && <AvatarSlot context="compact-row" type="agent" agentAvatarUrl={target.avatarUrl} />}
            {target.type === "human" && <AvatarSlot context="compact-row" type="human" humanAvatarUrl={target.avatarUrl} humanPlaceholder={!target.avatarUrl} />}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{target.title}</span>
        {target.requiredAction === "join_channel" && !resolvedChannelId && (
          <span className={FORWARD_TARGET_HINT_CLASS}>
            <LogIn size={12} />
            {formatMessage({ id: "message.forwardComposer.notJoined" })}
          </span>
        )}
        {target.requiredAction === "create_dm" && !resolvedChannelId && (
          <span className={FORWARD_TARGET_HINT_CLASS}>
            <UserPlus size={12} />
            {formatMessage({ id: "message.forwardComposer.newDm" })}
          </span>
        )}
      </div>
    );
  };

  const renderTarget = (target: Channel) => {
    const key = localSelectionKey(currentServerId, target.id);
    const selected = selectedDestinations.has(key);
    const disabled = joinInFlight || (!selected && selectedDestinations.size >= MAX_FORWARD_DESTINATIONS);
    const toggle = () => chooseDestination({ key, label: targetLabel(target), localTarget: target }, disabled);
    return (
      <div
        key={key}
        role={showCheckbox ? "checkbox" : "button"}
        tabIndex={disabled ? -1 : 0}
        aria-checked={showCheckbox ? selected : undefined}
        aria-disabled={disabled}
        aria-label={formatMessage({ id: showCheckbox ? "message.forwardComposer.selectTargetAria" : "message.forwardComposer.forwardToAria" }, { target: targetLabel(target) })}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key !== " " && event.key !== "Enter") return;
          event.preventDefault();
          toggle();
        }}
        className={`${FORWARD_TARGET_ROW_CLASS} hover:bg-fill-pressed ${selected ? "font-bold" : "font-medium"}`}
        data-testid={`forward-target-${target.id}`}
      >
        {showCheckbox && <Checkbox checked={selected} disabled={disabled} tabIndex={-1} aria-hidden className="pointer-events-none" />}
        {target.type === "dm" ? (
          <span className="shrink-0">{targetIcon(target)}</span>
        ) : (
          <IconTile size="sm">{targetIcon(target)}</IconTile>
        )}
        <span className="min-w-0 flex-1 truncate">{targetPickerLabel(target)}</span>
      </div>
    );
  };

  if (!isSearchMode) return <>{filteredTargets.map(renderTarget)}</>;
  if (searchLoading) return <div className="flex items-center justify-center py-4"><Spinner size="sm"  aria-label={formatMessage({ id: "common.loadingLabel" })} /></div>;
  if (searchFailed) {
    return (
      <div className="flex flex-col items-center gap-2 py-4 text-center">
        <p className="text-callout text-foreground-muted">{formatMessage({ id: "message.forwardComposer.searchFailed" })}</p>
        <Button type="button" size="sm" variant="outline" onClick={handleRetrySearch}>{formatMessage({ id: "message.forwardComposer.tryAgain" })}</Button>
      </div>
    );
  }
  if (searchResults.length === 0) {
    return <p className="py-4 text-center text-callout text-foreground-hint">{formatMessage({ id: "message.forwardComposer.noMatchingDestinations" })}</p>;
  }
  return <>{searchResults.map(renderSearchTarget)}</>;
}
