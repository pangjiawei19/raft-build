import { expect, test } from "@playwright/test";
import { expectCssColor } from "../../fixtures/colorAssertions";
import { loginViaApi } from "../../fixtures/auth";
import { waitForSeedState } from "../../fixtures/seedState";

test.use({ viewport: { width: 390, height: 844 } });

test.describe("mobile iOS standalone chrome", () => {
  test("lets the app wrapper own the safe-area color per route", async ({ page, request }) => {
    const seedState = await waitForSeedState();
    await loginViaApi(request, seedState);

    await page.goto(`/s/${seedState.server.slug}`);
    await expect(page.getByText(seedState.server.name)).toBeVisible();

    const rootColors = await page.evaluate(() => {
      const appRoot = document.querySelector<HTMLElement>("#root > div");
      return {
        themeColor: document
          .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
          ?.content,
        statusBarStyle: document
          .querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-status-bar-style"]')
          ?.content,
        html: getComputedStyle(document.documentElement).backgroundColor,
        body: getComputedStyle(document.body).backgroundColor,
        appRoot: appRoot ? getComputedStyle(appRoot).backgroundColor : null,
      };
    });

    expect(rootColors.themeColor).toBe("#FFD440");
    expect(rootColors.statusBarStyle).toBe("black-translucent");
    // The page canvas is paper; the wrapper paints the frame on tab roots and
    // paper on pushed pages (Raft DS: yellow frame, every phone screen on paper).
    await expectCssColor(page, rootColors.html, "#FFFFFF");
    await expectCssColor(page, rootColors.body, "#FFFFFF");
    await expectCssColor(page, rootColors.appRoot, "#FFD440", 1);

    await page.goto(`/s/${seedState.server.slug}/tasks`);
    await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
    const tasksRootColors = await page.evaluate(() => {
      const appRoot = document.querySelector<HTMLElement>("#root > div");
      return {
        themeColor: document
          .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
          ?.content,
        appRoot: appRoot ? getComputedStyle(appRoot).backgroundColor : null,
      };
    });
    expect(tasksRootColors.themeColor).toBe("#FFD440");
    await expectCssColor(page, tasksRootColors.appRoot, "#FFD440", 1);

    await page.goto(`/s/${seedState.server.slug}/channel/${seedState.channel.id}`);
    await expect(page.getByPlaceholder(`Message #${seedState.channel.name}`)).toBeVisible();

    const detailColors = await page.evaluate(() => {
      const appRoot = document.querySelector<HTMLElement>("#root > div");
      return {
        themeColor: document
          .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
          ?.content,
        appRoot: appRoot ? getComputedStyle(appRoot).backgroundColor : null,
      };
    });

    expect(detailColors.themeColor).toBe("#FFFFFF");
    await expectCssColor(page, detailColors.appRoot, "#FFFFFF");
  });

  // Raft DS › TabBar: the tab bar is an edge bar on the card surface with a
  // seam on top, the last thing in the column; nothing floats over the content
  // and nothing is stacked above it. A tab root wears the frame (yellow in
  // light, the neutral #0d0d0b in dark) and the browser chrome follows it.
  test("the tab bar is an in-flow edge bar under the frame-coloured shell, in light and dark", async ({
    page,
    request,
  }) => {
    const seedState = await waitForSeedState();
    await loginViaApi(request, seedState);

    const setDeviceThemeMode = async (mode: "light" | "dark") => {
      await page.evaluate((nextMode) => {
        window.localStorage.setItem("slock-theme-preferences-v2", JSON.stringify({ mode: nextMode }));
      }, mode);
      await page.reload();
    };

    const readShell = async () =>
      page.evaluate(() => {
        const appRoot = document.querySelector<HTMLElement>("#root > div");
        const nav = document.querySelector<HTMLElement>('[data-slot="mobile-nav-root"]');
        const navStyle = nav ? getComputedStyle(nav) : null;
        return {
          themeColor: document
            .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
            ?.content,
          appRoot: appRoot ? getComputedStyle(appRoot).backgroundColor : null,
          navPosition: navStyle?.position ?? null,
          navBorderTopWidth: navStyle?.borderTopWidth ?? null,
          floatingOverlays: document.querySelectorAll(
            '[data-testid="mobile-bottom-bar-overlay"], [data-testid="mobile-live-activity-slot"]',
          ).length,
        };
      });

    await page.goto(`/s/${seedState.server.slug}`);
    await expect(page.getByText(seedState.server.name)).toBeVisible();

    for (const [mode, frame] of [["light", "#FFD440"], ["dark", "#0D0D0B"]] as const) {
      await setDeviceThemeMode(mode);
      await expect(page.getByText(seedState.server.name)).toBeVisible();

      const shell = await readShell();
      expect(shell.themeColor).toBe(frame);
      await expectCssColor(page, shell.appRoot, frame, 1);
      expect(shell.navPosition).not.toBe("fixed");
      expect(shell.navPosition).not.toBe("absolute");
      expect(shell.navBorderTopWidth).toBe("1px");
      expect(shell.floatingOverlays).toBe(0);

      // The bar sits on the bottom edge of the viewport, in flow.
      const navBox = await page.locator('[data-slot="mobile-nav-root"]').boundingBox();
      expect(navBox).not.toBeNull();
      expect(Math.abs((navBox?.y ?? 0) + (navBox?.height ?? 0) - page.viewportSize()!.height)).toBeLessThanOrEqual(1);
    }

    // The list ends above the bar: its last row scrolls fully clear of it
    // without any reserved clearance under a floating capsule.
    const lastRow = page.locator("[data-sidebar-channel-id]").last();
    await lastRow.scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>(
        '[data-testid="sidebar-scroll-surface"]',
      );
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
    const rowBox = await lastRow.boundingBox();
    const navBox = await page.locator('[data-slot="mobile-nav-root"]').boundingBox();
    expect(rowBox).not.toBeNull();
    expect(navBox).not.toBeNull();
    expect((rowBox?.y ?? 0) + (rowBox?.height ?? 0)).toBeLessThanOrEqual((navBox?.y ?? 0) + 1);
  });
});
