import "./helpers/domSetup";
import assert from "node:assert/strict";

// Task #1302: the real capture pipeline, with only the rasterizer replaced.
// The engine's over-budget failure mode is a successful-looking `data:,`.
const toPng = vi.fn<(node: HTMLElement, options: { pixelRatio: number }) => Promise<string>>();
vi.mock("html-to-image", () => ({ toPng: (node: HTMLElement, options: { pixelRatio: number }) => toPng(node, options) }));

const { captureSelectedMessageImage } = await import("../src/utils/selectScreenshot");
const { ScreenshotInvalidOutputError, ScreenshotNeedsPaginationError } = await import("../src/utils/screenshotBudget");

// A 1x1 PNG.
const REAL_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

let layoutHeight = 0;
const restore: Array<() => void> = [];

function stub<T extends object>(target: T, key: PropertyKey, descriptor: PropertyDescriptor) {
  const previous = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, ...descriptor });
  restore.push(() => {
    if (previous) Object.defineProperty(target, key, previous);
    else delete (target as Record<PropertyKey, unknown>)[key];
  });
}

beforeEach(() => {
  toPng.mockReset();
  // jsdom has no layout: give the off-screen container a height and the row
  // a width, the two numbers the budget is computed from.
  stub(HTMLElement.prototype, "offsetHeight", { get() { return layoutHeight; } });
  stub(window, "devicePixelRatio", { value: 3 });
  // The brand logo is inlined best-effort; keep it off the network.
  const realFetch = globalThis.fetch;
  stub(globalThis, "fetch", {
    value: (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith("data:") ? realFetch(input, init) : Promise.resolve(new Response(null, { status: 404 })),
  });
  stub(globalThis, "createImageBitmap", {
    value: async () => ({ width: 1, height: 1, close() {} }),
  });
  const row = document.createElement("div");
  row.id = "message-m1";
  row.getBoundingClientRect = () => ({ width: 400, height: 100, top: 0, left: 0, right: 400, bottom: 100, x: 0, y: 0, toJSON() {} });
  document.body.append(row);
});

afterEach(() => {
  while (restore.length) restore.pop()!();
  document.body.replaceChildren();
});

test("a selection over budget even at 1x is refused before any render", async () => {
  layoutHeight = 40_001; // 400 x 40,001 at 1x = 16,000,400 pixels
  await assert.rejects(captureSelectedMessageImage(["m1"], { timeoutMs: 5000 }), (err) => err instanceof ScreenshotNeedsPaginationError);
  assert.equal(toPng.mock.calls.length, 0, "no over-budget render is attempted");
});

test("a long selection renders at the highest ratio that fits", async () => {
  layoutHeight = 6_000; // 3x would be 1200 x 18,000 = 21.6M; 2x is 800 x 12,000 = 9.6M
  toPng.mockResolvedValue(REAL_PNG);
  const image = await captureSelectedMessageImage(["m1"], { timeoutMs: 5000 });
  assert.equal(toPng.mock.calls[0]?.[1].pixelRatio, 2);
  assert.equal(image.pixelRatio, 2);
  assert.ok(image.blob.size > 0);
});

test("a short selection keeps the screen's ratio", async () => {
  layoutHeight = 800;
  toPng.mockResolvedValue(REAL_PNG);
  const image = await captureSelectedMessageImage(["m1"], { timeoutMs: 5000 });
  assert.equal(toPng.mock.calls[0]?.[1].pixelRatio, 3);
  assert.equal(image.pixelRatio, 3);
});

test("the engine's empty `data:,` is an error, not an image", async () => {
  layoutHeight = 800;
  toPng.mockResolvedValue("data:,");
  await assert.rejects(captureSelectedMessageImage(["m1"], { timeoutMs: 5000 }), (err) => err instanceof ScreenshotInvalidOutputError);
});

test("a PNG that does not decode is an error, not an image", async () => {
  layoutHeight = 800;
  toPng.mockResolvedValue(REAL_PNG);
  stub(globalThis, "createImageBitmap", { value: async () => { throw new Error("decode"); } });
  await assert.rejects(captureSelectedMessageImage(["m1"], { timeoutMs: 5000 }), (err) => err instanceof ScreenshotInvalidOutputError);
});
