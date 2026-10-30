import "./helpers/domSetup";
import assert from "node:assert/strict";
import { act, renderHook } from "@testing-library/react";
import { TestIntlProvider } from "./helpers/intl";

// Task #1302: a capture that the pixel budget or the output check refuses
// must leave no preview, start no upload or share, keep the selection, and
// tell the user what to do.
const capture = vi.fn();
const createArtifact = vi.fn();
vi.mock("../src/utils/selectScreenshot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/utils/selectScreenshot")>()),
  captureSelectedMessageImage: (...args: unknown[]) => capture(...args),
}));
vi.mock("../src/utils/selectMarkdown", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/utils/selectMarkdown")>()),
  createSelectedMessagesShareArtifact: (...args: unknown[]) => createArtifact(...args),
}));

const { useSelectionShareHandlers } = await import("../src/components/message/useSelectionShareHandlers");
const { useSelectionStore } = await import("../src/store/selectionStore");
const { ScreenshotInvalidOutputError, ScreenshotNeedsPaginationError } = await import("../src/utils/screenshotBudget");

const message = {
  id: "m1",
  channelId: "c1",
  content: "hello",
  createdAt: "2026-10-16T00:00:00.000Z",
  seq: 1,
} as never;

function setup() {
  useSelectionStore.getState().enter("c1", ["m1"]);
  return renderHook(() => useSelectionShareHandlers({ channelMessages: [message] }), { wrapper: TestIntlProvider });
}

afterEach(() => {
  capture.mockReset();
  createArtifact.mockReset();
  useSelectionStore.getState().exit();
});

const failures = [
  ["over budget", () => new ScreenshotNeedsPaginationError({ kind: "needsPagination", cssWidth: 400, cssHeight: 50_000, budget: 16_000_000 }), /^This selection is too long for one image\. Select fewer messages and try again\.$/],
  ["empty render", () => new ScreenshotInvalidOutputError("not-png"), /^The image came out empty\. Try again, or select fewer messages\.$/],
] as const;

for (const [name, error, text] of failures) {
  test(`${name}: Save image shows an error and no preview, and keeps the selection`, async () => {
    capture.mockRejectedValue(error());
    const { result } = setup();
    await act(async () => { await result.current.onSavePic(); });
    assert.equal(result.current.picPreview, null);
    assert.match(result.current.picError ?? "", text);
    assert.equal(useSelectionStore.getState().isActive, true);
    assert.deepEqual([...useSelectionStore.getState().selectedIds], ["m1"]);
  });

  test(`${name}: Share to X uploads nothing and keeps the selection`, async () => {
    capture.mockRejectedValue(error());
    const { result } = setup();
    await act(async () => { await result.current.onShareX(); });
    assert.equal(createArtifact.mock.calls.length, 0);
    assert.match(result.current.picError ?? "", text);
    assert.equal(useSelectionStore.getState().isActive, true);
  });
}
