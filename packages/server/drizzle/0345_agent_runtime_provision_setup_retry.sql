ALTER TABLE "agent_runtime_provisions" ADD COLUMN "setup_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_runtime_provisions" ADD COLUMN "setup_retry_outcome" text;