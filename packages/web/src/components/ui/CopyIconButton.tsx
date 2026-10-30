import { Check, Copy } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";
import Tooltip from "./Tooltip";

type CopyIconButtonSurface = "dark" | "light" | "code";

interface CopyIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  copied: boolean;
  copiedLabel: string;
  copyLabel: string;
  surface?: CopyIconButtonSurface;
  iconSize?: number;
}

// Raft Design System › Code: the copy control is a quiet icon button; after a
// copy its glyph swaps to a check for a few seconds — the swap is the signal,
// no colour change. `code` follows the code palette (index.css .r-code-copy);
// `dark` sits on the dark HUD-style surfaces; `light` on paper/surface.
const surfaceClasses: Record<CopyIconButtonSurface, { copied: string; idle: string }> = {
  code: {
    copied: "r-code-copy r-code-copy--copied",
    idle: "r-code-copy",
  },
  dark: {
    copied: "text-foreground-on-hud",
    idle: "text-foreground-on-hud/0 group-hover:text-foreground-on-hud/70 hover:!text-foreground-on-hud [@media(hover:none)]:text-foreground-on-hud/70",
  },
  light: {
    copied: "text-foreground",
    idle: "text-foreground-hint hover:bg-fill-pressed hover:text-foreground",
  },
};

export default function CopyIconButton({
  copied,
  copiedLabel,
  copyLabel,
  surface = "light",
  iconSize = 14,
  className = "",
  type = "button",
  ...props
}: CopyIconButtonProps) {
  const toneClass = copied ? surfaceClasses[surface].copied : surfaceClasses[surface].idle;

  return (
    <Tooltip content={copied ? copiedLabel : copyLabel}>
      <button
        type={type}
        className={`flex size-6 items-center justify-center rounded-sticker transition-colors outline-none focus-visible:shadow-focus ${toneClass} ${className}`}
        aria-label={copied ? copiedLabel : copyLabel}
        {...props}
      >
        {copied ? <Check size={iconSize} /> : <Copy size={iconSize} />}
      </button>
    </Tooltip>
  );
}
