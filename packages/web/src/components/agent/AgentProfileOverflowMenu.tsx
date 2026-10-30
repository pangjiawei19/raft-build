import { EllipsisVertical, Play, RotateCcw, Square } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DirectMessageIcon,
  PanelAction,
} from "@botiverse/raft-ui";
import { useIntl } from "react-intl";
import Tooltip from "../ui/Tooltip";

interface AgentProfileOverflowMenuProps {
  canMessageAgent: boolean;
  canControlAgentRuntime: boolean;
  isOnline: boolean;
  messageLabel: string;
  onMessage: () => void;
  onStartStop: () => void;
  onRestartReset: () => void;
  /** A hosted agent: its only runtime command, stop the running turn. */
  onStopHostedTurn?: () => void;
  /**
   * Keep the high-frequency commands visible while the containing panel has
   * room, and collapse them into the overflow menu as that panel narrows.
   * The default remains the menu-only primitive for existing callers.
   */
  responsive?: boolean;
}

// The profile action strip sits flush against the top edge of its panel.
// RUI's tooltip defaults to `side="top"`; at this edge collision shifting
// can keep the popup inside the viewport by moving it back over the
// trigger. Use the documented panel-header direction so the label always
// clears the action button instead of occluding it.
const PROFILE_TOOLTIP_CONTENT_PROPS = { side: "bottom" as const };

/**
 * Immediate Agent Profile commands belong in the same lightweight command
 * menu as Thread topbar actions. Structural navigation (Back / Close) stays
 * outside the menu, while unavailable commands are omitted instead of shown
 * disabled.
 */
export default function AgentProfileOverflowMenu({
  canMessageAgent,
  canControlAgentRuntime,
  isOnline,
  messageLabel,
  onMessage,
  onStartStop,
  onRestartReset,
  onStopHostedTurn,
  responsive = false,
}: AgentProfileOverflowMenuProps) {
  const { formatMessage } = useIntl();
  const menuLabel = formatMessage({ id: "agent.detail.moreActions" });
  const startStopLabel = formatMessage({
    id: isOnline ? "agent.detail.stopAgent" : "agent.detail.startAgent",
  });
  const restartResetLabel = formatMessage({ id: "agent.detail.restartReset" });
  const stopHostedTurnLabel = formatMessage({ id: "agent.detail.stopHostedTurn" });

  if (!canMessageAgent && !canControlAgentRuntime && !onStopHostedTurn) return null;

  // Header icon buttons are raft-ui PanelAction (44 on a phone, the DS small
  // 32 on desktop); the group keeps the panel head's action gap.
  const inlineActions = (
    <div
      className="agent-profile-inline-actions hidden items-center gap-0.5 md:gap-1"
      data-testid="agent-profile-inline-actions"
    >
      {canMessageAgent && (
        <Tooltip content={messageLabel} contentProps={PROFILE_TOOLTIP_CONTENT_PROPS}>
          <PanelAction
            aria-label={messageLabel}
            onClick={onMessage}
            data-testid="agent-profile-inline-message"
          >
            <DirectMessageIcon />
          </PanelAction>
        </Tooltip>
      )}
      {canControlAgentRuntime && (
        <>
          <Tooltip content={startStopLabel} contentProps={PROFILE_TOOLTIP_CONTENT_PROPS}>
            <PanelAction
              aria-label={startStopLabel}
              onClick={onStartStop}
              data-testid="agent-profile-inline-start-stop"
            >
              {isOnline ? <Square /> : <Play />}
            </PanelAction>
          </Tooltip>
          <Tooltip content={restartResetLabel} contentProps={PROFILE_TOOLTIP_CONTENT_PROPS}>
            <PanelAction
              aria-label={restartResetLabel}
              onClick={onRestartReset}
              data-testid="agent-profile-inline-restart-reset"
            >
              <RotateCcw />
            </PanelAction>
          </Tooltip>
        </>
      )}
      {onStopHostedTurn && (
        <Tooltip content={stopHostedTurnLabel} contentProps={PROFILE_TOOLTIP_CONTENT_PROPS}>
          <PanelAction
            aria-label={stopHostedTurnLabel}
            onClick={onStopHostedTurn}
            data-testid="agent-profile-inline-stop-hosted-turn"
          >
            <Square />
          </PanelAction>
        </Tooltip>
      )}
    </div>
  );

  const overflowMenu = (
    <div className={responsive ? "agent-profile-overflow-actions" : undefined}>
      <DropdownMenu>
        <Tooltip content={menuLabel} contentProps={PROFILE_TOOLTIP_CONTENT_PROPS}>
          <DropdownMenuTrigger
            render={(
              <PanelAction
                aria-label={menuLabel}
                data-testid="agent-profile-overflow-trigger"
              >
                <EllipsisVertical />
              </PanelAction>
            )}
          />
        </Tooltip>
        <DropdownMenuContent
          side="bottom"
          align="end"
          sideOffset={4}
              aria-label={menuLabel}
          data-testid="agent-profile-overflow-menu"
        >
          {canMessageAgent && (
            <DropdownMenuItem
              onClick={onMessage}
              data-testid="agent-profile-overflow-message"
            >
              <DirectMessageIcon />
              {messageLabel}
            </DropdownMenuItem>
          )}
          {canControlAgentRuntime && (
            <DropdownMenuItem
              onClick={onStartStop}
              data-testid="agent-profile-overflow-start-stop"
            >
              {isOnline ? <Square /> : <Play />}
              {formatMessage({
                id: isOnline ? "agent.detail.stopAgent" : "agent.detail.startAgent",
              })}
            </DropdownMenuItem>
          )}
          {canControlAgentRuntime && (
            <DropdownMenuItem
              onClick={onRestartReset}
              data-testid="agent-profile-overflow-restart-reset"
            >
              <RotateCcw />
              {formatMessage({ id: "agent.detail.restartReset" })}
            </DropdownMenuItem>
          )}
          {onStopHostedTurn && (
            <DropdownMenuItem
              onClick={onStopHostedTurn}
              data-testid="agent-profile-overflow-stop-hosted-turn"
            >
              <Square />
              {stopHostedTurnLabel}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  if (responsive) {
    return (
      <div className="agent-profile-responsive-actions" data-testid="agent-profile-responsive-actions">
        {inlineActions}
        {overflowMenu}
      </div>
    );
  }

  return overflowMenu;
}
