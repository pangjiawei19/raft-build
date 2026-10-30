import { expect, test } from "@playwright/test";

/**
 * The Create Agent capacity banner is a raft-ui Banner that follows the mode.
 *
 * Before the raft-ui swap this banner was hand-rolled from raw utilities
 * (`border-2 border-black bg-brutal-orange/20`): a literal surface and a hard
 * black rule that nothing above the callsite could restyle, so it rendered
 * identically whatever the shell around it did.
 *
 * Read in light AND dark and required to disagree, because that is the only
 * shape of assertion a hardcoded colour cannot satisfy. A single-mode
 * measurement cannot tell a literal from a token — which is exactly how the
 * `text-black/60` override on KeyValueAddButton survived a fully green suite
 * (@Dozy, PR #7010).
 *
 * The register is the DS Banner (raft-ui design/components/Banner): a soft
 * intent surface on the container radius (radius-lg, 10), a 1px `line` hairline
 * drawn inside, no ink border, 12/14 padding and 14/20 text.
 *
 * Uses the real Create Agent dialog via the `dialog-capacity-banner` case.
 * Neither of this dialog's banners rendered in ANY case before that was added:
 * a surface no case renders cannot regress visibly.
 */
type Mode = "light" | "dark";

// The visual host reads its mode from `?theme=dark` and renders light
// otherwise (requestedMode in packages/web/visual-testing/VisualTestingCases.tsx).
const CASE = (mode: Mode) =>
  "/visual-testing.html?case=components.members.create-agent.dialog-capacity-banner" +
  (mode === "dark" ? "&theme=dark" : "");

async function readBanner(page: import("@playwright/test").Page, mode: Mode) {
  await page.goto(CASE(mode));
  // Wait for the DIALOG, not the banner slot. Waiting on `[data-slot="banner"]`
  // means a revert to the hand-rolled banner (a bare div with no slot) fails as
  // a bare 10s timeout, which reads as "the harness is broken" rather than "this
  // is not a raft-ui Banner". Let the assertion below say that instead.
  await page.waitForSelector('[data-testid], form', { timeout: 10_000 });
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    const root = document.querySelector('[data-slot="banner"]');
    const description = document.querySelector('[data-slot="banner-description"]');
    if (!root || !description) {
      // Distinguish "nothing rendered" from "rendered, but not a raft-ui Banner".
      const legacy = [...document.querySelectorAll("div")].some(
        (d) => typeof d.className === "string" && /bg-brutal-orange/.test(d.className),
      );
      return { missing: true as const, legacyBannerPresent: legacy };
    }
    const s = getComputedStyle(root);
    const d = getComputedStyle(description);
    return {
      background: s.backgroundColor,
      borderWidth: s.borderTopWidth,
      boxShadow: s.boxShadow,
      radius: s.borderRadius,
      padding: s.padding,
      textMetrics: `${d.fontSize}/${d.lineHeight}`,
      text: (description.textContent ?? "").trim(),
    };
  });
}

test("the capacity banner is a raft-ui Banner that follows the mode", async ({ page }) => {
  const light = await readBanner(page, "light");
  const dark = await readBanner(page, "dark");

  // Preconditions. Without these the inequality below passes vacuously on a
  // banner that failed to render at all.
  for (const [mode, read] of [["light", light], ["dark", dark]] as const) {
    expect(read, `${mode}: the capacity banner must render`).not.toBeNull();
    expect(
      "missing" in read ? read.legacyBannerPresent : false,
      `${mode}: found the hand-rolled banner (bg-brutal-orange) instead of a raft-ui Banner — the callsite was reverted off <Banner status=...>`,
    ).toBe(false);
    expect("missing" in read, `${mode}: no [data-slot="banner"] rendered`).toBe(false);
    if ("missing" in read) continue;

    expect(read.text).toMatch(/agent limit reached/i);
    // The DS register, in both modes: a highlight, not a sticker.
    expect(read.borderWidth, `${mode}: no ink border — the soft surface is a highlight, not a sticker`).toBe("0px");
    expect(read.boxShadow, `${mode}: the 1px line hairline sits inside the container`).toContain("0px 0px 0px 1px inset");
    expect(read.radius, `${mode}: container radius (radius-lg)`).toBe("10px");
    expect(read.padding, `${mode}: banner padding`).toBe("12px 14px");
    expect(read.textMetrics, `${mode}: banner text`).toBe("14px/20px");
  }

  // `[data-slot="banner"]` only exists on raft-ui's Banner — the hand-rolled one
  // was a bare div, so reaching this point already proves the swap held.
  const lightBg = "missing" in light ? null : light.background;
  const darkBg = "missing" in dark ? null : dark.background;
  expect(
    darkBg,
    `the banner's surface must change with the mode — got ${lightBg} in both, which is what the hand-rolled bg-brutal-orange/20 did`,
  ).not.toBe(lightBg);
});
