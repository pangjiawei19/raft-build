import assert from "node:assert/strict";
import { Readable } from "node:stream";
import * as XLSX from "xlsx";
import type { attachments } from "../../db/schema";
import { __setStorageForTests, resetStorageForTests } from "../storageService";
import { WorkerCircuitOpen, WorkerCrashed, WorkerPoolBusy, WorkerTaskTimeout } from "../workerPool/errors";
import { attachmentPreviewProviders, buildAttachmentPreviewResponse, isAttachmentPreviewTruncated } from "./registry";
import { buildXlsxPreview } from "./providers/xlsx";
import { XLSX_PREVIEW_WORKER_KIND } from "./workerBootstrap";

type Attachment = typeof attachments.$inferSelect;

test("attachment preview providers are ordered and declare resource/trust contract", () => {
  assert.deepEqual(attachmentPreviewProviders.map((provider) => provider.kind), ["diff", "csv", "xlsx", "markdown", "pdf", "text"]);
  for (const provider of attachmentPreviewProviders) {
    assert.ok(provider.trustLevel === "data" || provider.trustLevel === "sandbox");
    assert.ok(provider.streamByteCap > 0);
    assert.ok(provider.payloadByteCap > 0);
  }
});

test("CSV previews trimmed for payload budget are reported as truncated", () => {
  assert.equal(isAttachmentPreviewTruncated({
    kind: "csv",
    delimiter: ",",
    headers: ["name"],
    rows: [["alpha"]],
    rowCount: 3,
    columnCount: 1,
  }, false), true);
});

test("non-CSV previews still use stream truncation as their truncation signal", () => {
  assert.equal(isAttachmentPreviewTruncated({ kind: "text", text: "hello" }, false), false);
  assert.equal(isAttachmentPreviewTruncated({ kind: "text", text: "hello" }, true), true);
});

test("XLSX sheet truncation is preserved in the shared response signal", () => {
  assert.equal(isAttachmentPreviewTruncated({
    kind: "xlsx",
    sheets: [{ name: "Data", headers: ["A"], rows: [["1"]], rowCount: 3, columnCount: 1, truncated: true }],
    sheetCount: 1,
    truncated: true,
  }, false), true);
});

// --- Worker-pool routing (xlsx is the pool's first consumer) -----------------

const xlsxPoolAttachment = {
  filename: "scores.xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  sizeBytes: 1024,
  storageKey: "srv/att/scores.xlsx",
} as Attachment;

function workbookBuffer(): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Name", "Score"], ["Alice", 10]]), "Scores");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function storageReturning(buffer: Buffer): void {
  __setStorageForTests({
    async put() {},
    async get() { return Readable.from([buffer]); },
    async delete() {},
  });
}

function recordingPool(result: (payload: unknown) => unknown) {
  const calls: Array<{ kind: string; payload: unknown }> = [];
  const workerPool = {
    submit: <T>(kind: string, payload: unknown): Promise<T> => {
      calls.push({ kind, payload });
      return Promise.resolve(result(payload) as T);
    },
  };
  return { workerPool, calls };
}

function rejectingPool(error: unknown) {
  return { submit: <T>(): Promise<T> => Promise.reject(error) };
}

test("xlsx previews are submitted to the worker pool, other providers stay direct", async () => {
  storageReturning(workbookBuffer());
  try {
    const { workerPool, calls } = recordingPool((payload) => buildXlsxPreview(payload as Buffer));
    const response = await buildAttachmentPreviewResponse(xlsxPoolAttachment, { workerPool });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].kind, XLSX_PREVIEW_WORKER_KIND);
    assert.ok(Buffer.isBuffer(calls[0].payload));
    assert.equal(response.status, "ok");
    if (response.status === "ok") assert.equal(response.data.kind, "xlsx");

    // A non-xlsx provider never touches the pool: this fake fails if used.
    const csvAttachment = {
      filename: "export.csv",
      mimeType: "text/csv",
      sizeBytes: 1024,
      storageKey: "srv/att/export.csv",
    } as Attachment;
    storageReturning(Buffer.from("name,count\nalpha,1\n", "utf8"));
    const csvResponse = await buildAttachmentPreviewResponse(csvAttachment, {
      workerPool: rejectingPool(new Error("pool must not be used")),
    });
    assert.equal(csvResponse.status, "ok");
    if (csvResponse.status === "ok") assert.equal(csvResponse.data.kind, "csv");
  } finally {
    resetStorageForTests();
  }
});

test("pool busy, task timeout, worker crash and circuit-open all degrade to the same transient unavailable", async () => {
  storageReturning(workbookBuffer());
  try {
    for (const error of [
      new WorkerPoolBusy(XLSX_PREVIEW_WORKER_KIND, "queue_full", "queue full"),
      new WorkerPoolBusy(XLSX_PREVIEW_WORKER_KIND, "enqueue_timeout", "enqueue deadline"),
      new WorkerTaskTimeout(XLSX_PREVIEW_WORKER_KIND, 8000),
      new WorkerCrashed("worker exited unexpectedly with code 1"),
      new WorkerCircuitOpen(XLSX_PREVIEW_WORKER_KIND),
    ]) {
      const response = await buildAttachmentPreviewResponse(xlsxPoolAttachment, { workerPool: rejectingPool(error) });
      assert.deepEqual(response, { status: "unsupported", reason: "unavailable" });
    }
  } finally {
    resetStorageForTests();
  }
});

test("a handler failure inside the pool is not swallowed as backpressure", async () => {
  storageReturning(workbookBuffer());
  try {
    await assert.rejects(
      buildAttachmentPreviewResponse(xlsxPoolAttachment, { workerPool: rejectingPool(new Error("sheetjs exploded")) }),
      /sheetjs exploded/,
    );
  } finally {
    resetStorageForTests();
  }
});

test("an unparseable workbook from the pool stays unreadable, not unavailable", async () => {
  storageReturning(workbookBuffer());
  try {
    const { workerPool, calls } = recordingPool(() => null);
    const response = await buildAttachmentPreviewResponse(xlsxPoolAttachment, { workerPool });
    assert.equal(calls.length, 1);
    assert.deepEqual(response, { status: "unsupported", reason: "unreadable" });
  } finally {
    resetStorageForTests();
  }
});

// No injected pool: the default singleton resolves the in-process executor
// under tests (NODE_ENV=test), so this pins the whole main-thread wiring —
// handler registration, kind timeout config and submission — without a thread.
test("the default pool wiring builds an xlsx preview end to end", async () => {
  storageReturning(workbookBuffer());
  try {
    const response = await buildAttachmentPreviewResponse(xlsxPoolAttachment);
    assert.equal(response.status, "ok");
    if (response.status === "ok") {
      assert.equal(response.data.kind, "xlsx");
      if (response.data.kind === "xlsx") {
        assert.deepEqual(response.data.sheets[0], {
          name: "Scores",
          headers: ["Name", "Score"],
          rows: [["Alice", "10"]],
          rowCount: 1,
          columnCount: 2,
          truncated: false,
        });
      }
    }
  } finally {
    resetStorageForTests();
  }
});

test("a build reports the storage download and the parse separately", async () => {
  // Scripted clock: 0 start, 40 after the download, 47 after the parse.
  const ticks = [0, 40, 47];
  const now = () => ticks.shift() ?? 47;
  const textAttachment = { filename: "notes.txt", mimeType: "text/plain", sizeBytes: 12, storageKey: "srv/att/notes.txt" } as Attachment;
  storageReturning(Buffer.from("hello world\n", "utf8"));
  try {
    const timings: { fetchMs?: number; parseMs?: number } = {};
    const response = await buildAttachmentPreviewResponse(textAttachment, { timings, now });
    assert.equal(response.status, "ok");
    assert.deepEqual(timings, { fetchMs: 40, parseMs: 7 });
  } finally {
    resetStorageForTests();
  }
});
