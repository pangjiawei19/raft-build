import { Bot, TriangleAlert, X } from "lucide-react";
import { useMemo } from "react";
import { PanelAction } from "@botiverse/raft-ui";
import { useIntl } from "react-intl";
import { useMobileBack } from "../../hooks/useAppNavigate";
import { useServerStore } from "../../store/serverStore";
import EmptyState from "../ui/EmptyState";
import PanelHeader from "../ui/PanelHeader";
import Tooltip from "../ui/Tooltip";

export default function AgentUnavailablePanel({ onClose }: { onClose?: () => void }) {
  const { formatMessage } = useIntl();
  const slug = useServerStore((s) => s.current?.slug);
  const onMobileBack = useMobileBack(onClose ?? (slug ? `/s/${slug}/members` : "/"));
  const mobileBackProps = useMemo(
    () => ({
      "data-testid": "agent-mobile-back",
      title: formatMessage({ id: "common.announcement.back" }),
    }),
    [formatMessage],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-layer-canvas">
      <PanelHeader
        title={formatMessage({ id: "agent.detail.unavailableTitle" })}
        onMobileBack={onMobileBack}
        mobileBackProps={mobileBackProps}
        icon={<Bot size={18} />}
        actions={onClose ? (
          <Tooltip content={formatMessage({ id: "common.close" })}>
            <PanelAction
              onClick={onClose}
              className="hidden md:flex"
              aria-label={formatMessage({ id: "common.close" })}
            >
              <X />
            </PanelAction>
          </Tooltip>
        ) : null}
      />
      <EmptyState
        className="flex flex-1 flex-col justify-center"
        icon={<TriangleAlert size={36} />}
        title={formatMessage({ id: "agent.detail.unavailableTitle" })}
        description={formatMessage({ id: "agent.detail.unavailableDescription" })}
        data-testid="agent-unavailable-panel"
      />
    </div>
  );
}
