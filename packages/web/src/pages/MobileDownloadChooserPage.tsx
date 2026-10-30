import { useIntl } from "react-intl";
import { Card } from "@botiverse/raft-ui";
import { mobileDownloadUrl } from "../utils/mobileDownloadUrl";
import { desktopDownloadUrl } from "../utils/desktopDownload";
import { useDesktopDownloadView } from "../components/settings/DesktopDownloadOptions";

/**
 * Public "pick your platform" page for the mobile download entry.
 *
 * **Why this page exists at all.** The server classifies devices by User-Agent,
 * and modern iPadOS Safari sends a string byte-identical to macOS — so an iPad
 * scanning our QR was indistinguishable from a desktop and got a 400. iPad is a
 * supported target (@huxijin, after @Aiden established the app runs on iPadOS),
 * so the entry point cannot answer "unsupported" from the UA alone. Anything
 * the server cannot classify lands here and the person chooses.
 *
 * **No session required.** Whoever scanned the QR has not signed in on that
 * device — mounting this behind auth would put a login wall in front of the
 * download, which is the failure this whole entry point exists to avoid. It is
 * registered on the public router, outside the authenticated shell.
 *
 * **Both links go back through `/api/mobile-download` with an explicit
 * platform**, never to a vendor URL: Hands hands out signed URLs that expire,
 * and TestFlight is an Apple-side surface that may be re-created. Explicit
 * platforms also mean this page cannot bounce back to itself.
 */

/**
 * Whether this browser is an iPad reporting itself as a Mac.
 *
 * `maxTouchPoints` is the documented discriminator: desktop Safari on real
 * macOS reports 0, iPadOS reports 5 while claiming `Macintosh`. Read at render
 * rather than module scope so tests can drive it, and guarded because a
 * non-browser render (SSR, jsdom without the field) must not throw.
 */
export function isTouchCapableMac(nav: { userAgent?: string; maxTouchPoints?: number } | undefined): boolean {
  if (!nav) return false;
  const ua = nav.userAgent ?? "";
  return /Macintosh|Mac OS X/i.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
}

// DS Button (rf-btn) drawn on a link: 44 tall, 1.5px edge, 15/20 bold, the
// pressed overlay on hover/press. The recommended desktop build is this
// page's one pink action; the two phone platforms are the paper button.
const LINK_BUTTON_BASE =
  "flex h-11 w-full items-center justify-center rounded-control border-[1.5px] px-4 text-center text-subhead font-bold no-underline outline-none focus-visible:shadow-focus";
const LINK_BUTTON_CLASS =
  `${LINK_BUTTON_BASE} border-line-strong bg-layer-card text-foreground hover:press-overlay active:press-overlay`;
const PRIMARY_LINK_BUTTON_CLASS =
  `${LINK_BUTTON_BASE} border-sticker-ink bg-attention text-sticker-ink hover:press-overlay-sticker active:press-overlay-sticker`;

export default function MobileDownloadChooserPage() {
  const { formatMessage } = useIntl();
  const likelyIPad = typeof navigator === "undefined" ? false : isTouchCapableMac(navigator);
  const desktop = useDesktopDownloadView();

  return (
    <div className="flex min-h-dvh items-center justify-center bg-layer-sidebar px-4 py-10 font-display text-foreground">
      <Card className="w-full max-w-sm space-y-4 p-6" data-testid="mobile-download-chooser">
        <h1 className="text-headline">
          {formatMessage({ id: "mobileDownload.chooser.title" })}
        </h1>
        <p className="text-callout text-foreground-muted">
          {formatMessage({ id: "mobileDownload.chooser.description" })}
        </p>
        {/* An iPad cannot be identified server-side, so when the browser tells us
            what the UA could not, say so — otherwise the reader has to know that
            "iPad counts as iOS here", which is our implementation detail. */}
        {likelyIPad ? (
          <p className="text-caption text-foreground-hint" data-testid="mobile-download-chooser-ipad-hint">
            {formatMessage({ id: "mobileDownload.chooser.ipadHint" })}
          </p>
        ) : null}
        <div className="flex flex-col gap-2">
          {/* Leaves Raft (302 → testflight.apple.com), so new tab; Android is a
              download and stays put. Same asymmetry as the Settings section. */}
          {/* Same paper button for both: neither platform is recommended. They
              stay real links (downloads), drawn as the DS ink-line button. */}
          <a
            className={LINK_BUTTON_CLASS}
            href={mobileDownloadUrl("ios")}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="mobile-download-chooser-ios"
          >
            {formatMessage({ id: "settings.mobileApp.ios" })}
          </a>
          <a
            className={LINK_BUTTON_CLASS}
            href={mobileDownloadUrl("android")}
            data-testid="mobile-download-chooser-android"
          >
            {formatMessage({ id: "settings.mobileApp.android" })}
          </a>
        </div>
        {/* Desktop (task #714 put the desktop beta on this page: the newsletter
            links here for desktop readers too). Same rule as Settings → About:
            this device's platform first when it is a computer, every platform
            listed. Each goes through /api/desktop-download, which resolves the
            Latest release's own update feed, so a download here and an in-app
            update never disagree. Downloads, so same tab. */}
        <div className="space-y-2 border-t border-line-hairline pt-4" data-testid="desktop-download-chooser">
          <h2 className="text-footnote font-bold text-foreground">{formatMessage({ id: "settings.desktopApp.sectionLabel" })}</h2>
          {desktop.recommended ? (
            <a
              className={PRIMARY_LINK_BUTTON_CLASS}
              href={desktopDownloadUrl(desktop.recommended.target)}
              data-testid="desktop-download-chooser-recommended"
              data-target={desktop.recommended.target}
            >
              {formatMessage({ id: desktop.recommended.labelId })}
            </a>
          ) : desktop.windowsSoon ? (
            <p className="text-caption text-foreground-hint" data-testid="desktop-download-chooser-windows-soon">
              {formatMessage({ id: "settings.desktopApp.windowsSoon" })}
            </p>
          ) : null}
          {desktop.recommended?.intelHint ? (
            <p className="text-caption text-foreground-hint" data-testid="desktop-download-chooser-intel-hint">
              {formatMessage({ id: "settings.desktopApp.intelHint" })}
            </p>
          ) : null}
          <ul className="flex flex-wrap gap-x-4 gap-y-2 text-footnote">
            {desktop.options.map((option) => (
              <li key={option.target}>
                {option.available ? (
                  <a className="font-semibold text-foreground underline decoration-[1.5px] underline-offset-[3px]" href={desktopDownloadUrl(option.target)} data-testid={`desktop-download-chooser-${option.target}`}>
                    {formatMessage({ id: option.labelId })}
                  </a>
                ) : (
                  <span className="text-foreground-hint" data-testid={`desktop-download-chooser-${option.target}`}>
                    {formatMessage({ id: "settings.desktopApp.option.unavailable" }, { platform: formatMessage({ id: option.labelId }) })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </div>
  );
}
