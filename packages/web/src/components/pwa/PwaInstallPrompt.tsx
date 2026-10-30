import CloseButton from "../ui/CloseButton";
import { useCallback, useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { Smartphone, X } from "lucide-react";
import { Button, Card } from "@botiverse/raft-ui";
import BottomSheet from "../ui/BottomSheet";
import {
  PWA_INSTALL_OPEN_EVENT,
  PWA_INSTALL_SESSION_DISMISSED_KEY,
  PWA_INSTALL_SESSION_COUNT_KEY,
  getCooldownState,
  getPwaInstallDisplayMode,
  getPwaInstallPlatform,
  getSessionCountBucket,
  hasPwaInstallPath,
  isPwaStandalone,
  readNumberStorage,
  recordPwaInstallEvent,
} from "../../utils/pwaInstall";
import type {
  PwaInstallCooldownState,
  PwaInstallPlatform,
  PwaInstallSurface,
} from "../../utils/pwaInstall";

function isMobileViewportNow(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 767px)").matches;
}

function IosInstructionSheet({
  variant,
  onClose,
  onCopyLink,
}: {
  variant: "safari" | "other";
  onClose: () => void;
  onCopyLink: () => void;
}) {
  const { formatMessage } = useIntl();
  const isSafari = variant === "safari";
  // Raft Design System › Sheet (`rf-sheet`): the head row (17/22 title, a
  // ghost close), a 14/20 ink-2 line under it, then full-width actions with
  // one pink primary.
  return (
    <BottomSheet
      role="dialog"
      aria-modal="true"
      aria-label={formatMessage({ id: "pwa.install.addToHomeScreen" })}
      onClose={onClose}
      className="md:hidden"
      sheetClassName="px-4"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0 pt-2.5">
          <div className="text-headline text-foreground">
            {formatMessage({ id: "pwa.install.addToYourHomeScreen" })}
          </div>
          <div className="mt-1 text-callout text-foreground-muted">
            {isSafari
              ? formatMessage({ id: "pwa.install.safariSubtitle" })
              : formatMessage({ id: "pwa.install.openInSafariSettingsHint" })}
          </div>
        </div>
        <CloseButton
          type="button"
          size="icon-lg"
          onClick={onClose}
          className="-mr-2 shrink-0"
          aria-label={formatMessage({ id: "pwa.install.closeInstructionsAria" })}
        >
          <X size={22} />
        </CloseButton>
      </div>

      {isSafari ? (
        <div className="rounded-container border border-line-hairline bg-fill-muted p-2">
          <img
            src="/pwa/ios-add-to-home-screen-3step.svg"
            alt={formatMessage({ id: "pwa.install.threeStepsAlt" })}
            className="block w-full"
          />
        </div>
      ) : (
        // DS Banner (info): the cyan-soft wash, ink text, a hairline. Hand-rolled
        // because raft-ui's Banner announces itself as role="alert", and this
        // static note never did.
        <div className="rounded-container bg-info-soft px-3.5 py-3 text-callout text-foreground ring-1 ring-inset ring-line-hairline">
          {formatMessage({ id: "pwa.install.iosSafariOnly" })}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-2">
        {!isSafari && (
          <Button type="button" onClick={onCopyLink} size="lg" variant="primary" className="w-full">
            {formatMessage({ id: "pwa.install.copyLink" })}
          </Button>
        )}
        <Button type="button" onClick={onClose} size="lg" variant={isSafari ? "primary" : "ghost"} className="w-full">
          {isSafari
            ? formatMessage({ id: "pwa.install.gotIt" })
            : formatMessage({ id: "common.close" })}
        </Button>
      </div>
    </BottomSheet>
  );
}

export function PwaInstallSettingsCard() {
  const { formatMessage } = useIntl();
  const [platform, setPlatform] = useState<PwaInstallPlatform>("other");
  const [standalone, setStandalone] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [sessionCount, setSessionCount] = useState(1);
  const [cooldownState, setCooldownState] = useState<PwaInstallCooldownState>("not_dismissed");

  useEffect(() => {
    if (typeof window === "undefined") return;
    // oxlint-disable-next-line react-doctor/no-initialize-state -- YMNNE-family: pre-existing non-bug site grandfathered; rule now gates new code (see docs/frontend/render-cost-contract.md)
    setPlatform(getPwaInstallPlatform(window.navigator.userAgent));
    // oxlint-disable-next-line react-doctor/no-initialize-state -- YMNNE-family: pre-existing non-bug site grandfathered; rule now gates new code (see docs/frontend/render-cost-contract.md)
    setStandalone(isPwaStandalone(window));
    // oxlint-disable-next-line react-doctor/no-initialize-state -- YMNNE-family: pre-existing non-bug site grandfathered; rule now gates new code (see docs/frontend/render-cost-contract.md)
    setIsMobile(isMobileViewportNow());
    // oxlint-disable-next-line react-doctor/no-initialize-state -- YMNNE-family: pre-existing non-bug site grandfathered; rule now gates new code (see docs/frontend/render-cost-contract.md)
    setSessionCount(readNumberStorage(window.localStorage, PWA_INSTALL_SESSION_COUNT_KEY) ?? 1);
    // oxlint-disable-next-line react-doctor/no-initialize-state -- YMNNE-family: pre-existing non-bug site grandfathered; rule now gates new code (see docs/frontend/render-cost-contract.md)
    setCooldownState(
      window.sessionStorage.getItem(PWA_INSTALL_SESSION_DISMISSED_KEY) === "1"
        ? "dismissed_active"
        : getCooldownState(Date.now(), null),
    );
  }, []);

  // oxlint-disable-next-line react-doctor/no-effect-chain -- YMNNE-family: pre-existing non-bug site grandfathered; rule now gates new code (see docs/frontend/render-cost-contract.md)
  useEffect(() => {
    if (!isMobile || standalone || typeof window === "undefined") return;
    if (!hasPwaInstallPath({ platform, hasNativePrompt: false })) return;
    recordPwaInstallEvent({
      event: "pwa_install_cta_shown",
      platform,
      surface: "settings",
      trigger: "settings",
      displayMode: getPwaInstallDisplayMode(window),
      sessionCountBucket: getSessionCountBucket(sessionCount),
      cooldownState,
    });
  }, [cooldownState, isMobile, platform, sessionCount, standalone]);

  const openInstallSheet = useCallback(() => {
    recordPwaInstallEvent({
      event: "pwa_install_cta_clicked",
      platform,
      surface: "settings",
      trigger: "settings",
      displayMode: getPwaInstallDisplayMode(window),
      sessionCountBucket: getSessionCountBucket(sessionCount),
      cooldownState,
    });
    window.dispatchEvent(new CustomEvent(PWA_INSTALL_OPEN_EVENT, { detail: { source: "settings" } }));
  }, [cooldownState, platform, sessionCount]);

  if (!isMobile || standalone || !hasPwaInstallPath({ platform, hasNativePrompt: false })) return null;

  const helpText = formatMessage({ id: "pwa.install.openInSafariSettingsHint" });

  return (
    <div data-pwa-install-settings-card className="mb-6 md:hidden">
      {/* DS card: the card surface, a hairline, the container radius, no
          shadow. The settings screen has its own primary, so "Add" is the
          ink-lined small button, not pink. */}
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-subhead font-semibold text-foreground">
              <Smartphone size={18} className="shrink-0 text-foreground-muted" aria-hidden="true" />
              {formatMessage({ id: "pwa.install.addToHomeScreen" })}
            </div>
            <div className="mt-1 text-caption text-foreground-hint">{helpText}</div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={openInstallSheet}
            className="shrink-0"
          >
            {formatMessage({ id: "pwa.install.add" })}
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default function PwaInstallPrompt() {
  const [platform, setPlatform] = useState<PwaInstallPlatform>("other");
  const [sessionCount, setSessionCount] = useState(1);
  const [cooldownState, setCooldownState] = useState<PwaInstallCooldownState>("not_dismissed");
  const [standalone, setStandalone] = useState(false);
  const [sheet, setSheet] = useState<null | "safari" | "other">(null);

  const track = useCallback((event: Parameters<typeof recordPwaInstallEvent>[0]["event"], surface: PwaInstallSurface, extra: Partial<Parameters<typeof recordPwaInstallEvent>[0]> = {}) => {
    if (typeof window === "undefined") return;
    recordPwaInstallEvent({
      event,
      platform,
      surface,
      trigger: extra.trigger ?? "supported_browser",
      displayMode: getPwaInstallDisplayMode(window),
      sessionCountBucket: getSessionCountBucket(sessionCount),
      cooldownState,
      ...extra,
    });
  }, [cooldownState, platform, sessionCount]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const nextStandalone = isPwaStandalone(window);
    // oxlint-disable-next-line react-doctor/no-initialize-state -- YMNNE-family: pre-existing non-bug site grandfathered; rule now gates new code (see docs/frontend/render-cost-contract.md)
    setPlatform(getPwaInstallPlatform(window.navigator.userAgent));
    // oxlint-disable-next-line react-doctor/no-initialize-state -- YMNNE-family: pre-existing non-bug site grandfathered; rule now gates new code (see docs/frontend/render-cost-contract.md)
    setSessionCount(readNumberStorage(window.localStorage, PWA_INSTALL_SESSION_COUNT_KEY) ?? 1);
    // oxlint-disable-next-line react-doctor/no-initialize-state -- YMNNE-family: pre-existing non-bug site grandfathered; rule now gates new code (see docs/frontend/render-cost-contract.md)
    setCooldownState(window.sessionStorage.getItem(PWA_INSTALL_SESSION_DISMISSED_KEY) === "1" ? "dismissed_active" : "not_dismissed");
    // oxlint-disable-next-line react-doctor/no-initialize-state -- YMNNE-family: pre-existing non-bug site grandfathered; rule now gates new code (see docs/frontend/render-cost-contract.md)
    setStandalone(nextStandalone);
  }, []);

  // oxlint-disable-next-line react-doctor/no-effect-chain -- YMNNE-family: pre-existing non-bug site grandfathered; rule now gates new code (see docs/frontend/render-cost-contract.md)
  useEffect(() => {
    if (!standalone) return;
    track("pwa_install_standalone_detected", "settings");
  }, [standalone, track]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOpen = (event: Event) => {
      const source = (event as CustomEvent<{ source?: string }>).detail?.source === "settings" ? "settings" : "notification_center";
      track("pwa_install_cta_clicked", source);
      if (platform === "ios_safari") {
        setSheet("safari");
        track("pwa_install_cta_shown", "ios_instruction_sheet");
      } else {
        setSheet("other");
        track("pwa_install_cta_shown", "ios_instruction_sheet");
      }
    };
    window.addEventListener(PWA_INSTALL_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(PWA_INSTALL_OPEN_EVENT, onOpen);
  }, [platform, track]);

  const closeSheet = useCallback(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(PWA_INSTALL_SESSION_DISMISSED_KEY, "1");
      setCooldownState("dismissed_active");
    }
    track("pwa_install_ios_instruction_dismissed", "ios_instruction_sheet");
    setSheet(null);
  }, [track]);

  const copyLink = useCallback(() => {
    if (typeof window === "undefined") return;
    void navigator.clipboard?.writeText(window.location.href);
    track("pwa_install_cta_clicked", "ios_instruction_sheet");
  }, [track]);

  if (standalone) return null;

  return sheet ? <IosInstructionSheet variant={sheet} onClose={closeSheet} onCopyLink={copyLink} /> : null;
}
