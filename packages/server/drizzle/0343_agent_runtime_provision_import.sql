DROP INDEX "idx_agent_runtime_provisions_due";--> statement-breakpoint
ALTER TABLE "agent_runtime_provisions" ADD COLUMN "import_source" text;--> statement-breakpoint
ALTER TABLE "agent_runtime_provisions" ADD COLUMN "import_ref" text;--> statement-breakpoint
ALTER TABLE "agent_runtime_provisions" ADD COLUMN "imported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_runtime_provisions" ADD COLUMN "import_failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_runtime_provisions" ADD COLUMN "import_error_code" text;--> statement-breakpoint
ALTER TABLE "agent_runtime_provisions" ADD COLUMN "import_error_message" text;--> statement-breakpoint
ALTER TABLE "agent_runtime_provisions" ADD COLUMN "import_error_http_status" integer;--> statement-breakpoint
ALTER TABLE "agent_runtime_provisions" ADD COLUMN "import_error_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "idx_agent_runtime_provisions_due" ON "agent_runtime_provisions" USING btree ("next_attempt_at") WHERE state IN ('provisioning', 'deleting') OR (state = 'active' AND (desired_revision > synced_revision OR (import_source IS NOT NULL AND imported_at IS NULL AND import_failed_at IS NULL)));