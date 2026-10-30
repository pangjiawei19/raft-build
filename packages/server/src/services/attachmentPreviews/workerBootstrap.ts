import type { XlsxAttachmentPreviewData } from "@botiverse/raft-shared";
import { registerWorkerPoolHandler } from "../workerPool/handlerRegistry";
import { buildXlsxPreview } from "./providers/xlsx";

/** Worker-pool kind for xlsx attachment preview parsing (the pool's first consumer). */
export const XLSX_PREVIEW_WORKER_KIND = "attachment_preview.xlsx";

// Pure registration module, safe to import anywhere: it is the pool's
// bootstrapModule inside each spawned worker, and the main thread imports it
// too so the in-process executor (RAFT_WORKER_POOL_SIZE=0 / tests) finds the
// same handler. The handler stays a pure function of the payload; the payload
// is a Buffer at both execution sites (workerEntry converts the transferred
// ArrayBuffer back before dispatch).
registerWorkerPoolHandler(XLSX_PREVIEW_WORKER_KIND, (payload): XlsxAttachmentPreviewData | null => (
  buildXlsxPreview(payload as Buffer)
));
