import { Button } from "@botiverse/raft-ui";
import Tooltip from "../ui/Tooltip";
import { useCallback } from "react";
import { X } from "lucide-react";
import { useIntl } from "react-intl";
import type { PendingInvite } from "./SettingsPanel";

export function PendingInviteRow({
  invite,
  onRequestRevoke,
}: {
  invite: PendingInvite;
  onRequestRevoke: (invite: PendingInvite) => void;
}) {
  const { formatDate, formatMessage } = useIntl();
  const handleRequestRevoke = useCallback(() => onRequestRevoke(invite), [invite, onRequestRevoke]);

  return (
    <div className="flex min-h-11 items-center gap-3 py-2 first:pt-0 last:pb-0">
      <span className="min-w-0 flex-1 truncate text-callout text-foreground">
        {invite.invitedEmail}
      </span>
      <span className="shrink-0 font-mono text-mono-meta text-foreground-hint">
        {formatDate(invite.createdAt, {
          month: "short",
          day: "numeric",
        })}
      </span>
      <Tooltip content={formatMessage({ id: "settings.invites.revokeInviteTitle" })}>
      <Button
        variant="outline" size="icon-sm" type="button"
        onClick={handleRequestRevoke}
        className="shrink-0"
        aria-label={formatMessage({ id: "settings.invites.revokeInviteTitle" })}
        data-slot="button"
      >
        <X size={14} />
      </Button>
      </Tooltip>
    </div>
  );
}
