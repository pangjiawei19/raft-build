import type { ReactElement, ReactNode } from "react";
import { User } from "lucide-react";
import { Avatar, AvatarBadge, AvatarFallback } from "@botiverse/raft-ui";
import type { AvatarBadgeOffset, AvatarSize, Presence } from "@botiverse/raft-ui";
import { AgentAvatar } from "../agent/PixelAvatar";
import GravatarAvatar from "../member/GravatarAvatar";

/**
 * Product identity adapter. A context names where an identity sits and maps
 * it to one step of raft-ui's Avatar scale; raft-ui owns everything else (the
 * sticker frame, its box, the initials' type and icon size, the badge corner).
 * Image loading and pixel artwork stay in their leaf renderers, which fill the
 * frame.
 *
 * Raft Design System › Avatar: 19 · 27 · 35 · 51 · 99 (8n + two 1.5px edges);
 * xl 99 carries the hard brand-art shadow. `preview-mini` keeps raft-ui's 14
 * for the one-line preview cards where 19 does not fit.
 */
const CONTEXT_SIZE = {
  /** An agent's or a person's own profile, and the onboarding hero: xl 99. */
  "profile-hero": "xl",
  /** Your own row in Settings, an avatar being edited: lg 51. */
  "profile-tile": "lg",
  "account-tile": "lg",
  /** The profile hover card: lg 51. */
  "mention-card": "lg",
  "panel-header": "md",
  /** The message row's own avatar: raft-ui's `messageItem.avatarSlot` recipe
   *  sizes it (36, 24 on narrow viewports). */
  "message-row": "md",
  /** A row in a list — channel members, the people and agents on a profile
   *  or computer page, the workspace switcher: the DS ListRow avatar, 35. */
  "list-row": "md",
  /** A dense row — search results, forward targets, the compact member graph,
   *  Working now: 27. */
  "compact-row": "sm",
  "creator-link": "xs",
  "sidebar-list": "2xs",
  "compact-list": "xs",
  /** A face in the stack of agents at work (DS AgentActivity): 19. */
  "face-stack": "xs",
  "preview-mini": "3xs",
} as const satisfies Record<string, AvatarSize>;

export type AvatarContext = keyof typeof CONTEXT_SIZE;

/** What GravatarAvatar asks for at each step: the image size to request and
 *  the placeholder icon shown while it loads. */
const GRAVATAR_LEAF: Record<AvatarSize, { size: number; icon: number }> = {
  xl: { size: 96, icon: 48 },
  lg: { size: 52, icon: 24 },
  md: { size: 36, icon: 16 },
  sm: { size: 24, icon: 14 },
  xs: { size: 16, icon: 12 },
  "2xs": { size: 16, icon: 10 },
  "3xs": { size: 11, icon: 9 },
};

export interface AvatarSlotProps {
  context: AvatarContext;
  /** Entity kind — controls which inner renderer is used. */
  type: "agent" | "human" | "server" | "app";
  /** Agent's avatarUrl (`pixel:*` key or uploaded image URL). Used when
   *  `type="agent"`. */
  agentAvatarUrl?: string | null;
  /** Human's gravatar hash. Used when `type="human"`. */
  gravatarHash?: string | null;
  /** Human's uploaded avatar URL. Used before Gravatar when `type="human"`. */
  humanAvatarUrl?: string | null;
  /** Server's uploaded avatar URL. Used when `type="server"`. */
  serverAvatarUrl?: string | null;
  /** Server initial placeholder. Used when `type="server"` has no avatar. */
  serverInitial?: string | null;
  /** App logo URL. Used when `type="app"`. */
  appAvatarUrl?: string | null;
  /** App initials placeholder. Used when `type="app"` has no logo. */
  appInitials?: string | null;
  /** Optional email — GravatarAvatar derives a hash client-side when
   *  `gravatarHash` is missing. Used when `type="human"`. */
  email?: string | null;
  /** When `type="human"`, render a static User-icon placeholder instead of
   *  attempting a Gravatar lookup. Use when no gravatar identity is known. */
  humanPlaceholder?: boolean;
  /** Optional corner indicator. When present, the identity frame is rendered
   *  by raft-ui Avatar and the indicator is mounted through AvatarBadge so
   *  size and bottom-right placement stay canonical across call sites. */
  badge?: ReactElement;
  /** A fixed status light on the corner: raft-ui AvatarBadge's own dot
   *  (`presence`). For a light that subscribes to one agent's activity or
   *  carries a tooltip (AgentActivityDot), pass it as `badge` instead.
   *  Ignored when `badge` is set. */
  presence?: Presence;
  /** Where the badge's centre sits, from the avatar's top-left (raft-ui
   *  AvatarBadge `offset`). Omit for the theme's default bottom-right spot. */
  badgeOffset?: AvatarBadgeOffset;
  /** Trusted preview content can supply an uncommitted upload without replacing the themed frame. */
  children?: ReactNode;
  /** Additional classes — appended to the outer container. Useful for
   *  callsite-specific tweaks (e.g. `grayscale opacity-60` for deactivated
   *  agents). Do not use this to add a background color or a size: the
   *  context owns the size. */
  className?: string;
}

export function AvatarImageWithFallback({
  src,
  fallback,
  alt = "",
  className = "h-full w-full object-cover",
}: {
  src?: string | null;
  fallback: ReactNode;
  alt?: string;
  className?: string;
}) {
  return (
    <>
      {/* Positioned fallbacks paint above ordinary in-flow children. Give both
          layers an explicit stack order so a valid avatar always covers its
          placeholder; hiding the broken image reveals the fallback again. */}
      <span className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
        {fallback}
      </span>
      {src ? (
        <img
          key={src}
          src={src}
          alt={alt}
          className={`relative z-[1] ${className}`}
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
      ) : null}
    </>
  );
}

export default function AvatarSlot({
  context,
  type,
  agentAvatarUrl,
  gravatarHash,
  humanAvatarUrl,
  serverAvatarUrl,
  serverInitial,
  appAvatarUrl,
  appInitials,
  email,
  humanPlaceholder,
  badge,
  presence,
  badgeOffset,
  children,
  className = "",
}: AvatarSlotProps) {
  const size = CONTEXT_SIZE[context];
  let content: ReactNode;
  if (children !== undefined) {
    content = children;
  } else if (type === "agent") {
    content = <AgentAvatar avatarUrl={agentAvatarUrl ?? null} />;
  } else if (type === "server" || type === "app") {
    const initials = type === "server" ? serverInitial || "S" : appInitials || "A";
    const fallback = initials.trim().slice(0, type === "server" ? 1 : 2).toUpperCase() || (type === "server" ? "S" : "A");
    content = <AvatarImageWithFallback src={type === "server" ? serverAvatarUrl : appAvatarUrl} fallback={fallback} />;
  } else if (humanPlaceholder) {
    content = <User />;
  } else {
    const leaf = GRAVATAR_LEAF[size];
    content = (
      <GravatarAvatar
        avatarUrl={humanAvatarUrl ?? null}
        gravatarHash={gravatarHash ?? null}
        email={email ?? undefined}
        size={leaf.size}
        iconSize={leaf.icon}
      />
    );
  }

  // A workspace tile is the ink square with yellow initials ("your
  // workspace", the same tile as the rail and the phone's Home pill); an app
  // without a logo keeps the default identity sticker.
  const workspaceTile = type === "server";
  return (
    <Avatar
      size={size}
      type={type === "agent" ? "agent" : "human"}
      className={`${workspaceTile ? "bg-sticker-ink" : ""} ${className}`.trim()}
      data-avatar-context={context}
      data-avatar-type={type}
    >
      {/* The workspace tile paints its ink + yellow on the fallback layer too,
          so the raft recipe's ink initials do not win inside it. Loaded
          images still cover this background. */}
      <AvatarFallback className={`relative overflow-hidden ${workspaceTile ? "bg-sticker-ink text-brand" : ""}`.trim()}>
        {content}
      </AvatarFallback>
      {badge ? (
        <AvatarBadge render={<span />} offset={badgeOffset} className="flex rounded-[2px] [&>span]:h-full [&>span]:w-full">
          {badge}
        </AvatarBadge>
      ) : presence ? (
        <AvatarBadge presence={presence} offset={badgeOffset} />
      ) : null}
    </Avatar>
  );
}
