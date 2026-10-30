// @ts-nocheck
import assert from "node:assert/strict";
import "./helpers/domSetup";
import { cleanup, render, screen } from "@testing-library/react";
import MobileDownloadChooserPage, { isTouchCapableMac } from "../src/pages/MobileDownloadChooserPage";
import { resetDesktopPlatformsForTest } from "../src/components/settings/DesktopDownloadOptions";
import { TestIntlProvider } from "./helpers/intl";

/**
 * The chooser that makes iPad a supported target.
 *
 * The server cannot identify a modern iPad — iPadOS Safari sends a UA
 * byte-identical to macOS — so anything unclassifiable is redirected here and
 * the person picks. Two things must hold: the page is reachable and complete
 * without a session, and both options route back through our own endpoint
 * rather than at a vendor URL that expires.
 */

// Pinned, so the page does not render differently on a Linux CI host (jsdom's
// default UA names the host platform) than on a Mac laptop.
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
let originalNavigator;
function useNavigator(userAgent: string, maxTouchPoints = 0) {
  Object.defineProperty(globalThis, "navigator", { value: { userAgent, maxTouchPoints }, configurable: true });
}
beforeEach(() => {
  originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  resetDesktopPlatformsForTest(async () => ({
    mac: { status: "available", version: "0.1.42", universal: false },
    linux: { status: "available", version: "0.1.42" },
    windows: { status: "none" },
  }));
  useNavigator(IPHONE, 5);
});
afterEach(() => {
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  resetDesktopPlatformsForTest();
});

function renderChooser(locale?: "en" | "zh-cn") {
  return render(
    <TestIntlProvider locale={locale}>
      <MobileDownloadChooserPage />
    </TestIntlProvider>,
  );
}

afterEach(() => {
  cleanup();
});

test("both platforms are offered, each through our own endpoint", () => {
  try {
    renderChooser();
    const ios = screen.getByTestId("mobile-download-chooser-ios");
    const android = screen.getByTestId("mobile-download-chooser-android");

    // Endpoint + platform; the origin half is covered by mobileDownloadUrl.test.ts.
    assert.ok(ios.getAttribute("href")?.endsWith("/mobile-download?platform=ios"));
    assert.ok(android.getAttribute("href")?.endsWith("/mobile-download?platform=android"));

    // Explicit platforms are also what stops this page bouncing back to itself:
    // a platform-less link here would redirect straight back to the chooser.
    for (const el of [ios, android]) {
      const href = el.getAttribute("href") ?? "";
      assert.ok(href.includes("platform="), `each choice must pin a platform: ${href}`);
      assert.ok(!href.includes("hands.build"), `must not embed a vendor URL: ${href}`);
      assert.ok(!href.includes("testflight.apple.com"), `must not embed a vendor URL: ${href}`);
    }

    // Desktop (task #714): the newsletter links here for desktop readers too.
    // Every platform goes through our own endpoint (which reads the Latest
    // release's update feed), never a versioned GitHub asset URL, and stays in
    // this tab because it is a download.
    for (const target of ["mac-arm64", "mac-x64", "linux-appimage", "linux-deb"]) {
      const link = screen.getByTestId(`desktop-download-chooser-${target}`);
      assert.ok(link.getAttribute("href")?.endsWith(`/desktop-download?target=${target}`), target);
      assert.equal(link.getAttribute("target"), null, `${target} is a download: same tab`);
    }
  } finally {
    cleanup();
  }
});

test("a phone gets no desktop recommendation; a Mac gets one, labelled with its chip", () => {
  try {
    renderChooser();
    assert.ok(screen.queryByTestId("desktop-download-chooser-recommended") === null, "the phone is not the computer");
    cleanup();
    useNavigator(MAC, 0);
    renderChooser();
    const recommended = screen.getByTestId("desktop-download-chooser-recommended");
    assert.equal(recommended.textContent, "Download for Mac (Apple silicon)");
    assert.ok(recommended.getAttribute("href")?.endsWith("/desktop-download?target=mac-arm64"));
    assert.ok(screen.getByTestId("desktop-download-chooser-intel-hint"));
  } finally {
    cleanup();
  }
});

test("the chooser's iOS option also opens in a new tab", async () => {
  try {
    renderChooser();
    const ios = screen.getByTestId("mobile-download-chooser-ios");
    const android = screen.getByTestId("mobile-download-chooser-android");
    assert.equal(ios.getAttribute("target"), "_blank");
    assert.match(ios.getAttribute("rel") ?? "", /noopener/);
    assert.equal(android.getAttribute("target"), null);
  } finally {
    cleanup();
  }
});

test("neither option is styled as the recommended one", () => {
  // Same reason as the settings section: we do not know the reader's device, so
  // promoting one states a recommendation we cannot support — and here we know
  // even less, since this page exists precisely because detection failed.
  try {
    renderChooser();
    const ios = screen.getByTestId("mobile-download-chooser-ios");
    const android = screen.getByTestId("mobile-download-chooser-android");
    assert.equal(ios.className, android.className, "both platforms must look the same");
    for (const el of [ios, android]) {
      assert.match(el.className, /(?:^|\s)bg-layer-card(?:\s|$)/, "must use the neutral paper button");
      assert.doesNotMatch(el.className, /bg-attention|bg-palette-pink/, "must not take the CTA fill");
    }
  } finally {
    cleanup();
  }
});

test("the page is localized, not English-only", () => {
  try {
    renderChooser("zh-cn");
    const text = document.body.textContent ?? "";
    assert.match(text, /获取 Raft App/);
    assert.match(text, /桌面版/, "zh-cn must localize the desktop entry");
    assert.match(text, /macOS（Apple 芯片）/);
    assert.ok(!text.includes("Get the Raft App"), "zh-cn must not fall back to English");
  } finally {
    cleanup();
  }
});

/**
 * The iPad discriminator itself.
 *
 * This is the one piece of knowledge the server provably cannot have, so it is
 * tested directly rather than only through the rendered page.
 */
test("a touch-capable Mac is treated as an iPad; a real Mac is not", () => {
  const iPadOS = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15";

  assert.equal(isTouchCapableMac({ userAgent: iPadOS, maxTouchPoints: 5 }), true, "iPadOS reports touch points");
  assert.equal(isTouchCapableMac({ userAgent: iPadOS, maxTouchPoints: 0 }), false, "desktop Safari reports none");
  // A touchscreen Windows laptop is not a Mac and must not be mistaken for one.
  assert.equal(
    isTouchCapableMac({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", maxTouchPoints: 10 }),
    false,
  );
  // Must not throw where the field is absent (older browsers, non-browser render).
  assert.equal(isTouchCapableMac({ userAgent: iPadOS }), false);
  assert.equal(isTouchCapableMac(undefined), false);
});

/**
 * NOT GATED HERE: that `/download` is registered on the PUBLIC router.
 *
 * The risk is real — declared inside the authenticated shell the page would
 * still render perfectly in isolation (every test above would pass) while
 * putting a login wall in front of every QR scan. That is the same "tooth one
 * layer below production" shape @Aiden caught in the server mount, and the
 * honest position is that this half is currently unguarded.
 *
 * I tried to drive the real `App` router here. It cannot run under this suite:
 * `App` reads `import.meta.env.DEV`, which is undefined outside Vite, and every
 * other test in the repo imports NAMED exports from `App` (`ServerResolver`,
 * `AuthBootstrapStatus`) rather than rendering the default component —
 * presumably for the same reason. Faking `import.meta` to force it would make
 * the test pass by simulating a browser this suite does not have.
 *
 * Verified manually instead, on the preview at the exact head, signed out.
 * Recorded rather than left silent: an absent assertion nobody mentions is
 * indistinguishable from one somebody forgot.
 */
