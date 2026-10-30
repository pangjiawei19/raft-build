-- mobile_push_outbox (7.4M rows, 3.4 GB on 10-16) keeps every row after it is
-- sent, and each row is updated twice (pending -> processing -> terminal), so
-- dead tuples pile up: 932k with the default 20% autovacuum threshold (~1.47M)
-- still far away. The drain's candidate read walked the (status, created_at)
-- index entries of rows long since terminal: 0 rows returned after 34,410
-- heap pages (253 ms), every 15 s per task plus every send.
--
-- Vacuum this table at 2% dead tuples, and never truncate its tail: the table
-- only grows (and, with retention, reuses its space), so truncation gains
-- nothing and its ACCESS EXCLUSIVE lock would stall the drain.
-- ALTER TABLE ... SET (...) takes SHARE UPDATE EXCLUSIVE: reads and writes go on.
ALTER TABLE "mobile_push_outbox" SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02,
  vacuum_truncate = false
);--> statement-breakpoint
-- Partial index of the active rows only (pending/processing; normally a
-- handful), in drain order. Staging/prod build it first with
--   pnpm --filter @botiverse/raft-server db:create-mobile-push-outbox-active-index
-- (CREATE INDEX CONCURRENTLY IF NOT EXISTS, then checks indisvalid), so this
-- statement is a no-op there and never holds a write lock. The old
-- idx_mobile_push_outbox_pending is dropped in a later migration, once the
-- drain plan is confirmed on the new index.
-- Fail closed: on a table this size a plain CREATE INDEX would hold a write
-- lock for minutes and stall every send's outbox insert. So when the index is
-- missing and the table is not small, stop the migration with the command to
-- run first instead of building it here. Empty/small databases (tests, dev,
-- fresh environments) build it below as usual.
-- An index left INVALID by a failed concurrent build is also refused (on any
-- table size): IF NOT EXISTS below would skip it and leave the drain without
-- a usable index.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indexrelid = to_regclass('public.idx_mobile_push_outbox_active_created')
      AND NOT (i.indisvalid AND i.indisready)
  ) THEN
    RAISE EXCEPTION 'idx_mobile_push_outbox_active_created exists but is invalid: DROP INDEX CONCURRENTLY it and re-run pnpm --filter @botiverse/raft-server db:create-mobile-push-outbox-active-index before migrating';
  END IF;
  IF to_regclass('public.idx_mobile_push_outbox_active_created') IS NULL
     AND (SELECT reltuples FROM pg_class WHERE oid = 'public.mobile_push_outbox'::regclass) > 100000 THEN
    RAISE EXCEPTION 'idx_mobile_push_outbox_active_created is missing on a large mobile_push_outbox: run pnpm --filter @botiverse/raft-server db:create-mobile-push-outbox-active-index (CONCURRENTLY) before migrating';
  END IF;
END
$$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_mobile_push_outbox_active_created" ON "mobile_push_outbox" USING btree ("created_at") WHERE "mobile_push_outbox"."status" IN ('pending', 'processing');
