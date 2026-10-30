import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ListRow, ListRowBody, ListRowMeta, ListRowTitle } from "@botiverse/raft-ui";
import SurfaceListItem from "./SurfaceListItem";
import Tooltip from "./Tooltip";

const NO_BUTTON_PROPS: ButtonHTMLAttributes<HTMLButtonElement> = {};

/**
 * Canonical "row with an avatar on the left" for detail / profile pages: the
 * pattern visible as `AGENTS ON THIS COMPUTER` rows in MachineDetailPanel.
 *
 * Per stdrc 2026-05-11 #wg-theme:eb11794c ("所有在 detail/profile 之类页面
 * 列出 agent、human 列表的地方，item 都应该复用 AGENTS ON THIS COMPUTER
 * 这个区域的那个 list item。组件化."): every place that lists agents or
 * humans inside a detail / profile panel should reuse this single row.
 *
 * Raft Design System › ListRow: "资料页、电脑详情里列 agent 和人：一律是放在
 * `rf-list--inset` 里的这一种行". The row is raft-ui `ListRow` — the caller
 * puts a list of them in a raft-ui `ListRowGroup` (the inset card), which
 * draws the hairlines between rows from the text edge (63px). Hover and
 * press lay the pressed overlay, the open/selected item is cyan-soft, and a
 * disabled row greys every part.
 *
 * **Slot contract** (every slot is a `ReactNode`, the primitive does NOT
 * own the participant kind — callers pass `<AvatarSlot type="agent|human">`
 * themselves so this stays orthogonal to the avatar primitive):
 *
 * - `avatar` — the leading block. Almost always `<AvatarSlot context="list-row" ...>`.
 *   Required.
 * - `name` — the row title (`ListRowTitle`: 16/24 600, one line).
 *   Required.
 * - `subtitle` — the second line (runtime label, email, role label, slug):
 *   machine text, `ListRowMeta` (Space Mono 12/16 in the row's ink-3).
 *   Optional.
 * - `rightContent` — trailing content: `<StatusDot>` plus an activity label,
 *   or a Remove / Demote button on a static row. Optional.
 *
 * **Interactive vs static**:
 *
 * - With `onClick` the row is a `<button>` (raft-ui ListRow: the whole row is
 *   the target).
 * - Without `onClick` it is a display-only `<div>` (`interactive={false}`): no
 *   hover or press, and its own controls (`rightContent`, `actionContent`)
 *   are the targets. Use this for SettingsPanel admin rows.
 * - `onClick` plus `actionContent` (a clickable body with separate trailing
 *   actions: the channel files row) is not a list row — a ListRow is one
 *   target — so it keeps its own card (SurfaceListItem) with the body button
 *   and the action buttons as siblings.
 *
 * **Selection mode** (MachineDetail's checkbox-mode bulk-select) is
 * intentionally NOT part of this primitive. Selection adds a leading
 * checkbox column and a different click handler — the caller composes the
 * same ListRow parts around it.
 */
export interface AvatarListRowProps {
  avatar: ReactNode;
  name: ReactNode;
  subtitle?: ReactNode;
  rightContent?: ReactNode;
  /** When set, the row renders as a clickable `<button>`. */
  onClick?: () => void;
  /** The item open next to the list (or picked): the DS cyan-soft selection.
   *  Say why with `aria-current` / `aria-pressed` in `buttonProps`. */
  selected?: boolean;
  /** Cross-axis alignment of the row contents.
   *
   *  - `"center"` (default).
   *  - `"start"` — top-aligns the avatar and the text. Use when the avatar
   *    is visually taller than the text column (e.g. a tall file
   *    thumbnail), per stdrc 2026-05-10 #wg-theme:7470ca2a
   *    ("头像在左边都应顶在左上角"). The trailing slots stay vertically
   *    centred either way, per stdrc 2026-05-15 #wg-theme:25bb834a.
   */
  align?: "start" | "center";
  /** Trailing controls. On a static row they simply follow `rightContent`;
   *  with `onClick` they render as siblings of the row button (NOT inside
   *  it), so a Download / Remove button stays its own click target. */
  actionContent?: ReactNode;
  /** Extra classes on the row (a state wash such as a bulk-action highlight). */
  className?: string;
  /** Extra props for the row element (e.g. `data-testid`, `aria-label`,
   *  `title`, `disabled`, `aria-pressed`). `title` becomes a Tooltip. */
  buttonProps?: ButtonHTMLAttributes<HTMLButtonElement> & Record<`data-${string}`, string | undefined>;
}

export default function AvatarListRow({
  avatar,
  name,
  subtitle,
  rightContent,
  onClick,
  selected = false,
  align = "center",
  actionContent,
  className = "",
  buttonProps,
}: AvatarListRowProps) {
  const interactive = onClick !== undefined;
  const hasSubtitle = subtitle != null && subtitle !== false;
  const hasRight = rightContent != null && rightContent !== false;
  const hasAction = actionContent != null && actionContent !== false;
  // Route buttonProps.title through the RUI Tooltip instead of the native
  // attribute (title= migration); all other buttonProps pass through.
  const { title: buttonTitle, ...restButtonProps } = buttonProps ?? NO_BUTTON_PROPS;

  if (interactive && hasAction) {
    return (
      <AvatarCardRow
        avatar={avatar}
        name={name}
        subtitle={hasSubtitle ? subtitle : null}
        rightContent={hasRight ? rightContent : null}
        onClick={onClick}
        selected={selected}
        align={align}
        actionContent={actionContent}
        className={className}
        buttonTitle={buttonTitle}
        buttonProps={restButtonProps}
      />
    );
  }

  const rowClassName = [align === "start" ? "items-start" : "", className].join(" ").trim();
  const row = (
    <ListRow
      {...restButtonProps}
      interactive={interactive}
      selected={selected}
      onClick={onClick}
      className={rowClassName || undefined}
    >
      {avatar}
      <ListRowBody>
        <ListRowTitle>{name}</ListRowTitle>
        {hasSubtitle && <ListRowMeta>{subtitle}</ListRowMeta>}
      </ListRowBody>
      {hasRight && <span className="flex shrink-0 self-center items-center gap-1.5">{rightContent}</span>}
      {hasAction && <span className="flex shrink-0 self-center items-center gap-1.5">{actionContent}</span>}
    </ListRow>
  );
  return buttonTitle && interactive ? <Tooltip content={buttonTitle}>{row}</Tooltip> : row;
}

/** The channel files card: a clickable body with its own trailing actions. */
function AvatarCardRow({
  avatar,
  name,
  subtitle,
  rightContent,
  onClick,
  selected,
  align,
  actionContent,
  className,
  buttonTitle,
  buttonProps,
}: {
  avatar: ReactNode;
  name: ReactNode;
  subtitle: ReactNode;
  rightContent: ReactNode;
  onClick: () => void;
  selected: boolean;
  align: "start" | "center";
  actionContent: ReactNode;
  className: string;
  buttonTitle: string | undefined;
  buttonProps: ButtonHTMLAttributes<HTMLButtonElement>;
}) {
  const itemsAlignClass = align === "start" ? "items-start" : "items-center";
  // When the row is `align="start"`, the text column stacks name + subtitle
  // vertically (filename on top, metadata wrapping below) rather than the
  // default inline flex-wrap row.
  const textColumn = (
    <div className="min-w-0 flex-1">
      {align === "start" ? (
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-body font-semibold text-foreground">{name}</span>
          {subtitle != null && (
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-mono-meta text-foreground-hint">
              {subtitle}
            </span>
          )}
        </div>
      ) : (
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="truncate text-body font-semibold text-foreground">{name}</span>
          {subtitle != null && (
            <span className="font-mono text-mono-meta text-foreground-hint">{subtitle}</span>
          )}
        </div>
      )}
    </div>
  );
  const rowButton = (
    <button
      {...buttonProps}
      type="button"
      onClick={onClick}
      className={`flex min-w-0 flex-1 gap-3 rounded-control text-left outline-none focus-visible:shadow-focus ${itemsAlignClass}`}
    >
      {avatar}
      {textColumn}
      {rightContent != null && (
        // `self-center` overrides the outer `items-start` cross-axis
        // alignment when the row is `align="start"` (tall avatar) so the
        // rightContent slot stays vertically centered like the action
        // slot below, per stdrc 2026-05-15 #wg-theme:25bb834a
        // ("这个组件的按钮都应该是垂直居中").
        <div className="flex shrink-0 self-center items-center gap-1.5">{rightContent}</div>
      )}
    </button>
  );
  return (
    <SurfaceListItem selected={selected} className={`group px-4 py-3 ${className}`}>
      <div className={`flex w-full min-w-0 gap-3 ${itemsAlignClass}`}>
        {buttonTitle ? <Tooltip content={buttonTitle}>{rowButton}</Tooltip> : rowButton}
        {/* Action slot always vertically centers itself, even when the row
            is `align="start"` (tall avatar) — keeps icon-btn pairs from
            hugging the top edge per stdrc 2026-05-15 #wg-theme:25bb834a
            ("右边的按钮应该垂直居中"). */}
        <div className="flex shrink-0 self-center items-center gap-1.5">{actionContent}</div>
      </div>
    </SurfaceListItem>
  );
}
