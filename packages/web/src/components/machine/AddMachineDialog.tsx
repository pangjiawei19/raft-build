import { Input, Checkbox, Button, Status } from "@botiverse/raft-ui";
import { useState, useEffect, useRef, useCallback } from "react";
import type { ChangeEvent } from "react";
import { CheckCircle, Monitor, Cloud } from "lucide-react";
import { useIntl } from "react-intl";
import { useMachineStore } from "../../store/machineStore";
import { useComputerConnectionWatch } from "../../hooks/useComputerConnectionWatch";
import { useServerStore } from "../../store/serverStore";
import { useAppNavigate } from "../../hooks/useAppNavigate";
import { getServerUrl } from "../../utils/server";
// The baseline/resolver import staging still carries is gone here: this dialog's
// connect state machine lives in useComputerConnectionWatch now, shared with onboarding.
import { getComputerCommands } from "../../utils/computerSetupCommand";
import { PLAN_CONFIG, getEffectiveLimits } from "@botiverse/raft-shared";
import type { ServerPlan } from "@botiverse/raft-shared";
import DialogCard from "../ui/DialogCard";
import FormField from "../ui/FormField";
import Banner from "../ui/Banner";
import ComputerCommandGuide from "./ComputerCommandGuide";

/** A link-like action inside a banner sentence (Raft DS UI text link: ink,
 *  1.5px underline, 600). */
const INLINE_TEXT_BUTTON_CLASS_NAME =
  "rounded-sticker font-semibold text-foreground underline decoration-[1.5px] underline-offset-[3px] outline-none hover:bg-fill-pressed focus-visible:shadow-focus";

function isQuotaError(error: string): boolean {
  return error.includes("limit reached");
}

type DialogStep = "type" | "waiting" | "connected";
export const WAITING_HINT_DELAY_MS = 45_000;
type MachineType = "local" | "cloud";

export default function AddMachineDialog({ onClose }: { onClose: () => void }) {
  const { formatMessage } = useIntl();
  const nav = useAppNavigate();
  const [step, setStep] = useState<DialogStep>("type");
  const [machineType, setMachineType] = useState<MachineType>("local");
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [machineId, setMachineId] = useState("");
  const [registeredMachineId, setRegisteredMachineId] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmedComputerMatch, setConfirmedComputerMatch] = useState(false);
  const connectedComputerConfirmationRef = useRef<{ machineId: string; requiresConfirmation: boolean } | null>(null);

  const registerMachine = useMachineStore((s) => s.registerMachine);
  const renameMachine = useMachineStore((s) => s.renameMachine);
  const serverSlug = useServerStore((s) => s.current?.slug);
  const deleteMachine = useMachineStore((s) => s.deleteMachine);
  const machines = useMachineStore((s) => s.machines);

  const plan = (useServerStore((s) => s.current?.plan) || "free") as ServerPlan;
  const maxMachines = getEffectiveLimits(plan).maxMachines;
  const atLimit = maxMachines !== -1 && machines.length >= maxMachines;

  const serverUrl = getServerUrl();


  // Watch for the machine coming online. The detection, the baseline, and the
  // dropped-event polling fallback all live in the shared watch — the onboarding
  // setup gate asks the same questions and must not answer them differently.
  // oxlint-disable-next-line react-doctor/no-event-handler -- YMNNE-family: pre-existing non-bug site grandfathered; rule now gates new code (see docs/frontend/render-cost-contract.md)
  const pendingMachine = machineId ? machines.find((m) => m.id === machineId) : null;
  // oxlint-disable-next-line react-doctor/no-event-handler -- Same YMNNE-family async waiter as `pendingMachine` above: the watch observes daemon connect, it is not an event handler.
  const connectWatchActive = step === "waiting";
  // oxlint-disable-next-line react-doctor/no-event-handler -- Ditto: the pending row id is the thing being waited on.
  const connectWatchPendingId = machineId;
  const connectionProgress = useComputerConnectionWatch({
    active: connectWatchActive,
    pendingMachineId: connectWatchPendingId,
  });

  // The browser cannot see the terminal, so a failed install or setup looks
  // like endless waiting. After a while, point the user at the terminal and at
  // the connect-only command (bug-triage task #22).
  const [waitingStalled, setWaitingStalled] = useState(false);
  useEffect(() => {
    if (step !== "waiting") return;
    const timer = setTimeout(() => setWaitingStalled(true), WAITING_HINT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [step]);
  const connectedMachine = connectionProgress.state === "connected" ? connectionProgress.machine : null;
  const connectedRequiresConfirmation = connectionProgress.state === "connected" &&
    connectionProgress.requiresConfirmation;
  const isConnected = Boolean(connectedMachine);
  const connectedComputerConfirmation = connectedComputerConfirmationRef.current;
  const needsComputerMatchConfirmation = step === "connected" &&
    Boolean(pendingMachine?.isComputer) &&
    machineId !== registeredMachineId &&
    (connectedComputerConfirmation?.machineId === machineId ? connectedComputerConfirmation.requiresConfirmation : true);
  const canFinishConnectedStep = step === "connected" && (!needsComputerMatchConfirmation || confirmedComputerMatch);

  // One-shot prefill waiter: during the Add Machine setup wizard, the daemon
  // registers and then comes online over the socket. When it does, advance
  // the wizard from "waiting" → "connected" and pre-fill the name field with
  // the daemon-reported hostname (saving the user a manual type). NOT a
  // mirror-prop pattern — it's a wait-for-async-event seed, and a
  // useState-initializer refactor would require remounting the dialog when
  // `isConnected` flips and would lose the wizard's place. Same shape as
  // CreateAgentDialog's `prefilledMachineId` waiter (PR #2524).
  // oxlint-disable-next-line react-doctor/no-cascading-set-state -- One-shot async waiter seeds wizard state after daemon/Computer connect; splitting would lose the modal progression contract.
  useEffect(() => {
    // oxlint-disable-next-line react-doctor/no-event-handler -- YMNNE-family async waiter, not a render mirror.
    if (connectedMachine && step === "waiting") {
      // oxlint-disable-next-line react-doctor/no-chain-state-updates -- YMNNE-family: pre-existing non-bug site grandfathered; rule now gates new code (see docs/frontend/render-cost-contract.md)
      setStep("connected");
      // The Computer setup command creates/resumes its own linked machine row
      // instead of using the daemon placeholder created for the legacy command.
      // When that row comes online, pivot the wizard to the real connected row.
      if (connectedMachine.id !== machineId) {
        connectedComputerConfirmationRef.current = {
          machineId: connectedMachine.id,
          requiresConfirmation: connectedRequiresConfirmation,
        };
        // oxlint-disable-next-line react-doctor/no-chain-state-updates, react-doctor/no-derived-state -- This is not render-derived state; it records the concrete connected row for Done/rename/navigation.
        setMachineId(connectedMachine.id);
      }
      // Pre-fill name with hostname from daemon
      if (connectedMachine.hostname) {
        // oxlint-disable-next-line react-doctor/no-derived-state
        setName(connectedMachine.hostname);
      }
    }
  }, [connectedMachine, connectedRequiresConfirmation, machineId, step]);

  // The dropped-event polling fallback now lives in useComputerConnectionWatch,
  // alongside the baseline it belongs with.

  const handleSelectType = useCallback(async () => {
    setRegistering(true);
    setError("");
    setConfirmedComputerMatch(false);
    connectedComputerConfirmationRef.current = null;
    try {
      const result = await registerMachine("my-computer");
      setApiKey(result.apiKey);
      setMachineId(result.machine.id);
      setRegisteredMachineId(result.machine.id);
      setStep("waiting");
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setError(axiosErr.response?.data?.error || formatMessage({ id: "machine.add.registerFailed" }));
    } finally {
      setRegistering(false);
    }
  }, [formatMessage, registerMachine]);

  const handleCancel = useCallback(async () => {
    // If we created a raw daemon placeholder but never confirmed a Computer
    // pivot, clean the placeholder rather than treating the heuristic match as
    // the final operation target.
    if (registeredMachineId && (!isConnected || (needsComputerMatchConfirmation && !confirmedComputerMatch))) {
      try {
        await deleteMachine(registeredMachineId);
      } catch {
        // ignore cleanup error
      }
    }
    onClose();
  }, [confirmedComputerMatch, deleteMachine, isConnected, needsComputerMatchConfirmation, onClose, registeredMachineId]);

  const pendingHostname = pendingMachine?.hostname;
  const handleDone = useCallback(async () => {
    if (needsComputerMatchConfirmation && !confirmedComputerMatch) return;
    const finalName = name.trim() || pendingHostname || "";
    if (finalName && machineId && finalName !== "my-computer") {
      setSaving(true);
      try {
        await renameMachine(machineId, finalName);
      } catch {
        // ignore — name stays as default
      } finally {
        setSaving(false);
      }
    }
    if (registeredMachineId && registeredMachineId !== machineId) {
      try {
        await deleteMachine(registeredMachineId);
      } catch {
        // ignore cleanup error
      }
    }
    useMachineStore.getState().clearPendingApiKey();
    onClose();
    nav.toMachine(machineId);
  }, [
    confirmedComputerMatch,
    deleteMachine,
    machineId,
    name,
    nav,
    needsComputerMatchConfirmation,
    onClose,
    pendingHostname,
    registeredMachineId,
    renameMachine,
  ]);

  const handleNameChange = useCallback((e: ChangeEvent<HTMLInputElement>) => setName(e.target.value), []);

  const deploymentEnv = import.meta.env?.VITE_DEPLOYMENT_ENV;
  const computerCommands = getComputerCommands(serverSlug, deploymentEnv, serverUrl, {
    legacyApiKey: apiKey,
  });
  const windowsComputerCommands = getComputerCommands(serverSlug, deploymentEnv, serverUrl, {
    legacyApiKey: apiKey,
    platform: "windows",
  });
  const computerSetupCommand = computerCommands?.setup ?? null;
  const computerInstall = computerCommands?.install ?? null;
  const computerInstallAndSetup = computerCommands?.installAndSetup ?? null;
  const windowsComputerSetupCommand = windowsComputerCommands?.setup ?? null;
  const windowsComputerInstall = windowsComputerCommands?.install ?? null;

  const dialogTitle = step === "type"
    ? formatMessage({ id: "machine.add.title.add" })
    : step === "waiting"
      ? formatMessage({ id: "machine.add.title.connect" })
      : formatMessage({ id: "machine.add.title.connected" });

  // The shared product dialog shell (Raft DS Dialog): backdrop, Escape and the
  // close button all run the same handler the hand-rolled header used.
  return (
    <DialogCard
      title={dialogTitle}
      onClose={canFinishConnectedStep ? handleDone : handleCancel}
      maxWidthClass="max-w-lg"
    >

        {atLimit && step === "type" && (
          <Banner intent="warning" className="mb-4">
            {formatMessage(
              { id: "machine.add.limitReached" },
              { count: machines.length, max: maxMachines, plan: PLAN_CONFIG[plan].displayName },
            )}{" "}
            <button
              type="button"
              onClick={() => {
                onClose();
                nav.toSettings("billing");
              }}
              className={INLINE_TEXT_BUTTON_CLASS_NAME}
            >
              {formatMessage({ id: "machine.add.upgradeForMore" })}
            </button>
          </Banner>
        )}
        {error && !atLimit && (
          <Banner intent="warning" className="mb-4">
            {error}
            {isQuotaError(error) && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    nav.toSettings("billing");
                  }}
                  className={INLINE_TEXT_BUTTON_CLASS_NAME}
                >
                  {formatMessage({ id: "machine.add.viewPlans" })}
                </button>
              </>
            )}
          </Banner>
        )}

        {/* Step 1: Choose machine type */}
        {step === "type" && (
          <div>
            {/* Two option cards (control plane, 1.5px field line): the picked one
                is the selection in content — cyan-soft. The cloud option is the
                DS disabled surface (sunken, disabled ink), not a dimmed copy. */}
            <div className="mb-4 flex gap-2">
              <button
                type="button"
                aria-pressed={machineType === "local"}
                onClick={() => setMachineType("local")}
                className={`flex flex-1 items-center gap-3 rounded-control border-[1.5px] border-line-strong p-3 text-left text-foreground outline-none transition-colors focus-visible:shadow-focus ${
                  machineType === "local"
                    ? "bg-info-soft"
                    : "bg-layer-card hover:press-overlay"
                }`}
              >
                <Monitor size={20} className="shrink-0 text-foreground-muted" aria-hidden="true" />
                <div className="min-w-0">
                  <div className="text-callout font-semibold">
                    {formatMessage({ id: "machine.add.yourComputer" })}
                  </div>
                  <div className="text-footnote text-foreground-muted">
                    {formatMessage({ id: "machine.add.yourComputerDescription" })}
                  </div>
                </div>
              </button>
              <div
                className="flex flex-1 cursor-not-allowed items-center gap-3 rounded-control border border-line-hairline bg-fill-muted p-3 text-left text-foreground-disabled"
              >
                <Cloud size={20} className="shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                  <div className="text-callout font-semibold">{formatMessage({ id: "machine.add.cloudComputer" })}</div>
                  <div className="text-footnote">{formatMessage({ id: "machine.add.comingSoon" })}</div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                size="lg"
                variant="ghost"
                type="button"
                onClick={handleCancel}
              >
                {formatMessage({ id: "common.confirm.cancel" })}
              </Button>
              <Button
                size="lg"
                variant="accent"
                type="button"
                onClick={handleSelectType}
                disabled={registering || atLimit}
              >
                {registering
                  ? formatMessage({ id: "machine.add.settingUp" })
                  : formatMessage({ id: "common.announcement.next" })}
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Waiting for connection */}
        {step === "waiting" && (
          <div>
            <ComputerCommandGuide
              className="mb-4"
              computerCommand={computerSetupCommand}
              computerInstallCommand={computerInstall}
              computerInstallAndSetupCommand={computerInstallAndSetup}
              windowsComputerCommand={windowsComputerSetupCommand}
              windowsComputerInstallCommand={windowsComputerInstall}
            />

            {/* Waiting indicator */}
            <Banner
              intent="info"
              className="mb-4"
              // rui Banner only lays out a leading indicator that is an <svg> or a
              // `data-slot="status"` element (its own Status). The old custom
              // StatusDot was a plain <span>, so the grid put the text in row 1 and
              // the dot underneath it (task #665). Raft DS: status lights never
              // blink — the not-yet-connected computer is the static offline pixel.
              icon={<Status variant="default" />}
            >
              <span className="font-bold text-foreground">
                {formatMessage({ id: "machine.add.waitingForConnect" })}
              </span>
            </Banner>
            {step === "waiting" && waitingStalled && (
              <p className="-mt-2 mb-4 text-footnote text-foreground-muted" data-testid="add-machine-still-waiting">
                {formatMessage({ id: "machine.add.stillWaitingHint" })}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button
                size="lg"
                variant="ghost"
                type="button"
                onClick={handleCancel}
              >
                {formatMessage({ id: "common.confirm.cancel" })}
              </Button>
              <Button
                size="lg"
                variant="accent"
                type="button"
                disabled
              >
                {formatMessage({ id: "machine.add.done" })}
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Connected — name the machine */}
        {step === "connected" && (
          <div>
            {/* Done: the Raft DS success Banner, part of this step rather than
                news, so it does not announce itself. */}
            <Banner
              intent="success"
              live={false}
              className="mb-4"
              icon={<CheckCircle size={20} aria-hidden="true" />}
              title={formatMessage({ id: "machine.add.connectedSuccessfully" })}
            >
              {pendingMachine?.hostname ? (
                <span className="font-mono text-mono-meta">
                  {pendingMachine.hostname} — {pendingMachine.os || formatMessage({ id: "machine.add.unknownOs" })}
                </span>
              ) : null}
            </Banner>

            <FormField
              label={formatMessage({ id: "machine.add.computerName" })}
              hint={formatMessage({ id: "machine.add.computerNameHint" })}
              className="mb-4"
            >
              <Input
                type="text"
                value={name}
                onChange={handleNameChange}
                className="w-full"
                placeholder={pendingMachine?.hostname || formatMessage({ id: "machine.add.computerNamePlaceholder" })}
                autoFocus
              />
            </FormField>

            {needsComputerMatchConfirmation && (
              <label className="mb-4 flex items-start gap-3 rounded-control border-[1.5px] border-line-strong bg-layer-card p-3 text-callout font-semibold text-foreground">
                <Checkbox
                  checked={confirmedComputerMatch}
                  onCheckedChange={setConfirmedComputerMatch}
                  className="mt-0.5"
                  aria-label={formatMessage({ id: "machine.add.confirmComputerMatch" }, { hostname: pendingMachine?.hostname ? ` (${pendingMachine.hostname})` : "" })}
                />
                <span>
                  {formatMessage(
                    { id: "machine.add.confirmComputerMatch" },
                    { hostname: pendingMachine?.hostname ? ` (${pendingMachine.hostname})` : "" },
                  )}
                </span>
              </label>
            )}

            <div className="flex justify-end">
              <Button
                size="lg"
                variant="accent"
                type="button"
                onClick={handleDone}
                disabled={saving || (needsComputerMatchConfirmation && !confirmedComputerMatch)}
              >
                {saving
                  ? formatMessage({ id: "machine.add.saving" })
                  : formatMessage({ id: "machine.add.done" })}
              </Button>
            </div>
          </div>
        )}
    </DialogCard>
  );
}
