import { test } from "@playwright/test";
import { expectCssColor } from "../fixtures/colorAssertions";
import { loginViaApi } from "../fixtures/auth";
import { waitForSeedState } from "../fixtures/seedState";

/**
 * Pins the desktop layout color contract (stdrc 2026-05-02
 * #proj-uiux:95e25b5b), which the Raft Design System keeps: colour thins
 * from the outside in, yellow → cream → white.
 *
 *   Rail (the frame, yellow #FFD440)
 *     │
 *     │  Sidebar column (cream #FFFAEF — desktop only)
 *     │    └─ Sidebar header (56 tall) also cream
 *     │
 *     │  Main panel column (paper, white #FFFFFF)
 *     │    └─ Panel header (56 tall) also white
 *     │    └─ Messages scroller white
 *
 * Mobile (<md) has no cream: every screen sits on paper, including the
 * channel list (there's no side-by-side to differentiate against).
 *
 * Areas meet at a single 1px `line-seam`; the side drawn first owns it.
 *
 * This spec asserts the rendered backgroundColor for each region via
 * getComputedStyle, so any regression on the theme tokens lights up here.
 * Elements are located by their raft-ui data-slot hooks, not by Tailwind
 * class names. */
test.describe("layout color contract (desktop)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("LeftRail = yellow / Sidebar = cream / Main = white", async ({
    page,
    request,
  }) => {
    const seedState = await waitForSeedState();
    await loginViaApi(request, seedState);
    await page.goto(seedState.urls.web);
    // Wait for the desktop shell to be present. The layout regions are
    // addressed by their stable data-slot hooks, not Tailwind class names.
    await page.waitForSelector('[data-slot="app-rail-root"]', { timeout: 10_000 });
    await page.waitForSelector('[data-slot="sidebar-root"]', { timeout: 10_000 });
    await page.waitForSelector('[data-slot="conversation-panel-root"]', { timeout: 10_000 });

    const colors = await page.evaluate(() => {
      // The Rail is raft-ui's AppRail root: the frame, yellow in light.
      const leftRail = document.querySelector(
        '[data-slot="app-rail-root"]',
      ) as HTMLElement | null;
      // The sidebar column: cream paper, desktop only.
      const sidebar = document.querySelector(
        '[data-slot="sidebar-root"]',
      ) as HTMLElement | null;
      // The main panel: paper.
      const mainCandidate = document.querySelector(
        '[data-slot="conversation-panel-root"]',
      ) as HTMLElement | null;
      return {
        leftRail: leftRail ? getComputedStyle(leftRail).backgroundColor : null,
        sidebar: sidebar ? getComputedStyle(sidebar).backgroundColor : null,
        main: mainCandidate
          ? getComputedStyle(mainCandidate).backgroundColor
          : null,
      };
    });

    // frame yellow: #FFD440 = rgb(255, 212, 64). The rail paints raft-ui's
    // frame token (an oklch value), whose color-space round-trip can land at
    // [255,212,65] — hence tolerance 1, not a changed contract.
    await expectCssColor(page, colors.leftRail, "#FFD440", 1);
    // sidebar cream = #FFFAEF = rgb(255, 250, 239)
    await expectCssColor(page, colors.sidebar, "#FFFAEF");
    // paper = #FFFFFF
    await expectCssColor(page, colors.main, "#FFFFFF");
  });
});
