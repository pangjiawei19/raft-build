import { Button, IconTile, ListRow, ListRowBody, ListRowDescription, ListRowTitle } from "@botiverse/raft-ui";
import { Blocks, Check, Plus } from "lucide-react";
import type { IntlShape } from "react-intl";
import type { ManagedMcpRecommendation } from "@botiverse/raft-shared";
import { useCallback } from "react";

type McpRecommendationItemProps = {
  recommendation: ManagedMcpRecommendation;
  added: boolean;
  beginRecommendation: (recommendation: ManagedMcpRecommendation) => void;
  formatMessage: IntlShape["formatMessage"];
};

export function McpRecommendationItem({
  recommendation,
  added,
  beginRecommendation,
  formatMessage,
}: McpRecommendationItemProps) {
  const handleSelect = useCallback(() => {
    beginRecommendation(recommendation);
  }, [beginRecommendation, recommendation]);
  // Raft Design System › ListRow: raft-ui's display-only ListRow (the Add
  // button is the target) with a neutral IconTile, the name and what it does.
  return (
    <ListRow interactive={false}>
      <IconTile>
        <Blocks />
      </IconTile>
      <ListRowBody>
        <ListRowTitle>{recommendation.name}</ListRowTitle>
        <ListRowDescription wrap>{recommendation.description}</ListRowDescription>
      </ListRowBody>
      <Button
        variant="outline"
        size="sm"
        disabled={added}
        onClick={handleSelect}
      >
        {added ? <Check size={16} /> : <Plus size={16} />}
        {formatMessage({ id: added ? "agent.mcp.added" : "agent.mcp.add" })}
      </Button>
    </ListRow>
  );
}
