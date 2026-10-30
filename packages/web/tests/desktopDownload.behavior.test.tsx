// @ts-nocheck
import assert from "node:assert/strict";
import "./helpers/domSetup";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { TestIntlProvider } from "./helpers/intl";
import DesktopDownloadOptions, { desktopDownloadOptions, resetDesktopPlatformsForTest } from "../src/components/settings/DesktopDownloadOptions";
import { AboutSection } from "../src/components/settings/SettingsPanel";
import {
  DEFAULT_DESKTOP_PLATFORMS,
  desktopDownloadUrl,
  detectDesktopOs,
  detectMacArch,
  recommendedDesktopDownload,
} from "../src/utils/desktopDownload";

// Real User-Agent strings, not paraphrases.
const UA = {
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  windowsChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
  linuxArm: "Mozilla/5.0 (X11; Linux aarch64; rv:131.0) Gecko/20100101 Firefox/131.0",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  chromebook: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};

const RELEASED = {
  mac: { status: "available", version: "0.1.42", universal: false },
  linux: { status: "available", version: "0.1.42" },
  windows: { status: "none" },
};

function servePlatforms(platforms) {
  resetDesktopPlatformsForTest(async () => {
    if (platforms === null) throw new Error("down");
    return platforms;
  });
}
beforeEach(() => { servePlatforms(RELEASED); });
afterEach(() => { resetDesktopPlatformsForTest(); cleanup(); });

async function withNavigator(nav, fn) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true });
  try { return await fn(); } finally { if (original) Object.defineProperty(globalThis, "navigator", original); }
}

test("detects the desktop OS of this device; phones, tablets, ChromeOS and ARM Linux get none", () => {
  assert.equal(detectDesktopOs({ userAgent: UA.macSafari, maxTouchPoints: 0 }), "mac");
  assert.equal(detectDesktopOs({ userAgent: UA.windowsChrome }), "windows");
  assert.equal(detectDesktopOs({ userAgent: UA.linuxFirefox }), "linux");
  assert.equal(detectDesktopOs({ userAgent: UA.linuxArm }), null, "only x86_64 Linux builds exist");
  assert.equal(detectDesktopOs({ userAgent: UA.android }), null, "Android says Linux in its UA but is not a desktop");
  assert.equal(detectDesktopOs({ userAgent: UA.iphone }), null);
  assert.equal(detectDesktopOs({ userAgent: UA.chromebook }), null, "ChromeOS cannot install these builds");
  assert.equal(detectDesktopOs({ userAgent: UA.windowsChrome.replace("Win64", "Microsoft") }), "windows", "'cros' inside a word is not ChromeOS");
  // iPadOS sends the Mac UA; only maxTouchPoints tells it apart.
  assert.equal(detectDesktopOs({ userAgent: UA.macSafari, maxTouchPoints: 5 }), null, "an iPad must not be offered a .dmg");
  // Client hints win: a large Android tablet's Chrome sends a desktop Linux UA
  // but still reports its real platform.
  assert.equal(detectDesktopOs({ userAgent: UA.linuxFirefox, userAgentData: { platform: "Android", mobile: false } }), null);
  assert.equal(detectDesktopOs({ userAgent: UA.macChrome, userAgentData: { platform: "macOS", mobile: false } }), "mac");
  assert.equal(detectDesktopOs({ userAgent: UA.chromebook, userAgentData: { platform: "Chrome OS", mobile: false } }), null);
  assert.equal(detectDesktopOs(undefined), null);
});

test("a Mac's chip comes only from Chromium's client hints; Safari stays unknown", async () => {
  const hints = (architecture) => ({ userAgentData: { getHighEntropyValues: async () => ({ architecture }) } });
  assert.equal(await detectMacArch(hints("arm")), "arm64");
  assert.equal(await detectMacArch(hints("x86")), "x64");
  assert.equal(await detectMacArch(hints("")), null);
  assert.equal(await detectMacArch({}), null, "Safari has no client hints and reports every Mac as Intel");
  assert.equal(await detectMacArch({ userAgentData: { getHighEntropyValues: async () => { throw new Error("denied"); } } }), null);
});

test("Mac recommendation never hands an Intel Mac an Apple silicon build under a plain label", () => {
  // No universal build: an unknown chip gets Apple silicon, SAID so, with the Intel hint.
  assert.deepEqual(recommendedDesktopDownload("mac", null, RELEASED), { target: "mac-arm64", kind: "macAppleSilicon", intelHint: true });
  assert.deepEqual(recommendedDesktopDownload("mac", "arm64", RELEASED), { target: "mac-arm64", kind: "macAppleSilicon", intelHint: false });
  assert.deepEqual(recommendedDesktopDownload("mac", "x64", RELEASED), { target: "mac-x64", kind: "macIntel", intelHint: false });
  // A universal build serves every Mac under the plain label.
  const universal = { ...RELEASED, mac: { ...RELEASED.mac, universal: true } };
  assert.deepEqual(recommendedDesktopDownload("mac", "x64", universal), { target: "mac", kind: "mac", intelHint: false });
  assert.deepEqual(recommendedDesktopDownload("mac", null, universal), { target: "mac", kind: "mac", intelHint: false });
});

test("Windows is offered exactly when the release has it; GitHub being down never invents it", () => {
  assert.equal(recommendedDesktopDownload("windows", null, RELEASED), null);
  assert.equal(recommendedDesktopDownload("windows", null, DEFAULT_DESKTOP_PLATFORMS), null);
  assert.deepEqual(recommendedDesktopDownload("windows", null, { ...RELEASED, windows: { status: "available", version: "0.1.43" } }), { target: "windows", kind: "windows", intelHint: false });
  assert.equal(desktopDownloadOptions(RELEASED).find((o) => o.target === "windows").available, false);
  // Mac and Linux stay offered while the release has not answered.
  assert.ok(desktopDownloadOptions(DEFAULT_DESKTOP_PLATFORMS).filter((o) => o.target !== "windows").every((o) => o.available));
  assert.equal(recommendedDesktopDownload("linux", null, RELEASED).target, "linux-appimage", "AppImage runs on any distribution");
});

test("with a universal build the list has one macOS entry", () => {
  const targets = desktopDownloadOptions({ ...RELEASED, mac: { ...RELEASED.mac, universal: true } }).map((o) => o.target);
  assert.deepEqual(targets, ["mac", "windows", "linux-appimage", "linux-deb"]);
  assert.deepEqual(desktopDownloadOptions(RELEASED).map((o) => o.target), ["mac-arm64", "mac-x64", "windows", "linux-appimage", "linux-deb"]);
});

test("every link goes through our endpoint with an explicit target", () => {
  assert.equal(desktopDownloadUrl("mac", "https://api.example/api"), "https://api.example/api/desktop-download?target=mac");
  assert.equal(desktopDownloadUrl("linux-deb", "https://api.example/api/"), "https://api.example/api/desktop-download?target=linux-deb");
});

test("About: a Safari Mac gets 'Download for Mac (Apple silicon)', the Intel hint, and every platform", async () => {
  await withNavigator({ userAgent: UA.macSafari, maxTouchPoints: 0 }, async () => {
    render(<TestIntlProvider><DesktopDownloadOptions /></TestIntlProvider>);
    const primary = screen.getByTestId("desktop-download-recommended");
    assert.equal(primary.textContent, "Download for Mac (Apple silicon)");
    assert.ok(primary.getAttribute("href")?.endsWith("/desktop-download?target=mac-arm64"));
    assert.equal(primary.getAttribute("target"), null, "a download stays in this tab");
    assert.ok(screen.getByTestId("desktop-download-intel-hint"));
    for (const target of ["mac-arm64", "mac-x64", "linux-appimage", "linux-deb"]) {
      assert.equal(screen.getByTestId(`desktop-download-${target}`).tagName, "A", target);
    }
  });
});

test("About: once the release carries a universal build, a Mac gets the plain button", async () => {
  servePlatforms({ ...RELEASED, mac: { ...RELEASED.mac, universal: true } });
  await withNavigator({ userAgent: UA.macSafari, maxTouchPoints: 0 }, async () => {
    render(<TestIntlProvider><DesktopDownloadOptions /></TestIntlProvider>);
    await waitFor(() => assert.equal(screen.getByTestId("desktop-download-recommended").textContent, "Download for Mac"));
    assert.ok(screen.queryByTestId("desktop-download-intel-hint") === null);
  });
});

test("About: a Chromium Intel Mac is recommended the Intel build", async () => {
  await withNavigator({ userAgent: UA.macChrome, maxTouchPoints: 0, userAgentData: { platform: "macOS", mobile: false, getHighEntropyValues: async () => ({ architecture: "x86" }) } }, async () => {
    render(<TestIntlProvider><DesktopDownloadOptions /></TestIntlProvider>);
    await waitFor(() => assert.equal(screen.getByTestId("desktop-download-recommended").getAttribute("data-target"), "mac-x64"));
  });
});

test("About: Windows reads 'coming soon' until the release has a Windows build, then gets a button", async () => {
  await withNavigator({ userAgent: UA.windowsChrome }, async () => {
    render(<TestIntlProvider><DesktopDownloadOptions /></TestIntlProvider>);
    await waitFor(() => assert.ok(screen.getByTestId("desktop-download-windows-soon")));
    assert.ok(screen.queryByTestId("desktop-download-recommended") === null);
    assert.equal(screen.getByTestId("desktop-download-windows").tagName, "SPAN", "not a link");
    cleanup();
    servePlatforms({ ...RELEASED, windows: { status: "available", version: "0.1.43" } });
    render(<TestIntlProvider><DesktopDownloadOptions /></TestIntlProvider>);
    await waitFor(() => assert.equal(screen.getByTestId("desktop-download-recommended").textContent, "Download for Windows"));
  });
});

test("About: a phone gets no recommendation, just the list", async () => {
  await withNavigator({ userAgent: UA.iphone, maxTouchPoints: 5 }, async () => {
    render(<TestIntlProvider locale="zh-cn"><DesktopDownloadOptions /></TestIntlProvider>);
    assert.ok(screen.queryByTestId("desktop-download-recommended") === null);
    assert.match(document.body.textContent ?? "", /选择你的平台/);
  });
});

test("About: the section is web-only — inside Raft Desktop it is not rendered", async () => {
  await withNavigator({ userAgent: UA.macSafari, maxTouchPoints: 0 }, async () => {
    render(<TestIntlProvider><AboutSection showWorkspace={false} /></TestIntlProvider>);
    assert.ok(screen.getByTestId("desktop-download"), "rendered in a browser");
    cleanup();
    window.raftDesktop = { isDesktop: true };
    try {
      render(<TestIntlProvider><AboutSection showWorkspace={false} /></TestIntlProvider>);
      assert.ok(screen.queryByTestId("desktop-download") === null, "not inside the desktop app");
    } finally {
      delete window.raftDesktop;
    }
  });
});
