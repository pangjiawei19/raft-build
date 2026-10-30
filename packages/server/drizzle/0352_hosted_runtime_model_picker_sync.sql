ALTER TABLE "hosted_runtime_server_plans" ADD COLUMN "synced_model_picker" boolean;--> statement-breakpoint
ALTER TABLE "hosted_runtime_server_plans" ADD COLUMN "model_picker_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hosted_runtime_server_plans" ADD COLUMN "model_picker_failed_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "hosted_runtime_server_plans" ADD COLUMN "model_picker_next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hosted_runtime_server_plans" ADD COLUMN "model_picker_last_error_code" text;