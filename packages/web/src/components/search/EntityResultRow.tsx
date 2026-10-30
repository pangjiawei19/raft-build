import { useCallback } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useIntl } from "react-intl";
import { Monitor } from "lucide-react";
import {
  Badge,
  Kbd,
  SearchEntityResult,
  SearchEntityResultContent,
  SearchEntityResultDescription,
  SearchEntityResultHeader,
  SearchEntityResultIcon,
  SearchEntityResultLeading,
  SearchEntityResultTitle,
} from "@botiverse/raft-ui";
import AgentActivityDot from "../agent/AgentActivityDot";
import AvatarSlot from "../ui/AvatarSlot";
import { ARCHIVED_CHANNEL_ICON_CLASS } from "../channel/channelArchiveVisual";
import { ChannelKindIcon } from "../channel/channelKindIcon";
import type { SearchEntityResult as SearchEntityRecord } from "./searchEntities";
import { formatEntitySubtitle, RETURN_KEY_GLYPH } from "./MessageSearchPage";
import type { SearchSenderMember } from "./MessageSearchPage";

/**
 * Destination (entity) row — shared by the overlay's exact-match head row and
 * the destinations section (task #102), so both render identically.
 */
export function EntityResultRow({
  result,
  returnHint,
  selected,
  agentAvatarUrl,
  humanMember,
  onResultContextMenu,
  onResultClick,
}: {
  result: SearchEntityRecord;
  returnHint: boolean;
  selected: boolean;
  agentAvatarUrl: string | null;
  humanMember: SearchSenderMember | undefined;
  onResultContextMenu: (event: ReactMouseEvent, result: SearchEntityRecord) => void;
  onResultClick: (event: ReactMouseEvent<HTMLButtonElement>, result: SearchEntityRecord) => void;
}) {
  const { formatMessage } = useIntl();
  const handleContextMenu = useCallback(
    (event: ReactMouseEvent) => onResultContextMenu(event, result),
    [onResultContextMenu, result],
  );
  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => onResultClick(event, result),
    [onResultClick, result],
  );
  const channelPinnedRef = result.type === "channel" && result.channelId
    ? { kind: "channel", id: result.channelId } as const
    : null;
  const isArchivedChannelResult = result.type === "channel" && !!result.archivedAt;

  // The row frame, hover and selected states belong to rui's
  // SearchEntityResult. The wrapper carries the row's test id, keyboard-active
  // marker and context menu; because every row sits in its own wrapper, the
  // DS ListRow hairline (drawn between sibling rows, from the text start)
  // is drawn here instead of on the button.
  return (
    <div
      data-testid={channelPinnedRef ? `search-channel-result-${channelPinnedRef.id}` : undefined}
      data-active={selected ? "true" : undefined}
      onContextMenu={channelPinnedRef && !result.archivedAt ? handleContextMenu : undefined}
      className="relative flex w-full not-first:before:pointer-events-none not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-[55px] not-first:before:z-[1] not-first:before:border-t not-first:before:border-line-hairline"
    >
      <SearchEntityResult
        type="button"
        onClick={handleClick}
        selected={selected}
      >
        <SearchEntityResultLeading>
          {result.type === "channel" ? (
            <SearchEntityResultIcon
              className={isArchivedChannelResult ? ARCHIVED_CHANNEL_ICON_CLASS : undefined}
            >
              <ChannelKindIcon type={result.channelType ?? "channel"} />
            </SearchEntityResultIcon>
          ) : result.type === "computer" ? (
            <SearchEntityResultIcon>
              <Monitor size={14} aria-hidden="true" />
            </SearchEntityResultIcon>
          ) : result.type === "agentDm" ? (
            result.agentId ? (
              <AvatarSlot
                context="compact-row"
                type="agent"
                agentAvatarUrl={agentAvatarUrl}
                badge={<AgentActivityDot agentId={result.agentId} />}
              />
            ) : (
              <AvatarSlot context="compact-row" type="agent" agentAvatarUrl={null} />
            )
          ) : result.userId ? (
            <AvatarSlot
              context="compact-row"
              type="human"
              humanAvatarUrl={humanMember?.avatarUrl}
              gravatarHash={humanMember?.gravatarHash}
            />
          ) : (
            <AvatarSlot context="compact-row" type="human" humanPlaceholder />
          )}
        </SearchEntityResultLeading>
        <SearchEntityResultContent>
          <SearchEntityResultHeader>
            <SearchEntityResultTitle className="truncate" muted={isArchivedChannelResult}>
              {result.title}
            </SearchEntityResultTitle>
            {/* The kind is a machine label after the name (DS `rf-tag`), not a
                coloured chip: identity comes from the tile/avatar. */}
            <Badge appearance="outline">
              {result.type === "channel" ? formatMessage({ id: "search.channel" }) : result.type === "computer" ? formatMessage({ id: "search.badgeComputer" }) : result.type === "agentDm" ? formatMessage({ id: "search.badgeAgent" }) : formatMessage({ id: "search.badgeHuman" })}
            </Badge>
            {result.archivedAt && (
              <Badge
                appearance={isArchivedChannelResult ? "outline" : "soft"}
                variant={isArchivedChannelResult ? undefined : "warning"}
              >
                {formatMessage({ id: "search.archived" })}
              </Badge>
            )}
          </SearchEntityResultHeader>
          <SearchEntityResultDescription muted={isArchivedChannelResult}>
            {formatEntitySubtitle(result.subtitle, formatMessage)}
          </SearchEntityResultDescription>
        </SearchEntityResultContent>
        {returnHint && selected ? <Kbd aria-hidden="true">{RETURN_KEY_GLYPH}</Kbd> : null}
      </SearchEntityResult>
    </div>
  );
}
