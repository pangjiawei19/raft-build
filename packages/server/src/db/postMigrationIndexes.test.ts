import { dbTest as test } from "../test/integration/dbTest";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { getDb } from "./index";
import {
  evaluatePostMigrationIndexes,
  POST_MIGRATION_INDEXES,
  postMigrationIndexRemedy,
  readObservedIndexes,
  type ObservedIndex,
  type PostMigrationIndexSpec,
} from "./postMigrationIndexes";

const sender = POST_MIGRATION_INDEXES.find((spec) => spec.name === "idx_messages_sender_created_at")!;
const outbox = POST_MIGRATION_INDEXES.find((spec) => spec.name === "idx_mobile_push_outbox_active_created")!;

function observed(spec: PostMigrationIndexSpec, overrides: Partial<ObservedIndex> = {}): ObservedIndex {
  return {
    table: spec.table,
    name: spec.name,
    columns: spec.columns,
    unique: spec.unique,
    predicate: spec.predicate,
    valid: true,
    ready: true,
    ...overrides,
  };
}

test("present, invalid and missing indexes are told apart, and the remedy names the create script", () => {
  const [ok] = evaluatePostMigrationIndexes([observed(sender)], [sender]);
  assert.equal(ok?.state, "ok");

  // A failed CONCURRENTLY build leaves the index behind with indisvalid=false.
  const [invalid] = evaluatePostMigrationIndexes([observed(sender, { valid: false })], [sender]);
  assert.equal(invalid?.state, "invalid");
  assert.equal(
    postMigrationIndexRemedy(invalid as Exclude<typeof invalid, { state: "ok" }>),
    `DROP INDEX CONCURRENTLY "idx_messages_sender_created_at"; then pnpm --filter @botiverse/raft-server db:create-messages-sender-index`,
  );
  const [notReady] = evaluatePostMigrationIndexes([observed(sender, { ready: false })], [sender]);
  assert.equal(notReady?.state, "invalid");

  const [missing] = evaluatePostMigrationIndexes([], [sender]);
  assert.equal(missing?.state, "missing");
  assert.equal(
    postMigrationIndexRemedy(missing as Exclude<typeof missing, { state: "ok" }>),
    "pnpm --filter @botiverse/raft-server db:create-messages-sender-index",
  );
});

test("an index matches on table, ordered columns, uniqueness and predicate, never on its name", () => {
  // Production rebuilt some tables by hand: same shape, another name, still ok.
  const [renamed] = evaluatePostMigrationIndexes([observed(sender, { name: "messages_new_sender_id_created_at_id_idx" })], [sender]);
  assert.equal(renamed?.state, "ok");
  assert.ok(renamed?.state === "ok" && renamed.matchedName === "messages_new_sender_id_created_at_id_idx");

  // The right name with the wrong shape is not the index.
  for (const wrong of [
    { columns: ["created_at", "sender_id", "id"] },
    { columns: ["sender_id", "created_at"] },
    { unique: true },
    { predicate: "(sender_type = 'agent'::text)" },
    { table: "messages_archive" },
  ] satisfies Partial<ObservedIndex>[]) {
    assert.equal(evaluatePostMigrationIndexes([observed(sender, wrong)], [sender])[0]?.state, "missing", JSON.stringify(wrong));
  }

  // Whitespace and parentheses in pg_get_expr output do not matter.
  const [reformatted] = evaluatePostMigrationIndexes(
    [observed(outbox, { predicate: "status = ANY (ARRAY['pending'::text,'processing'::text])" })],
    [outbox],
  );
  assert.equal(reformatted?.state, "ok");

  // A valid index of the shape wins over a broken leftover of it.
  const [both] = evaluatePostMigrationIndexes([observed(sender, { name: "broken", valid: false }), observed(sender)], [sender]);
  assert.ok(both?.state === "ok" && both.matchedName === sender.name);
});

test("the catalog is read from pg_index on a migrated database", async ({ db: _db }) => {
  // The test database speaks drizzle, not pg.Pool: inline the one array parameter.
  const query = async (text: string, values?: unknown[]) => {
    const tables = (values?.[0] ?? []) as string[];
    const inlined = text.replace("$1::text[]", `ARRAY[${tables.map((table) => `'${table.replace(/'/g, "''")}'`).join(",")}]::text[]`);
    const result = await getDb().execute(sql.raw(inlined));
    return { rows: result.rows as Record<string, unknown>[] };
  };
  // Its own table and catalog entry, so the test does not depend on which
  // post-migration indexes the test database happens to have.
  const spec: PostMigrationIndexSpec = {
    name: "idx_pmi_probe",
    table: "pmi_probe",
    columns: ["owner_id", "created_at"],
    unique: false,
    predicate: "(state = 'open'::text)",
    createScript: "db:create-pmi-probe-index",
  };
  await getDb().execute(sql.raw(`CREATE TABLE IF NOT EXISTS "pmi_probe" (owner_id uuid, created_at timestamptz, state text)`));
  try {
    assert.equal(evaluatePostMigrationIndexes(await readObservedIndexes(query, [spec]), [spec])[0]?.state, "missing");
    // Right columns, wrong predicate: still missing.
    await getDb().execute(sql.raw(`CREATE INDEX "pmi_probe_full" ON "pmi_probe" ("owner_id", "created_at")`));
    assert.equal(evaluatePostMigrationIndexes(await readObservedIndexes(query, [spec]), [spec])[0]?.state, "missing");
    await getDb().execute(sql.raw(`CREATE INDEX "pmi_probe_other_name" ON "pmi_probe" ("owner_id", "created_at") WHERE state = 'open'`));
    const [found] = evaluatePostMigrationIndexes(await readObservedIndexes(query, [spec]), [spec]);
    assert.ok(found?.state === "ok" && found.matchedName === "pmi_probe_other_name", JSON.stringify(found));
  } finally {
    await getDb().execute(sql.raw(`DROP TABLE IF EXISTS "pmi_probe"`));
  }

  // The real catalog reads without error; every entry resolves to a state.
  const states = evaluatePostMigrationIndexes(await readObservedIndexes(query));
  assert.equal(states.length, POST_MIGRATION_INDEXES.length);
});
