import { useCallback, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useIntl } from "react-intl";
import {
  Banner,
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
} from "@botiverse/raft-ui";
import { ExternalLink } from "lucide-react";
import { ComboboxSelect } from "@botiverse/raft-ui/wip";
import api from "../../api/client";
import { useServerStore } from "../../store/serverStore";
import type { Agent } from "../../store/agentStore";
import type { Machine } from "../../store/machineStore";
import { HostedModelChoice, hostedModelPickerShown, initialHostedModel, useHostedRuntimeModels } from "../agent/HostedModelChoice";
import { isMigrationProPlanRequiredError } from "./billing";
import type { MigrationErrorPresentation } from "./errors";
import { migrationStartErrorPresentation, migrationTargetLabel } from "./presentation";
import { MigrationErrorContent } from "./MigrationErrorContent";

interface MigrationStartResponse {
  migrationRef: string;
  state: string;
  sourceMachineId: string;
  // null for a move to the cloud.
  targetMachineId: string | null;
  deadlines?: Record<string, string>;
}

/** The target option for the cloud; never a machine id. */
const HOSTED_TARGET_CHOICE = "__cloud__";

export function AgentMigrationDialog({
  agent,
  machines,
  sourceMachineId,
  hostedAvailable = false,
  onClose,
  onProRequired,
  onStarted,
}: {
  agent: Agent;
  machines: Machine[];
  sourceMachineId: string | null;
  /** Offer the cloud as a target (the server's hosted-migration gate; see useHostedMigrationAvailable). */
  hostedAvailable?: boolean;
  onClose: () => void;
  onProRequired: () => void;
  onStarted: (result: MigrationStartResponse) => Promise<void>;
}) {
  const { formatMessage } = useIntl();
  const serverSlug = useServerStore((state) => state.current?.slug);
  const targetComputers = useMemo(() =>
    machines.filter((machine) =>
      machine.id !== sourceMachineId &&
      machine.isComputer === true
    ),
  [machines, sourceMachineId]);
  const targetComputerOptions = useMemo(() => {
    const computers = targetComputers.map((machine) => ({ value: machine.id, label: machine.name }));
    return hostedAvailable
      ? [...computers, { value: HOSTED_TARGET_CHOICE, label: formatMessage({ id: "agent.migration.hosted.option" }) }]
      : computers;
  }, [targetComputers, hostedAvailable, formatMessage]);
  const [targetComputer, setTargetComputer] = useState(targetComputers[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<MigrationErrorPresentation | null>(null);
  const hostedSelected = hostedAvailable
    && (targetComputer === HOSTED_TARGET_CHOICE || targetComputers.length === 0);
  const selectedTargetComputer = hostedSelected
    ? HOSTED_TARGET_CHOICE
    : targetComputers.some((machine) => machine.id === targetComputer)
      ? targetComputer
      : targetComputers[0]?.id ?? "";
  // The model the cloud agent starts on, as in the create-agent form: `null` is
  // the provider's default, and nothing is picked where the server decides.
  const hostedModels = useHostedRuntimeModels("antiproton", hostedSelected);
  const [hostedModelPick, setHostedModelPick] = useState<string | null | undefined>(undefined);
  const hostedModelsView = hostedModels.state.kind === "ready" ? hostedModels.state.view : null;
  const hostedModel = hostedModelsView === null || hostedModelsView.locked || !hostedModelPickerShown(hostedModelsView)
    ? null
    : hostedModelPick !== undefined ? hostedModelPick : initialHostedModel(hostedModelsView);
  const sourceComputerName = machines.find((machine) => machine.id === sourceMachineId)?.name;
  const source = migrationTargetLabel(formatMessage, machines, sourceMachineId);
  const targetComputerName = hostedSelected
    ? formatMessage({ id: "agent.migration.hosted.targetName" })
    : machines.find((machine) => machine.id === selectedTargetComputer)?.name;
  const recoveryComputerId = error?.recoveryComputerId;

  const handleTargetComputerChange = useCallback((value: string | number | null) => {
    if (value == null) return;
    setTargetComputer(String(value));
  }, []);
  // Recovery happens on the Computers page; open it in a new tab so this
  // dialog (and the chosen target) stays put for the retry. A real anchor
  // (new tab) written as the DS UI text link: underlined ink, not a hyperlink
  // colour.
  const recoveryComputersHref = serverSlug
    ? `/s/${serverSlug}/${recoveryComputerId ? `computer/${recoveryComputerId}` : "computers"}`
    : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTargetComputer) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post<MigrationStartResponse>(`/agents/${agent.id}/migrate`, hostedSelected
        ? { target: { kind: "hosted", ...(hostedModel ? { hostedModel } : {}) } }
        : { targetComputer: selectedTargetComputer });
      await onStarted(data);
    } catch (err: unknown) {
      if (isMigrationProPlanRequiredError(err)) {
        onProRequired();
        return;
      }
      setError(migrationStartErrorPresentation(err, formatMessage, {
        sourceComputerName,
        targetComputerName,
        sourceComputerId: sourceMachineId,
        targetComputerId: hostedSelected ? null : selectedTargetComputer,
      }));
    } finally {
      setSubmitting(false);
    }
  }

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open && !submitting) onClose();
  }, [onClose, submitting]);

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      {/* Size follows the viewport: width about a third of it (28–40rem), both
          axes capped at 90% with a 16–32px gutter, no fixed height. raft-ui's
          DialogBody scrolls and the header/footer stay pinned when it overflows. */}
      <DialogContent
        className="w-[calc(100%_-_2*clamp(16px,3vw,32px))] max-w-[min(90vw,clamp(28rem,32vw,40rem))] max-h-[min(90dvh,calc(100dvh_-_2*clamp(16px,3vh,32px)))]"
        aria-busy={submitting}
      >
        <form onSubmit={handleSubmit} className="contents">
          <DialogHeader>
            <DialogTitle>
              {formatMessage({ id: hostedAvailable ? "agent.migration.hosted.dialogTitle" : "agent.detail.moveToAnotherComputer" })}
            </DialogTitle>
            <DialogClose disabled={submitting} aria-label={formatMessage({ id: "common.close" })} />
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <Field>
              <FieldLabel id="agent-migration-target-computer-label">
                {formatMessage({ id: hostedAvailable ? "agent.migration.hosted.targetLabel" : "agent.detail.targetComputer" })}
              </FieldLabel>
              <ComboboxSelect
                aria-labelledby="agent-migration-target-computer-label"
                options={targetComputerOptions}
                value={selectedTargetComputer || null}
                onValueChange={handleTargetComputerChange}
                disabled={submitting || targetComputerOptions.length === 0}
                placeholder={formatMessage({ id: "agent.detail.noOtherAttachedComputer" })}
                emptyContent={formatMessage({ id: "ui.selectionPopover.emptyLabel" })}
                showArrow
                autoHighlight
              />
            </Field>
            {hostedSelected && hostedModelPickerShown(hostedModelsView) ? (
              <Field>
                <FieldLabel>{formatMessage({ id: "agent.detail.hostedModel.title" })}</FieldLabel>
                <HostedModelChoice
                  state={hostedModels.state}
                  value={hostedModel}
                  onChange={setHostedModelPick}
                  onReload={hostedModels.reload}
                  testId="agent-migration-hosted-model"
                />
              </Field>
            ) : null}
            {/* The one choice first; what happens next follows as the dialog's body text. */}
            {hostedSelected ? (
              // Said before starting: the move to the cloud is final once confirmed.
              <ul className="list-disc space-y-2 pl-5" data-testid="agent-migration-hosted-notes">
                <li>{formatMessage({ id: "agent.migration.hosted.noteStopped" }, { source })}</li>
                <li>{formatMessage({ id: "agent.migration.hosted.noteFiles" }, { source })}</li>
                <li>{formatMessage({ id: "agent.migration.hosted.noteSession" })}</li>
                <li>{formatMessage({ id: "agent.migration.hosted.noteGithub" })}</li>
                <li>{formatMessage({ id: "agent.migration.hosted.noteFinal" })}</li>
              </ul>
            ) : (
              <div className="space-y-2">
                <p>{formatMessage({ id: "agent.detail.migrationModeStopBeforeExport" })}</p>
                <p>{formatMessage({ id: "agent.detail.migrationSessionResetDetailed" })}</p>
              </div>
            )}
            {error ? (
              <Banner status="warning" size="sm" role="alert">
                <MigrationErrorContent presentation={error} />
              </Banner>
            ) : null}
            {error?.recovery === "open_computers_and_retry" && recoveryComputersHref ? (
              <a
                href={recoveryComputersHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-fit items-center gap-1 rounded-sticker text-callout font-semibold text-foreground underline decoration-[1.5px] underline-offset-[3px] outline-none focus-visible:shadow-focus"
              >
                {formatMessage({
                  id: recoveryComputerId
                    ? "agent.migration.error.openComputerSettings"
                    : "agent.migration.error.openComputers",
                })}
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" size="lg"
              type="button"
              onClick={onClose}
              disabled={submitting}
            >
              {formatMessage({ id: "agent.detail.cancel" })}
            </Button>
            <Button variant="accent" size="lg"
              type="submit"
              disabled={submitting || !selectedTargetComputer || (hostedSelected && hostedModels.state.kind === "loading")}
            >
              {submitting
                ? formatMessage({ id: "agent.detail.starting" })
                : error?.recovery === "open_computers_and_retry"
                  ? formatMessage({ id: "agent.migration.error.tryAgain" })
                  : hostedSelected
                    ? formatMessage({ id: "agent.migration.hosted.start" })
                    : formatMessage({ id: "agent.detail.startMigration" })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
