// listRecoverableMentionDeliveriesForAgent must be servable by the partial
// index idx_mention_delivery_occurrences_agent_payload_open, and the index the
// migration builds must match what the CONCURRENTLY create/verify scripts
// expect (they run first in staging/prod and make the migration a no-op).
import { dbTest as test } from "../test/integration/dbTest";
import { closeTestDatabase } from "../test/integration/database";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { getDb } from "../db/index";
import { recoverableMentionDeliveriesForAgentQuery } from "./mentionDeliveryOccurrenceService";
import {
  AGENT_OPEN_INDEX_COLUMNS,
  AGENT_OPEN_INDEX_NAME,
  AGENT_OPEN_INDEX_PREDICATE,
} from "../../scripts/mention-delivery-agent-open-index";

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

afterEach(async () => {
  await closeTestDatabase();
});

test("migrations build the agent-open index exactly as the create/verify scripts expect", async ({ db }) => {
  void db;
  const result = await getDb().execute(sql`
    SELECT i.indisunique AS "isUnique",
           array_to_string(array_agg(a.attname ORDER BY k.ord), ',') AS "columns",
           pg_get_expr(i.indpred, i.indrelid) AS "predicate"
    FROM pg_class idx
    JOIN pg_index i ON i.indexrelid = idx.oid
    JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
    WHERE idx.relname = ${AGENT_OPEN_INDEX_NAME}
    GROUP BY i.indisunique, i.indpred, i.indrelid
  `);
  const rows = (result as unknown as { rows: Array<{ isUnique: boolean; columns: string; predicate: string }> }).rows;
  assert.equal(rows.length, 1, "index must exist after migrations");
  assert.equal(rows[0]!.isUnique, false);
  assert.equal(rows[0]!.columns, AGENT_OPEN_INDEX_COLUMNS);
  assert.equal(rows[0]!.predicate, AGENT_OPEN_INDEX_PREDICATE);

  const migration = await readFile(path.join(SERVER_ROOT, "drizzle/0341_mention_delivery_agent_open_index.sql"), "utf8");
  assert.match(migration, /CREATE INDEX IF NOT EXISTS "idx_mention_delivery_occurrences_agent_payload_open"/);
  const statements = migration.split("\n").filter((line) => !line.startsWith("--")).join("\n");
  assert.doesNotMatch(statements, /CONCURRENTLY/, "migrations run in a transaction");
});

test("the agent recovery query can use the agent-open index", async ({ db }) => {
  void db;
  const query = recoverableMentionDeliveriesForAgentQuery(randomUUID(), randomUUID()).toSQL();
  const client = (getDb() as unknown as { $client: { query: (q: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, string>> }> } }).$client;
  await client.query("SET enable_seqscan = off");
  try {
    const plan = await client.query(`EXPLAIN ${query.sql}`, query.params);
    const text = plan.rows.map((r) => Object.values(r)[0]).join("\n");
    assert.match(text, new RegExp(AGENT_OPEN_INDEX_NAME), text);
  } finally {
    await client.query("RESET enable_seqscan");
  }
});
