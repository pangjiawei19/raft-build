import { expect, test } from "@playwright/test";

/**
 * Textarea joins the field metric axis (cindyz's ruling, 2026-08-25).
 *
 * The DS TextField is one box for single- and multi-line input: the textarea
 * types its text exactly like the input (16/24). Before raft-ui's textarea
 * recipe took `text-field font-field`, the Description textarea carried no field
 * metrics at all — it looked right only because a hardcoded `text-sm` happened
 * to equal the field token of the day, 14px/20px including line-height. Move the
 * token and the Input would follow while the textarea stayed put, with nothing
 * going red.
 *
 * So this file asserts two different things, and the second is the point:
 *   1. the textarea's computed metrics equal the field tokens (held to the DS)
 *   2. the textarea AGREES WITH THE INPUT
 * (1) alone can pass on a coincidence — a hardcoded value that happens to match
 * today's token. (2) is what actually encodes "these two move together", which is
 * the property cindyz asked for.
 */

type Metrics = { fontSize: string; fontWeight: string; lineHeight: string };

/** One Description textarea and one Name input in the Create Agent dialog. */
const TEXTAREA_COUNT = 1;
const INPUT_COUNT = 1;

const CASE = "/visual-testing.html?case=components.members.create-agent.dialog";

async function settle(page: import("@playwright/test").Page) {
  await page.waitForSelector('[data-slot="field"]');
  await page.waitForTimeout(600);
}

async function read(page: import("@playwright/test").Page, selector: string) {
  return page.evaluate((sel) => {
    return [...document.querySelectorAll(sel)].map((el) => {
      const s = getComputedStyle(el);
      return { fontSize: s.fontSize, fontWeight: s.fontWeight, lineHeight: s.lineHeight };
    });
  }, selector);
}

/** DS TextField: input text is 16/24, at the body weight. */
const RAFT_FIELD: Metrics = { fontSize: "16px", fontWeight: "400", lineHeight: "24px" };

/**
 * The field metric tokens as the browser resolves them, held to the DS before
 * anything is compared with them. That also rules out a failed custom-property
 * read turning into a vacuous "NaNpx === NaNpx" pass.
 */
async function tokens(page: import("@playwright/test").Page): Promise<Metrics> {
  const resolved = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    const px = (v: string) => `${parseFloat(v.trim())}px`;
    return {
      fontSize: px(s.getPropertyValue("--field-font-size")),
      fontWeight: s.getPropertyValue("--field-font-weight").trim(),
      lineHeight: px(s.getPropertyValue("--field-line-height")),
    };
  });
  expect(resolved, "the field axis resolves to the DS input type, 16/24 400").toEqual(RAFT_FIELD);
  return resolved;
}

test(`the textarea obeys the field tokens`, async ({ page }) => {
  await page.goto(CASE);
  await settle(page);
  const t = await tokens(page);

  // MECHANISM, not just the number. Caught by counterfactual: with the recipe
  // change absent, every value assertion still passed — an inherited 16px equals
  // a 16px token, and a hardcoded text-sm equalled a 14px/20px one. The computed
  // values can coincide with the tokens whether or not the textarea is on the
  // axis, so a value-only check proves nothing here.
  const carriesAxis = await page.evaluate(() => {
    const el = document.querySelector('[data-slot="field"] textarea') as HTMLElement | null;
    return el ? { textField: el.className.includes("text-field"), fontField: el.className.includes("font-field") } : null;
  });
  expect(carriesAxis, `textarea exists`).not.toBeNull();
  expect(carriesAxis!.textField, `textarea must carry text-field — matching the token by coincidence is not being on the axis`).toBe(true);
  expect(carriesAxis!.fontField, `textarea must carry font-field`).toBe(true);

  const found = await read(page, '[data-slot="field"] textarea');
  // Denominator before contents: an empty NodeList satisfies every loop body.
  expect(found.length, `expected exactly ${TEXTAREA_COUNT} textarea`).toBe(TEXTAREA_COUNT);
  for (const m of found) {
    expect(m.fontSize, `textarea font-size must equal --field-font-size`).toBe(t.fontSize);
    expect(m.fontWeight, `textarea font-weight must equal --field-font-weight`).toBe(t.fontWeight);
    expect(m.lineHeight, `textarea line-height must equal --field-line-height`).toBe(t.lineHeight);
  }
});

test(`the textarea and the input agree`, async ({ page }) => {
  await page.goto(CASE);
  await settle(page);
  const areas = await read(page, '[data-slot="field"] textarea');
  const inputs = await read(page, 'input[data-slot="field-control"]');
  expect(areas.length, `exactly ${TEXTAREA_COUNT} textarea`).toBe(TEXTAREA_COUNT);
  expect(inputs.length, `exactly ${INPUT_COUNT} real text input`).toBe(INPUT_COUNT);
  // The property cindyz actually asked for: single-line and multi-line move together.
  // Asserted independently of the token so it still holds if the token changes.
  expect(areas[0].fontSize, `textarea vs input font-size`).toBe(inputs[0].fontSize);
  expect(areas[0].fontWeight, `textarea vs input font-weight`).toBe(inputs[0].fontWeight);
  expect(areas[0].lineHeight, `textarea vs input line-height`).toBe(inputs[0].lineHeight);
});