import assert from "node:assert/strict";
import {
  planScreenshotPixelRatio,
  SCREENSHOT_PIXEL_BUDGET,
  ScreenshotInvalidOutputError,
  validateScreenshotPng,
} from "../src/utils/screenshotBudget";
import type { ScreenshotValidationDeps } from "../src/utils/screenshotBudget";

// Task #1302: one canvas per screenshot, at most 16,000,000 pixels.

test("the budget is 16,000,000 pixels, under iOS Safari's 16,777,216", () => {
  assert.equal(SCREENSHOT_PIXEL_BUDGET, 16_000_000);
});

test("3x is kept while it fits, and dropped one pixel past the budget", () => {
  // 1000 css wide: 3x canvas is 3000 wide, so 16,000,000 / 3000 = 5333.33 rows.
  // 1777 css tall → 5331 rows = 15,993,000 px (fits); 1778 → 5334 rows = 16,002,000 (over).
  assert.deepEqual(planScreenshotPixelRatio(1000, 1777, 3), { kind: "fits", pixelRatio: 3, width: 3000, height: 5331 });
  assert.equal(planScreenshotPixelRatio(1000, 1778, 3).kind === "fits" && planScreenshotPixelRatio(1000, 1778, 3).pixelRatio, 2);
});

test("exactly at the budget fits; one more row does not", () => {
  // 2x: 4000 x 4000 = 16,000,000 exactly.
  assert.deepEqual(planScreenshotPixelRatio(2000, 2000, 2), { kind: "fits", pixelRatio: 2, width: 4000, height: 4000 });
  const over = planScreenshotPixelRatio(2000, 2000.5, 2);
  assert.equal(over.kind === "fits" && over.pixelRatio, 1);
});

test("falls back 3 → 2 → 1 and reports pagination when even 1x is over", () => {
  const width = 400;
  // 3x fits up to 16e6 / 1200 = 13333 rows → 4444 css.
  assert.equal(pixelRatioFor(width, 4444, 3), 3);
  // 2x fits up to 16e6 / 800 = 20000 rows → 10000 css.
  assert.equal(pixelRatioFor(width, 4445, 3), 2);
  assert.equal(pixelRatioFor(width, 10000, 3), 2);
  // 1x fits up to 16e6 / 400 = 40000 css.
  assert.equal(pixelRatioFor(width, 10001, 3), 1);
  assert.equal(pixelRatioFor(width, 40000, 3), 1);
  assert.deepEqual(planScreenshotPixelRatio(width, 40001, 3), {
    kind: "needsPagination",
    cssWidth: 400,
    cssHeight: 40001,
    budget: 16_000_000,
  });
});

test("a fractional screen ratio is tried first, then the whole ratios below it", () => {
  assert.equal(pixelRatioFor(400, 100, 2.625), 2.625);
  // 6000 css: 2.625x is 1050 x 15750 = 16.5M (over); 2x is 800 x 12000 = 9.6M.
  assert.equal(pixelRatioFor(400, 6000, 2.625), 2);
  assert.equal(pixelRatioFor(400, 100, 2), 2, "never above the preferred ratio");
});

test("an empty layout is not a fit", () => {
  assert.equal(planScreenshotPixelRatio(0, 500, 3).kind, "needsPagination");
  assert.equal(planScreenshotPixelRatio(500, 0, 3).kind, "needsPagination");
});

function pixelRatioFor(width: number, height: number, preferred: number): number | null {
  const plan = planScreenshotPixelRatio(width, height, preferred);
  return plan.kind === "fits" ? plan.pixelRatio : null;
}

const PNG = "data:image/png;base64,iVBORw0KGgo=";

function deps(overrides: Partial<ScreenshotValidationDeps> = {}): ScreenshotValidationDeps {
  return {
    toBlob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
    decode: async () => ({ width: 1200, height: 900 }),
    ...overrides,
  };
}

async function rejectsWith(promise: Promise<unknown>, reason: string) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof ScreenshotInvalidOutputError, String(err));
    assert.equal(err.reason, reason);
    return true;
  });
}

test("the engine's empty `data:,` is rejected", async () => {
  await rejectsWith(validateScreenshotPng("data:,", 3, deps()), "not-png");
  await rejectsWith(validateScreenshotPng("data:image/png;base64,", 3, deps()), "not-png");
  await rejectsWith(validateScreenshotPng("data:image/jpeg;base64,AAAA", 3, deps()), "not-png");
});

test("an empty or unreadable Blob is rejected", async () => {
  await rejectsWith(validateScreenshotPng(PNG, 3, deps({ toBlob: async () => new Blob([]) })), "empty-blob");
  await rejectsWith(validateScreenshotPng(PNG, 3, deps({ toBlob: async () => { throw new Error("bad url"); } })), "empty-blob");
});

test("a payload that does not decode is rejected", async () => {
  await rejectsWith(validateScreenshotPng(PNG, 3, deps({ decode: async () => { throw new Error("decode"); } })), "undecodable");
});

test("a zero-size image is rejected", async () => {
  await rejectsWith(validateScreenshotPng(PNG, 3, deps({ decode: async () => ({ width: 0, height: 900 }) })), "zero-size");
  await rejectsWith(validateScreenshotPng(PNG, 3, deps({ decode: async () => ({ width: 1200, height: 0 }) })), "zero-size");
});

test("a valid PNG comes back with its Blob, size and render ratio", async () => {
  const image = await validateScreenshotPng(PNG, 2, deps());
  assert.equal(image.dataUrl, PNG);
  assert.equal(image.blob.size, 3);
  assert.equal(image.width, 1200);
  assert.equal(image.height, 900);
  assert.equal(image.pixelRatio, 2);
});
