import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { getWorkerPoolHandler } from "../workerPool/handlerRegistry";
import { buildXlsxPreview } from "./providers/xlsx";
import { XLSX_PREVIEW_WORKER_KIND } from "./workerBootstrap";

test("worker bootstrap registers the xlsx preview kind, equivalent to buildXlsxPreview", async () => {
  const handler = getWorkerPoolHandler(XLSX_PREVIEW_WORKER_KIND);
  assert.ok(handler, "the xlsx preview kind must be registered for both worker and in-process dispatch");

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Name", "Score"], ["Alice", 10]]), "Scores");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  assert.deepEqual(await handler(buffer), buildXlsxPreview(buffer));

  // Unparseable bytes degrade to null (→ "unreadable"), never a throw.
  assert.equal(await handler(Buffer.from("not a zip")), null);
});
