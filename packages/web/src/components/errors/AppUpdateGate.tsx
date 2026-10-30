import type { CSSProperties } from "react";
import { useIntl } from "react-intl";
import RootFallbackScroller from "./RootFallbackScroller";
import { FALLBACK_STYLE } from "./RootErrorFallback";

/** A stale build can mean the stylesheet itself is gone, so these screens use
 *  the same token-with-literal-fallback styling as the crash screen. */
export function AppRefreshRequiredScreen({
  onContinueAnyway,
  onRecoverAndRefresh,
}: {
  onContinueAnyway: () => void;
  onRecoverAndRefresh: () => void;
}) {
  const { formatMessage } = useIntl();

  return (
    <RootFallbackScroller className="safe-top safe-bottom" style={FALLBACK_STYLE.page}>
      <div
        role="alert"
        aria-live="assertive"
        style={{ ...FALLBACK_STYLE.card, maxWidth: 448 }}
      >
        <h1 style={FALLBACK_STYLE.title}>
          {formatMessage({ id: "app.update.refreshToContinue" })}
        </h1>
        <p style={FALLBACK_STYLE.body}>
          {formatMessage({ id: "app.update.staleBuildBody" })}
        </p>
        <div style={FALLBACK_STYLE.actions}>
          <button
            type="button"
            onClick={onContinueAnyway}
            style={FALLBACK_STYLE.ghostButton}
          >
            {formatMessage({ id: "app.update.continueAnyway" })}
          </button>
          <button
            type="button"
            onClick={onRecoverAndRefresh}
            style={FALLBACK_STYLE.primaryButton}
          >
            {formatMessage({ id: "app.update.refreshNow" })}
          </button>
        </div>
      </div>
    </RootFallbackScroller>
  );
}

// Raft Design System › Banner (warning): the orange-soft wash, ink text, a
// hairline, no ink frame; it floats over the app, so it takes the float shadow.
const WARNING_BANNER_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "12px 14px",
  borderRadius: 10,
  background: "var(--warning-soft, #fde6de)",
  color: "var(--foreground, #141111)",
  boxShadow: "inset 0 0 0 1px var(--line-hairline, #14111126), var(--elevation-float, 0 1px 0 #1411110a, 0 12px 32px -12px #14111152)",
  fontFamily: 'var(--font-sans, "Space Grotesk", system-ui, sans-serif)',
  fontSize: 14,
  lineHeight: "20px",
};

// Raft Design System › Button (small, ink-lined paper button): 32 tall, 13/18 700.
const SMALL_BUTTON_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "none",
  height: 32,
  padding: "0 12px",
  borderRadius: 8,
  border: "1.5px solid var(--line-strong, #141111)",
  background: "var(--layer-card, #ffffff)",
  color: "var(--foreground, #141111)",
  font: "inherit",
  fontSize: 13,
  lineHeight: "18px",
  fontWeight: 700,
  whiteSpace: "nowrap",
  cursor: "pointer",
};

export function AppRefreshWarningBanner({ onRefresh }: { onRefresh: () => void }) {
  const { formatMessage } = useIntl();

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-3 left-1/2 z-40 w-[min(calc(100%-24px),560px)] -translate-x-1/2"
    >
      <div role="alert" style={WARNING_BANNER_STYLE}>
        <p style={{ margin: 0, flex: 1, minWidth: 0 }}>
          {formatMessage({ id: "app.update.newerVersionAvailable" })}
        </p>
        <button
          type="button"
          onClick={onRefresh}
          style={SMALL_BUTTON_STYLE}
        >
          {formatMessage({ id: "app.update.refresh" })}
        </button>
      </div>
    </div>
  );
}
