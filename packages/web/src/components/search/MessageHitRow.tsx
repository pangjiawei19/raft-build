import { useCallback } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useIntl } from "react-intl";
import {
  Badge,
  SearchMessageResult,
  SearchMessageResultBody,
  SearchMessageResultHeader,
  SearchMessageResultMeta,
  SearchMessageResultSender,
  SearchMessageResultThreadMeta,
  SearchMessageResultTimestamp,
  SearchThreadMessageResult,
  ThreadIcon,
} from "@botiverse/raft-ui";
import { formatRelativeTimeParts } from "../../utils/relativeTime";
import AvatarSlot from "../ui/AvatarSlot";
import { getSearchRelativeTimeParts } from "./searchGrouping";
import { SearchHighlight } from "./MessageSearchPage";
import type { MessageSearchResult, SearchSenderMember } from "./MessageSearchPage";

/** One message hit, top-level or nested inside a thread group. */
export function MessageHitRow({
  result,
  nested,
  selected,
  sourceLabel,
  agentAvatarUrl,
  senderMember,
  historyCutoffMs,
  query,
  onResultClick,
}: {
  result: MessageSearchResult;
  nested: boolean;
  selected: boolean;
  sourceLabel: string;
  agentAvatarUrl: string | null;
  senderMember: SearchSenderMember | null;
  historyCutoffMs: number | null;
  query: string;
  onResultClick: (event: ReactMouseEvent<HTMLButtonElement>, result: MessageSearchResult) => void;
}) {
  const intl = useIntl();
  const { formatMessage } = intl;
  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => onResultClick(event, result),
    [onResultClick, result],
  );

  const Result = nested ? SearchThreadMessageResult : SearchMessageResult;

  // DS search hit (`.rf-hit`): a 27px identity in its own column, then who /
  // where / time on one line and a two-line excerpt under it. The DOM keeps
  // the original reading order (where, then who, then when — so the button's
  // accessible name is unchanged): rui's raft recipe moves the sender to the
  // front visually, and the avatar is lifted into the left column by
  // positioning it against the row (16px edge, 12px top), with the text
  // column starting at 16 + 27 + 12 = 55px where the hairline starts too.
  return (
    <Result
      type="button"
      onClick={handleClick}
      selected={selected}
      className="pl-[55px] not-first:before:left-[55px]"
    >
    <SearchMessageResultHeader>
      <SearchMessageResultMeta>{sourceLabel}</SearchMessageResultMeta>
      {result.channelType === "thread" && (
        <SearchMessageResultThreadMeta>
          <ThreadIcon width={12} height={12} />
          {formatMessage({ id: "search.threadInline" })}
        </SearchMessageResultThreadMeta>
      )}
      {(result.channelType === "thread"
        ? result.parentChannelArchivedAt
        : result.channelArchivedAt) && (
        <Badge appearance="soft" variant="warning">
          {formatMessage({ id: "search.archived" })}
        </Badge>
      )}
      {historyCutoffMs !== null && new Date(result.createdAt).getTime() < historyCutoffMs && (
        <Badge appearance="soft" variant="warning" data-testid="search-hit-beyond-history">
          {formatMessage({ id: "search.beyondHistory" })}
        </Badge>
      )}
      <SearchMessageResultSender>
        <span className="absolute top-3 left-4 flex">
          {result.senderType === "agent" ? (
            <AvatarSlot context="compact-row" type="agent" agentAvatarUrl={agentAvatarUrl} />
          ) : result.senderType === "external_projection" ? (
            <AvatarSlot context="compact-row" type="app" appAvatarUrl={result.senderAvatarUrl} appInitials={result.senderName} />
          ) : (
            <AvatarSlot context="compact-row" type="human" humanAvatarUrl={senderMember?.avatarUrl} gravatarHash={senderMember?.gravatarHash} />
          )}
        </span>
        <span>{result.senderName}</span>
      </SearchMessageResultSender>
      <SearchMessageResultTimestamp>{(() => {
        const parts = getSearchRelativeTimeParts(result.createdAt);
        return parts ? formatRelativeTimeParts(parts.value, parts.unit, intl.locale) : formatMessage({ id: "search.grpUnknownTime" });
      })()}</SearchMessageResultTimestamp>
    </SearchMessageResultHeader>
    <SearchMessageResultBody>
      <SearchHighlight text={result.snippet} query={query} />
    </SearchMessageResultBody>
    </Result>
  );
}
