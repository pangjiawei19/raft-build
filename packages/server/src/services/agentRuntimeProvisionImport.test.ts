import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { __setAgentRuntimeProviderTransportForTests } from "./agentRuntimeProviderService";
import { buildProvisionImportBody, checkProvisionImport, fetchProvisionImportLimits } from "./agentRuntimeProvisionImport";

const config = { baseUrl: "http://provider.test", token: "test-token" };

function respondWith(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): string[] {
  const calls: string[] = [];
  __setAgentRuntimeProviderTransportForTests({
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return await handler(url, init);
    }) as typeof globalThis.fetch,
  });
  return calls;
}

afterEach(() => {
  __setAgentRuntimeProviderTransportForTests(null);
});

test("import limits are read from the provider and validated", async () => {
  const calls = respondWith(() => Response.json({ maxTotalBytes: 10485760, maxFiles: 2000, maxFileBytes: 2097152, extra: true }));
  assert.deepEqual(await fetchProvisionImportLimits(config), {
    ok: true,
    limits: { maxTotalBytes: 10485760, maxFiles: 2000, maxFileBytes: 2097152 },
  });
  assert.deepEqual(calls, ["GET http://provider.test/provision/import-limits"]);
});

test("a malformed, failed or unreachable limits call is reported, never guessed", async () => {
  respondWith(() => Response.json({ maxTotalBytes: "10MiB", maxFiles: 2000, maxFileBytes: 2097152 }));
  assert.deepEqual(await fetchProvisionImportLimits(config), { ok: false, reason: "invalid_response", httpStatus: 200 });

  respondWith(() => Response.json({ error: { code: "unavailable", message: "down" } }, { status: 503 }));
  assert.deepEqual(await fetchProvisionImportLimits(config), { ok: false, reason: "unavailable", httpStatus: 503 });

  respondWith(() => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); });
  const unreachable = await fetchProvisionImportLimits(config);
  assert.equal(unreachable.ok, false);
  assert.equal(!unreachable.ok && unreachable.httpStatus, null);
});

const limits = { maxTotalBytes: 10485760, maxFiles: 2000, maxFileBytes: 2097152 };

test("import-check sends the import body itself, scoped to the server, and returns every refusal", async () => {
  let sent: unknown;
  const calls = respondWith((_url, init) => {
    sent = JSON.parse(String(init?.body));
    return Response.json({
      ok: false,
      rejected: [
        { index: 1, path: null, reason: "credential_in_path", param: "files[1].path" },
        { index: 2, path: "notes/keys.env", reason: "credential_in_text", param: "files[2].contentBase64" },
      ],
      more: 0,
      totals: { files: 1, bytes: 5 },
      limits,
    });
  });
  const body = buildProvisionImportBody("mig_abcdefghijklmnopqrstuv", {
    files: [{ path: "MEMORY.md", content: "hello" }, { path: "sk-live", content: "x" }, { path: "notes/keys.env", content: "y" }],
  });
  const result = await checkProvisionImport(config, "server-1", body);
  assert.deepEqual(calls, ["POST http://provider.test/provision/import-check?raftServerId=server-1"]);
  assert.deepEqual(sent, body);
  assert.ok(result.ok);
  assert.equal(result.check.ok, false);
  assert.deepEqual(result.check.rejected.map((r) => [r.index, r.path, r.reason]), [
    [1, null, "credential_in_path"],
    [2, "notes/keys.env", "credential_in_text"],
  ]);
  assert.deepEqual(result.check.totals, { files: 1, bytes: 5 });
});

test("import-check: a body-level 4xx or a malformed answer is a failure, not an empty refusal list", async () => {
  const body = buildProvisionImportBody("mig_abcdefghijklmnopqrstuv", { files: [{ path: "MEMORY.md", content: "hello" }] });
  respondWith(() => Response.json({ error: { code: "too_large", message: "over 10 MiB", param: "files" } }, { status: 413 }));
  assert.deepEqual(await checkProvisionImport(config, "server-1", body), { ok: false, reason: "too_large", httpStatus: 413 });

  respondWith(() => Response.json({ ok: true, totals: { files: 1 }, limits }));
  assert.deepEqual(await checkProvisionImport(config, "server-1", body), { ok: false, reason: "invalid_response", httpStatus: 200 });
});
