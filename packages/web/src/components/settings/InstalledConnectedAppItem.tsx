import { Button } from "@botiverse/raft-ui";
import { useCallback } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Pencil } from "lucide-react";
import { useIntl } from "react-intl";
import SurfaceListItem from "../ui/SurfaceListItem";
import { CONNECTED_APP_CATEGORY_LABEL_ID, ConnectedAppDistributionBadge, ConnectedAppLogo, ConnectedAppOriginBadges, ConnectedAppSummary, ConnectedAppUrlLink } from "./SettingsPanel";
import type { ConnectedAppsViewMode, InstalledConnectedApp } from "./SettingsPanel";

export function InstalledConnectedAppItem({
  app,
  viewMode,
  canManage,
  uninstalling,
  onOpen,
  onEdit,
  onRequestUninstall,
}: {
  app: InstalledConnectedApp;
  viewMode: ConnectedAppsViewMode;
  canManage: boolean;
  uninstalling: boolean;
  onOpen: (app: InstalledConnectedApp) => void;
  onEdit: (app: InstalledConnectedApp) => void;
  onRequestUninstall: (app: InstalledConnectedApp) => void;
}) {
  const { formatMessage } = useIntl();
  const handleEdit = useCallback(() => onEdit(app), [app, onEdit]);
  const handleRequestUninstall = useCallback((event: ReactMouseEvent) => {
    event.stopPropagation();
    onRequestUninstall(app);
  }, [app, onRequestUninstall]);

  return (
    <SurfaceListItem
      interactive={false}
      className={viewMode === "grid"
 ? "flex min-h-[184px] w-full flex-col gap-3"
 : "flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <ConnectedAppLogo name={app.name} logoUrl={app.logoUrl} seed={app.defaultLogoSeed} size="sm" />
        <div className="min-w-0 flex-1">
          {app.editable ? (
            <div className="min-w-0 break-words text-body font-semibold text-foreground">{app.name}</div>
          ) : (
            <div
              role="button"
              tabIndex={0}
              aria-label={app.name}
              onClick={() => onOpen(app)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
                event.preventDefault();
                onOpen(app);
              }}
              className="w-fit max-w-full break-words rounded-sticker text-body font-semibold text-foreground decoration-[1.5px] underline-offset-[3px] outline-none hover:underline focus-visible:shadow-focus"
            >
              {app.name}
            </div>
          )}
          <div className="mt-0.5 text-footnote text-foreground-muted">
            <span>{formatMessage({ id: CONNECTED_APP_CATEGORY_LABEL_ID[app.category] ?? "settings.connectedApps.categoryOther" })}</span>
            <span aria-hidden="true"> · </span>
            <span>{app.developer}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <ConnectedAppDistributionBadge status={app.publishStatus} />
            <ConnectedAppOriginBadges app={app} />
          </div>
          {viewMode === "list" && (
            <ConnectedAppSummary description={app.description} />
          )}
          {viewMode === "grid" && (
            <ConnectedAppUrlLink url={app.homepageUrl} label={app.homepageDomain} className="mt-1" />
          )}
        </div>
      </div>
      {canManage && (app.editable ? (
        <Button size="sm" variant="outline"
          type="button"
          onClick={handleEdit}
          className={`w-fit ${viewMode === "grid" ? "mt-auto self-end" : "self-end sm:self-auto"}`}
        >
          <Pencil size={14} />
          {formatMessage({ id: "settings.connectedApps.edit" })}
        </Button>
      ) : (
        <div className={`flex w-full flex-wrap justify-end gap-2 sm:w-auto ${viewMode === "grid" ? "mt-auto self-end" : "self-end sm:self-auto"}`}>
          <Button
            variant="outline" size="sm"
            type="button"
            onClick={handleRequestUninstall}
            disabled={uninstalling}
          >
            {uninstalling ? formatMessage({ id: "settings.connectedApps.uninstalling" }) : formatMessage({ id: "settings.connectedApps.uninstall" })}
          </Button>
        </div>
      ))}
    </SurfaceListItem>
  );
}
