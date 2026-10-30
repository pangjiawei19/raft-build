import { Card, Badge, Status, Button, Progress, ProgressTrack, ProgressIndicator, Separator, Spinner } from "@botiverse/raft-ui";
import CloseButton from "../ui/CloseButton";
import {
  clearClockTimeout,
  setClockTimeout,
} from "@botiverse/raft-shared";
import type { RuntimeAccountUsageProvider } from "@botiverse/raft-shared";
import { AlertCircle, RefreshCw, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import { createPortal } from "react-dom";
import { useIntl } from "react-intl";

import { useMediaQuery } from "../../hooks/effectPrimitives";
import { formatRelativeTime } from "../../utils/relativeTime";
import {
  runtimeAccountUsageClient,
} from "../../utils/runtimeAccountUsageClient";
import type {
  RuntimeAccountUsageClient,
  RuntimeAccountUsageReadResult,
  RuntimeAccountUsageRefreshResult,
} from "../../utils/runtimeAccountUsageClient";
import BottomSheet from "../ui/BottomSheet";
import { useViewportClamp } from "../layout/useViewportClamp";
import { dismissLayerProps, notDismissLayerProps } from "../ui/dismissLayer";

const HOVER_OPEN_DELAY_MS = 200;
const HOVER_CLOSE_DELAY_MS = 160;
const POST_REFRESH_READ_DELAY_MS = 1_200;
const POST_REFRESH_MAX_READ_ATTEMPTS = 8;

type RuntimeBadgeAppearance = Pick<ComponentProps<typeof Badge>, "appearance" | "variant">;

type SurfaceRefreshState = RuntimeAccountUsageRefreshResult["state"] | "idle" | "requesting" | "unconfirmed";

function usageProviderForRuntime(runtimeId: string): RuntimeAccountUsageProvider | null {
  if (runtimeId === "claude" || runtimeId === "codex" || runtimeId === "grok") return runtimeId;
  if (runtimeId === "kimi" || runtimeId === "kimi-sdk") return "kimi";
  return null;
}

function providerName(provider: RuntimeAccountUsageProvider): string {
  if (provider === "claude") return "Claude";
  if (provider === "codex") return "Codex";
  if (provider === "grok") return "Grok";
  return "Kimi";
}

function isAttention(result: RuntimeAccountUsageReadResult): boolean {
  if (result.state === "missing" || result.state === "stale") return result.state === "stale";
  return result.snapshot.accounts.some((account) =>
    account.health !== "ok" || account.windows.some((window) => window.status !== "ok"),
  );
}

/**
 * Runtime labels are RUI badges in both their inert and interactive states.
 * Keep the consumer's visual overrides, but let the primitive own the inline
 * flex layout so the label and health indicator share one cross-axis.
 */
function runtimeBadgeClassName(className: string): string {
  return `${className} inline-flex items-center`;
}

function RuntimeUsageContents({
  result,
  loading,
  loadError,
}: {
  result: RuntimeAccountUsageReadResult | null;
  loading: boolean;
  loadError: boolean;
}) {
  const { formatMessage, locale } = useIntl();
  if (loading && !result) {
    return <div className="px-4 py-5 text-callout text-foreground-muted">{formatMessage({ id: "machine.runtimeUsage.reading" })}</div>;
  }
  if (loadError && !result) {
    return (
      <div className="flex items-start gap-2 px-4 py-5 text-callout text-warning-strong">
        <AlertCircle size={16} className="mt-0.5 shrink-0" />
        {formatMessage({ id: "machine.runtimeUsage.readFailed" })}
      </div>
    );
  }
  if (!result || result.state === "missing") {
    return (
      <div className="px-4 py-5">
        <div className="text-callout font-bold text-foreground">{formatMessage({ id: "machine.runtimeUsage.noSnapshot" })}</div>
        <p className="mt-1 text-footnote text-foreground-muted">
          {formatMessage({ id: "machine.runtimeUsage.noSnapshotDescription" })}
        </p>
      </div>
    );
  }

  const stale = result.state === "stale";
  return (
    // A stale snapshot sits on the sunken surface under an orange-soft notice
    // (ink text): recoverable, so warning, never red.
    <div className={stale ? "bg-fill-muted" : undefined}>
      {stale && (
        <div className="border-b border-line-hairline bg-warning-soft px-4 py-2 text-caption font-bold text-foreground">
          {formatMessage({ id: "machine.runtimeUsage.stale" })}
        </div>
      )}
      <div>
        {result.snapshot.accounts.map((account, index) => {
          const reauth = account.health === "reauth_required";
          return (
            <Fragment key={account.accountKey}>
            {index > 0 ? <Separator /> : null}
            <div className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-callout font-bold text-foreground">
                    {account.planLabel ?? formatMessage({ id: "machine.runtimeUsage.accountFallback" })}
                  </div>
                  {(account.maskedLabel ?? account.displayName) && (
                    <div className="mt-0.5 truncate font-mono text-mono-meta text-foreground-hint" data-testid="runtime-account-masked-label">
                      {account.maskedLabel ?? account.displayName}
                    </div>
                  )}
                </div>
                {/* Raft DS StatusChip: soft wash, a square pixel, one word. */}
                <Badge
                  appearance="soft"
                  variant={account.health === "ok" ? "success" : "warning"}
                >
                  <Status size="md" variant={account.health === "ok" ? "success" : "warning"} aria-hidden="true" />
                  {formatMessage({ id: `machine.runtimeUsage.health.${account.health}` })}
                </Badge>
              </div>
              {account.health === "unsupported" || account.health === "error" ? (
                <p className="mt-3 text-footnote text-foreground-muted">
                  {formatMessage({ id: account.health === "unsupported"
                    ? "machine.runtimeUsage.unsupportedDescription"
                    : "machine.runtimeUsage.readFailed" })}
                </p>
              ) : reauth ? (
                <p className="mt-3 text-footnote text-foreground-muted">
                  {formatMessage({ id: "machine.runtimeUsage.reauthDescription" })}
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {account.windows.map((window) => (
                    <div key={window.id}>
                      <div className="flex flex-col gap-0.5 text-footnote sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                        <span className="font-semibold text-foreground">{window.label}</span>
                        {window.status === "parse_unavailable" ? (
                          <span className="text-warning-strong">{formatMessage({ id: "machine.runtimeUsage.parseUnavailable" })}</span>
                        ) : (
                          <span className="text-foreground-muted sm:text-right">
                            {window.resetsAt
                              ? formatMessage(
                                  { id: "machine.runtimeUsage.windowSummary" },
                                  {
                                    percent: Math.round((window.usedRatio ?? 0) * 100),
                                    reset: formatRelativeTime(window.resetsAt, locale) ?? formatMessage({ id: "machine.runtimeUsage.later" }),
                                  },
                                )
                              : formatMessage(
                                  { id: "machine.runtimeUsage.windowSummaryResetUnavailable" },
                                  { percent: Math.round((window.usedRatio ?? 0) * 100) },
                                )}
                          </span>
                        )}
                      </div>
                      {window.status !== "parse_unavailable" && (
                        <Progress
                          value={Math.round((window.usedRatio ?? 0) * 100)}
                          size="sm"
                          // Raft DS Progress: cyan, orange once at/over 90% of the limit.
                          variant={window.status === "limit_reached" || (window.usedRatio ?? 0) >= 0.9 ? "warning" : "information"}
                          className="mt-1.5"
                          aria-label={window.label}
                        >
                          <ProgressTrack>
                            <ProgressIndicator />
                          </ProgressTrack>
                        </Progress>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            </Fragment>
          );
        })}
      </div>
      <Separator />
      <div className="px-4 py-2 text-caption text-foreground-hint">
        {formatMessage(
          { id: "machine.runtimeUsage.metadata" },
          {
            updated: formatRelativeTime(result.snapshot.collectedAt, locale) ?? formatMessage({ id: "machine.runtimeUsage.recently" }),
          },
        )}
      </div>
    </div>
  );
}

function Surface({
  provider,
  runtimeVersion,
  result,
  loading,
  loadError,
  refreshState,
  cooldownLeftMs,
  onRefresh,
  onClose,
}: {
  provider: RuntimeAccountUsageProvider;
  runtimeVersion?: string | null;
  result: RuntimeAccountUsageReadResult | null;
  loading: boolean;
  loadError: boolean;
  refreshState: SurfaceRefreshState;
  /** Task #704: ms left in the refresh window; > 0 disables the button and
   *  replaces the refused-click copy with a countdown. */
  cooldownLeftMs: number;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const { formatMessage } = useIntl();
  return (
    <div data-testid={`runtime-usage-surface-${provider}`}>
      <div className="flex items-center justify-between gap-3 border-b border-line-hairline px-4 py-3">
        <div className="min-w-0">
          <div className="text-headline text-foreground">{formatMessage({ id: "machine.runtimeUsage.title" }, { provider: providerName(provider) })}</div>
          <div data-testid={`runtime-version-${provider}`} className="font-mono text-mono-meta text-foreground-hint">
            {runtimeVersion?.trim()
              ? formatMessage({ id: "machine.runtimeUsage.version" }, { version: runtimeVersion.trim() })
              : formatMessage({ id: "machine.runtimeUsage.versionUnavailable" })}
          </div>
          <div className="text-caption text-foreground-hint">{formatMessage({ id: "machine.runtimeUsage.private" })}</div>
        </div>
        <CloseButton type="button" className="" onClick={onClose} aria-label={formatMessage({ id: "machine.runtimeUsage.close" })}>
          <X size={16} />
        </CloseButton>
      </div>
      <RuntimeUsageContents result={result} loading={loading} loadError={loadError} />
      <div className="flex items-center justify-between gap-3 border-t border-line-hairline px-4 py-2.5">
        <span className="text-caption text-foreground-hint">
          {refreshState === "requested"
            ? formatMessage({ id: "machine.runtimeUsage.refreshRequested" })
            : refreshState === "unconfirmed"
              ? formatMessage({ id: "machine.runtimeUsage.refreshUnconfirmed" })
            : refreshState === "timeout"
              ? formatMessage({ id: "machine.runtimeUsage.refreshTimeout" })
            : cooldownLeftMs > 0
              ? formatMessage(
                  { id: "machine.runtimeUsage.refreshCooldownCountdown" },
                  { seconds: Math.ceil(cooldownLeftMs / 1000) },
                )
            : refreshState === "computer_offline"
              ? formatMessage({ id: "machine.runtimeUsage.computerOffline" })
              : formatMessage({ id: "machine.runtimeUsage.cacheOnly" })}
        </span>
        <Button size="sm"
          variant="outline"
          type="button"
          onClick={onRefresh}
          disabled={refreshState === "requesting" || cooldownLeftMs > 0}
          className="shrink-0"
        >
          {/* Waiting with no known end: the pixel spinner (Raft DS Loading). */}
          {refreshState === "requesting"
            ? <Spinner size="xs" aria-hidden="true" />
            : <RefreshCw size={16} aria-hidden="true" />}
          {formatMessage({ id: "machine.runtimeUsage.refresh" })}
        </Button>
      </div>
    </div>
  );
}

export default function RuntimeAccountUsageChip({
  runtimeId,
  runtimeVersion,
  serverId,
  machineId,
  children,
  className = "",
  appearance = "solid",
  variant = "default",
  client = runtimeAccountUsageClient,
}: {
  runtimeId: string;
  runtimeVersion?: string | null;
  serverId: string;
  machineId: string;
  children: ReactNode;
  className?: string;
  client?: RuntimeAccountUsageClient;
} & RuntimeBadgeAppearance) {
  const { formatMessage } = useIntl();
  const provider = usageProviderForRuntime(runtimeId);
  const mobile = useMediaQuery("(max-width: 767px)");
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<RuntimeAccountUsageReadResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [refreshState, setRefreshState] = useState<SurfaceRefreshState>("idle");
  // Task #704: the refresh window (2 minutes, shared by the panel's own
  // auto-refresh) drives the footer countdown. The remaining time is derived
  // during render from the client's window; the ticker only forces the
  // re-render that makes it drain.
  const [, setCooldownTick] = useState(0);
  useEffect(() => {
    if (!provider) return;
    const ticker = setInterval(() => setCooldownTick((tick) => tick + 1), 1_000);
    return () => clearInterval(ticker);
  }, [provider, serverId, machineId]);
  const cooldownLeftMs = provider
    ? client.refreshCooldownRemainingMs(serverId, machineId, provider)
    : 0;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const openTimerRef = useRef<ReturnType<typeof setClockTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setClockTimeout> | null>(null);
  const rereadTimerRef = useRef<ReturnType<typeof setClockTimeout> | null>(null);
  const mountedRef = useRef(true);
  const pinnedRef = useRef(false);
  // Render-side mirror of pinnedRef: only a PINNED card is an outside-press
  // dismiss layer. Hover / focus-open closes on mouse-out, and the card keeps
  // role="dialog" in both states, so the unpinned card must opt OUT explicitly
  // (data-dismiss-layer="false") or a host's role fallback would treat it as an
  // open layer while the user merely hovers.
  //
  // The pin's identity is the SUBJECT the effect below re-keys on — client,
  // machineId, provider, serverId (the transitive deps of readSnapshot /
  // requestBackgroundRefresh) — the very same rule that resets pinnedRef there.
  // The pin stores the subject it was made under; during render any difference
  // (a machine switch, an A→B→A round trip, a client swap alone) invalidates it
  // and clears the stored pin (React's documented "adjust state during render"
  // for prop-driven resets), so a stale pin can never come back and the marker
  // and the ref never disagree. No Effect adjusts state.
  const [pinnedFor, setPinnedFor] = useState<{ client: typeof client; machineId: string; provider: typeof provider; serverId: string } | null>(null);
  const pinned =
    pinnedFor !== null &&
    pinnedFor.client === client &&
    pinnedFor.machineId === machineId &&
    pinnedFor.provider === provider &&
    pinnedFor.serverId === serverId;
  if (pinnedFor !== null && !pinned) setPinnedFor(null);
  const pollGenerationRef = useRef(0);
  const subjectGenerationRef = useRef(0);

  const { style: popoverStyle } = useViewportClamp({
    triggerRef,
    popoverRef,
    placement: "vertical-smart",
    open: open && !mobile,
    gutter: 8,
  });

  const readSnapshot = useCallback(async (subjectGeneration = subjectGenerationRef.current) => {
    if (!provider) return null;
    setLoading(true);
    setLoadError(false);
    try {
      const next = await client.read(serverId, machineId, provider);
      if (mountedRef.current && subjectGenerationRef.current === subjectGeneration) setResult(next);
      return next;
    } catch {
      if (mountedRef.current && subjectGenerationRef.current === subjectGeneration) setLoadError(true);
      return null;
    } finally {
      if (mountedRef.current && subjectGenerationRef.current === subjectGeneration) setLoading(false);
    }
  }, [client, machineId, provider, serverId]);

  const startFollowUpReads = useCallback((subjectGeneration = subjectGenerationRef.current) => {
    if (!provider) return;
    const generation = ++pollGenerationRef.current;
    let attempt = 0;

    const scheduleNext = () => {
      if (
        !mountedRef.current
        || subjectGenerationRef.current !== subjectGeneration
        || pollGenerationRef.current !== generation
      ) return;
      if (attempt >= POST_REFRESH_MAX_READ_ATTEMPTS) {
        setRefreshState("unconfirmed");
        return;
      }
      if (rereadTimerRef.current) clearClockTimeout(rereadTimerRef.current);
      rereadTimerRef.current = setClockTimeout(() => {
        rereadTimerRef.current = null;
        attempt += 1;
        client.invalidate(serverId, machineId, provider);
        void readSnapshot(subjectGeneration).then((next) => {
          if (
            !next
            || !mountedRef.current
            || subjectGenerationRef.current !== subjectGeneration
            || pollGenerationRef.current !== generation
          ) return;
          if (next.state === "fresh") {
            setRefreshState("idle");
            return;
          }
          scheduleNext();
        });
      }, POST_REFRESH_READ_DELAY_MS);
    };

    scheduleNext();
  }, [client, machineId, provider, readSnapshot, serverId]);

  const requestBackgroundRefresh = useCallback(async (subjectGeneration = subjectGenerationRef.current) => {
    if (!provider) return;
    try {
      const refresh = await client.refresh(serverId, machineId, provider, "stale_or_missing");
      if (!mountedRef.current || subjectGenerationRef.current !== subjectGeneration) return;
      setRefreshState(refresh.state);
      if (refresh.state === "requested" || refresh.state === "cooldown") startFollowUpReads(subjectGeneration);
    } catch {
      if (mountedRef.current && subjectGenerationRef.current === subjectGeneration) {
        setRefreshState("computer_offline");
      }
    }
  }, [client, machineId, provider, serverId, startFollowUpReads]);

  useEffect(() => {
    const subjectGeneration = ++subjectGenerationRef.current;
    mountedRef.current = true;
    pinnedRef.current = false;
    void readSnapshot(subjectGeneration).then((next) => {
      if (subjectGenerationRef.current !== subjectGeneration) return;
      if (next?.state === "stale" || next?.state === "missing") {
        void requestBackgroundRefresh(subjectGeneration);
      }
    });
    return () => {
      mountedRef.current = false;
      subjectGenerationRef.current += 1;
      pollGenerationRef.current += 1;
      if (openTimerRef.current) clearClockTimeout(openTimerRef.current);
      if (closeTimerRef.current) clearClockTimeout(closeTimerRef.current);
      if (rereadTimerRef.current) clearClockTimeout(rereadTimerRef.current);
    };
  }, [readSnapshot, requestBackgroundRefresh]);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) clearClockTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);
  const cancelHoverOpen = useCallback(() => {
    if (openTimerRef.current) clearClockTimeout(openTimerRef.current);
    openTimerRef.current = null;
  }, []);
  const closeSoon = useCallback(() => {
    cancelClose();
    closeTimerRef.current = setClockTimeout(() => {
      if (!pinnedRef.current) setOpen(false);
    }, HOVER_CLOSE_DELAY_MS);
  }, [cancelClose]);
  const openNow = useCallback(() => {
    cancelClose();
    setOpen(true);
    void readSnapshot();
  }, [cancelClose, readSnapshot]);
  const pinOpen = useCallback(() => {
    pinnedRef.current = true;
    setPinnedFor({ client, machineId, provider, serverId });
    openNow();
  }, [client, machineId, openNow, provider, serverId]);
  const closeSurface = useCallback(() => {
    pinnedRef.current = false;
    setPinnedFor(null);
    cancelClose();
    cancelHoverOpen();
    setOpen(false);
  }, [cancelClose, cancelHoverOpen]);
  const openAfterHover = useCallback(() => {
    cancelClose();
    if (openTimerRef.current) clearClockTimeout(openTimerRef.current);
    openTimerRef.current = setClockTimeout(openNow, HOVER_OPEN_DELAY_MS);
  }, [cancelClose, openNow]);
  const handleMouseEnter = useCallback(() => {
    if (!mobile) openAfterHover();
  }, [mobile, openAfterHover]);
  const handleMouseLeave = useCallback(() => {
    if (mobile) return;
    cancelHoverOpen();
    closeSoon();
  }, [cancelHoverOpen, closeSoon, mobile]);
  const handleFocus = useCallback(() => {
    if (!mobile) openNow();
  }, [mobile, openNow]);
  const handleBlur = useCallback(() => {
    if (!mobile) closeSoon();
  }, [closeSoon, mobile]);
  const refresh = useCallback(async () => {
    if (!provider) return;
    const subjectGeneration = subjectGenerationRef.current;
    setRefreshState("requesting");
    try {
      const next = await client.refresh(serverId, machineId, provider, "manual");
      if (!mountedRef.current || subjectGenerationRef.current !== subjectGeneration) return;
      // Manual refresh awaits the machine's reply through the server relay:
      // a `fresh` result carries the snapshot itself (the client has already
      // written it into the read cache), so surface it in place. The
      // follow-up polling below only serves legacy `requested` replies.
      if (next.state === "fresh") {
        if (next.snapshot) {
          setLoadError(false);
          setResult({ state: "fresh", snapshot: next.snapshot });
          setRefreshState("idle");
        } else {
          setRefreshState("unconfirmed");
        }
        return;
      }
      setRefreshState(next.state);
      if (next.accepted || next.state === "cooldown") startFollowUpReads(subjectGeneration);
    } catch {
      if (mountedRef.current && subjectGenerationRef.current === subjectGeneration) {
        setRefreshState("computer_offline");
      }
    }
  }, [client, machineId, provider, serverId, startFollowUpReads]);
  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!open || mobile) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!pinnedRef.current) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      closeSurface();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && pinnedRef.current) closeSurface();
    };
    document.addEventListener("pointerdown", onPointerDown);
    // keydown-global-exempt: Escape closes only this pinned runtime-usage surface.
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeSurface, mobile, open]);

  if (!provider) {
    return <Badge appearance={appearance} variant={variant} className={runtimeBadgeClassName(className)}>{children}</Badge>;
  }

  const surface = (
    <Surface
      provider={provider}
      runtimeVersion={runtimeVersion}
      result={result}
      loading={loading}
      loadError={loadError}
      refreshState={refreshState}
      cooldownLeftMs={cooldownLeftMs}
      onRefresh={handleRefresh}
      onClose={closeSurface}
    />
  );
  const attention = result ? isAttention(result) : false;
  const hasKnownState = result?.state !== "missing" && result !== null;

  return (
    <>
      <Badge
        ref={triggerRef}
        render={<button type="button" />}
        appearance={appearance}
        variant={variant}
        className={`${runtimeBadgeClassName(className)} relative cursor-help outline-none focus-visible:shadow-focus`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={typeof children === "string" ? children : providerName(provider)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onClick={pinOpen}
      >
        {children}
        {hasKnownState && (
          <Status
            data-testid={`runtime-usage-health-${provider}`}
            size="sm"
            variant={attention ? "warning" : "success"}
            className="ml-1"
            aria-label={formatMessage({ id: attention ? "machine.runtimeUsage.attention" : "machine.runtimeUsage.healthy" })}
          />
        )}
      </Badge>
      {open && mobile && (
        <BottomSheet onClose={closeSurface} sheetClassName="max-h-[82vh] overflow-y-auto">
          {surface}
        </BottomSheet>
      )}
      {open && !mobile && createPortal(
        <Card
          ref={popoverRef}
          {...(pinned ? dismissLayerProps : notDismissLayerProps)}
          role="dialog"
          aria-label={formatMessage({ id: "machine.runtimeUsage.dialogLabel" }, { provider: providerName(provider) })}
          // A floating surface (Raft DS Popover): popover layer, seam edge,
          // float shadow — the card recipe alone is an in-flow card.
          className="z-[70] w-[min(390px,calc(100vw-16px))] overflow-y-auto border-line-seam bg-layer-popover shadow-float"
          style={popoverStyle}
          onMouseEnter={cancelClose}
          onMouseLeave={closeSoon}
        >
          {surface}
        </Card>,
        document.body,
      )}
    </>
  );
}

export function RuntimeAccountUsageGateChip({
  enabled,
  runtimeId,
  runtimeVersion,
  serverId,
  machineId,
  children,
  className = "",
  appearance = "solid",
  variant = "default",
  client,
}: {
  enabled: boolean;
  runtimeId: string;
  runtimeVersion?: string | null;
  serverId: string | null;
  machineId: string;
  children: ReactNode;
  className?: string;
  client?: RuntimeAccountUsageClient;
} & RuntimeBadgeAppearance) {
  if (!enabled || !serverId) {
    return (
      <Badge appearance={appearance} variant={variant} className={runtimeBadgeClassName(className)}>
        {children}
      </Badge>
    );
  }
  return (
    <RuntimeAccountUsageChip
      runtimeId={runtimeId}
      runtimeVersion={runtimeVersion}
      serverId={serverId}
      machineId={machineId}
      className={className}
      appearance={appearance}
      variant={variant}
      client={client}
    >
      {children}
    </RuntimeAccountUsageChip>
  );
}

export { usageProviderForRuntime };
