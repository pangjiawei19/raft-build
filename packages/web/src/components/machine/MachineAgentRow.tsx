import { CheckboxIndicator, ListRow, ListRowBody, ListRowMeta, ListRowTitle } from "@botiverse/raft-ui";
import type { Agent, AgentDisplayState } from "../../store/agentStore";
import AvatarListRow from "../ui/AvatarListRow";
import AvatarSlot from "../ui/AvatarSlot";
import StatusDot from "../ui/StatusDot";
import Tooltip from "../ui/Tooltip";
import { agentModelLabel } from "../../utils/agentModelName";
import { formatActivityText } from "../../utils/activity";
import { formatRuntimeLabelWithStatus } from "../../utils/runtimeAvailabilityLabel";
import { useCallback } from "react";
import { useIntl } from "react-intl";

const BULK_HIGHLIGHT_BUTTON_PROPS = { "data-bulk-highlight": "true" } as const;

export function MachineAgentRow({
  agent,
  displayState,
  selectionMode,
  selected,
  canManageMachines,
  onToggleSelection,
  onOpenAgent,
  highlighted = false,
}: {
  agent: Agent;
  displayState: AgentDisplayState;
  selectionMode: boolean;
  selected: boolean;
  canManageMachines: boolean;
  onToggleSelection: (agentId: string) => void;
  onOpenAgent: (agentId: string) => void;
  /** Briefly marks a row just changed by a bulk action (3 s, one-shot). */
  highlighted?: boolean;
}) {
  const { formatMessage } = useIntl();
  const agentId = agent.id;
  const handleToggleSelection = useCallback(() => onToggleSelection(agentId), [agentId, onToggleSelection]);
  const handleOpenAgent = useCallback(() => onOpenAgent(agentId), [agentId, onOpenAgent]);
  // A Computer page is where these agent identities are managed:
  // show the model alongside the runtime (artin 2026-09-27), not
  // only the chat-side "Show agent model" preference.
  const agentIdentityLabel = [
    formatRuntimeLabelWithStatus(agent.runtime, formatMessage),
    agentModelLabel(agent),
  ].filter(Boolean).join(" · ");
  const activityText = formatActivityText(
    formatMessage,
    displayState.activity,
    displayState.activityDetail,
    displayState.activityDetailKind,
  );
  const avatar = <AvatarSlot context="list-row" type="agent" agentAvatarUrl={agent.avatarUrl} />;
  const rightStatus = (
    <>
      <StatusDot activity={displayState.activity} title={activityText} />
      <Tooltip content={activityText}><span
        className="hidden max-w-[min(32rem,42vw)] truncate align-middle font-mono text-mono-meta text-foreground-hint sm:inline-block"
      >
        {activityText}
      </span></Tooltip>
    </>
  );
  if (selectionMode) {
    // Selection mode adds a leading checkbox to the same raft-ui ListRow the
    // normal-mode AvatarListRow draws (avatar / name / subtitle / status):
    // the row toggles the selection, and a selected row is the cyan-soft
    // selection.
    return (
      <Tooltip content={
          selected
            ? formatMessage({ id: "machine.detail.deselectAgent" })
            : formatMessage({ id: "machine.detail.selectAgent" })
        }>
      <ListRow
        selected={canManageMachines && selected}
        onClick={handleToggleSelection}
        // `group`: CheckboxIndicator's previewOnHover hook (group-hover).
        className="group"
        aria-label={
          selected
            ? formatMessage({ id: "machine.detail.deselectAgentName" }, { name: agent.displayName || agent.name })
            : formatMessage({ id: "machine.detail.selectAgentName" }, { name: agent.displayName || agent.name })
        }
      >
        <CheckboxIndicator
          checked={selected}
          previewOnHover
          className="mt-0"
        />
        {avatar}
        <ListRowBody>
          <ListRowTitle>{agent.displayName || agent.name}</ListRowTitle>
          <ListRowMeta>{agentIdentityLabel}</ListRowMeta>
        </ListRowBody>
        <span className="flex shrink-0 items-center gap-1.5">{rightStatus}</span>
      </ListRow>
      </Tooltip>
    );
  }
  return (
    <AvatarListRow
      avatar={avatar}
      name={agent.displayName || agent.name}
      subtitle={agentIdentityLabel}
      rightContent={rightStatus}
      onClick={handleOpenAgent}
      selected={false}
      buttonProps={highlighted ? BULK_HIGHLIGHT_BUTTON_PROPS : undefined}
      // A row a bulk action just changed: a lime-soft wash that fades back
      // (soft washes are highlights, no edge).
      className={highlighted
        ? "bg-success-soft duration-300 motion-reduce:transition-none"
        : "duration-300 motion-reduce:transition-none"}
    />
  );
}
