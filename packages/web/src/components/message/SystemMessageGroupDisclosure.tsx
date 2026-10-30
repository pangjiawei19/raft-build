import type { ReactNode } from "react";
import {
  SystemMessageGroup,
  SystemMessageGroupChevron,
  SystemMessageGroupDisclosure,
  SystemMessageGroupHeader,
  SystemMessageGroupPanel,
  SystemMessageGroupSummary,
} from "@botiverse/raft-ui";
import Tooltip from "../ui/Tooltip";

type SystemMessageGroupDisclosureWrapperProps = {
  summary: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
};

export default function ConnectedSystemMessageGroupDisclosure({
  summary,
  expanded,
  onToggle,
  children,
}: SystemMessageGroupDisclosureWrapperProps) {
  return (
    <SystemMessageGroup
      open={expanded}
      onOpenChange={onToggle}
      // The group layer carries no margins of its own (Josh's table): the
      // note rhythm owns both seams, and the inner rows re-assert their own
      // 4px lead against the single-note value.
      className="[&_[data-slot=system-message-item]]:pt-1"
    >
      <SystemMessageGroupHeader>
        <Tooltip content={summary}>
          <SystemMessageGroupDisclosure
            data-testid="system-message-group-toggle"
            aria-expanded={expanded}
          >
            <SystemMessageGroupSummary>{summary}</SystemMessageGroupSummary>
            <SystemMessageGroupChevron />
          </SystemMessageGroupDisclosure>
        </Tooltip>
      </SystemMessageGroupHeader>
      <SystemMessageGroupPanel data-testid="system-message-group-details">
        {children}
      </SystemMessageGroupPanel>
    </SystemMessageGroup>
  );
}
