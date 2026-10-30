import { expect, test } from "@playwright/test";

/**
 * The dialog's secondary controls are ghost: no surface of their own.
 *
 * The DS puts a dialog's foot as "Cancel (ghost) first, pink last", and the
 * header × is a frameless icon button (raft-ui design/components/Button,
 * Dialog). A secondary drawn with a surface — raft-ui's `default` or `outline`
 * Button — reads as a second primary beside the pink one; under the retired
 * theme families that surface even inverted to near-black and outweighed the
 * primary outright (@cindyz, 2026-08-29).
 *
 * This lives in the browser suite because it CANNOT be asserted in jsdom:
 * variants differ only once real CSS resolves — measured here as the computed
 * background. It is measured in light AND dark: a ghost is transparent in both,
 * while any surface variant resolves to an opaque colour in each mode.
 *
 * Visual browser CI measures this on selected staging pushes and daily runs.
 * Ordinary PR checks do not run these browser assertions.
 */
/**
 * BOTH shells that render a secondary control.
 *
 * `dialog-no-computer` covers the no-computer shell's × and Cancel. `dialog`
 * covers the regular Create Agent form, whose Cancel sits at the bottom of the
 * form and is a THIRD ghost site. An earlier version of this spec opened only
 * the first case, so reverting just the form's Cancel left it 2/2 green while
 * the PR body claimed all three were protected (@Dozy, review of H=10df1285e).
 * Same subset-claimed-as-whole mistake as #7052's four Banner sites — every
 * site that carries the rule gets driven.
 */
type Mode = "light" | "dark";

// The visual host reads its mode from `?theme=dark` and renders light
// otherwise (requestedMode in packages/web/visual-testing/VisualTestingCases.tsx).
const CASE = (caseId: string, mode: Mode) =>
  `/visual-testing.html?case=components.members.create-agent.${caseId}` +
  (mode === "dark" ? "&theme=dark" : "");

/** Alpha of a computed colour: `rgba(r, g, b, a)` or `oklch(l c h / a)`; 1 when opaque. */
function alpha(color: string | null): number {
  if (color === null) return Number.NaN;
  if (color === "transparent") return 0;
  const match = color.match(/\/\s*([\d.]+)\s*\)$/) ?? color.match(/^rgba\([^)]*,\s*([\d.]+)\s*\)$/);
  return match ? parseFloat(match[1]) : 1;
}

async function readSecondary(page: import("@playwright/test").Page, mode: Mode, caseId = "dialog-no-computer") {
  await page.goto(CASE(caseId, mode));
  await page.waitForSelector("button", { timeout: 10_000 });
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")];
    const pick = (m: (b: HTMLButtonElement) => boolean) => {
      const el = buttons.find(m) as HTMLButtonElement | undefined;
      return el ? getComputedStyle(el).backgroundColor : null;
    };
    return {
      cancel: pick((b) => /^cancel$/i.test((b.textContent ?? "").trim())),
      close: pick((b) => /close/i.test(b.getAttribute("aria-label") ?? "")),
      primary: pick((b) => /^add computer$/i.test((b.textContent ?? "").trim())),
    };
  });
}

for (const mode of ["light", "dark"] as Mode[]) {
  test(`${mode}: the no-computer shell's Cancel and × are ghost beside the pink primary`, async ({ page }) => {
    const read = await readSecondary(page, mode);

    for (const [name, value] of Object.entries(read)) {
      expect(value, `${mode}: ${name} must render`).not.toBeNull();
    }

    for (const name of ["cancel", "close"] as const) {
      expect(
        alpha(read[name]),
        `${mode}: ${name} got ${read[name]}. A secondary with its own surface is the \`default\`/\`outline\` variant, which competes with the primary.`,
      ).toBe(0);
    }

    // The primary is the one pink sticker on the screen; a secondary that
    // matches it is the same failure wearing a different colour.
    expect(alpha(read.primary), `${mode}: the primary has a surface`).toBeGreaterThan(0);
    expect(read.cancel).not.toBe(read.primary);
    expect(read.close).not.toBe(read.primary);
  });

  test(`${mode}: the regular form's Cancel is ghost too, not just the no-computer shell's`, async ({ page }) => {
    // The third ghost site: the Cancel at the foot of the real Create Agent
    // form. Reverting only this one is what slipped past an earlier spec.
    const read = await readSecondary(page, mode, "dialog");

    expect(read.cancel, `${mode}: the form's Cancel must render`).not.toBeNull();
    expect(
      alpha(read.cancel),
      `${mode}: form Cancel got ${read.cancel}. A secondary with its own surface is the \`default\`/\`outline\` variant.`,
    ).toBe(0);
  });
}
