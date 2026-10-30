import type { LucideIcon } from "lucide-react";
import { Upload } from "lucide-react";

/**
 * The veil over an avatar you can change: the scrim (`layer-backdrop`) with
 * the action's icon in HUD ink, covering the sticker to its corners. It shows
 * on hover, on keyboard focus and the whole time `busy` is set.
 *
 * Put it after the AvatarSlot inside a `group/avatar-edit relative` trigger
 * that wraps the avatar exactly. The named group keeps an outer `group` (a
 * row, a card) from raising the veil when something else in it is hovered
 * or focused. A label trigger around a file input puts the input first and
 * marks it `peer/avatar-edit`, so its keyboard focus shows the veil through a
 * sibling selector rather than an ancestor `:has()`.
 */
export default function AvatarEditVeil({
  icon: Icon = Upload,
  busy = false,
}: {
  /** What a click does: upload (default) or open the editor (Pencil). */
  icon?: LucideIcon;
  /** Keep the veil up while the change is in flight. */
  busy?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      data-avatar-edit-veil=""
      className={`absolute inset-0 flex items-center justify-center rounded-sticker bg-layer-backdrop text-foreground-on-hud transition-opacity ${
        busy
          ? "opacity-100"
          : "opacity-0 group-hover/avatar-edit:opacity-100 group-focus-visible/avatar-edit:opacity-100 peer-focus-visible/avatar-edit:opacity-100"
      }`}
    >
      <Icon size={20} />
    </span>
  );
}
