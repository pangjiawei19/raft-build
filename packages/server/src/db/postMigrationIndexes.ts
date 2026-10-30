// Indexes built outside the migrations: a migration that is `SELECT 1` (or a
// no-op `IF NOT EXISTS`) plus a `db:create-*` script that each environment
// runs once, CONCURRENTLY. Nothing re-runs that script, so an environment that
// never ran it silently lacks the index (staging 10-16: no
// idx_messages_sender_created_at, the onboarding funnel query hit its 60 s
// timeout; 26 ms once built). db:migrate:deploy checks this catalog in the
// migrate task it already runs: one pg_index read, no extra ECS task (the
// per-deploy create/verify steps were removed in #8034).
//
// An index matches on table, ordered columns, uniqueness and predicate, never
// on its name: production rebuilt some tables by hand and their indexes carry
// other names. A match that is not valid and ready (a failed concurrent build)
// counts as missing.

export interface PostMigrationIndexSpec {
  /** The name the create script uses; only for messages. */
  name: string;
  table: string;
  columns: readonly string[];
  unique: boolean;
  /** pg_get_expr(indpred) as PostgreSQL prints it; null for a full index. */
  predicate: string | null;
  /** The package script that builds it (CREATE INDEX CONCURRENTLY IF NOT EXISTS). */
  createScript: string;
}

export const POST_MIGRATION_INDEXES: readonly PostMigrationIndexSpec[] = [
  {
    name: "idx_messages_user_random_id",
    table: "messages",
    columns: ["sender_id", "random_id"],
    unique: true,
    predicate: "((sender_type = 'user'::text) AND (random_id IS NOT NULL))",
    createScript: "db:create-message-random-id-index",
  },
  {
    name: "idx_messages_sender_created_at",
    table: "messages",
    columns: ["sender_id", "created_at", "id"],
    unique: false,
    predicate: null,
    createScript: "db:create-messages-sender-index",
  },
  {
    name: "idx_mention_delivery_occurrences_agent_payload_open",
    table: "mention_delivery_occurrences",
    columns: ["agent_id", "state"],
    unique: false,
    predicate: "((acked_at IS NULL) AND (terminal_error_at IS NULL) AND (delivery_payload IS NOT NULL))",
    createScript: "db:create-mention-delivery-agent-open-index",
  },
  {
    name: "idx_channels_thread_parent_channel",
    table: "channels",
    columns: ["parent_channel_id", "id"],
    unique: false,
    predicate: "((type = 'thread'::text) AND (deleted_at IS NULL))",
    createScript: "db:create-channels-thread-parent-channel-index",
  },
  {
    name: "idx_mobile_push_outbox_active_created",
    table: "mobile_push_outbox",
    columns: ["created_at"],
    unique: false,
    predicate: "(status = ANY (ARRAY['pending'::text, 'processing'::text]))",
    createScript: "db:create-mobile-push-outbox-active-index",
  },
];

/** One index of a catalog table, as pg_index describes it. */
export interface ObservedIndex {
  table: string;
  name: string;
  columns: readonly string[];
  unique: boolean;
  predicate: string | null;
  valid: boolean;
  ready: boolean;
}

export type PostMigrationIndexState =
  | { spec: PostMigrationIndexSpec; state: "ok"; matchedName: string }
  | { spec: PostMigrationIndexSpec; state: "invalid"; matchedName: string }
  | { spec: PostMigrationIndexSpec; state: "missing" };

/** Whitespace and redundant parentheses differ between PostgreSQL versions; the expression does not. */
function normalizePredicate(predicate: string | null): string | null {
  return predicate === null ? null : predicate.replace(/[\s()]/g, "");
}

function sameShape(spec: PostMigrationIndexSpec, index: ObservedIndex): boolean {
  return index.table === spec.table
    && index.unique === spec.unique
    && index.columns.length === spec.columns.length
    && index.columns.every((column, i) => column === spec.columns[i])
    && normalizePredicate(index.predicate) === normalizePredicate(spec.predicate);
}

/** Pure: every spec is ok (a valid, ready index of its shape), invalid (only broken ones), or missing. */
export function evaluatePostMigrationIndexes(
  observed: readonly ObservedIndex[],
  catalog: readonly PostMigrationIndexSpec[] = POST_MIGRATION_INDEXES,
): PostMigrationIndexState[] {
  return catalog.map((spec) => {
    const matches = observed.filter((index) => sameShape(spec, index));
    const usable = matches.find((index) => index.valid && index.ready);
    if (usable) return { spec, state: "ok", matchedName: usable.name };
    if (matches[0]) return { spec, state: "invalid", matchedName: matches[0].name };
    return { spec, state: "missing" };
  });
}

type QueryFn = (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

/** Every index of the catalog's tables in the public schema: one catalog read. */
export async function readObservedIndexes(
  query: QueryFn,
  catalog: readonly PostMigrationIndexSpec[] = POST_MIGRATION_INDEXES,
): Promise<ObservedIndex[]> {
  const tables = [...new Set(catalog.map((spec) => spec.table))];
  const result = await query(
    `SELECT t.relname AS "table",
            c.relname AS "name",
            i.indisunique AS "unique",
            i.indisvalid AS "valid",
            i.indisready AS "ready",
            pg_get_expr(i.indpred, i.indrelid) AS "predicate",
            ARRAY(
              SELECT a.attname::text
              FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
              ORDER BY k.ord
            ) AS "columns"
     FROM pg_index i
     JOIN pg_class c ON c.oid = i.indexrelid
     JOIN pg_class t ON t.oid = i.indrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public' AND t.relname = ANY($1::text[])`,
    [tables],
  );
  return result.rows.map((row) => ({
    table: String(row.table),
    name: String(row.name),
    unique: row.unique === true,
    valid: row.valid === true,
    ready: row.ready === true,
    predicate: typeof row.predicate === "string" ? row.predicate : null,
    columns: Array.isArray(row.columns) ? row.columns.map(String) : [],
  }));
}

/** The command an operator runs for a missing or invalid index. */
export function postMigrationIndexRemedy(state: Exclude<PostMigrationIndexState, { state: "ok" }>): string {
  const create = `pnpm --filter @botiverse/raft-server ${state.spec.createScript}`;
  return state.state === "invalid"
    ? `DROP INDEX CONCURRENTLY "${state.matchedName}"; then ${create}`
    : create;
}
