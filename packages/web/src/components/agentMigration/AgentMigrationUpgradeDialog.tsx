import { useIntl } from "react-intl";
import ConfirmDialog from "../ConfirmDialog";

export function AgentMigrationUpgradeDialog({
  onClose,
  onViewPlans,
}: {
  onClose: () => void;
  onViewPlans: () => void;
}) {
  const { formatMessage } = useIntl();
  return (
    <ConfirmDialog
      title={formatMessage({ id: "agent.migration.proRequired.title" })}
      message={(
        <p>
          {formatMessage({ id: "agent.migration.proRequired.description" })}
        </p>
      )}
      confirmLabel={formatMessage({ id: "agent.migration.proRequired.viewPlans" })}
      confirmVariant="accent"
      onConfirm={onViewPlans}
      onClose={onClose}
      plainMessage
      chromeLocale="active"
      maxWidthClass="max-w-md"
    />
  );
}
