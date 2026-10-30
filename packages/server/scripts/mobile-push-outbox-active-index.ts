import pg from "pg";

// Partial index for the mobile push outbox drain (migration 0359). Built
// CONCURRENTLY before the migration runs, so the migration's same-name
// CREATE INDEX IF NOT EXISTS is a no-op in staging/prod.
// Run it against the DIRECT (non "-pooler") DATABASE_URL: timeouts are set with
// session-level set_config, which a transaction-mode pooler may not carry over
// to the connection that runs the CREATE.
export const ACTIVE_INDEX_NAME = "idx_mobile_push_outbox_active_created";
export const ACTIVE_INDEX_COLUMNS = "created_at";
export const ACTIVE_INDEX_PREDICATE = "(status = ANY (ARRAY['pending'::text, 'processing'::text]))";
export const ACTIVE_INDEX_STATEMENT_TIMEOUT =
  process.env.MOBILE_PUSH_OUTBOX_ACTIVE_INDEX_STATEMENT_TIMEOUT?.trim() || "30min";
export const ACTIVE_INDEX_LOCK_TIMEOUT =
  process.env.MOBILE_PUSH_OUTBOX_ACTIVE_INDEX_LOCK_TIMEOUT?.trim() || "30s";

export const CREATE_ACTIVE_INDEX_SQL = `
CREATE INDEX CONCURRENTLY IF NOT EXISTS "${ACTIVE_INDEX_NAME}"
  ON "mobile_push_outbox" USING btree ("created_at")
  WHERE "status" IN ('pending', 'processing')
`;

export type ActiveIndexStatus = {
  exists: boolean;
  isUnique: boolean;
  isValid: boolean;
  isReady: boolean;
  columns: string[];
  predicate: string | null;
  definition: string | null;
};

type IndexRow = {
  isUnique: boolean;
  isValid: boolean;
  isReady: boolean;
  columns: string[] | string | null;
  predicate: string | null;
  definition: string | null;
};

export function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  return databaseUrl;
}

export function createPool(databaseUrl = getDatabaseUrl()): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl, max: 1 });
}

export async function assertMobilePushOutboxTableExists(client: pg.PoolClient) {
  const result = await client.query<{ exists: boolean }>(
    `SELECT to_regclass('public.mobile_push_outbox') IS NOT NULL AS "exists"`,
  );
  if (!result.rows[0]?.exists) {
    throw new Error(`mobile_push_outbox is missing; run db:migrate before ${ACTIVE_INDEX_NAME}`);
  }
}

export async function readActiveIndexStatus(
  client: pg.PoolClient,
): Promise<ActiveIndexStatus> {
  const result = await client.query<IndexRow>(
    `
      SELECT
        i.indisunique AS "isUnique",
        i.indisvalid AS "isValid",
        i.indisready AS "isReady",
        array_agg(a.attname ORDER BY key.ordinality) AS "columns",
        pg_get_expr(i.indpred, i.indrelid) AS "predicate",
        pg_get_indexdef(idx.oid) AS "definition"
      FROM pg_class idx
      JOIN pg_namespace ns ON ns.oid = idx.relnamespace
      JOIN pg_index i ON i.indexrelid = idx.oid
      JOIN pg_class tbl ON tbl.oid = i.indrelid
      JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS key(attnum, ordinality)
        ON true
      JOIN pg_attribute a ON a.attrelid = tbl.oid AND a.attnum = key.attnum
      WHERE ns.nspname = 'public'
        AND tbl.relname = 'mobile_push_outbox'
        AND idx.relname = $1
      GROUP BY i.indisunique, i.indisvalid, i.indisready, i.indpred, i.indrelid, idx.oid
    `,
    [ACTIVE_INDEX_NAME],
  );

  const row = result.rows[0];
  if (!row) {
    return {
      exists: false,
      isUnique: false,
      isValid: false,
      isReady: false,
      columns: [],
      predicate: null,
      definition: null,
    };
  }

  return {
    exists: true,
    isUnique: row.isUnique,
    isValid: row.isValid,
    isReady: row.isReady,
    columns: normalizeColumns(row.columns),
    predicate: row.predicate,
    definition: row.definition,
  };
}

export function assertActiveIndexReady(status: ActiveIndexStatus) {
  if (!status.exists) {
    throw new Error(`${ACTIVE_INDEX_NAME} is missing`);
  }
  if (status.isUnique) {
    throw new Error(`${ACTIVE_INDEX_NAME} must not be unique`);
  }
  if (!status.isValid || !status.isReady) {
    throw new Error(
      `${ACTIVE_INDEX_NAME} exists but is not ready/valid; drop the invalid index concurrently before retrying`,
    );
  }
  if (status.columns.join(",") !== ACTIVE_INDEX_COLUMNS) {
    throw new Error(
      `${ACTIVE_INDEX_NAME} has unexpected columns: ${status.columns.join(",")}`,
    );
  }
  if (status.predicate !== ACTIVE_INDEX_PREDICATE) {
    throw new Error(
      `${ACTIVE_INDEX_NAME} has unexpected predicate: ${status.predicate}`,
    );
  }
}

export function describeActiveIndexStatus(status: ActiveIndexStatus): string {
  if (!status.exists) return `${ACTIVE_INDEX_NAME}: missing`;
  return [
    `${ACTIVE_INDEX_NAME}: exists`,
    `unique=${status.isUnique}`,
    `valid=${status.isValid}`,
    `ready=${status.isReady}`,
    `columns=${status.columns.join(",") || "(none)"}`,
    `predicate=${status.predicate ?? "(none)"}`,
  ].join(" ");
}

function normalizeColumns(columns: string[] | string | null): string[] {
  if (!columns) return [];
  if (Array.isArray(columns)) return columns;
  return columns
    .replace(/^\{|\}$/g, "")
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
}
