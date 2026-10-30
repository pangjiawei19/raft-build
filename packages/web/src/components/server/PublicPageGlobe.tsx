import { useIntl } from "react-intl";
import { Globe } from "lucide-react";

/**
 * A small globe after the server's name when its public page is live (cindyz,
 * #wg-rbac:cbca4ee7: visible at a glance, not loud; not as a badge on the
 * avatar). Same Globe as the Public access settings. Screen readers get the
 * meaning as text; pointer users get it as a native tooltip.
 */
export function PublicPageGlobe({ live, size = 13 }: { live: boolean; size?: number }) {
  const { formatMessage } = useIntl();
  if (!live) return null;
  const label = formatMessage({ id: "layout.server.publicPageLive" });
  return (
    <span className="inline-flex shrink-0 items-center text-foreground-muted" title={label} data-testid="public-page-globe">
      <Globe size={size} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}
