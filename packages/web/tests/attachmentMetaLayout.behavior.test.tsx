import assert from "node:assert/strict";
import { cleanup, render as rtlRender } from "@testing-library/react";
import { TestIntlProvider } from "./helpers/intl";
const render: typeof rtlRender = (ui, options) => rtlRender(ui, { wrapper: TestIntlProvider, ...options });
import { AttachmentChip } from "../src/components/message/AttachmentChip";
import { AttachmentMetaText } from "../src/components/message/AttachmentMetaText";

afterEach(() => {
  cleanup();
});

function assertPinnedChipLayout(root: Element) {
  assert.match(root.className, /\bw-44\b/);
  assert.match(root.className, /\bmin-w-44\b/);
  assert.match(root.className, /\bmax-w-44\b/);
  assert.match(root.className, /\bshrink-0\b/);
  assert.match(root.className, /\boverflow-hidden\b/);
}

test("long attachment filenames stay clipped inside the same pinned chip, preview or download", () => {
  const filename = "a-very-long-document-name-that-must-not-expand-the-message-column.csv";
  const attachment = {
    id: "attachment-long-name",
    filename,
    mimeType: "text/csv",
    sizeBytes: 13_312,
  };

  const preview = render(
    <AttachmentChip
      attachment={attachment}
      isOptimistic={false}
      affordance="preview"
      onClick={() => undefined}
    />,
  );
  const previewRoot = preview.container.firstElementChild;
  assert.ok(previewRoot);
  assertPinnedChipLayout(previewRoot);
  const previewTextSlot = preview.container.querySelector("[data-message-affordance='attachment-text-slot']");
  const previewFilename = preview.container.querySelector("[data-message-affordance='attachment-filename']");
  assert.ok(previewTextSlot);
  assert.ok(previewFilename);
  assert.match(previewTextSlot.className, /\bw-full\b/);
  assert.match(previewTextSlot.className, /\bmin-w-0\b/);
  assert.match(previewTextSlot.className, /\bmax-w-full\b/);
  assert.match(previewTextSlot.className, /\boverflow-hidden\b/);
  assert.match(previewFilename.className, /\btruncate\b/);
  assert.equal(previewFilename.textContent, filename);

  preview.unmount();
  const download = render(
    <AttachmentChip
      attachment={attachment}
      isOptimistic={false}
      affordance="download"
      onClick={() => undefined}
    />,
  );
  const downloadRoot = download.container.firstElementChild;
  assert.ok(downloadRoot);
  assertPinnedChipLayout(downloadRoot);
  assert.equal(downloadRoot.className, previewRoot.className, "preview and download chips share one rendered layout");
});

test("attachment metadata truncates the MIME label while preserving the APK size", () => {
  const { container } = render(
    <AttachmentChip
      attachment={{
        id: "attachment-apk",
        filename: "raft-android-1.7.0-1070000-release.apk",
        mimeType: "application/vnd.android.package-archive",
        sizeBytes: 154_140_672,
      }}
      isOptimistic={false}
      affordance="download"
      meta={<AttachmentMetaText label="application/vnd.android.package-archive" sizeBytes={154_140_672} />}
    />,
  );

  const meta = container.querySelector("[data-message-affordance='attachment-meta']");
  const label = container.querySelector("[data-message-affordance='attachment-meta-label']");
  const size = container.querySelector("[data-message-affordance='attachment-meta-size']");
  assert.ok(meta);
  assert.ok(label);
  assert.ok(size);
  const metaRow = meta.parentElement;
  assert.ok(metaRow);
  assert.match(metaRow.className, /\bflex\b/);
  assert.match(metaRow.className, /\bmin-w-0\b/);
  assert.doesNotMatch(metaRow.className, /\btruncate\b/);
  assert.match(meta.className, /\bflex-1\b/);
  assert.match(meta.className, /\bmin-w-0\b/);
  assert.match(label.className, /\bflex-1\b/);
  assert.match(label.className, /\btruncate\b/);
  assert.match(size.className, /\bshrink-0\b/);
  assert.equal(size.textContent, "147.0 MB");
});

test("attachment summary text clips inside the RUI summary slot", () => {
  const { container } = render(
    <AttachmentChip
      attachment={{
        id: "attachment-csv",
        filename: "sparkling-art-04296362-results.csv",
        mimeType: "text/csv",
        sizeBytes: 13_312,
      }}
      isOptimistic={false}
      affordance="preview"
      affordanceName="document-preview"
      meta={<AttachmentMetaText label="CSV preview" sizeBytes={13_312} />}
      summary={<span>First 200 rows · 3 columns</span>}
    />,
  );

  const summarySlot = container.querySelector("[data-message-affordance='attachment-summary-slot']");
  const summaryText = container.querySelector("[data-message-affordance='attachment-summary-text']");
  const previewIcon = container.querySelector("[data-message-affordance='document-preview']");
  assert.ok(summarySlot);
  assert.ok(summaryText);
  assert.ok(previewIcon);

  // RUI MessageAttachment anatomy (2026-09-23): the summary lives in the
  // MessageAttachmentSummary slot and the affordance icon is an RUI action in
  // the meta row end — no more absolutely-positioned corner box, so the old
  // pr-6 clearance is gone.
  assert.equal(summarySlot.getAttribute("data-slot"), "message-attachment-summary");
  assert.match(summarySlot.className, /\bmin-w-0\b/);
  assert.match(summarySlot.className, /\boverflow-hidden\b/);
  assert.doesNotMatch(summarySlot.className, /\bpr-6\b/);
  assert.match(summaryText.className, /\bmin-w-0\b/);
  assert.match(summaryText.className, /\bflex-1\b/);
  assert.match(summaryText.className, /\btruncate\b/);
  assert.equal(previewIcon.getAttribute("data-slot"), "message-attachment-action");
  assert.equal(previewIcon.parentElement?.getAttribute("data-slot"), "message-attachment-meta-end");
  assert.doesNotMatch(previewIcon.className, /(^|\s)absolute(\s|$)/);
});
