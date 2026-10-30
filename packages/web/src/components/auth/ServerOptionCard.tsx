import { ListRow, ListRowBody, ListRowChevron, ListRowMeta, ListRowTitle } from "@botiverse/raft-ui";
import type { Server } from "../../store/serverStore";
import { useCallback } from "react";
import AvatarSlot from "../ui/AvatarSlot";

/**
 * One server in the "choose a server" list: Raft Design System › ListRow in an
 * inset list (raft-ui ListRow; the caller's ListRowGroup is the card and draws
 * the hairlines between rows). The workspace tile (the square sticker every
 * workspace wears), the name and the slug in machine type, and the chevron of
 * a row that goes somewhere. The whole row is the button: hover and press lay
 * the pressed overlay, and while a switch is pending the row is disabled. It
 * is a place to go, not a choice inside a form, so it is not the `option`
 * card.
 */
export function ServerOptionCard({
  server,
  switchPending,
  onSelect,
}: {
  server: Server;
  switchPending: boolean;
  onSelect: (server: Server) => void;
}) {
  const handleClick = useCallback(() => {
    onSelect(server);
  }, [onSelect, server]);
  return (
    <ListRow
      onClick={handleClick}
      disabled={switchPending}
      data-testid="server-selector-option"
    >
      <span className="shrink-0" aria-hidden="true">
        <AvatarSlot
          context="list-row"
          type="server"
          serverAvatarUrl={server.avatarUrl}
          serverInitial={server.name.slice(0, 1)}
        />
      </span>
      <ListRowBody>
        <ListRowTitle>{server.name}</ListRowTitle>
        <ListRowMeta>/{server.slug}</ListRowMeta>
      </ListRowBody>
      <ListRowChevron />
    </ListRow>
  );
}
