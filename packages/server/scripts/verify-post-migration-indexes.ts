import "dotenv/config";
import pg from "pg";
import {
  evaluatePostMigrationIndexes,
  postMigrationIndexRemedy,
  readObservedIndexes,
} from "../src/db/postMigrationIndexes";
import { withTransientConnectRetry } from "../src/db/transientConnectRetry";

// Runs last in db:migrate:deploy. POST_MIGRATION_INDEX_GUARD_REQUIRED=1 fails
// the deploy on a missing or invalid index (staging); anything else only
// warns (production for its first release with this check, release-QA, local).
const rawRequired = process.env.POST_MIGRATION_INDEX_GUARD_REQUIRED;

async function main(): Promise<void> {
  if (rawRequired !== undefined && rawRequired !== "" && rawRequired !== "0" && rawRequired !== "1") {
    throw new Error("invalid_required_mode");
  }
  const required = rawRequired === "1";
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("database_url_missing");

  const states = await withTransientConnectRetry(async () => {
    const pool = new pg.Pool({ connectionString: url, max: 1 });
    try {
      return evaluatePostMigrationIndexes(await readObservedIndexes((text, values) => pool.query(text, values)));
    } finally {
      await pool.end().catch(() => undefined);
    }
  }, {
    onRetry: (attempt, error) => {
      const reason = error instanceof Error ? error.message : "unknown";
      console.warn(`[POST_MIGRATION_INDEXES_RETRY] attempt=${attempt} reason=${reason}`);
    },
  });

  for (const state of states) {
    if (state.state === "ok") {
      console.log(`[POST_MIGRATION_INDEX_OK] ${state.spec.name} on ${state.spec.table} (matched ${state.matchedName})`);
    } else {
      const tag = required ? "POST_MIGRATION_INDEX_MISSING" : "POST_MIGRATION_INDEX_MISSING_WARN";
      console.error(`[${tag}] ${state.spec.name} on ${state.spec.table}(${state.spec.columns.join(", ")}) is ${state.state}; run: ${postMigrationIndexRemedy(state)}`);
    }
  }
  const bad = states.filter((state) => state.state !== "ok");
  if (bad.length > 0 && required) {
    throw new Error(`post_migration_indexes_missing count=${bad.length}`);
  }
  console.log(`[POST_MIGRATION_INDEXES_${bad.length === 0 ? "OK" : "WARNED"}] checked=${states.length} missing=${bad.length} required=${required ? 1 : 0}`);
}

void main().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : "unknown";
  console.error(`[POST_MIGRATION_INDEXES_FAILED] reason=${reason}`);
  process.exitCode = 1;
});
