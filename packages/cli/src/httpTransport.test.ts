import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";

import { afterEach, test } from "vitest";

import { requestJsonOverHttp } from "./httpTransport";

let server: Server | null = null;

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
});

async function serve(handler: (req: IncomingMessage, res: ServerResponse, body: string) => void): Promise<URL> {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => handler(req, res, Buffer.concat(chunks).toString("utf8")));
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
  return new URL(`http://127.0.0.1:${(server!.address() as AddressInfo).port}/internal/agent-api/x`);
}

test("sends method, headers and JSON body; resolves status, headers and text", async () => {
  let seen: { method?: string; headers?: IncomingMessage["headers"]; body?: string } = {};
  const url = await serve((req, res, body) => {
    seen = { method: req.method, headers: req.headers, body };
    res.writeHead(201, { "content-type": "application/json", "x-multi": ["a", "b"] });
    res.end(JSON.stringify({ ok: true, echo: "é" }));
  });
  const res = await requestJsonOverHttp(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer t" },
    body: JSON.stringify({ content: "héllo" }),
  });
  assert.equal(res.status, 201);
  assert.equal(res.ok, true);
  assert.equal(res.headers.get("Content-Type"), "application/json");
  assert.equal(res.headers.get("x-multi"), "a, b");
  assert.equal(res.headers.get("absent"), null);
  assert.deepEqual(JSON.parse(await res.text()), { ok: true, echo: "é" });
  assert.equal(seen.method, "POST");
  assert.equal(seen.headers?.authorization, "Bearer t");
  assert.equal(seen.headers?.["content-length"], String(Buffer.byteLength(JSON.stringify({ content: "héllo" }))));
  assert.deepEqual(JSON.parse(seen.body!), { content: "héllo" });
});

test("non-2xx is a response, not an error", async () => {
  const url = await serve((_req, res) => {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "nope" }));
  });
  const res = await requestJsonOverHttp(url, { method: "GET", headers: {} });
  assert.equal(res.ok, false);
  assert.equal(res.status, 403);
  assert.deepEqual(JSON.parse(await res.text()), { error: "nope" });
});

test("decodes a gzip-encoded body", async () => {
  const url = await serve((_req, res) => {
    res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" });
    res.end(gzipSync(JSON.stringify({ zipped: true })));
  });
  const res = await requestJsonOverHttp(url, { method: "GET", headers: {} });
  assert.deepEqual(JSON.parse(await res.text()), { zipped: true });
});

test("a body cut off mid-stream rejects text(), like a fetch body-read failure", async () => {
  const url = await serve((_req, res) => {
    res.writeHead(200, { "content-type": "application/json", "content-length": "1000" });
    res.write("{\"partial\":");
    setTimeout(() => res.socket?.destroy(), 10);
  });
  const res = await requestJsonOverHttp(url, { method: "GET", headers: {} });
  assert.equal(res.status, 200);
  await assert.rejects(res.text(), (error: unknown) => error instanceof TypeError && error.message === "terminated");
});

test("a refused connection rejects with TypeError('fetch failed') carrying the socket error", async () => {
  const url = await serve(() => {});
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
  await assert.rejects(requestJsonOverHttp(url, { method: "GET", headers: {} }), (error: unknown) => {
    assert.ok(error instanceof TypeError);
    assert.equal(error.message, "fetch failed");
    assert.equal((error.cause as { code?: string }).code, "ECONNREFUSED");
    return true;
  });
});

test("an aborted signal rejects with the signal's reason", async () => {
  const url = await serve(() => { /* never answers */ });
  const controller = new AbortController();
  const pending = requestJsonOverHttp(url, { method: "GET", headers: {}, signal: controller.signal });
  const reason = new Error("caller gave up");
  setTimeout(() => controller.abort(reason), 20);
  await assert.rejects(pending, (error: unknown) => error === reason);

  const already = new AbortController();
  already.abort();
  await assert.rejects(
    requestJsonOverHttp(url, { method: "GET", headers: {}, signal: already.signal }),
    (error: unknown) => error instanceof DOMException && error.name === "AbortError",
  );
});
