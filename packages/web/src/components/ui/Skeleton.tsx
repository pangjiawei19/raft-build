import type { HTMLAttributes } from "react";
import { Card, Skeleton } from "@botiverse/raft-ui";

/**
 * Loading-placeholder compositions built from raft-ui's Skeleton.
 *
 * Raft Design System › Loading (`rf-skel`): a passive indicator — the sunken
 * fill with the sticker radius, never pink. The shape is the content that is
 * coming: text is a `line`, an avatar is a square `block` (every identity in
 * the DS is a square sticker). Size comes from `className`; skeletons are
 * aria-hidden, so announce loading at the region level (e.g. `aria-busy` on
 * the list container).
 *
 * Layout-shift rule: a skeleton MUST occupy the same box the real content
 * will. Build row-skeletons to the SAME height/padding as the real row (see
 * SkeletonRow + each panel's row classes), so loaded content swaps in without
 * the page jumping.
 */

export interface SkeletonRowProps extends HTMLAttributes<HTMLDivElement> {
  /** Render an avatar/icon stand-in on the left (sized via avatarClassName). */
  avatar?: boolean;
  /** Sizing for the avatar stand-in — MUST match the real row's avatar box. */
  avatarClassName?: string;
  /** Width classes for each text line, top to bottom. Defaults to a 2-line row. */
  lineWidths?: string[];
}

/**
 * SkeletonRow — a composable list-row skeleton (avatar + stacked lines).
 *
 * Pass the SAME outer height/padding classes the real row uses (via `className`)
 * and the SAME avatar box (via `avatarClassName`) so the placeholder is the
 * exact height of the loaded row. Example — sidebar channel/DM row (~44px):
 *
 *   <SkeletonRow
 *     className="gap-1.5 px-2 py-2"
 *     avatar avatarClassName="size-[18px]"
 *     lineWidths={["w-24"]}
 *   />
 */
export function SkeletonRow({
  avatar = false,
  avatarClassName = "size-[18px]",
  lineWidths = ["w-3/4", "w-1/2"],
  className = "",
  ...props
}: SkeletonRowProps) {
  return (
    <div className={["flex items-center", className].filter(Boolean).join(" ")} {...props}>
      {avatar && <Skeleton variant="block" className={`shrink-0 ${avatarClassName}`} />}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {lineWidths.map((w, i) => (
          <Skeleton key={i} variant="line" className={w} />
        ))}
      </div>
    </div>
  );
}

/**
 * ConversationCardSkeleton — the loading placeholder for ConversationPreviewCard
 * list rows (Inbox + Saved panels, ~96px cards). Mirrors the real card box
 * (header line + multi-line preview) so
 * the list does not jump when items load. Shared so inbox/saved stay identical.
 */
export function ConversationCardSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} className="w-full flex-row items-start gap-3 p-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-2.5">
              <Skeleton variant="line" className="w-20" />
              <Skeleton variant="line" className="w-16" />
              <Skeleton variant="line" className="w-10" />
            </div>
            <Skeleton variant="line" className="w-full" />
            <Skeleton variant="line" className="w-3/5" />
          </div>
        </Card>
      ))}
    </div>
  );
}
