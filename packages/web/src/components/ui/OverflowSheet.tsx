import { useCallback } from "react";
import type { ComponentProps, ReactNode } from "react";
import { useIntl } from "react-intl";
import { ArrowLeft, MoreHorizontal, X } from "lucide-react";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  PanelAction,
  PanelActions,
  Switch,
} from "@botiverse/raft-ui";
import Tooltip from "./Tooltip";
import SectionEyebrow from "./SectionEyebrow";
import type { MessageId } from "../../i18n/messages";

/**
 * Topbar overflow primitives. Shared shell for the channel and thread
 * overflow menus: one header icon trigger + a right-side Drawer.
 * On phones the drawer takes the whole width, so the sheet IS the mobile
 * page; the mobile chevron in the header doubles as the back affordance, the
 * X is desktop-only — mirroring the design's "desktop dialog / mobile page
 * with back" split without a new route.
 *
 * Raft Design System › Sheet (`rf-drawer`), the same frame as the channel
 * settings drawer: raft-ui's raft drawer recipe draws the popover layer
 * sliding in from the right (420 wide, the whole width on a phone) with a
 * seam edge and the float shadow; `DrawerHeader` is the 56px white head with
 * a seam under it and the 17/22 headline title; `DrawerBody` scrolls the
 * content. Yellow stays on the frame, never on a drawer head.
 */

/** A panel-head icon action: raft-ui PanelAction (44 on a phone, the DS small
 *  32 on desktop), so its size comes from the panel-action recipe. */
export function OverflowMenuTrigger({
  labelId,
  onClick,
  icon,
  testId,
}: {
  labelId: MessageId;
  onClick: () => void;
  /** Defaults to the generic overflow glyph; semantic surfaces may provide a more precise icon. */
  icon?: ReactNode;
  testId?: string;
}) {
  const { formatMessage } = useIntl();
  return (
    <Tooltip content={formatMessage({ id: labelId })}>
      <PanelAction
        onClick={onClick}
        aria-label={formatMessage({ id: labelId })}
        data-testid={testId}
      >
        {icon ?? <MoreHorizontal />}
      </PanelAction>
    </Tooltip>
  );
}

export function OverflowSheet({
  open,
  onOpenChange,
  title,
  descriptionId,
  closeLabelId = "message.channelSettings.close",
  closeGuardRef,
  onCloseGuarded,
  hideDesktopClose = false,
  bare = false,
  testId,
  headerExtras,
  subtitle,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Visible sheet title (e.g. `#general`, `Thread — #general`). */
  title: ReactNode;
  /** sr-only DrawerDescription text for assistive tech. */
  descriptionId: MessageId;
  /** aria-label for the mobile chevron / desktop X close buttons.
   *  Callers pass a sheet-specific key; the legacy channel-settings
   *  default only keeps hypothetical unupdated callers intact. */
  closeLabelId?: MessageId;
  /** Unsaved-draft guard (final6): while the ref reads true, EVERY
   *  dismissal (X / chevron / outside-press / swipe / escape) is
   *  cancelled and `onCloseGuarded` fires instead, so the host can
   *  prompt save-or-discard. Read at event time so dirtiness never
   *  re-renders this sheet. */
  closeGuardRef?: { current: boolean };
  onCloseGuarded?: () => void;
  /** Hide the explicit close affordances when the host wants the drawer to
   *  be dismissed only through outside press, swipe, or Escape. */
  hideDesktopClose?: boolean;
  /** Bare mode (drawer-internal page navigation, task #187): skips the
   *  built-in header and the padded scroll wrapper so the child page
   *  owns the full-bleed layout (own header / pinned footer). The
   *  DrawerContent classes — and therefore the sheet SIZE — are
   *  untouched; title/description stay mounted sr-only for a11y. */
  bare?: boolean;
  testId?: string;
  /** v2「重量随风险」 (Artea 2026-08-06): the header IS the identity
   *  surface — extras (search icon, muted pill) render on the title row
   *  before the close affordance, subtitle (channel description) renders
   *  under it. Omit both for the plain header. */
  headerExtras?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  const { formatMessage } = useIntl();
  const handleOpenChange = useCallback<NonNullable<ComponentProps<typeof Drawer>["onOpenChange"]>>(
    (nextOpen, eventDetails) => {
      if (!nextOpen && closeGuardRef?.current) {
        eventDetails.cancel();
        onCloseGuarded?.();
        return;
      }
      onOpenChange(nextOpen);
    },
    [closeGuardRef, onCloseGuarded, onOpenChange],
  );
  return (
    <Drawer
      open={open}
      modal
      swipeDirection="right"
      onOpenChange={handleOpenChange}
    >
      <DrawerContent
        data-testid={testId}
        className="inset-y-0 right-0 h-dvh w-full [--drawer-content-height:100dvh] [--drawer-inset:0px] flex-col"
      >
        {/* Bare mode HIDES the header instead of unmounting it and keeps
            the body wrapper as the same element at the same position —
            only its className changes — so children keep their React
            identity and a dirty settings draft survives root → page →
            back navigation. Title/description swap to sr-only copies so
            exactly one of each is mounted at a time. */}
        <DrawerHeader
          className={bare ? "hidden" : undefined}
          data-testid={bare ? undefined : "overflow-sheet-header"}
        >
          {/* Back / identity / actions, straight in the raft-ui sheet head,
              which owns the edges (on a phone Back mirrors the last action,
              3px from the edge). Back leaves the layout on desktop. The subtitle
              sits in the identity column under the title, so a channel
              description lines up with the #channel label. */}
          <DrawerClose
            render={(
              <PanelAction
                className="md:hidden"
                aria-label={formatMessage({ id: closeLabelId })}
              />
            )}
          >
            <ArrowLeft size={22} />
          </DrawerClose>
          <div className="min-w-0 flex-1" data-testid="overflow-sheet-identity">
            <DrawerTitle
              className="truncate"
              data-testid="overflow-sheet-title"
            >
              {title}
            </DrawerTitle>
            <DrawerDescription className="sr-only">
              {formatMessage({ id: descriptionId })}
            </DrawerDescription>
            {subtitle && (
              <div className="min-w-0" data-testid="overflow-sheet-subtitle-row">
                {subtitle}
              </div>
            )}
          </div>
          {/* The panel-head actions slot: the recipe lands the last glyph
              on the head's edge (the sheet head shares the panel head's
              right padding). */}
          <PanelActions>
            {headerExtras}
            {!hideDesktopClose && (
              <DrawerClose
                render={(
                  <PanelAction
                    className="max-md:hidden"
                    aria-label={formatMessage({ id: closeLabelId })}
                  />
                )}
              >
                <X size={22} />
              </DrawerClose>
            )}
          </PanelActions>
        </DrawerHeader>
        {bare && (
          <>
            <DrawerTitle className="sr-only">{title}</DrawerTitle>
            <DrawerDescription className="sr-only">
              {formatMessage({ id: descriptionId })}
            </DrawerDescription>
          </>
        )}

        {/* The rows bring their own 16px inset (DS sheet items run edge to
            edge), so the body only scrolls; bare pages own their layout. */}
        <DrawerBody
          className={bare
            ? "flex min-h-0 flex-1 flex-col overflow-visible p-0"
            : "min-h-0 flex-1 overflow-y-auto px-0 py-2"}
        >
          {children}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}

export function OverflowActionRow({
  icon,
  label,
  onClick,
  trailing,
  danger = false,
  disabled = false,
  testId,
  className,
  ariaLabel,
}: {
  icon: ReactNode;
  label: ReactNode;
  onClick: () => void;
  /** Right-aligned auxiliary content (e.g. a count summary). */
  trailing?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  testId?: string;
  /** Keep the visual label terse without losing the full action scope. */
  ariaLabel?: string;
  /** Extra classes appended to the row — v2 uses it for the filled
   *  destructive block (Delete = the only filled action). */
  className?: string;
}) {
  return (
    <Button
      variant={danger ? "danger" : "outline"}
      size="sm"
      nativeButton
      type="button"
      className={`w-full justify-start text-left [&_[data-slot=button-content]]:w-full [&_[data-slot=button-content]]:justify-start ${className ?? ""}`}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      aria-label={ariaLabel}
    >
      <span data-icon="inline-start" className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
      {trailing && (
        <span className="ml-auto shrink-0 font-mono text-mono-meta font-normal text-foreground-hint">
          {trailing}
        </span>
      )}
    </Button>
  );
}

/** Lightweight utility command for overflow sheets. Unlike
    OverflowActionRow, this carries no standalone box: low-risk navigation
    and subscription commands read as one flat list (Raft Design System ›
    Sheet `rf-sheet__item`: 16/24 500 ink, a 20px ink-2 icon, the pressed wash
    on hover, no radius, no line). */
export function OverflowCommandRow({
  icon,
  label,
  onClick,
  disabled = false,
  testId,
}: {
  icon: ReactNode;
  label: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="md"
      nativeButton
      type="button"
      className="h-11 w-full justify-start gap-3 rounded-none px-4 py-0 text-left text-body font-medium [&_[data-slot=button-content]]:w-full [&_[data-slot=button-content]]:justify-start [&_[data-icon=inline-start]]:text-foreground-muted"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
    >
      <span data-icon="inline-start" className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </Button>
  );
}

export function OverflowSwitchRow({
  labelId,
  icon,
  label,
  checked,
  disabled = false,
  onCheckedChange,
  testId,
}: {
  /** Stable id anchor wiring the Switch's aria-labelledby. */
  labelId: string;
  icon: ReactNode;
  label: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
  testId?: string;
}) {
  return (
    <div className="flex w-full items-center justify-between gap-3 px-4 py-3">
      <span id={labelId} className="flex min-w-0 items-center gap-3 text-subhead font-medium text-foreground">
        <span className="shrink-0 text-foreground-muted">{icon}</span>
        <span className="truncate">{label}</span>
      </span>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-labelledby={labelId}
        data-testid={testId}
      />
    </div>
  );
}

/** Visual separator before a danger-zone group, with an optional group
    header (final4: groups are labeled by the state they mutate). DS: a
    hairline between drawer sections and a 13/18 700 ink-3 section title. */
export function OverflowDangerZone({
  children,
  labelId,
}: {
  children: ReactNode;
  labelId?: MessageId;
}) {
  const { formatMessage } = useIntl();
  return (
    <div className="mt-2 border-t border-line-hairline pt-2">
      {labelId && (
        <SectionEyebrow as="div" className="px-4 pt-2 pb-1.5">
          {formatMessage({ id: labelId })}
        </SectionEyebrow>
      )}
      {children}
    </div>
  );
}
