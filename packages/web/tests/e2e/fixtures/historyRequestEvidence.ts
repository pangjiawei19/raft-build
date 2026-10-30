import { writeFile } from "node:fs/promises";
import type { Page, Request, Response, TestInfo } from "@playwright/test";

type HistoryRequest = {
  id: number;
  kind: "older" | "newer" | "latest";
  before: string | null;
  after: string | null;
  limit: string | null;
  startedAtMs: number;
  responseAtMs: number | null;
  finishedAtMs: number | null;
  failedAtMs: number | null;
  status: number | null;
  bodyReadAtMs: number | null;
  bodyState: "not_received" | "pending" | "read" | "unavailable";
  rowCount: number | null;
  firstSeq: number | string | null;
  lastSeq: number | string | null;
};

function sequence(value: unknown): number | string | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  return typeof value === "string" && /^\d+$/.test(value) ? value : null;
}

/** Test-local transport evidence, restricted to one channel's history endpoint.
 * Records no headers, credentials, message text, or unfiltered query values. */
export function recordHistoryRequests(page: Page, channelId: string) {
  const records: HistoryRequest[] = [];
  const olderRequests: { before: string }[] = [];
  const byRequest = new Map<Request, HistoryRequest>();
  const startedAtEpochMs = Date.now();
  const started = performance.now();
  const now = () => performance.now() - started;
  const onRequest = (request: Request) => {
    if (request.method() !== "GET") return;
    const url = new URL(request.url());
    if (url.pathname !== `/api/messages/channel/${channelId}`) return;
    const numericParam = (key: string) => {
      const value = url.searchParams.get(key);
      return value !== null && /^\d+$/.test(value) ? value : null;
    };
    // Preserve the original assertion's cursor semantics in memory; only the
    // allowlisted numeric value is written to the failure artifact.
    const assertionCursor = url.searchParams.get("before");
    if (assertionCursor !== null) olderRequests.push({ before: assertionCursor });
    const before = numericParam("before");
    const after = numericParam("after");
    const record: HistoryRequest = {
      id: records.length + 1, kind: url.searchParams.has("before") ? "older" : url.searchParams.has("after") ? "newer" : "latest",
      before, after, limit: numericParam("limit"), startedAtMs: now(),
      responseAtMs: null, finishedAtMs: null, failedAtMs: null, status: null,
      bodyReadAtMs: null, bodyState: "not_received", rowCount: null, firstSeq: null, lastSeq: null,
    };
    records.push(record);
    byRequest.set(request, record);
  };
  const onResponse = (response: Response) => {
    const record = byRequest.get(response.request());
    if (!record) return;
    record.responseAtMs = now();
    record.status = response.status();
    record.bodyState = "pending";
    void response.json().then((body: unknown) => {
      const rows: unknown = body && typeof body === "object" && "messages" in body ? body.messages : body;
      if (Array.isArray(rows)) {
        const seq = (row: unknown) => row && typeof row === "object" && "seq" in row ? sequence(row.seq) : null;
        record.rowCount = rows.length;
        record.firstSeq = seq(rows[0]);
        record.lastSeq = seq(rows.at(-1));
      }
      record.bodyState = "read";
      record.bodyReadAtMs = now();
    }).catch(() => { record.bodyState = "unavailable"; record.bodyReadAtMs = now(); });
  };
  const onFinished = (request: Request) => {
    const record = byRequest.get(request);
    if (record) record.finishedAtMs = now();
  };
  const onFailed = (request: Request) => {
    const record = byRequest.get(request);
    if (record) record.failedAtMs = now();
  };
  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfinished", onFinished);
  page.on("requestfailed", onFailed);
  return {
    // The existing cursor assertion sees exactly the same request events.
    olderRequests,
    async attachFailure(info: TestInfo) {
      const file = info.outputPath("history-request-evidence.json");
      await writeFile(file, JSON.stringify({ version: 1, channelId, startedAtEpochMs, capturedAtMs: now(),
        attempt: info.retry, requests: records }, null, 2));
      await info.attach("history-request-evidence", { path: file, contentType: "application/json" });
    },
    stop() {
      page.off("request", onRequest);
      page.off("response", onResponse);
      page.off("requestfinished", onFinished);
      page.off("requestfailed", onFailed);
    },
  };
}
