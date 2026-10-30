import { GitBranch, Hash, Lock } from "lucide-react";
import { useIntl } from "react-intl";
import type { Channel } from "../../store/channelStore";

export const CHANNEL_KIND_ICON_SIZE = 14;

export function ChannelKindIcon({
  type,
  size = CHANNEL_KIND_ICON_SIZE,
  className,
  onPublicPage = false,
}: {
  type: Channel["type"];
  size?: number;
  className?: string;
  /** Anyone can read this channel on the server's public page (server public
   *  and channel visible to Guests): the # carries a small globe, the same
   *  mark as Public access in settings (cindyz, #wg-rbac:cbca4ee7). */
  onPublicPage?: boolean;
}) {
  if (type === "private") return <Lock size={size} className={className} />;
  if (type === "channel" && onPublicPage) return <PublicChannelGlyph size={size} className={className} />;
  if (type === "joint") return <GitBranch size={size} className={className} />;
  if (type === "channel") return <Hash size={size} className={className} />;
  return null;
}

/**
 * The glyph carries meaning, so screen readers get it as text and pointer
 * users as a native tooltip (cindyz: "顺手加一下"), like the server-name globe.
 */
function PublicChannelGlyph({ size, className }: { size: number; className?: string }) {
  const { formatMessage } = useIntl();
  const label = formatMessage({ id: "channel.publicPageReadable" });
  return (
    <span className="inline-flex shrink-0 items-center" title={label}>
      <HashGlobeIcon size={size} className={className} />
      {/* The comma keeps it a separate phrase before the channel name. */}
      <span className="sr-only">{`${label}, `}</span>
    </span>
  );
}

/**
 * One glyph, not two stacked icons (cindyz): lucide's # with its bottom-right
 * cell given over to a larger Globe (circle, meridian, equator); the hash
 * strokes stop short of it, so the two read as one mark at 14px. Every stroke
 * is 2 units, like lucide's own #: a thinner globe stroke rendered as grey
 * partial pixels with solid dots where lines cross (cindyz: crossings looked
 * darker).
 */
function HashGlobeIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
      data-on-public-page=""
    >
      <line x1="2.5" x2="15" y1="8" y2="8" />
      <line x1="2.5" x2="8" y1="14" y2="14" />
      <line x1="8.5" x2="7" y1="2.5" y2="17" />
      <line x1="13.5" x2="13" y1="2.5" y2="8" />
      <circle cx="16.5" cy="16.5" r="6.5" />
      <path d="M16.5 10a9 9 0 0 0 0 13 9 9 0 0 0 0-13" />
      <path d="M10 16.5h13" />
    </svg>
  );
}
