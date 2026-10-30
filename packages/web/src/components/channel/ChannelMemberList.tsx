import { useCallback } from "react";
import type { MouseEvent, ReactNode } from "react";
import { useIntl } from "react-intl";
import { Badge, Button, Card } from "@botiverse/raft-ui";
import type { AgentActivity, ServerRole } from "@botiverse/raft-shared";
import { UserMinus, X } from "lucide-react";
import AvatarSlot from "../ui/AvatarSlot";
import SectionEyebrow from "../ui/SectionEyebrow";
import Tooltip from "../ui/Tooltip";
import AgentActivityDot from "../agent/AgentActivityDot";

// DS ListRow for a member: 35px identity, the name 15/20 600, the role or
// handle 12/16 ink-3; rows press like content rows and are separated by a
// hairline that starts where the text starts (16 + 35 + 12 = 63px).
const MEMBER_ROW_CLASS = [
  "group relative flex min-h-16 items-center gap-3 px-4 py-2.5 transition-colors md:min-h-14",
  "hover:bg-fill-pressed [@media(max-height:600px)]:min-h-0 [@media(max-height:600px)]:py-1.5",
  "[[data-member-row]+&]:before:pointer-events-none [[data-member-row]+&]:before:absolute [[data-member-row]+&]:before:top-0 [[data-member-row]+&]:before:right-0 [[data-member-row]+&]:before:left-[63px] [[data-member-row]+&]:before:border-t [[data-member-row]+&]:before:border-line-hairline",
  "[li+li>&]:before:pointer-events-none [li+li>&]:before:absolute [li+li>&]:before:top-0 [li+li>&]:before:right-0 [li+li>&]:before:left-[63px] [li+li>&]:before:border-t [li+li>&]:before:border-line-hairline",
].join(" ");
const MEMBER_ROW_TITLE_CLASS = "truncate text-subhead font-semibold text-foreground";
const MEMBER_ROW_SUB_CLASS = "truncate text-caption text-foreground-hint";

export function ChannelMemberListShell({
  children,
  className = "",
  framed = true,
  "data-testid": dataTestId,
}: {
  children: ReactNode;
  className?: string;
  /** Framed = bordered box with its own scroll (dialogs). Unframed = flat
      sections that scroll with the surrounding sheet (drawer panel). */
  framed?: boolean;
  "data-testid"?: string;
}) {
  return framed ? (
    <Card className={`max-h-72 overflow-y-auto ${className}`} data-testid={dataTestId}>
      {children}
    </Card>
  ) : (
    <div className={className} data-testid={dataTestId}>
      {children}
    </div>
  );
}

/** DS list section title (`rf-section`): 13/18 700 ink-3 above its rows,
 *  no band behind it. */
export function ChannelMemberSectionHeader({ children }: { children: ReactNode }) {
  return (
    <SectionEyebrow as="div" className="px-4 pt-4 pb-1.5">
      {children}
    </SectionEyebrow>
  );
}

function ChannelMemberActivityBadge({
  agentId,
  fallbackActivity,
}: {
  agentId: string;
  fallbackActivity?: AgentActivity;
}) {
  return (
    <AgentActivityDot
      agentId={agentId}
      fallbackActivity={fallbackActivity}
      size="md"
      data-channel-member-avatar-badge-shell="true"
    />
  );
}

/** Channel membership only needs one visible distinction: whether the actor
 *  effectively administers this channel. Server owner/admin inheritance and
 *  an explicit channel grant intentionally share the same user-facing label. */
export function MemberRoleTag({ role }: { role: ServerRole }) {
  const { formatMessage } = useIntl();
  if (role === "member") return null;
  const isGuest = role === "guest";
  // Admin is a neutral label (DS `rf-tag`); a guest comes from outside the
  // workspace, so it reads as the cyan-soft external chip.
  return (
    <Badge
      data-testid={isGuest ? "member-page-role-channel-guest" : "member-page-role-channel-admin"}
      appearance={isGuest ? "soft" : "outline"}
      variant={isGuest ? "information" : undefined}
      className="shrink-0"
    >
      {formatMessage({ id: isGuest
        ? "channel.membersPage.role.channelGuest"
        : "channel.membersPage.role.channelAdmin" })}
    </Badge>
  );
}

export function ChannelMemberRoleAndActions({
  role,
  actions,
}: {
  role: ServerRole;
  actions: ReactNode;
}) {
  return (
    <span
      className="flex shrink-0 self-center items-center gap-2 md:grid"
      data-testid="member-page-trailing"
    >
      <span
        className={`flex shrink-0 items-center md:col-start-1 md:row-start-1 md:justify-self-end ${actions ? "md:group-hover:invisible md:group-focus-within:invisible" : ""}`}
      >
        <MemberRoleTag role={role} />
      </span>
      {actions ? (
        <span className="shrink-0 self-center md:invisible md:col-start-1 md:row-start-1 md:justify-self-end md:group-hover:visible md:group-focus-within:visible">
          {actions}
        </span>
      ) : null}
    </span>
  );
}

export function ChannelMemberRow({
  type,
  name,
  secondary,
  agentId,
  agentAvatarUrl,
  agentFallbackActivity,
  humanAvatarUrl,
  gravatarHash,
  onAvatarClick,
  onRowClick,
  trailing,
}: {
  type: "agent" | "human";
  name: ReactNode;
  secondary?: ReactNode;
  agentId?: string;
  agentAvatarUrl?: string | null;
  agentFallbackActivity?: AgentActivity;
  humanAvatarUrl?: string | null;
  gravatarHash?: string | null;
  onAvatarClick?: () => void;
  /** Whole-row click (member page: row → profile). Mutually exclusive
   *  with onAvatarClick — a button cannot nest inside a button, so the
   *  avatar renders inert when the row itself is the click target. */
  onRowClick?: () => void;
  trailing?: ReactNode;
}) {
  const avatar = (
    <AvatarSlot
      context="list-row"
      type={type}
      agentAvatarUrl={agentAvatarUrl}
      humanAvatarUrl={humanAvatarUrl}
      gravatarHash={gravatarHash}
      badge={type === "agent" && agentId ? (
        <ChannelMemberActivityBadge agentId={agentId} fallbackActivity={agentFallbackActivity} />
      ) : undefined}
    />
  );

  const text = (
    <div className="min-w-0 flex-1">
      <div className={MEMBER_ROW_TITLE_CLASS}>
        {name}
      </div>
      {secondary ? (
        <div className={MEMBER_ROW_SUB_CLASS}>
          {secondary}
        </div>
      ) : null}
    </div>
  );

  const body = (
    <>
      {text}
      {trailing}
    </>
  );

  if (onRowClick) {
    // The row body (avatar + name + sub-line) IS the profile button; the
    // trailing slot (role tag, remove button) renders as a sibling so
    // interactive controls never nest inside a button.
    return (
      <div className={MEMBER_ROW_CLASS} data-member-row="">
        <button
          type="button"
          onClick={onRowClick}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-control text-left outline-none focus-visible:shadow-focus"
        >
          <span className="relative shrink-0">{avatar}</span>
          {text}
        </button>
        {trailing}
      </div>
    );
  }

  return (
    <div className={MEMBER_ROW_CLASS} data-member-row="">
      {onAvatarClick ? (
        <button
          type="button"
          onClick={onAvatarClick}
          className="relative shrink-0 rounded-sticker outline-none focus-visible:shadow-focus"
        >
          {avatar}
        </button>
      ) : (
        <span className="relative shrink-0">{avatar}</span>
      )}
      {body}
    </div>
  );
}

export function ChannelMemberRemoveButton({
  label,
  onClick,
  revealOnRowHover = true,
  visibleLabel,
  icon,
}: {
  label: string;
  onClick: () => void;
  /** Desktop hover-reveal. Uses visibility (not display) so the button's
   *  space is always reserved — the trailing badge never shifts when the
   *  control appears (Artea 2026-08-05: reveal jitter). Mobile always
   *  shows it (no hover). */
  revealOnRowHover?: boolean;
  /** Member-management rows render icon-only with a suitable icon (Artea,
   *  2026-09-17); other compact lists keep the bare icon affordance. */
  visibleLabel?: string;
  icon?: ReactNode;
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={onClick}
        className={`${revealOnRowHover ? "flex md:invisible md:group-hover:visible md:group-focus-within:visible" : "flex"} ${visibleLabel ? "h-8 px-2.5 text-footnote font-bold" : "size-8"} shrink-0 items-center justify-center rounded-control text-foreground-muted outline-none transition-colors hover:bg-fill-pressed hover:text-foreground active:bg-fill-pressed focus-visible:shadow-focus`}
        aria-label={label}
      >
        {visibleLabel ?? icon ?? <X size={16} aria-hidden="true" />}
      </button>
    </Tooltip>
  );
}

export function ChannelMemberHoverActions({
  roleAction,
  removeAction,
}: {
  roleAction?: {
    label: string;
    ariaLabel?: string;
    onClick: () => void;
    disabled?: boolean;
  };
  removeAction?: {
    label: string;
    onClick: () => void;
  };
}) {
  const onRoleAction = roleAction?.onClick;
  const handleRoleActionClick = useCallback((event: MouseEvent) => {
    event.stopPropagation();
    onRoleAction?.();
  }, [onRoleAction]);

  if (!roleAction && !removeAction) return null;

  return (
    <span className="flex items-center gap-2" data-testid="channel-member-hover-actions">
      {roleAction && (
        <Button
          type="button"
          onClick={handleRoleActionClick}
          disabled={roleAction.disabled}
          size="sm"
          variant="outline"
          className="whitespace-nowrap"
          data-testid="channel-member-role-action"
          aria-label={roleAction.ariaLabel}
        >
          {roleAction.label}
        </Button>
      )}
      {removeAction && (
        <ChannelMemberRemoveButton
          label={removeAction.label}
          onClick={removeAction.onClick}
          revealOnRowHover={false}
          icon={<UserMinus size={16} aria-hidden />}
        />
      )}
    </span>
  );
}
