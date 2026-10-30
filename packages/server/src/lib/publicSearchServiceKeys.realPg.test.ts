// Real-PostgreSQL teeth for the public search service key table (public server
// SEO task #4, Ark): the migration owner rotates keys; a serving role that can
// only SELECT reads them; every write and DDL by that role is refused by the
// database; and a serving role with any extra right on the table makes the
// service path unavailable (503) while anonymous callers are unaffected. No
// production role name is assumed: the check runs as `current_user`.
//
// CI: the probe-concurrency job step "Public search service keys real
// PostgreSQL 17 teeth"; locally PUBLIC_SEARCH_KEYS_REAL_PG_URL (a role that
// can create databases and roles).
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Request, RequestHandler, Response } from "express";
import pg from "pg";
import * as schema from "../db/schema";
import {
  createDatabaseKeySource,
  createMemoryPublicSearchBucketStore,
  createPublicSearchAccess,
  PUBLIC_SEARCH_SERVICE_CLIENT_ID,
  readPublicSearchServiceLimits,
} from "./publicSearchServiceAccess";

const REAL_PG_URL = process.env.PUBLIC_SEARCH_KEYS_REAL_PG_URL;
const REAL_PG_REQUIRED = process.env.PUBLIC_SEARCH_KEYS_REAL_PG_REQUIRED === "1";
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

function urlFor(adminUrl: string, database: string, user?: { name: string; password: string }) {
  const parsed = new URL(adminUrl);
  parsed.pathname = `/${database}`;
  if (user) {
    parsed.username = user.name;
    parsed.password = user.password;
  }
  return parsed.toString();
}

const denied = (error: { code?: string }) => error.code === "42501";

/**
 * pg-pool's `end()` resolves once its clients are told to close, not once
 * their sessions are gone, and a closing client keeps the pool's idle error
 * listener. `DROP DATABASE ... WITH (FORCE)` in the cleanup can then kill a
 * session that is still shutting down, and the FATAL 57P01 (admin_shutdown)
 * is re-emitted on the pool. With no listener that is an unhandled error that
 * fails the run intermittently (bug-triage task #21). The pools here tolerate
 * exactly that code; anything else is kept and asserted after cleanup.
 */
function watchTeardownErrors(pool: pg.Pool, unexpected: Error[]): pg.Pool {
  pool.on("error", (error: Error & { code?: string }) => {
    if (error.code !== "57P01") unexpected.push(error);
  });
  return pool;
}

test.skipIf(!REAL_PG_URL && !REAL_PG_REQUIRED)(
  "real PG: the owner rotates keys, a read-only serving role reads them and is refused every write, and any extra right closes the service path",
  async () => {
    assert.ok(REAL_PG_URL, "PUBLIC_SEARCH_KEYS_REAL_PG_URL is required");
    const suffix = randomBytes(4).toString("hex");
    const database = `slock_public_search_keys_${process.pid}_${suffix}`;
    const runtime = { name: `pss_runtime_${suffix}`, password: randomBytes(12).toString("hex") };
    const admin = new pg.Client({ connectionString: REAL_PG_URL });
    await admin.connect();
    const pools: pg.Pool[] = [];
    const unexpectedPoolErrors: Error[] = [];
    try {
      await admin.query(`CREATE DATABASE "${database}"`);
      await admin.query(`CREATE ROLE "${runtime.name}" LOGIN PASSWORD '${runtime.password}'`);
      const ownerPool = watchTeardownErrors(new pg.Pool({ connectionString: urlFor(REAL_PG_URL, database), max: 2 }), unexpectedPoolErrors);
      pools.push(ownerPool);
      await migrate(drizzle(ownerPool, { schema }), { migrationsFolder: MIGRATIONS_FOLDER });
      // The serving role gets exactly what the contract allows on this table.
      await ownerPool.query(`GRANT CONNECT ON DATABASE "${database}" TO "${runtime.name}"`);
      await ownerPool.query(`GRANT USAGE ON SCHEMA public TO "${runtime.name}"`);
      await ownerPool.query(`GRANT SELECT ON public_search_service_keys TO "${runtime.name}"`);

      // The owner rotates in one transaction: old current becomes previous, new current arrives.
      const tokens = [randomBytes(32).toString("base64url"), randomBytes(32).toString("base64url")];
      const digest = (token: string) => createHash("sha256").update(token).digest("hex");
      await ownerPool.query(`INSERT INTO public_search_service_keys (key_id, client_id, sha256) VALUES ('k1', $1, $2)`, [PUBLIC_SEARCH_SERVICE_CLIENT_ID, digest(tokens[0]!)]);
      const rotation = await ownerPool.connect();
      try {
        await rotation.query("BEGIN");
        await rotation.query(`UPDATE public_search_service_keys SET expires_at = now() + interval '1 day' WHERE key_id = 'k1'`);
        await rotation.query(`INSERT INTO public_search_service_keys (key_id, client_id, sha256) VALUES ('k2', $1, $2)`, [PUBLIC_SEARCH_SERVICE_CLIENT_ID, digest(tokens[1]!)]);
        await rotation.query("COMMIT");
      } finally {
        rotation.release();
      }
      await assert.rejects(
        ownerPool.query(`INSERT INTO public_search_service_keys (key_id, client_id, sha256) VALUES ('k3', $1, $2)`, [PUBLIC_SEARCH_SERVICE_CLIENT_ID, digest("x")]),
        (error: { code?: string }) => error.code === "23505",
        "a second current key is refused by the partial unique index",
      );

      // The serving role reads both keys through the production source (with its privilege preflight).
      const runtimePool = watchTeardownErrors(new pg.Pool({ connectionString: urlFor(REAL_PG_URL, database, runtime), max: 2 }), unexpectedPoolErrors);
      pools.push(runtimePool);
      const runtimeDb = drizzle(runtimePool, { schema });
      const source = createDatabaseKeySource({ checkPrivileges: true, db: () => runtimeDb as never });
      const rows = await source();
      assert.deepEqual(rows.map((row) => row.keyId).sort(), ["k1", "k2"]);

      // …and the database refuses it every write and DDL on the table.
      for (const [name, statement] of [
        ["INSERT", `INSERT INTO public_search_service_keys (key_id, client_id, sha256) VALUES ('kx', 'x', '${"0".repeat(64)}')`],
        ["UPDATE", `UPDATE public_search_service_keys SET expires_at = now()`],
        ["DELETE", `DELETE FROM public_search_service_keys`],
        ["TRUNCATE", `TRUNCATE public_search_service_keys`],
        ["ALTER", `ALTER TABLE public_search_service_keys ADD COLUMN x int`],
        ["DROP", `DROP TABLE public_search_service_keys`],
      ] as const) {
        await assert.rejects(runtimePool.query(statement), denied, `${name} by the serving role`);
      }

      // The gate over this source: valid → passes; an extra right on the serving role → 503; anonymous unaffected.
      const passThrough: RequestHandler = (_req, _res, next) => next();
      const access = createPublicSearchAccess({
        anonymousLimiter: passThrough,
        verifyLimiter: passThrough,
        keySource: source,
        bucketStore: createMemoryPublicSearchBucketStore(),
        limits: readPublicSearchServiceLimits({}),
      });
      const send = async (authorization?: string) => {
        const res = new EventEmitter() as EventEmitter & { statusCode: number; headersSent: boolean; set: () => unknown; status: (c: number) => unknown; json: () => unknown };
        res.statusCode = 200;
        res.headersSent = false;
        res.set = () => res;
        res.status = (code: number) => { res.statusCode = code; return res; };
        res.json = () => { res.headersSent = true; res.emit("finish"); return res; };
        let passed = false;
        access({ headers: authorization ? { authorization } : {} } as unknown as Request, res as unknown as Response, () => { passed = true; res.emit("finish"); });
        await new Promise((resolve) => setTimeout(resolve, 200));
        return passed ? 200 : res.statusCode;
      };
      assert.equal(await send(`Raft-Service v1 k2.${tokens[1]}`), 200, "read-only serving role: the current key works");
      assert.equal(await send(`Raft-Service v1 k1.${tokens[0]}`), 200, "the previous key works until its deadline");

      await ownerPool.query(`GRANT UPDATE ON public_search_service_keys TO "${runtime.name}"`);
      assert.equal(await send(`Raft-Service v1 k2.${tokens[1]}`), 503, "one extra right on the serving role closes the service path");
      assert.equal(await send(), 200, "anonymous callers are unaffected");
      await ownerPool.query(`REVOKE UPDATE ON public_search_service_keys FROM "${runtime.name}"`);
      assert.equal(await send(`Raft-Service v1 k2.${tokens[1]}`), 200, "read-only again: the service path is back on the next request");

      // The owner deletes the previous key: refused on the very next request, no restart.
      await ownerPool.query(`DELETE FROM public_search_service_keys WHERE key_id = 'k1'`);
      assert.equal(await send(`Raft-Service v1 k1.${tokens[0]}`), 401, "deleted previous key: 401 on the next request");
    } finally {
      for (const pool of pools) await pool.end().catch(() => {});
      await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`).catch(() => {});
      await admin.query(`DROP ROLE IF EXISTS "${runtime.name}"`).catch(() => {});
      await admin.end();
    }
    assert.deepEqual(unexpectedPoolErrors, [], "no pool error other than the teardown's admin_shutdown");
  },
);

test.skipIf(!REAL_PG_URL && !REAL_PG_REQUIRED)(
  "real PG: the key lookup runs on its own two-connection pool; when that pool is saturated it fails fast and the content pool is untouched; closeDatabase ends it",
  async () => {
    assert.ok(REAL_PG_URL, "PUBLIC_SEARCH_KEYS_REAL_PG_URL is required");
    const { initDatabase, getDb, getBoundedAuthDb, closeDatabase } = await import("../db/index");
    const { sql } = await import("drizzle-orm");
    const database = `slock_public_search_auth_${process.pid}_${randomBytes(4).toString("hex")}`;
    const admin = new pg.Client({ connectionString: REAL_PG_URL });
    await admin.connect();
    const testUrl = urlFor(REAL_PG_URL, database);
    let releases: Array<() => void> = [];
    const unexpectedPoolErrors: Error[] = [];
    try {
      await admin.query(`CREATE DATABASE "${database}"`);
      const setup = watchTeardownErrors(new pg.Pool({ connectionString: testUrl, max: 1 }), unexpectedPoolErrors);
      await migrate(drizzle(setup, { schema }), { migrationsFolder: MIGRATIONS_FOLDER });
      await setup.query(`INSERT INTO public_search_service_keys (key_id, client_id, sha256) VALUES ('k1', $1, $2)`, [PUBLIC_SEARCH_SERVICE_CLIENT_ID, "0".repeat(64)]);
      await setup.end();

      await initDatabase(testUrl, undefined, { log: () => {} });
      // The owner connection has every right, so the preflight is off here; this test is about the pool.
      const source = createDatabaseKeySource({ checkPrivileges: false });
      assert.deepEqual((await source()).map((row) => row.keyId), ["k1"], "reads through the bounded pool");

      // Hold both auth connections (always released below, so a failure cannot hang the test).
      releases = [];
      const holders = [0, 1].map(() => getBoundedAuthDb(250)!.transaction(async (tx) => {
        await tx.execute(sql`SELECT 1`);
        await new Promise<void>((resolve) => releases.push(resolve));
      }));
      await new Promise((resolve) => setTimeout(resolve, 100));
      const started = Date.now();
      await assert.rejects(source(), "a third lookup cannot get a connection and fails");
      const waited = Date.now() - started;
      assert.ok(waited < 1_000, `it fails within the pool's bound, waited ${waited}ms`);
      // The content pool is a different pool: it still answers.
      const content = await getDb().execute(sql`SELECT 1 AS one`);
      assert.equal((content.rows[0] as { one: number }).one, 1, "content queries are unaffected");
      for (const release of releases) release();
      await Promise.all(holders);
      assert.deepEqual((await source()).map((row) => row.keyId), ["k1"], "free again once the holders finish");

      await closeDatabase();
      assert.ok(getBoundedAuthDb(250) === null, "closeDatabase ends the auth pool and does not hand it out again");
    } finally {
      for (const release of releases) release();
      await closeDatabase().catch(() => {});
      await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`).catch(() => {});
      await admin.end();
    }
    assert.deepEqual(unexpectedPoolErrors, [], "no pool error other than the teardown's admin_shutdown");
  },
);
