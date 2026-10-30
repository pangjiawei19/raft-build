import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";

import { fetch } from "undici";

import { buildFetchDispatcher } from "./proxy";

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server has no TCP address");
  return address.port;
}

async function close(server: http.Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

// undici 8 only tunnels non-http targets unless `proxyTunnel: true`; Computer
// keeps tunnelling plain-http targets too, like the daemon and the agent CLI.
test("an http target goes through the proxy as a CONNECT tunnel", async () => {
  const origin = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json", connection: "close" });
    response.end(JSON.stringify({ ok: true }));
  });
  const originPort = await listen(origin);

  let proxyConnects = 0;
  // Answers only CONNECT: a forwarded (non-tunnelled) request gets 501.
  const proxy = http.createServer((_request, response) => {
    response.writeHead(501);
    response.end();
  });
  proxy.on("connect", (_request, downstream, head) => {
    proxyConnects += 1;
    const upstream = net.connect(originPort, "127.0.0.1", () => {
      downstream.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      downstream.pipe(upstream);
      upstream.pipe(downstream);
    });
    upstream.once("error", () => downstream.destroy());
    downstream.once("error", () => upstream.destroy());
  });
  const proxyPort = await listen(proxy);

  try {
    // Only the proxy can reach this host.
    const target = `http://proxy-only.invalid:${originPort}/manifest`;
    const dispatcher = buildFetchDispatcher(target, { HTTP_PROXY: `http://127.0.0.1:${proxyPort}` });
    assert.ok(dispatcher);
    const response = await fetch(target, { dispatcher });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(proxyConnects, 1);
    await dispatcher.close();
  } finally {
    await close(proxy);
    await close(origin);
  }
});
