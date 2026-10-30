import { Button, Card, IconTile, ListRow, ListRowBody, ListRowDescription, ListRowGroup, ListRowTitle } from "@botiverse/raft-ui";
import { Monitor, Plus, RefreshCw } from "lucide-react";
import { useCallback, useMemo } from "react";
import type { MouseEvent } from "react";
import { useIntl } from "react-intl";
import { useLocation } from "react-router-dom";
import { useMachineStore } from "../../store/machineStore";
import { useServerStore } from "../../store/serverStore";
import { useServerPermissions } from "../../hooks/useServerPermissions";
import { useAppNavigate, useMobileBack } from "../../hooks/useAppNavigate";
import Banner from "../ui/Banner";
import EmptyState from "../ui/EmptyState";
import PanelHeader from "../ui/PanelHeader";
import StatusDot from "../ui/StatusDot";
import { SkeletonRow } from "../ui/Skeleton";
import { MachineRunLabel } from "./MachineRunLabel";
import {
  getComputerAttentionStatus,
  getComputerRowDotStatus,
  getComputerRowDotTitleDescriptor,
  getComputerRowDotLight,
} from "../../utils/computerUpgradeIndicator";
import { getComputerAvailableVersion } from "../../utils/computerVersionFact";
import { machineDiskLowPresentation } from "../../utils/machineDiskPresentation";

/**
 * Mobile-only Computers panel — renders as a regular detail panel (the
 * shared PanelHeader over a paper body) so /computers visually matches other
 * Settings sub-pages like Account / Browser / Server. Reported as a styling
 * inconsistency by @stdrc 2026-05-01 `#proj-uiux:c8711d2a` msg 2a500cb7 —
 * previously /computers on mobile rendered via the Sidebar's inline branch,
 * which read as sidebar navigation rather than a page.
 *
 * Raft Design System › ListRow: the computers are one inset list (surface,
 * hairline, container radius) of 64-tall rows — a neutral square tile with
 * the presence pixel, the name 16/24 600, the description 14/20 ink-2, the
 * run label in Space Mono. Hairlines between rows start at the text edge.
 *
 * Desktop still uses the Sidebar's dedicated Computers rail column;
 * only mobile routes /computers here.
 */
const SKELETON_LINE_WIDTHS = ["w-2/5", "w-3/5"];

export default function MobileComputersPanel() {
  const { formatMessage } = useIntl();
  const machines = useMachineStore((s) => s.machines);
  const latestComputerVersion = useMachineStore((s) => s.latestComputerVersion);
  const machinesLoading = useMachineStore((s) => s.loading);
  const machineLoadStatus = useMachineStore((s) => s.loadStatus);
  const machineLoadError = useMachineStore((s) => s.loadError);
  const loadMachines = useMachineStore((s) => s.loadMachines);
  const setShowAddMachine = useMachineStore((s) => s.setShowAddMachine);
  const serverSlug = useServerStore((s) => s.current?.slug);
  const { capabilities } = useServerPermissions();
  const canRegisterMachines = capabilities.registerMachines;
  const nav = useAppNavigate();
  const location = useLocation();
  const attentionOnly = new URLSearchParams(location.search).get("filter") === "attention";
  const visibleMachines = attentionOnly
    ? machines.filter((machine) => getComputerAttentionStatus(machine) !== "none")
    : machines;
  // Computers is a level-2 view under Settings on mobile; back pops
  // to the Settings tab home (or app root if serverSlug is missing).
  const onMobileBack = useMobileBack(serverSlug ? `/s/${serverSlug}/settings` : "/");
  const mobileBackProps = useMemo(
    () => ({ "data-testid": "computers-mobile-back", title: formatMessage({ id: "common.announcement.back" }) }),
    [formatMessage],
  );
  const retryLoadMachines = useCallback(() => {
    void loadMachines();
  }, [loadMachines]);
  const openComputer = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    const machineId = event.currentTarget.dataset.machineId;
    if (machineId) nav.toComputer(machineId);
  }, [nav]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="mobile-computers-panel">
      {/* Header — uses canonical PanelHeader so padding (`gap-3 px-5`),
          back-chevron sizing, and action-slot wrapping match every other
          Settings sub-page (Account / Browser / Server). Was hand-rolled
          with `gap-3 px-5` before; converted to PanelHeader after stdrc
          confirmed (2026-05-14 #wg-theme:16123203) that the wider BEFORE
          padding is the canonical look on every breakpoint. */}
      <PanelHeader
        title={formatMessage({ id: "machine.mobile.title" })}
        onMobileBack={onMobileBack}
        mobileBackProps={mobileBackProps}
      />

      {/* Body — paper, with the computers as one inset list. */}
      <div className="flex-1 overflow-y-auto bg-layer-canvas p-4 safe-bottom">
        <div className="flex flex-col gap-2.5">
          {machinesLoading && (
            <div className="flex flex-col gap-2.5" data-testid="computers-loading-skeleton">
              {Array.from({ length: 4 }, (_, index) => (
                <Card
                  key={index}
                  render={<SkeletonRow avatar avatarClassName="size-[35px] rounded-sticker" lineWidths={SKELETON_LINE_WIDTHS} />}
                  className="min-h-16 flex-row items-center gap-3 px-4 py-3"
                />
              ))}
            </div>
          )}
          {!machinesLoading && machineLoadError && machines.length > 0 && (
            // The list below is a saved copy: a recoverable problem (Raft DS
            // warning Banner) with one small ink-line action. Part of the page,
            // not news, so it does not announce itself.
            <Banner
              intent="warning"
              live={false}
              data-testid="computers-refresh-error"
              title={formatMessage({ id: "machine.mobile.refreshErrorSaved" })}
              actions={(
                <Button size="sm" variant="outline" onClick={retryLoadMachines}>
                  <RefreshCw size={16} />
                  {formatMessage({ id: "machine.mobile.retry" })}
                </Button>
              )}
            />
          )}
          {!machinesLoading && machineLoadStatus === "error" && (
            <EmptyState
              className="flex flex-col items-center justify-center py-10"
              icon={<Monitor size={36} />}
              title={formatMessage({ id: "machine.mobile.loadErrorTitle" })}
              description={formatMessage({ id: "machine.mobile.loadErrorDescription" })}
              action={
                <Button size="sm" variant="outline" onClick={retryLoadMachines}>
                  <RefreshCw size={16} />
                  {formatMessage({ id: "machine.mobile.retry" })}
                </Button>
              }
            />
          )}
          {!machinesLoading && machineLoadStatus === "loaded" && machines.length === 0 && (
            <EmptyState
              className="flex flex-col items-center justify-center py-10"
              icon={<Monitor size={36} />}
              title={formatMessage({ id: "emptyState.noComputersTitle" })}
              description={formatMessage({ id: "machine.mobile.emptyDescription" })}
            />
          )}
          {!machinesLoading && machineLoadStatus === "loaded" && machines.length > 0 && visibleMachines.length === 0 && (
            <EmptyState
              className="flex flex-col items-center justify-center py-10"
              icon={<Monitor size={36} />}
              title={formatMessage({ id: "machine.mobile.noAttentionTitle" })}
              description={formatMessage({ id: "machine.mobile.noAttentionDescription" })}
            />
          )}
          {!machinesLoading && machineLoadStatus === "loaded" && visibleMachines.length > 0 && (
            <ListRowGroup>
          {visibleMachines.map((machine) => {
              // Same row signal as the desktop Sidebar: the web's own version comparison.
              const availableVersion = getComputerAvailableVersion(machine, latestComputerVersion);
              const diskLow = machineDiskLowPresentation(machine, formatMessage);
              const rowDotStatus = getComputerRowDotStatus(machine, availableVersion);
              const rowDotTitle = getComputerRowDotTitleDescriptor(
                rowDotStatus,
                machine.status,
                availableVersion,
              );
              return (
                // Raft Design System › ListRow (raft-ui): the neutral IconTile
                // with the presence pixel on its corner, the name, the
                // description and the facts in machine type. The group draws
                // the hairline from the text column (16 + 35 + 12).
                <ListRow
                  key={machine.id}
                  data-machine-id={machine.id}
                  onClick={openComputer}
                  data-testid={`computer-list-item-${machine.id}`}
                >
                  <span className="relative shrink-0">
                    <IconTile>
                      <Monitor aria-hidden="true" />
                    </IconTile>
                    <StatusDot
                      className="absolute -right-1 -top-1"
                      title={formatMessage({ id: rowDotTitle.id }, rowDotTitle.values)}
                      {...getComputerRowDotLight(rowDotStatus)}
                      data-testid={`computer-status-dot-${machine.id}`}
                    />
                  </span>
                  <ListRowBody>
                    <ListRowTitle>{machine.name}</ListRowTitle>
                    {machine.description && (
                      <ListRowDescription>{machine.description}</ListRowDescription>
                    )}
                    <div className="flex min-w-0 items-center gap-1.5 font-mono text-mono-meta text-foreground-hint">
                      <span className="truncate">
                        <MachineRunLabel machine={machine} />
                      </span>
                      {/* An available version is a fact, not a problem: ink.
                          The pink attention pixel on the tile carries "waiting
                          for you"; low disk is the problem, so it is orange. */}
                      {availableVersion && (
                        <span className="shrink-0 font-bold text-foreground">
                          → v{availableVersion}
                        </span>
                      )}
                      {diskLow && (
                        <span
                          className="shrink-0 font-bold text-warning-strong"
                          data-testid={`computer-disk-low-${machine.id}`}
                          title={formatMessage({ id: "machine.diskLow.chipTitle" }, { free: diskLow.free, percent: diskLow.freePercent })}
                        >
                          {formatMessage({ id: "machine.diskLow.chip" })}
                        </span>
                      )}
                    </div>
                  </ListRowBody>
                </ListRow>
              );
          })}
            </ListRowGroup>
          )}
          {/* @artin: the add affordance is a full-width "+" row at the END of the list,
              not a top-right corner icon. A dashed seam (like an empty board column)
              marks it as an action rather than an item. Gated on
              register-machines permission; under host-shell the panel header no longer carries
              an actions row, so this row is the sole add path in the embedded WebView. */}
          {!machinesLoading && machineLoadStatus === "loaded" && canRegisterMachines && (
            <button
              onClick={() => setShowAddMachine(true)}
              data-testid="computers-add-row"
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-container border border-dashed border-line-seam px-4 py-3 text-subhead font-bold text-foreground-muted outline-none hover:bg-fill-pressed hover:text-foreground active:bg-fill-pressed focus-visible:shadow-focus"
            >
              <Plus size={18} aria-hidden="true" />
              {formatMessage({ id: "machine.mobile.addComputer" })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
