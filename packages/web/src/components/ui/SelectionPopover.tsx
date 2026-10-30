import { useCallback, useRef } from "react";
import type { ChangeEvent, KeyboardEvent, ReactNode, RefObject } from "react";
import { Check, Search } from "lucide-react";
import { useIntl } from "react-intl";
import { PopoverContent } from "@botiverse/raft-ui";
import { dismissLayerProps } from "./dismissLayer";

/** Raft Design System › Menu / Select popup (`rf-menu`): the popover layer,
 *  the container radius, a seam edge plus the float shadow — raft-ui's
 *  PopoverContent draws it for the positioned popover; a caller that places
 *  the bare panel itself (SelectionPopoverPanel) adds it. */
export const SELECTION_POPOVER_SURFACE =
  "rounded-container bg-layer-popover text-foreground shadow-float ring-1 ring-line-seam";

export interface SelectionPopoverOption {
  key: string;
  checked: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** A sentinel row ("Unassigned", "Anyone"): the label reads as a hint,
   *  ink-2 and never truncated. Despite the name it is not italic — the DS
   *  has no italic type. */
  italic?: boolean;
  avatar?: ReactNode;
  reserveLeadingSlot?: boolean;
  leading?: ReactNode;
}

interface SelectionPopoverBaseProps {
  title: string;
  options: SelectionPopoverOption[];
  showClear?: boolean;
  onClear?: () => void;
  showHeader?: boolean;
  emptyLabel?: string;
  className?: string;
}

interface SearchableSelectionPopoverProps extends SelectionPopoverBaseProps {
  searchable: true;
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  onInputKeyDown?: (event: KeyboardEvent<HTMLInputElement>, options: SelectionPopoverOption[]) => void;
}

interface PlainSelectionPopoverProps extends SelectionPopoverBaseProps {
  searchable?: false;
  search?: never;
  onSearchChange?: never;
  searchPlaceholder?: never;
  onInputKeyDown?: never;
}

type SelectionPopoverPanelProps = SearchableSelectionPopoverProps | PlainSelectionPopoverProps;

type SelectionPopoverProps = SelectionPopoverPanelProps & {
  /** Which edge of the trigger it lines up with (it still shifts to stay on
   *  screen). */
  align?: "start" | "end";
  /** "trigger": exactly as wide as the trigger (a field-style picker). */
  width?: "content" | "trigger";
};

/**
 * Shared option row for selection popovers.
 *
 * Every row is the same height whatever it holds: a fixed `h-9`, and a
 * `size-5` leading slot the caller can reserve so label-only rows line up with
 * avatar rows. Search channel rows pass a real leading icon instead; Tasks
 * channel rows stay label-only to match the Tasks list.
 *
 * Raft Design System › Select / Menu (`rf-menu__item`): 36 tall, 8px radius,
 * 14/20 500 ink; pointer hover is the yellow-soft highlight; the current value
 * is a trailing ink check plus bold — a check, never a fill.
 */
function SelectionPopoverOptionRow({
  checked,
  onClick,
  label,
  disabled = false,
  italic = false,
  avatar = null,
  reserveLeadingSlot = false,
  leading = null,
}: Omit<SelectionPopoverOption, "key">) {
  const leadingContent = leading ?? avatar;
  // Sentinel rows read as a hint (ink-2).
  const labelClassName = italic
    ? "whitespace-nowrap text-foreground-muted"
    : "truncate";
  // One hover token for every selection list and menu (Select,
  // SelectionPopover, InlineBadgeEditor dropdowns, sidebar action menus,
  // context menus): the DS yellow-soft highlight. A selected row gets no fill
  // of its own; the trailing check plus bold marks it.
  const rowTone = disabled
    ? "cursor-not-allowed text-foreground-disabled"
    : `text-foreground hover:bg-brand-soft focus-visible:bg-brand-soft${checked ? " font-bold" : " font-medium"}`;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex h-9 w-full items-center justify-between gap-2 overflow-hidden rounded-control px-2.5 text-left text-callout outline-none ${rowTone}`}
    >
      <span className="flex min-w-0 items-center gap-2">
        {(reserveLeadingSlot || leadingContent) && (
          <span className="flex size-5 shrink-0 items-center justify-center">
            {leadingContent}
          </span>
        )}
        <span className={labelClassName}>
          {label}
        </span>
      </span>
      {checked && <Check size={16} className="shrink-0 text-foreground" aria-hidden="true" />}
    </button>
  );
}

/**
 * The selection list positioned against its trigger. Render it inside a
 * raft-ui `<Popover open onOpenChange>` next to its `<PopoverTrigger>`: the
 * popover owns the trigger toggle, outside presses and Escape, and puts the
 * list in a portal placed by Base UI, which keeps it on screen (it shifts and
 * flips at the edge, and never grows past the space it has).
 *
 * Never position a list inline under its trigger instead (`absolute left-0
 * top-full`): near an edge it runs off the screen, and focusing its search box
 * then scrolls the clipped app column sideways — the whole page jumps.
 */
export default function SelectionPopover({
  align = "start",
  width = "content",
  className = "",
  ...panelProps
}: SelectionPopoverProps) {
  const searchRef = useRef<HTMLInputElement | null>(null);
  return (
    <PopoverContent
      align={align}
      sideOffset={8}
      collisionPadding={8}
      initialFocus={panelProps.searchable ? searchRef : undefined}
      className={`flex max-w-(--available-width) flex-col ${width === "trigger" ? "w-(--anchor-width)" : ""} ${className}`}
      {...dismissLayerProps}
    >
      <SelectionPopoverSections {...panelProps} searchRef={searchRef} />
    </PopoverContent>
  );
}

/**
 * The bare panel, for a caller that already places it (its own portal and
 * measured position). It brings no surface: pass SELECTION_POPOVER_SURFACE.
 */
export function SelectionPopoverPanel({ className = "", ...panelProps }: SelectionPopoverPanelProps) {
  return (
    <div className={`flex min-w-0 flex-col overflow-hidden ${className}`} {...dismissLayerProps}>
      <SelectionPopoverSections {...panelProps} />
    </div>
  );
}

function SelectionPopoverSections(props: SelectionPopoverPanelProps & {
  /** Set when the popover focuses the search box itself (initialFocus). */
  searchRef?: RefObject<HTMLInputElement | null>;
}) {
  const { formatMessage } = useIntl();
  const {
    title,
    options,
    showClear = false,
    onClear,
    showHeader = true,
    emptyLabel,
    searchRef,
  } = props;
  const emptyLabelText = emptyLabel ?? formatMessage({ id: "ui.selectionPopover.emptyLabel" });
  const { onSearchChange, onInputKeyDown } = props;
  const handleSearchChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    onSearchChange?.(event.target.value);
  }, [onSearchChange]);
  const handleInputKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    onInputKeyDown?.(event, options);
  }, [onInputKeyDown, options]);

  return (
    <>
      {showHeader && (
        <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-2.5 pb-1">
          <span className="text-caption font-bold text-foreground-hint">
            {title}
          </span>
          {showClear && onClear && (
            <button
              type="button"
              onClick={onClear}
              className="rounded-[2px] text-caption font-semibold text-foreground underline decoration-[1.5px] underline-offset-[3px] outline-none focus-visible:shadow-focus"
            >
              {formatMessage({ id: "ui.selectionPopover.clear" })}
            </button>
          )}
        </div>
      )}
      {props.searchable && (
        // DS menu search row: flush with the menu's edge, a hairline under it,
        // and the focus ring drawn inside the edge.
        <label className="flex h-10 shrink-0 items-center gap-2 border-b border-line-hairline px-3 text-foreground-hint focus-within:shadow-[inset_0_0_0_2px_var(--foreground)]">
          <Search size={16} className="shrink-0" aria-hidden="true" />
          <input
            ref={searchRef}
            type="text"
            // The positioned popover focuses it itself, without scrolling.
            autoFocus={!searchRef}
            value={props.search}
            onChange={handleSearchChange}
            onKeyDown={handleInputKeyDown}
            placeholder={props.searchPlaceholder ?? formatMessage({ id: "ui.selectionPopover.searchPlaceholder" })}
            className="h-full min-w-0 flex-1 bg-transparent text-callout text-foreground outline-none placeholder:text-foreground-hint"
          />
        </label>
      )}
      <div className="max-h-64 min-h-0 overflow-y-auto p-1.5">
        {options.length === 0 ? (
          <div className="px-2.5 py-2 text-callout text-foreground-hint">
            {emptyLabelText}
          </div>
        ) : (
          options.map(({ key, ...option }) => (
            <SelectionPopoverOptionRow key={key} {...option} />
          ))
        )}
      </div>
    </>
  );
}
