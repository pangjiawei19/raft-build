-- Preserve 0216: enforce the expanded shape for new writes without scanning
-- historical read mutations in the deployment transaction.
ALTER TABLE "read_mutations" DROP CONSTRAINT "read_mutations_scope_shape";--> statement-breakpoint
ALTER TABLE "read_mutations" ADD CONSTRAINT "read_mutations_scope_shape" CHECK (
    ("read_mutations"."kind" = 'global_read_all' AND "read_mutations"."scope_id" IS NULL AND "read_mutations"."requested_through_seq" IS NULL AND "read_mutations"."done_target_kind" IS NULL AND "read_mutations"."done_through_seq" IS NULL)
    OR ("read_mutations"."kind" IN ('channel_read_all', 'conversation_read_all') AND "read_mutations"."scope_id" IS NOT NULL AND "read_mutations"."requested_through_seq" IS NULL AND "read_mutations"."done_target_kind" IS NULL AND "read_mutations"."done_through_seq" IS NULL)
    OR ("read_mutations"."kind" IN ('row_read', 'row_unread') AND "read_mutations"."scope_id" IS NOT NULL AND "read_mutations"."requested_through_seq" IS NOT NULL AND "read_mutations"."requested_through_seq" >= 0 AND "read_mutations"."done_target_kind" IS NULL AND "read_mutations"."done_through_seq" IS NULL)
    OR ("read_mutations"."kind" = 'done' AND "read_mutations"."scope_id" IS NOT NULL AND "read_mutations"."requested_through_seq" IS NULL AND "read_mutations"."done_target_kind" IN ('channel', 'thread') AND "read_mutations"."done_through_seq" IS NOT NULL AND "read_mutations"."done_through_seq" > 0)
  ) NOT VALID;
--> statement-breakpoint
-- Keep admission off throughout rolling upgrades: old read workers do not know
-- conversation_read_all. Enable via FFA only after every worker is upgraded.
INSERT INTO "feature_flags" ("key", "description", "enabled", "kill_switch", "randomization_unit", "default_enabled", "default_variant", "salt")
VALUES ('sidebar_mark_all_read_v0', 'Sidebar channel and followed-thread read-all (requires upgraded read workers)', true, false, 'server', false, NULL, 'sidebar_mark_all_read_v0')
ON CONFLICT ("key") DO NOTHING;
