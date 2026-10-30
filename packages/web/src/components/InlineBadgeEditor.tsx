import { Badge, DropdownMenuPopup, TaskStatusBadge } from "@botiverse/raft-ui";
import type { BadgeProps, TaskStatusId } from "@botiverse/raft-ui";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

import { InlineBadgeMenuItem } from "./InlineBadgeMenuItem";
import { SelectionPopoverPanel, SELECTION_POPOVER_SURFACE } from "./ui/SelectionPopover";
import Tooltip from "./ui/Tooltip";
import { dismissLayerProps } from "./ui/dismissLayer";

export type InlineBadgeOption = { id: string; label: string; avatar?: ReactNode };

function noop() {}

function stopPropagation(event: { stopPropagation(): void }) {
  event.stopPropagation();
}

interface InlineBadgeEditorProps {
  /** Display label shown in the badge */
  displayValue: string;
  /** Currently selected option ID (for highlight) */
  selectedId: string;
  /** `avatar` is rendered in a reserved leading slot, so a list of people lines
   *  up whether or not every entry has a picture. Status passes none. */
  options: InlineBadgeOption[];
  onSelect: (id: string) => Promise<void> | void;
  open: boolean;
  onToggle: () => void;
  onRequestClose?: () => void;
  badgeClassName: string;
  badgeVariant?: BadgeProps["variant"];
  /**
   * When set, the trigger renders raft-ui's `TaskStatusBadge` for this status,
   * so the icon + colours come from the single task-status source instead of a
   * caller-supplied `badgeClassName`. Status callsites use this; other badges
   * (e.g. a non-status pill) keep the generic `badgeClassName` path.
   */
  badgeStatus?: TaskStatusId;
  capitalize?: boolean;
  dropdownMinWidth?: string;
  dropdownAlign?: "left" | "right";
  disabled?: boolean;
  buttonTestId?: string;
  buttonDataTaskStatus?: string;
  buttonTitle?: string;
  buttonAriaLabel?: string;
  dropdownTestId?: string;
  optionTestIdPrefix?: string;
  buttonClassName?: string;
  buttonChildren?: ReactNode;
  /**
   * Swap the local option list for the real `SelectionPopover` — the same
   * control the search page's filters use.
   *
   * @stdrc msg=4c357cb1: "assignee 选择框得复用搜索里那个 filter 的选择框，这两个
   * 本质上是同一个东西". They are: pick one of a set of people, where the set is
   * long enough to need typing. The trigger stays this component's badge so the
   * property row still reads like Status, which is the other half of that note.
   *
   * Status does not pass this: four options, a closed set, nothing to search.
   */
  searchable?: boolean;
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  popoverTitle?: string;
  emptyLabel?: string;
}

export default function InlineBadgeEditor({
  displayValue,
  selectedId,
  options,
  onSelect,
  open,
  onToggle,
  onRequestClose,
  badgeClassName,
  badgeVariant = "muted",
  badgeStatus,
  capitalize,
  dropdownMinWidth = "min-w-[120px]",
  dropdownAlign,
  disabled,
  buttonTestId,
  buttonDataTaskStatus,
  buttonTitle,
  buttonAriaLabel,
  dropdownTestId,
  optionTestIdPrefix,
  buttonClassName,
  buttonChildren,
  searchable,
  search = "",
  onSearchChange,
  searchPlaceholder,
  popoverTitle,
  emptyLabel,
}: InlineBadgeEditorProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({
    position: "fixed",
    visibility: "hidden",
  });

  useLayoutEffect(() => {
    if (!open) {
      setDropdownStyle({ position: "fixed", visibility: "hidden" });
      return;
    }

    const measure = () => {
      const trigger = triggerRef.current;
      const dropdown = dropdownRef.current;
      if (!trigger || !dropdown) return;

      const triggerRect = trigger.getBoundingClientRect();
      const dropdownRect = dropdown.getBoundingClientRect();
      const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const gutter = 8;
      const align = dropdownAlign ?? (window.matchMedia("(min-width: 640px)").matches ? "left" : "right");

      const idealLeft = align === "left"
        ? triggerRect.left
        : triggerRect.right - dropdownRect.width;
      const left = Math.min(
        Math.max(gutter, idealLeft),
        viewportWidth - gutter - dropdownRect.width,
      );

      const idealTop = triggerRect.bottom + 4;
      const wouldOverflowBottom = idealTop + dropdownRect.height > viewportHeight - gutter;
      const top = wouldOverflowBottom
        ? Math.max(gutter, triggerRect.top - 4 - dropdownRect.height)
        : idealTop;

      setDropdownStyle({
        position: "fixed",
        left: Math.max(gutter, left),
        top,
        zIndex: 1000,
        visibility: "visible",
        maxHeight: viewportHeight - gutter * 2,
        maxWidth: viewportWidth - gutter * 2,
      });
    };

    measure();
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { capture: true, passive: true });
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, { capture: true });
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
    };
  }, [dropdownAlign, open]);

  useEffect(() => {
    if (!open || !onRequestClose) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      const trigger = triggerRef.current;
      const dropdown = dropdownRef.current;
      if (trigger?.contains(target) || dropdown?.contains(target)) return;
      onRequestClose();
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, onRequestClose]);

  // The popover's own `autoFocus` does not win here: the trigger has focus from
  // the click that opened it, and the panel mounts into a portal afterwards. A
  // search box you have to click before typing is not a search box.
  // `dropdownStyle` is in the deps on purpose: the panel mounts `visibility:
  // hidden` so it can be measured, and focus() is a silent no-op on a hidden
  // element. Re-running once the measured style lands is what actually focuses.
  useEffect(() => {
    if (!open || !searchable || dropdownStyle.visibility === "hidden") return;
    const input = dropdownRef.current?.querySelector("input");
    if (input instanceof HTMLInputElement && document.activeElement !== input) input.focus();
  }, [open, searchable, dropdownStyle]);

  const selectionOptions = useMemo(() => {
    const reserveLeadingSlot = options.some((o) => o.avatar);
    return options.map((opt) => ({
      key: opt.id,
      label: opt.label,
      checked: opt.id === selectedId,
      avatar: opt.avatar,
      reserveLeadingSlot,
      onClick: () => { void onSelect(opt.id); },
    }));
  }, [options, selectedId, onSelect]);

  const dropdown = open && searchable ? (
    // Same portal and same measured position as the plain list — only the panel
    // itself is delegated. SelectionPopover brings its own popover surface, so
    // the wrapper must not draw a second frame.
    <div
      ref={dropdownRef}
      style={dropdownStyle}
      data-testid={dropdownTestId}
      onMouseDown={stopPropagation}
      onClick={stopPropagation}
    >
      <SelectionPopoverPanel
        searchable
        title={popoverTitle ?? ""}
        showHeader={!!popoverTitle}
        search={search}
        onSearchChange={onSearchChange ?? noop}
        searchPlaceholder={searchPlaceholder}
        emptyLabel={emptyLabel}
        className={`w-[240px] ${SELECTION_POPOVER_SURFACE}`}
        options={selectionOptions}
      />
    </div>
  ) : open ? (
    <DropdownMenuPopup
      ref={dropdownRef}
      style={dropdownStyle}
      className={`overflow-y-auto ${dropdownMinWidth}`}
      data-testid={dropdownTestId}
      {...dismissLayerProps}
      onMouseDown={stopPropagation}
      onClick={stopPropagation}
    >
      {options.map((opt) => (
        <InlineBadgeMenuItem
          key={opt.id}
          option={opt}
          selected={opt.id === selectedId}
          onSelect={onSelect}
          testId={optionTestIdPrefix ? `${optionTestIdPrefix}-${opt.id}` : undefined}
        />
      ))}
    </DropdownMenuPopup>
  ) : null;

  // Raft Design System › StatusChip: an editable chip is a 22px soft chip
  // with a trailing chevron. raft-ui's Badge draws the chip, its hover/press
  // overlay and its disabled state; this class only lays the trigger out and
  // carries the caller's tone class. No case transform: Title Case copy
  // ("In Progress") renders as written.
  const defaultButtonClassName = `mt-0.5 inline-flex items-center gap-1 ${badgeClassName} disabled:cursor-not-allowed${capitalize ? " capitalize" : ""}`;

  const badge = badgeStatus ? (
    <TaskStatusBadge
      status={badgeStatus}
      render={<button ref={triggerRef} type="button" disabled={disabled} />}
      onClick={onToggle}
      data-testid={buttonTestId}
      data-task-status={buttonDataTaskStatus}
      aria-label={buttonAriaLabel}
      className={`mt-0.5 ${buttonClassName ?? ""}`.trim()}
    >
      {displayValue}
      <ChevronDown size={12} aria-hidden="true" />
    </TaskStatusBadge>
  ) : (
    <Badge
      render={<button ref={triggerRef} type="button" disabled={disabled} />}
      appearance="soft"
      variant={badgeVariant}
      onClick={onToggle}
      data-testid={buttonTestId}
      data-task-status={buttonDataTaskStatus}
      data-slot="badge"
      aria-label={buttonAriaLabel}
      className={buttonClassName ?? defaultButtonClassName}
    >
      {buttonChildren ?? (
        <>
          {displayValue}
          <ChevronDown size={12} aria-hidden="true" />
        </>
      )}
    </Badge>
  );

  return (
    <>
      {buttonTitle ? <Tooltip content={buttonTitle}>{badge}</Tooltip> : badge}
      {dropdown && createPortal(dropdown, document.body)}
    </>
  );
}
