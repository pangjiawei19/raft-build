import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { KimiCodeAuth } from "./kimiAuth";
import { ensureFreshKimiToken, readKimiStoredToken, writeKimiStoredToken, type KimiStoredToken } from "./kimiTokenRefresh";

// Isolated fixtures only: fake token strings, a temp KIMI_CODE_HOME, a mocked
// token endpoint, and the real proper-lockfile lock. No real credentials.

const NOW_MS = 1_800_000_000_000;
const nowSeconds = Math.floor(NOW_MS / 1_000);
const FAST_LOCK = { retries: { retries: 2, factor: 1, minTimeout: 50, maxTimeout: 100 } };

function fixtureAuth(home: string): KimiCodeAuth {
  return {
    baseUrl: "https://api.kimi.test/coding/v1",
    oauthHost: "https://auth.kimi.test",
    storage: "file",
    storageName: "kimi-code",
    home,
    credentialPath: path.join(home, "credentials", "kimi-code.json"),
    lockTarget: path.join(home, "oauth", "kimi-code"),
  };
}

function token(overrides: Partial<KimiStoredToken> = {}): KimiStoredToken {
  return { access_token: "at-old", refresh_token: "rt-old", expires_at: nowSeconds - 60, expires_in: 900, scope: "", token_type: "Bearer", ...overrides };
}

type FetchCall = { url: string; body: string; headers: Record<string, string> };

function mockFetch(responder: (call: FetchCall, index: number) => { status: number; json?: unknown } | Error): { fetchFn: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), body: String(init?.body ?? ""), headers: (init?.headers as Record<string, string>) ?? {} };
    calls.push(call);
    const result = responder(call, calls.length - 1);
    if (result instanceof Error) throw result;
    return { status: result.status, json: async () => result.json ?? {} } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

const okResponse = (rt = "rt-new") => ({ status: 200, json: { access_token: "at-new", refresh_token: rt, expires_in: 900, scope: "", token_type: "Bearer" } });

function withHome<T>(fn: (home: string, auth: KimiCodeAuth) => Promise<T>): Promise<T> {
  const home = mkdtempSync(path.join(os.tmpdir(), "kimi-refresh-"));
  return fn(home, fixtureAuth(home)).finally(() => rmSync(home, { recursive: true, force: true }));
}

const baseDeps = (extra: Record<string, unknown> = {}) => ({ now: () => NOW_MS, sleep: async () => {}, lock: FAST_LOCK, platform: "linux" as const, env: {}, ...extra });

test("task #1282: a token outside the refresh threshold is fresh; nothing is requested or written", () => withHome(async (_home, auth) => {
  writeKimiStoredToken(auth.credentialPath, token({ expires_at: nowSeconds + 800 }));
  const { fetchFn, calls } = mockFetch(() => okResponse());
  const before = readFileSync(auth.credentialPath, "utf8");
  assert.deepEqual(await ensureFreshKimiToken(auth, baseDeps({ fetchFn })), { kind: "fresh", expiresAt: nowSeconds + 800 });
  assert.equal(calls.length, 0);
  assert.equal(readFileSync(auth.credentialPath, "utf8"), before);
}));

test("task #1282: an expired token is refreshed with the client's request shape, the rotated token replaces the file in the client's write shape, mode 0600", () => withHome(async (_home, auth) => {
  writeKimiStoredToken(auth.credentialPath, token());
  const { fetchFn, calls } = mockFetch(() => okResponse("rt-new"));
  const result = await ensureFreshKimiToken(auth, baseDeps({ fetchFn, identity: { platform: "raft_computer", version: "1.0.0" } }));
  assert.deepEqual(result, { kind: "refreshed", expiresAt: nowSeconds + 900 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://auth.kimi.test/api/oauth/token");
  assert.equal(calls[0]!.body, new URLSearchParams({ client_id: "17e5f671-d194-4dfb-9706-5516cb48c098", grant_type: "refresh_token", refresh_token: "rt-old" }).toString());
  assert.equal(calls[0]!.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(calls[0]!.headers["X-Msh-Platform"], "raft_computer", "the daemon names itself, never the client");
  assert.ok(calls[0]!.headers["X-Msh-Device-Id"], "device id from <home>/device_id");
  const stored = readKimiStoredToken(auth.credentialPath);
  assert.equal(stored.kind, "ok");
  assert.deepEqual(stored.kind === "ok" ? stored.token : null, { access_token: "at-new", refresh_token: "rt-new", expires_at: nowSeconds + 900, expires_in: 900, scope: "", token_type: "Bearer" });
  assert.equal(statSync(auth.credentialPath).mode & 0o777, 0o600);
  assert.ok(readFileSync(auth.credentialPath, "utf8").endsWith("}\n"), "2-space JSON with trailing newline, like FileTokenStorage");
  assert.equal(existsSync(`${auth.lockTarget}.lock`), false, "lock released");
}));

test("task #1282: a rejected refresh with an unchanged refresh token reports rejected and leaves the file untouched (never the client's revoked tombstone)", () => withHome(async (_home, auth) => {
  writeKimiStoredToken(auth.credentialPath, token());
  const before = readFileSync(auth.credentialPath, "utf8");
  for (const response of [{ status: 401 }, { status: 403 }, { status: 400, json: { error: "invalid_grant" } }]) {
    const { fetchFn, calls } = mockFetch(() => response);
    assert.deepEqual(await ensureFreshKimiToken(auth, baseDeps({ fetchFn })), { kind: "rejected", reason: "refresh_rejected" }, JSON.stringify(response));
    assert.equal(calls.length, 1, "no retry on a rejection");
    assert.equal(readFileSync(auth.credentialPath, "utf8"), before, "no tombstone, no change");
  }
}));

test("task #1282: a rejection whose re-read finds a rotated token adopts it (another writer refreshed first)", () => withHome(async (_home, auth) => {
  writeKimiStoredToken(auth.credentialPath, token());
  const { fetchFn } = mockFetch(() => {
    // The other party's refresh landed while ours was in flight.
    writeKimiStoredToken(auth.credentialPath, token({ access_token: "at-theirs", refresh_token: "rt-theirs", expires_at: nowSeconds + 900 }));
    return { status: 401 };
  });
  assert.deepEqual(await ensureFreshKimiToken(auth, baseDeps({ fetchFn })), { kind: "adopted", expiresAt: nowSeconds + 900 });
  const stored = readKimiStoredToken(auth.credentialPath);
  assert.equal(stored.kind === "ok" ? stored.token.refresh_token : null, "rt-theirs");
}));

test("task #1282: network failures retry with backoff then report transient; the file is untouched", () => withHome(async (_home, auth) => {
  writeKimiStoredToken(auth.credentialPath, token());
  const before = readFileSync(auth.credentialPath, "utf8");
  const { fetchFn, calls } = mockFetch(() => new Error("ECONNRESET"));
  assert.deepEqual(await ensureFreshKimiToken(auth, baseDeps({ fetchFn })), { kind: "transient", reason: "network", expired: true });
  assert.equal(calls.length, 3);
  assert.equal(readFileSync(auth.credentialPath, "utf8"), before);
  const server = mockFetch(() => ({ status: 503 }));
  assert.deepEqual(await ensureFreshKimiToken(auth, baseDeps({ fetchFn: server.fetchFn })), { kind: "transient", reason: "server", expired: true });
  assert.equal(server.calls.length, 3);
  const noRotation = mockFetch(() => ({ status: 200, json: { access_token: "at-new", expires_in: 900 } }));
  assert.deepEqual(await ensureFreshKimiToken(auth, baseDeps({ fetchFn: noRotation.fetchFn })), { kind: "transient", reason: "rotation_missing", expired: true });
  assert.equal(readFileSync(auth.credentialPath, "utf8"), before, "a response without rotation is never written");
}));

test("task #1282: a token still valid but inside the threshold reports transient with expired=false on failure (the probe may still run)", () => withHome(async (_home, auth) => {
  writeKimiStoredToken(auth.credentialPath, token({ expires_at: nowSeconds + 100 }));
  const { fetchFn } = mockFetch(() => new Error("offline"));
  assert.deepEqual(await ensureFreshKimiToken(auth, baseDeps({ fetchFn })), { kind: "transient", reason: "network", expired: false });
}));

test("task #1282 (b): the loser waits for the winner's commit and adopts it without sending the old refresh token", () => withHome(async (_home, auth) => {
  writeKimiStoredToken(auth.credentialPath, token());
  // The winner (another real process) holds the client's lock, rotates the file, then releases.
  const script = `
    const lockfile = require(${JSON.stringify(require.resolve("proper-lockfile"))});
    const fs = require("node:fs");
    fs.mkdirSync(require("node:path").dirname(${JSON.stringify(auth.lockTarget)}), { recursive: true });
    fs.writeFileSync(${JSON.stringify(auth.lockTarget)}, "", { flag: "a" });
    lockfile.lock(${JSON.stringify(auth.lockTarget)}, { retries: 0, stale: 5000, realpath: false }).then((release) => {
      process.stdout.write("held\\n");
      setTimeout(() => {
        fs.writeFileSync(${JSON.stringify(auth.credentialPath)}, JSON.stringify(${JSON.stringify(token({ access_token: "at-winner", refresh_token: "rt-winner", expires_at: nowSeconds + 900 }))}, null, 2) + "\\n");
        release().then(() => { process.stdout.write("released\\n"); process.exit(0); });
      }, 300);
    });
  `;
  const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "inherit"] });
  const childClosed = new Promise<void>((resolve) => child.on("close", () => resolve()));
  await new Promise<void>((resolve) => child.stdout.on("data", (c: Buffer) => { if (c.toString().includes("held")) resolve(); }));
  const { fetchFn, calls } = mockFetch(() => okResponse());
  const result = await ensureFreshKimiToken(auth, baseDeps({ fetchFn, lock: { retries: { retries: 20, factor: 1, minTimeout: 50, maxTimeout: 100 } } }));
  assert.deepEqual(result, { kind: "adopted", expiresAt: nowSeconds + 900 });
  assert.equal(calls.length, 0, "the loser never sent the old refresh token");
  const stored = readKimiStoredToken(auth.credentialPath);
  assert.equal(stored.kind === "ok" ? stored.token.refresh_token : null, "rt-winner");
  await childClosed;
}));

test("task #1282 (c): the lock held by the client is a bounded failure: no request, no write", () => withHome(async (_home, auth) => {
  writeKimiStoredToken(auth.credentialPath, token());
  const before = readFileSync(auth.credentialPath, "utf8");
  const script = `
    const lockfile = require(${JSON.stringify(require.resolve("proper-lockfile"))});
    const fs = require("node:fs");
    fs.mkdirSync(require("node:path").dirname(${JSON.stringify(auth.lockTarget)}), { recursive: true });
    fs.writeFileSync(${JSON.stringify(auth.lockTarget)}, "", { flag: "a" });
    lockfile.lock(${JSON.stringify(auth.lockTarget)}, { retries: 0, stale: 5000, realpath: false }).then((release) => { process.stdout.write("held\\n"); setTimeout(() => release().then(() => process.exit(0)), 1500); });
  `;
  const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "inherit"] });
  const childClosed = new Promise<void>((resolve) => child.on("close", () => resolve()));
  await new Promise<void>((resolve) => child.stdout.on("data", (c: Buffer) => { if (c.toString().includes("held")) resolve(); }));
  const { fetchFn, calls } = mockFetch(() => okResponse());
  const startedAt = Date.now();
  assert.deepEqual(await ensureFreshKimiToken(auth, baseDeps({ fetchFn })), { kind: "transient", reason: "lock_unavailable", expired: true });
  assert.ok(Date.now() - startedAt < 1400, "bounded wait, shorter than the client's hold");
  assert.equal(calls.length, 0);
  assert.equal(readFileSync(auth.credentialPath, "utf8"), before);
  await childClosed;
}));

test("task #1282: a lock compromised during the refresh stops the write and reports lock_compromised", () => withHome(async (_home, auth) => {
  writeKimiStoredToken(auth.credentialPath, token());
  const before = readFileSync(auth.credentialPath, "utf8");
  const { fetchFn } = mockFetch(() => okResponse());
  const result = await ensureFreshKimiToken(auth, baseDeps({
    fetchFn,
    lock: { ...FAST_LOCK, staleMs: 2000 },
    beforeWrite: async () => {
      // Another party reclaimed the lock it judged stale (its lock dir carries its own mtime).
      rmSync(`${auth.lockTarget}.lock`, { recursive: true, force: true });
      mkdirSync(`${auth.lockTarget}.lock`);
      const foreign = new Date(Date.now() - 60_000);
      utimesSync(`${auth.lockTarget}.lock`, foreign, foreign);
      await new Promise((r) => setTimeout(r, 2500));
    },
  }));
  assert.deepEqual(result, { kind: "transient", reason: "lock_compromised", expired: true });
  assert.equal(readFileSync(auth.credentialPath, "utf8"), before, "no write on a compromised lock");
}));

test.fails("task #1282 (a) KNOWN GAP: a login (which the client writes without the lock) landing between the last in-lock comparison and the rename is overwritten", () => withHome(async (_home, auth) => {
  writeKimiStoredToken(auth.credentialPath, token());
  const { fetchFn } = mockFetch(() => okResponse("rt-ours"));
  await ensureFreshKimiToken(auth, baseDeps({
    fetchFn,
    beforeWrite: () => {
      // The user switched accounts right now: the client's login wrote a new token, unlocked.
      writeKimiStoredToken(auth.credentialPath, token({ access_token: "at-login", refresh_token: "rt-login", expires_at: nowSeconds + 900 }));
    },
  }));
  const stored = readKimiStoredToken(auth.credentialPath);
  // The honest requirement: the login must survive. It does not today (our rename wins).
  assert.equal(stored.kind === "ok" ? stored.token.refresh_token : null, "rt-login");
}));

test("task #1282: an account switch seen at the last in-lock comparison is respected (our result is dropped, the new account's file stays)", () => withHome(async (_home, auth) => {
  writeKimiStoredToken(auth.credentialPath, token());
  const { fetchFn } = mockFetch(() => {
    // The switch lands while our request is in flight, before the comparison.
    writeKimiStoredToken(auth.credentialPath, token({ access_token: "at-login", refresh_token: "rt-login", expires_at: nowSeconds + 900 }));
    return okResponse("rt-ours");
  });
  assert.deepEqual(await ensureFreshKimiToken(auth, baseDeps({ fetchFn })), { kind: "adopted", expiresAt: nowSeconds + 900 });
  const stored = readKimiStoredToken(auth.credentialPath);
  assert.equal(stored.kind === "ok" ? stored.token.refresh_token : null, "rt-login");
}));

test("task #1282: no refresh on win32, with the client's lock kill switch, or for non-file storage; missing, unreadable, tombstoned and refresh-token-less files are reported as such", () => withHome(async (_home, auth) => {
  writeKimiStoredToken(auth.credentialPath, token());
  const { fetchFn, calls } = mockFetch(() => okResponse());
  assert.deepEqual(await ensureFreshKimiToken(auth, baseDeps({ fetchFn, platform: "win32" })), { kind: "platform_unsupported", reason: "win32" });
  assert.deepEqual(await ensureFreshKimiToken(auth, baseDeps({ fetchFn, env: { KIMI_DISABLE_OAUTH_LOCK: "1" } })), { kind: "platform_unsupported", reason: "lock_disabled" });
  assert.deepEqual(await ensureFreshKimiToken({ ...auth, storage: "other" }, baseDeps({ fetchFn })), { kind: "platform_unsupported", reason: "storage_not_file" });
  assert.equal(calls.length, 0);
  writeKimiStoredToken(auth.credentialPath, token({ access_token: "", refresh_token: "", expires_at: 0, expires_in: 0 }));
  assert.deepEqual(await ensureFreshKimiToken(auth, baseDeps({ fetchFn })), { kind: "revoked" });
  writeKimiStoredToken(auth.credentialPath, token({ refresh_token: "" }));
  assert.deepEqual(await ensureFreshKimiToken(auth, baseDeps({ fetchFn })), { kind: "missing", reason: "no_refresh_token" });
  rmSync(auth.credentialPath);
  assert.deepEqual(await ensureFreshKimiToken(auth, baseDeps({ fetchFn })), { kind: "missing", reason: "no_file" });
  assert.equal(calls.length, 0);
}));

// ── review on #9802 (Huaihuai, 2026-10-14): input validation ──

test("task #1282 (review): a 200 whose access_token is empty or not a string is never written — the file keeps the old token, the result is a transient malformed_response, and the next read is still a usable token, not revoked", () => withHome(async (_home, auth) => {
  writeKimiStoredToken(auth.credentialPath, token());
  const before = readFileSync(auth.credentialPath, "utf8");
  for (const accessToken of ["", 42, null, undefined]) {
    const { fetchFn, calls } = mockFetch(() => ({ status: 200, json: { access_token: accessToken, refresh_token: "rt-new", expires_in: 900 } }));
    assert.deepEqual(await ensureFreshKimiToken(auth, baseDeps({ fetchFn })), { kind: "transient", reason: "malformed_response", expired: true }, `access_token=${String(accessToken)}`);
    assert.equal(calls.length, 1, "no retry on a malformed success");
    assert.equal(readFileSync(auth.credentialPath, "utf8"), before, "file untouched");
    const after = readKimiStoredToken(auth.credentialPath);
    assert.equal(after.kind, "ok");
    assert.equal(after.kind === "ok" ? after.token.access_token : null, "at-old");
  }
}));

test("task #1282 (review): only the client's exact tombstone reads as revoked; {} , a partial record, mistyped fields, an array or a foreign shape are malformed (handed to OAR, not a pre-step verdict)", () => withHome(async (_home, auth) => {
  mkdirSync(path.dirname(auth.credentialPath), { recursive: true });
  const write = (body: string) => writeFileSync(auth.credentialPath, body);
  const { fetchFn, calls } = mockFetch(() => okResponse());
  // The real tombstone (kimi-code revokedTombstone: empty tokens, expires_at 0, scope / token_type carried over).
  write(JSON.stringify({ access_token: "", refresh_token: "", expires_at: 0, scope: "", token_type: "Bearer", expires_in: 0 }));
  assert.deepEqual(readKimiStoredToken(auth.credentialPath), { kind: "revoked" });
  assert.deepEqual(await ensureFreshKimiToken(auth, baseDeps({ fetchFn })), { kind: "revoked" });
  const malformed: Array<[string, string]> = [
    ["{}", "{}"],
    ['{"access_token":""}', "empty access token without the tombstone's other fields"],
    ['{"access_token":"","refresh_token":"rt-x","expires_at":0}', "empty access token with a refresh token"],
    ['{"access_token":"","refresh_token":"","expires_at":1}', "tombstone tokens but a live expires_at"],
    ['{"access_token":12,"refresh_token":"rt-x"}', "numeric access token"],
    ['{"access_token":"at-x","refresh_token":12}', "numeric refresh token"],
    ['{"refresh_token":"rt-x","expires_at":0}', "access token absent"],
    ['{"foo":"bar"}', "foreign shape"],
  ];
  for (const [body, label] of malformed) {
    write(body);
    assert.deepEqual(readKimiStoredToken(auth.credentialPath), { kind: "missing", reason: "malformed" }, label);
    assert.deepEqual(await ensureFreshKimiToken(auth, baseDeps({ fetchFn })), { kind: "missing", reason: "malformed" }, label);
  }
  write("[]");
  assert.deepEqual(readKimiStoredToken(auth.credentialPath), { kind: "missing", reason: "unreadable" });
  write("not json");
  assert.deepEqual(readKimiStoredToken(auth.credentialPath), { kind: "missing", reason: "unreadable" });
  assert.equal(calls.length, 0, "nothing is requested for a file that is not a usable token");
}));

test("task #1282 (review): a file that turns malformed between the refresh and the write is left alone and reported as such", () => withHome(async (_home, auth) => {
  writeKimiStoredToken(auth.credentialPath, token());
  const { fetchFn } = mockFetch(() => okResponse());
  let replaced = "";
  const deps = baseDeps({ fetchFn });
  const wrappedFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    writeFileSync(auth.credentialPath, "{}");
    replaced = readFileSync(auth.credentialPath, "utf8");
    return (fetchFn as (i: string | URL | Request, n?: RequestInit) => Promise<Response>)(input, init);
  }) as unknown as typeof fetch;
  assert.deepEqual(await ensureFreshKimiToken(auth, { ...deps, fetchFn: wrappedFetch }), { kind: "missing", reason: "malformed" });
  assert.equal(readFileSync(auth.credentialPath, "utf8"), replaced, "the foreign write is not overwritten by our refreshed token");
}));
