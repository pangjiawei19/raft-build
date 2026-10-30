import { X } from "lucide-react";
import { Button } from "@botiverse/raft-ui";
import type { ButtonProps } from "@botiverse/raft-ui";
import { useIntl } from "react-intl";

/** Dismissal is a quiet icon action; the primary action owns the filled button.
 *  Raft Design System › IconButton: a borderless ink glyph whose hover/press is
 *  the pressed wash — the raft-ui ghost recipe draws exactly that, so only
 *  layout classes travel through `className`. */
export default function CloseButton({ children, className = "", ...props }: ButtonProps) {
  const { formatMessage } = useIntl();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={formatMessage({ id: "common.close" })}
      {...props}
      className={className}
    >
      {children ?? <X size={16} />}
    </Button>
  );
}
