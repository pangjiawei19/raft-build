import { writeFile } from "node:fs/promises";
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { test, seedThreadWindow } from "../../fixtures/scenario";
import { expectThreadFocusedWindow } from "../../fixtures/readiness";
import { expectCssColor } from "../../fixtures/colorAssertions";

async function threadRenderedIds(page: Page): Promise<string[]> {
  return page.getByTestId("thread-message-scroller").evaluate((el) => Array.from(new Set(
    Array.from(el.querySelectorAll<HTMLElement>("[data-message-id]"))
      .map((node) => node.dataset.messageId ?? "")
      .filter(Boolean),
  )));
}

test.describe("thread search lazy hydration", () => {
  test("native Home navigation resumes focused thread history", async ({ page, scenario }, testInfo) => {
    const seeded = await seedThreadWindow(scenario.seed);
    const pages: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "GET" && request.url().includes(`/messages/channel/${seeded.threadChannelId}`)
        && request.url().includes("limit=50") && request.url().includes("before=")) pages.push(request.url());
    });
    await page.goto(`/s/${scenario.seed.server.slug}/channel/${scenario.seed.channel.id}`
      + `?thread=${scenario.seed.channel.id}:${seeded.parentId}&msg=${seeded.newerReplyId}`);
    await expectThreadFocusedWindow(page, seeded.newerReplyId);
    const scroller = page.getByTestId("thread-message-scroller");
    await scroller.evaluate((element) => {
      const events: object[] = [];
      const record = (event: Event) => {
        events.push({ type: event.type, at: event.timeStamp, sampledAt: performance.now(),
          key: event instanceof KeyboardEvent ? event.key : null,
          cancelled: event.defaultPrevented, target: (event.target as HTMLElement)?.tagName,
          focused: document.activeElement === element, top: element.scrollTop,
          height: element.scrollHeight, viewport: element.clientHeight });
        if (events.length > 100) events.shift();
      };
      Object.defineProperty(element, "keyboardEvidence", { get: () => events });
      for (const type of ["focusin", "scroll"]) element.addEventListener(type, record);
      element.addEventListener("keydown", (event) => requestAnimationFrame(() => record(event)));
    });
    try {
      // A visible row alone can precede the initial center-positioning rAF.
      // Require the requested alignment and stable geometry across the same
      // frame sequence used by the timeline's positioning guard.
      await expect.poll(() => scroller.evaluate(async (element, messageId) => {
        let previous = "";
        let stable = 0;
        for (let frame = 0; frame < 4; frame += 1) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const row = element.querySelector<HTMLElement>(`[data-timeline-message-id="${messageId}"]`);
          if (!row) return false;
          const bounds = element.getBoundingClientRect();
          const rect = row.getBoundingClientRect();
          const expected = Math.max(0, Math.min(element.scrollHeight - element.clientHeight,
            element.scrollTop + (rect.top + rect.bottom - bounds.top - bounds.bottom) / 2));
          if (Math.abs(element.scrollTop - expected) > 2) return false;
          const state = `${element.scrollTop}:${element.scrollHeight}:${element.clientHeight}`;
          stable = state === previous ? stable + 1 : 0;
          previous = state;
        }
        return stable === 3;
      }, seeded.newerReplyId), { timeout: 5000, message: "initial focused reply positioning must finish before keyboard setup" }).toBe(true);
      // Explicit focusability also exercises engines which do not auto-focus
      // native scroll containers, including WebKit. Start part-way down the
      // focused window, inside its scroll range: how tall that window is
      // follows the row metrics (the reply count now reads in the header, not
      // as a divider in the scroller), so a fixed offset may sit past the end.
      const keyboardStart = await scroller.evaluate((element) => {
        element.setAttribute("tabindex", "0");
        (element as HTMLElement).focus();
        const start = Math.min(270, Math.floor((element.scrollHeight - element.clientHeight) / 2));
        element.scrollTop = start;
        return start;
      });
      expect(keyboardStart, "the focused window must leave room to scroll toward older replies").toBeGreaterThan(0);
      await expect(scroller).toBeFocused();
      await expect.poll(() => scroller.evaluate(async (element, start) => {
        let dimensions = "";
        for (let frame = 0; frame < 4; frame += 1) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          if (Math.abs(element.scrollTop - start) > 1 || document.activeElement !== element) return false;
          const current = `${element.scrollHeight}:${element.clientHeight}`;
          if (dimensions && dimensions !== current) return false;
          dimensions = current;
        }
        return true;
      }, keyboardStart), { timeout: 5000, message: "keyboard start position and focus must remain stable" }).toBe(true);
      expect(pages).toEqual([]);
      await scroller.press("Home");
      await expect.poll(() => pages.length,
        { message: "native keyboard scrolling must resume older history paging" }).toBeGreaterThan(0);
    } catch (error) {
      const evidencePath = testInfo.outputPath("keyboard-scroll-evidence.json");
      await writeFile(evidencePath, JSON.stringify({ pages, state: await scroller.evaluate((element) => ({
          focused: document.activeElement === element,
          activeTag: document.activeElement?.tagName, top: element.scrollTop,
          height: element.scrollHeight, viewport: element.clientHeight,
          events: Reflect.get(element, "keyboardEvidence"),
        })) }));
      await testInfo.attach("keyboard-scroll-evidence", { path: evidencePath, contentType: "application/json" });
      throw error;
    }
  });

  test("finds an older reply that is not in the initially rendered focused window", async ({ page, scenario }) => {
    const { seed: seedState } = scenario;
    const seeded = await seedThreadWindow(seedState);

    const threadFetches: string[] = [];
    const sentinelFetchesAfterContextRequest: string[] = [];
    let searchContextRequestSeen = false;
    page.on("request", (req) => {
      const url = req.url();
      if (
        req.method() === "GET"
        && url.includes("/messages/context/")
        && url.includes(`channelId=${seeded.threadChannelId}`)
        && !url.includes(seeded.newerReplyId)
      ) {
        searchContextRequestSeen = true;
      }
      if (req.method() === "GET" && url.includes(`/messages/channel/${seeded.threadChannelId}`)) {
        threadFetches.push(url);
        if (
          searchContextRequestSeen
          && url.includes("limit=50")
          && (url.includes("before=") || url.includes("after="))
        ) {
          sentinelFetchesAfterContextRequest.push(url);
        }
      }
    });

    await page.goto(
      `/s/${seedState.server.slug}/channel/${seedState.channel.id}` +
        `?thread=${seedState.channel.id}:${seeded.parentId}&msg=${seeded.newerReplyId}`,
    );
    const scroller = page.getByTestId("thread-message-scroller");
    await expectThreadFocusedWindow(page, seeded.newerReplyId);
    await expect(scroller.getByText(`${seeded.olderNeedle}`)).toHaveCount(0);
    const initialRenderedCount = (await threadRenderedIds(page)).length;
    expect(initialRenderedCount, "focused open should render a partial thread window").toBeLessThan(
      seeded.totalMessageRows,
    );

    // Programmatic positioning must not turn a permalink's bounded window
    // into ordinary history pagination before the reader scrolls.
    await scroller.evaluate((element) => { element.scrollTop = 0; });
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => { window.setTimeout(resolve, 50); }));
    }));
    expect(threadFetches.filter((url) => url.includes("limit=50") && url.includes("before=")),
      "focused entry must wait for a real user scroll before loading history").toEqual([]);

    await page.getByTestId("thread-overflow-trigger").click();
    await page.getByTestId("thread-overflow-search").click();
    await page.getByTestId("thread-search-input").fill(seeded.olderNeedle);

    await expect(page.getByTestId("thread-search-count")).toHaveText("1/1", { timeout: 10_000 });
    await expect(scroller.getByText(seeded.olderNeedle)).toBeVisible();
    // The highlighted reply row says so with `data-highlighted="true"`
    // (MessageItem.tsx), not a colour class.
    await expect(scroller.locator('[data-highlighted="true"]').filter({ hasText: seeded.olderNeedle })).toBeVisible();
    const highlightedCodeMatch = scroller
      .locator("code")
      .getByTestId("thread-search-fragment-highlight")
      .filter({ hasText: seeded.olderNeedle });
    await expect(highlightedCodeMatch).toBeVisible();
    // Raft DS › Search: a hit is a small yellow sticker (what you looked for),
    // opaque yellow like @you, not a translucent wash.
    const highlightBackground = await highlightedCodeMatch.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    await expectCssColor(page, highlightBackground, "#FFD440", 1);

    // Expose the top sentinel without a wheel/touch gesture. The bounded
    // context must remain stable through programmatic layout/scroll changes;
    // only a subsequent real user scroll may resume timeline pagination.
    await scroller.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        window.setTimeout(resolve, 50);
      }));
    }));
    expect(
      sentinelFetchesAfterContextRequest,
      "the bounded search context must not trigger timeline sentinel paging before a user scroll",
    ).toEqual([]);

    const olderFetch = threadFetches.find((url) => url.includes("before="));
    expect(olderFetch, "search must hydrate older thread pages instead of matching only rendered DOM").toBeTruthy();
    const finalRenderedCount = (await threadRenderedIds(page)).length;
    expect(finalRenderedCount, "search hydration should expand the loaded thread window").toBeGreaterThan(initialRenderedCount);
    expect(finalRenderedCount, "search must not force-render the full thread").toBeLessThan(
      seeded.totalMessageRows,
    );

    // The context barrier is temporary: a real scroll resumes pagination.
    await scroller.hover();
    await page.mouse.wheel(0, 10000);
    await expect.poll(() => sentinelFetchesAfterContextRequest.length,
      { message: "a real user scroll must resume bounded-context history paging" }).toBeGreaterThan(0);
  });
});
