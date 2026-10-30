import { CircleCheck, Info, OctagonAlert, TriangleAlert } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import {
  Banner,
  BannerAction,
  BannerDescription,
  BannerTitle,
} from "@botiverse/raft-ui";

/**
 * Thin product adapter over the public RUI Banner composition. RUI owns the
 * visual recipe and status semantics while callers provide product content.
 *
 * Raft Design System › Banner: one soft wash per intent (info cyan, warning
 * orange, destructive red, success lime), ink text and ink icon, a hairline
 * and no ink frame. A problem is orange; red is only for consequences that
 * cannot be taken back.
 */

export type BannerIntent = "destructive" | "warning" | "info" | "success";

const NON_LIVE = { role: undefined };
export type BannerDensity = "sm" | "md" | "lg";

// Default icon per intent — the DS banner glyphs (Lucide, 20px). NOT
// auto-rendered — the dominant inline pattern is iconless, so we render an
// icon only when the caller explicitly passes one. To get the conventional
// intent icon, callers can either pass `withIcon` (boolean) or any
// ReactNode via `icon`. The map exists so `withIcon` has a predictable lookup.
const INTENT_DEFAULT_ICON: Record<BannerIntent, ReactNode> = {
  destructive: <OctagonAlert size={20} aria-hidden="true" />,
  warning: <TriangleAlert size={20} aria-hidden="true" />,
  info: <Info size={20} aria-hidden="true" />,
  success: <CircleCheck size={20} aria-hidden="true" />,
};

export interface BannerProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Semantic status forwarded to the RUI recipe. */
  intent: BannerIntent;
  /** Density forwarded to the RUI size register. */
  density?: BannerDensity;
  /** Optional bold heading rendered above the body. */
  title?: ReactNode;
  /** Banner body. Most callsites pass a `<p>`-worthy string but any
   *  ReactNode (links, button rows) is fine. */
  children?: ReactNode;
  /** Convenience flag — render the conventional intent icon
   *  (OctagonAlert / TriangleAlert / Info / CircleCheck). When
   *  `false` (default), banner renders without an icon — matching
   *  the dominant inline pattern. */
  withIcon?: boolean;
  /** Override the icon entirely with a custom node. Takes
   *  precedence over `withIcon`. Useful for waiting indicators
   *  (pulsing dot) or task-specific icons. */
  icon?: ReactNode;
  /** Optional right-aligned action slot (e.g. a button or link). */
  actions?: ReactNode;
  /** RUI's Banner announces itself as a live `role="alert"`. Pass `false`
   *  for a notice that is part of the page (read before acting) rather than
   *  news, so assistive tech does not interrupt with it. */
  live?: boolean;
}

export default function AppBanner({
  intent,
  density = "md",
  title,
  children,
  icon,
  withIcon = false,
  actions,
  live = true,
  className = "",
  ...rest
}: BannerProps) {
  const resolvedIcon = icon !== undefined ? icon : (withIcon ? INTENT_DEFAULT_ICON[intent] : null);
  return (
    <Banner {...rest} {...(live ? null : NON_LIVE)} status={intent} size={density} className={className}>
      {resolvedIcon}
      {title ? <BannerTitle>{title}</BannerTitle> : null}
      {children ? <BannerDescription>{children}</BannerDescription> : null}
      {actions ? <BannerAction>{actions}</BannerAction> : null}
    </Banner>
  );
}
