import { useCallback } from "react";
import { AppWindow } from "lucide-react";
import { IconTile, ListRow, ListRowBody, ListRowDescription, ListRowTitle } from "@botiverse/raft-ui";
import type { GrantableApp } from "./AgentAppAccessTab";

/**
 * One app to pick in the grant form: a raft-ui ListRow (a neutral IconTile,
 * the name, the description) in the form's inset list. The chosen app is the
 * cyan-soft selection of a content list. The tile is the 27px step, so the
 * hairline between options starts at its text column (16 + 27 + 12).
 */
export function GrantableAppOption({
  app,
  selected,
  onChoose,
}: {
  app: GrantableApp;
  selected: boolean;
  onChoose: (app: GrantableApp) => void;
}) {
  const handleClick = useCallback(() => onChoose(app), [onChoose, app]);
  return (
    <ListRow
      onClick={handleClick}
      selected={selected}
      aria-pressed={selected}
      className="[--list-row-rule-start:55px]"
    >
      <IconTile size="sm">
        <AppWindow />
      </IconTile>
      <ListRowBody>
        <ListRowTitle>{app.name}</ListRowTitle>
        {app.description && <ListRowDescription wrap>{app.description}</ListRowDescription>}
      </ListRowBody>
    </ListRow>
  );
}
