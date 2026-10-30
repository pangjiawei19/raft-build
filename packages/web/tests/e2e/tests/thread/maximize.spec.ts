import { expect, test } from "@playwright/test";
import { loginViaApi } from "../../fixtures/auth";
import { waitForSeedState } from "../../fixtures/seedState";

test("Maximize folds the channel, restores its width, and retains the thread", async ({ page, request }) => {
  const seed = await waitForSeedState();
  // Other specs append and hydrate threads in the shared seed channel while
  // this spec runs. Its exact scroll coordinates need an owned, static timeline.
  const login = await loginViaApi(request, seed);
  const headers = {
    Authorization: `Bearer ${login.accessToken}`,
    "X-Server-Id": seed.server.id,
  };
  const channelResponse = await request.post(`${seed.urls.api}/api/channels`, {
    headers,
    data: { name: `maximize-${crypto.randomUUID().slice(0, 8)}` },
  });
  expect(channelResponse.ok(), await channelResponse.text()).toBeTruthy();
  const channel: { id: string } = await channelResponse.json();
  const messages: Array<{ id: string; content: string }> = [];
  for (let index = 0; index < 50; index += 1) {
    const response = await request.post(`${seed.urls.api}/api/messages`, {
      headers,
      data: { channelId: channel.id, content: `Maximize message ${index}` },
    });
    expect(response.ok()).toBeTruthy();
    messages.push(await response.json());
  }
  const focusMessage = messages[0];
  const latestMessage = messages[messages.length - 1];
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/s/${seed.server.slug}/channel/${channel.id}?thread=${channel.id}:${focusMessage.id}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("thread-overflow-trigger").waitFor({ timeout: 60_000 });
  const side = page.getByTestId("thread-side-column");
  const main = page.locator(".thread-main-column");
  await expect(main).toBeVisible();
  const root = await side.locator('[data-slot="thread-panel-root"]').elementHandle();
  expect(root).not.toBeNull();
  const scroller = main.getByTestId("message-scroller");
  // The thread header can mount before the channel's initial tail layout.
  // Wait for loaded content and room for the upward gesture before sampling.
  await expect(scroller.getByText(latestMessage.content)).toBeVisible();
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(300);
  // Establish a real reading gesture before the fixture sets its exact position.
  await scroller.hover();
  const beforeWheel = await scroller.evaluate((node) => node.scrollTop);
  await page.mouse.wheel(0, -300);
  // mouse.wheel returns before compositor scrolling; do not stack the exact
  // position onto a pending wheel and accidentally trigger older-page loading.
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeLessThan(beforeWheel);
  await scroller.evaluate((node) => { node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight - 300); node.dispatchEvent(new Event("scroll")); });
  await page.waitForTimeout(250);
  const originalScroll = await scroller.evaluate((node) => node.scrollTop);
  const originalWidth = (await side.boundingBox())!.width;
  const persistedWidth = await page.evaluate(() => localStorage.getItem("slock:threadPanelWidth"));
  await page.getByTestId("thread-overflow-trigger").click();
  await expect(page.getByRole("menuitem").first()).toHaveText("Focus mode");
  await page.getByTestId("thread-overflow-maximize").click();
  await expect(main).toBeHidden();
  expect((await side.locator('[data-slot="thread-panel-root"]').boundingBox())!.width).toBeGreaterThan(originalWidth);
  expect((await side.boundingBox())!.width).toBe(originalWidth);
  await page.getByTestId("thread-overflow-trigger").click();
  await expect(page.getByRole("menuitem").first()).toHaveText("Standard mode");
  await page.getByTestId("thread-overflow-maximize").click();
  await expect(main).toBeVisible();
  expect((await side.boundingBox())!.width).toBe(originalWidth);
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBe(originalScroll);
  expect(await side.locator('[data-slot="thread-panel-root"]').evaluate((node, original) => node === original, root)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem("slock:threadPanelWidth"))).toBe(persistedWidth);
  await page.getByTestId("thread-overflow-trigger").click();
  await page.getByTestId("thread-overflow-maximize").click();
  await page.getByTestId("thread-parent-avatar").click();
  const profile = page.getByTestId("profile-panel");
  await expect(profile).toBeVisible();
  await expect(page.getByTestId("thread-layout-container")).toHaveAttribute("data-thread-maximized", "false");
  expect(await profile.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  })).toBe(true);

});

test("phone thread menu omits the channel layout action", async ({ page }) => {
  const seed = await waitForSeedState();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/s/${seed.server.slug}/channel/${seed.channel.id}?thread=${seed.channel.id}:${seed.messages.focusMessageId}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("thread-overflow-trigger").waitFor({ timeout: 60_000 });
  await page.getByTestId("thread-overflow-trigger").click();
  await expect(page.getByTestId("thread-overflow-menu")).toBeVisible();
  await expect(page.getByTestId("thread-overflow-maximize")).toHaveCount(0);
});
