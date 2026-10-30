// `sk_computer_*` verification: rows carrying `api_key_hmac` verify by HMAC
// without argon2; rows without one (or an unset secret) verify by argon2 and
// store the HMAC; an HMAC from an older secret falls back to argon2 and is
// rewritten; a rotation racing the store never inherits the old key's HMAC.
import { dbTest as test } from "../test/integration/dbTest";
import { closeTestDatabase } from "../test/integration/database";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { eq } from "drizzle-orm";
import { vi } from "vitest";
import { getDb } from "../db/index";
import { computers, servers, users } from "../db/schema";
import { createServer } from "./serverService";
import { registerMachine } from "./machineService";
import { adoptLegacyMachine } from "./computerAdoptionService";
import { AGENT_API_KEY_HMAC_SECRET_ENV } from "./agentCredentialService";
import { newArgon2VerifyStats } from "./argon2VerifyStats";
import {
  attachComputer,
  findComputerByApiKeyWithReason,
  generateComputerApiKeyMaterial,
} from "./computerCredentialService";

const SECRET = "computer-api-key-hmac-test-secret-0123456789";
const OTHER_SECRET = "computer-api-key-hmac-other-secret-9876543210";

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await closeTestDatabase();
});

async function attach() {
  const suffix = randomUUID();
  const [owner] = await getDb().insert(users).values({
    email: `computer-hmac-${suffix}@slock.test`,
    name: `computer-hmac-${suffix}`,
    passwordHash: "hash",
    emailVerified: true,
  }).returning();
  const server = await createServer("Computer HMAC", `computer-hmac-${suffix}`, owner!.id);
  const attached = await attachComputer({ userId: owner!.id, serverSlug: server.slug, name: `hmac-${suffix.slice(0, 8)}` });
  assert.ok(attached.ok, JSON.stringify(attached));
  const [row] = await getDb().select({ id: computers.id }).from(computers).where(eq(computers.serverId, server.id));
  return { apiKey: attached.apiKey, computerId: row!.id, serverId: server.id };
}

async function storedHmac(computerId: string): Promise<Buffer | null> {
  const [row] = await getDb().select({ apiKeyHmac: computers.apiKeyHmac }).from(computers).where(eq(computers.id, computerId));
  return row!.apiKeyHmac ? Buffer.from(row!.apiKeyHmac) : null;
}

// Same prefix, so the lookup still finds the row and the verifier must reject.
function wrongKeySamePrefix(apiKey: string): string {
  return apiKey.slice(0, -1) + (apiKey.at(-1) === "0" ? "1" : "0");
}

test("an attach with the secret set stores the HMAC; the key then verifies without argon2", async ({ db }) => {
  void db;
  vi.stubEnv(AGENT_API_KEY_HMAC_SECRET_ENV, SECRET);
  const { apiKey, computerId } = await attach();
  assert.ok(await storedHmac(computerId), "attach must persist api_key_hmac");

  const verify = vi.spyOn(argon2, "verify");
  const stats = newArgon2VerifyStats();
  const found = await findComputerByApiKeyWithReason(apiKey, stats);
  assert.equal(found.ok && found.computer.computerId, computerId);
  assert.equal(verify.mock.calls.length, 0, "HMAC path must not call argon2");
  assert.equal(stats.hmacMatches, 1);
  assert.equal(stats.count, 0);
});

test("a wrong key with the right prefix is still rejected, via argon2", async ({ db }) => {
  void db;
  vi.stubEnv(AGENT_API_KEY_HMAC_SECRET_ENV, SECRET);
  const { apiKey, computerId } = await attach();
  const before = await storedHmac(computerId);
  assert.deepEqual(await findComputerByApiKeyWithReason(wrongKeySamePrefix(apiKey)), { ok: false, reason: "computer_key_hash_mismatch" });
  assert.deepEqual(await storedHmac(computerId), before, "a failed verify must not touch the stored HMAC");
});

test("a row without an HMAC verifies with argon2 once, stores it, then takes the HMAC path", async ({ db }) => {
  void db;
  const { apiKey, computerId } = await attach(); // secret unset: no HMAC
  assert.equal(await storedHmac(computerId), null);

  vi.stubEnv(AGENT_API_KEY_HMAC_SECRET_ENV, SECRET);
  const verify = vi.spyOn(argon2, "verify");
  assert.equal((await findComputerByApiKeyWithReason(wrongKeySamePrefix(apiKey))).ok, false);
  assert.equal(await storedHmac(computerId), null, "a failed verify must not store an HMAC");
  assert.equal((await findComputerByApiKeyWithReason(apiKey)).ok, true);
  assert.equal(verify.mock.calls.length, 2);
  assert.ok(await storedHmac(computerId), "argon2 success must store api_key_hmac");
  assert.equal((await findComputerByApiKeyWithReason(apiKey)).ok, true);
  assert.equal(verify.mock.calls.length, 2, "stored row must verify without argon2");
});

test("a key rejected because its server was deleted pays argon2 once, not on every reconnect", async ({ db }) => {
  void db;
  const { apiKey, computerId, serverId } = await attach();
  vi.stubEnv(AGENT_API_KEY_HMAC_SECRET_ENV, SECRET);
  await getDb().update(servers).set({ deletedAt: new Date() }).where(eq(servers.id, serverId));
  const verify = vi.spyOn(argon2, "verify");
  assert.deepEqual(await findComputerByApiKeyWithReason(apiKey), { ok: false, reason: "server_not_found" });
  assert.equal(verify.mock.calls.length, 1);
  assert.ok(await storedHmac(computerId), "the HMAC is stored even though auth is then refused");
  assert.deepEqual(await findComputerByApiKeyWithReason(apiKey), { ok: false, reason: "server_not_found" });
  assert.equal(verify.mock.calls.length, 1, "the repeat rejection must not run argon2 again");
});

test("an HMAC from an older secret falls back to argon2, is rewritten and counted, then takes the HMAC path", async ({ db }) => {
  void db;
  vi.stubEnv(AGENT_API_KEY_HMAC_SECRET_ENV, OTHER_SECRET);
  const { apiKey, computerId } = await attach();
  const old = await storedHmac(computerId);
  assert.ok(old);

  vi.stubEnv(AGENT_API_KEY_HMAC_SECRET_ENV, SECRET); // the secret changed
  const verify = vi.spyOn(argon2, "verify");
  const stats = newArgon2VerifyStats();
  assert.equal((await findComputerByApiKeyWithReason(apiKey, stats)).ok, true, "a changed secret must not lock the key out");
  assert.equal(verify.mock.calls.length, 1);
  assert.equal(stats.hmacRewrites, 1, "the rewrite is visible on the auth span");
  const rewritten = await storedHmac(computerId);
  assert.ok(rewritten && !rewritten.equals(old), "the stale HMAC is replaced");
  assert.equal((await findComputerByApiKeyWithReason(apiKey)).ok, true);
  assert.equal(verify.mock.calls.length, 1, "after the rewrite the key verifies without argon2");
});

test("a rotation during the argon2 verify does not inherit the old key's HMAC", async ({ db }) => {
  void db;
  const { apiKey, computerId } = await attach(); // no HMAC yet
  vi.stubEnv(AGENT_API_KEY_HMAC_SECRET_ENV, SECRET);
  const rotated = await generateComputerApiKeyMaterial();
  const realVerify = argon2.verify.bind(argon2);
  vi.spyOn(argon2, "verify").mockImplementationOnce(async (...args) => {
    const ok = await realVerify(...args);
    // Rotate the row the way the adoption path does, mid-verify.
    await getDb().update(computers)
      .set({ apiKeyHash: rotated.apiKeyHash, apiKeyPrefix: rotated.apiKeyPrefix, apiKeyHmac: rotated.apiKeyHmac })
      .where(eq(computers.id, computerId));
    return ok;
  });
  assert.equal((await findComputerByApiKeyWithReason(apiKey)).ok, false, "the old key loses to the rotation");
  assert.deepEqual(await storedHmac(computerId), rotated.apiKeyHmac, "the rotated row keeps the new key's HMAC");
  vi.restoreAllMocks();
  assert.equal((await findComputerByApiKeyWithReason(rotated.apiKey)).ok, true);
});

test("a revoked key is refused on the HMAC path too", async ({ db }) => {
  void db;
  vi.stubEnv(AGENT_API_KEY_HMAC_SECRET_ENV, SECRET);
  const { apiKey, computerId } = await attach();
  await getDb().update(computers).set({ revokedAt: new Date() }).where(eq(computers.id, computerId));
  assert.deepEqual(await findComputerByApiKeyWithReason(apiKey), { ok: false, reason: "computer_revoked" });
});

test("without the secret, a row carrying an HMAC verifies with argon2 as before", async ({ db }) => {
  void db;
  vi.stubEnv(AGENT_API_KEY_HMAC_SECRET_ENV, SECRET);
  const { apiKey } = await attach();
  vi.stubEnv(AGENT_API_KEY_HMAC_SECRET_ENV, "");
  const verify = vi.spyOn(argon2, "verify");
  assert.equal((await findComputerByApiKeyWithReason(apiKey)).ok, true);
  assert.equal(verify.mock.calls.length, 1);
});

test("a rotation through legacy adoption writes the new key's HMAC: new key on the fast path, old key refused", async ({ db }) => {
  void db;
  vi.stubEnv(AGENT_API_KEY_HMAC_SECRET_ENV, SECRET);
  const suffix = randomUUID();
  const [owner] = await getDb().insert(users).values({
    email: `computer-hmac-adopt-${suffix}@slock.test`,
    name: `computer-hmac-adopt-${suffix}`,
    passwordHash: "hash",
    emailVerified: true,
  }).returning();
  const server = await createServer("Computer HMAC adopt", `computer-hmac-adopt-${suffix}`, owner!.id);
  const { machine, apiKey: legacyKey } = await registerMachine(server.id, owner!.id, "hmac-adopt-legacy");
  // A live Computer row already linked to the machine: adoption rotates it in place.
  const old = await generateComputerApiKeyMaterial();
  await getDb().insert(computers).values({
    serverId: server.id,
    name: "hmac-adopt",
    apiKeyHash: old.apiKeyHash,
    apiKeyHmac: old.apiKeyHmac,
    apiKeyPrefix: old.apiKeyPrefix,
    attachedByUserId: owner!.id,
    machineId: machine.id,
  });

  const adopted = await adoptLegacyMachine({ userId: owner!.id, legacyApiKey: legacyKey });
  assert.ok(adopted.ok && adopted.resumed, JSON.stringify(adopted));
  const verify = vi.spyOn(argon2, "verify");
  assert.equal((await findComputerByApiKeyWithReason(adopted.apiKey)).ok, true);
  assert.equal(verify.mock.calls.length, 0, "the rotated row carries the new key's HMAC");
  assert.equal((await findComputerByApiKeyWithReason(old.apiKey)).ok, false, "the old key no longer authenticates");
});
