// JSON transport for the agent API over node:http / node:https.
//
// Node's built-in fetch parses HTTP with a WebAssembly build of llhttp. In a
// short-lived `raft` process that costs ~25 MiB to instantiate plus ~30 MiB
// of transient memory when V8 tiers the module up in the background, and
// ~0.3 s of CPU, for requests whose bodies are a few KiB. node:http uses the
// native llhttp instead (~3 MiB). Only the plain JSON request path uses this
// transport; multipart uploads, attachment downloads, redirects and requests
// through an HTTP proxy dispatcher stay on fetch.
//
// Observable behaviour mirrors fetch where callers can see it:
// - the promise resolves once headers arrive; the body is read by `text()`,
//   which rejects if the body fails mid-stream (a fetch body-read failure);
// - network failures reject with `TypeError("fetch failed", { cause })`;
// - an aborted signal rejects with `signal.reason`;
// - undici's 300 s headers / body timeouts, as UND_ERR_HEADERS_TIMEOUT /
//   UND_ERR_BODY_TIMEOUT causes.

import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

/** The part of a fetch Response the JSON client reads. */
export interface TransportResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export interface JsonTransportInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal | null;
}

// undici's defaults for fetch (headersTimeout / bodyTimeout).
const HEADERS_TIMEOUT_MS = 300_000;
const BODY_TIMEOUT_MS = 300_000;

class TransportTimeoutError extends Error {
  constructor(readonly code: "UND_ERR_HEADERS_TIMEOUT" | "UND_ERR_BODY_TIMEOUT") {
    super(code === "UND_ERR_HEADERS_TIMEOUT" ? "Headers Timeout Error" : "Body Timeout Error");
    this.name = code === "UND_ERR_HEADERS_TIMEOUT" ? "HeadersTimeoutError" : "BodyTimeoutError";
  }
}

function fetchFailed(cause: unknown): TypeError {
  return new TypeError("fetch failed", { cause });
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("This operation was aborted", "AbortError");
}

function decoded(res: IncomingMessage): NodeJS.ReadableStream {
  const encoding = (res.headers["content-encoding"] ?? "").toLowerCase().trim();
  if (encoding === "gzip" || encoding === "x-gzip") return res.pipe(createGunzip());
  if (encoding === "deflate") return res.pipe(createInflate());
  if (encoding === "br") return res.pipe(createBrotliDecompress());
  return res;
}

export function isHttpRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export function requestJsonOverHttp(url: URL, init: JsonTransportInit): Promise<TransportResponse> {
  const signal = init.signal ?? null;
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  const body = init.body === undefined ? undefined : Buffer.from(init.body, "utf8");

  return new Promise<TransportResponse>((resolve, reject) => {
    let settled = false;
    const req = send(url, {
      method: init.method,
      headers: {
        accept: "*/*",
        "accept-encoding": "gzip, deflate, br",
        "user-agent": "node",
        ...init.headers,
        ...(body ? { "content-length": String(body.length) } : {}),
      },
    });
    const onAbort = (): void => { req.destroy(abortReason(signal!) as Error); };
    signal?.addEventListener("abort", onAbort, { once: true });

    req.setTimeout(HEADERS_TIMEOUT_MS, () => req.destroy(new TransportTimeoutError("UND_ERR_HEADERS_TIMEOUT")));
    req.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      if (settled) return;
      settled = true;
      reject(signal?.aborted ? abortReason(signal) : fetchFailed(err));
    });
    req.on("response", (res) => {
      settled = true;
      req.setTimeout(BODY_TIMEOUT_MS, () => res.destroy(new TransportTimeoutError("UND_ERR_BODY_TIMEOUT")));
      // Buffer the body right away (as fetch does internally) so an unread
      // body never pins the socket; `text()` reports how it ended.
      const chunks: Buffer[] = [];
      const bodyDone = new Promise<string>((resolveBody, rejectBody) => {
        const stream = decoded(res);
        const fail = (err: unknown): void => {
          signal?.removeEventListener("abort", onAbort);
          rejectBody(signal?.aborted ? abortReason(signal) : new TypeError("terminated", { cause: err }));
        };
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => {
          signal?.removeEventListener("abort", onAbort);
          resolveBody(Buffer.concat(chunks).toString("utf8"));
        });
        stream.on("error", fail);
        res.on("aborted", () => fail(new Error("aborted")));
        if (stream !== res) res.on("error", fail);
      });
      // Avoid an unhandled rejection when the caller never reads the body.
      bodyDone.catch(() => {});
      const status = res.statusCode ?? 0;
      resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: {
          get(name: string): string | null {
            const value = res.headers[name.toLowerCase()];
            if (value === undefined) return null;
            return Array.isArray(value) ? value.join(", ") : value;
          },
        },
        text: () => bodyDone,
      });
    });
    req.end(body);
  });
}
