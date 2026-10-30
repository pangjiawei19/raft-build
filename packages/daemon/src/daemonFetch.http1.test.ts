import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createSecureServer } from "node:http2";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { createProviderHttpClient, daemonFetch } from "./daemonFetch";

// A throwaway self-signed pair, generated per run so no key lives in the repo.
function makeTestCertificate(): { key: string; cert: string } | undefined {
  const dir = mkdtempSync(path.join(os.tmpdir(), "daemon-http1-"));
  try {
    const result = spawnSync("openssl", [
      "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes",
      "-keyout", path.join(dir, "key.pem"), "-out", path.join(dir, "cert.pem"),
      "-days", "1", "-subj", "/CN=localhost",
    ], { stdio: "ignore" });
    if (result.status !== 0) return undefined;
    return { key: readFileSync(path.join(dir, "key.pem"), "utf8"), cert: readFileSync(path.join(dir, "cert.pem"), "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const testCertificate = makeTestCertificate();

// undici 8 negotiates HTTP/2 via ALPN by default. Daemon traffic stays on
// HTTP/1.1 until h2 ships on its own (see proxy.ts HTTP1_ONLY).
test.skipIf(!testCertificate)("daemon and provider fetches negotiate HTTP/1.1 with an h2-capable server", async () => {
  const server = createSecureServer({ ...testCertificate!, allowHTTP1: true }, (req, res) => {
    res.end(req.httpVersion);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const url = `https://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const previousReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const client = createProviderHttpClient({}, "http1-test");
  const control = new Agent();
  try {
    // Control: the server does offer h2, so a default undici 8 agent takes it.
    assert.equal(await (await undiciFetch(url, { dispatcher: control })).text(), "2.0");
    assert.equal(await (await daemonFetch(url, {}, {})).text(), "1.1");
    assert.equal(await (await client.fetch(url)).text(), "1.1");
  } finally {
    client.dispose();
    await control.close();
    if (previousReject === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousReject;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
