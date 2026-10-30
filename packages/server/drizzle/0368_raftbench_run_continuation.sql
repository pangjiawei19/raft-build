ALTER TABLE "raftbench_latest_runs" ADD COLUMN "start_after_seq" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "raftbench_latest_runs" ADD COLUMN "failure_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "raftbench_latest_runs" ADD COLUMN "skipped_ranges" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "raftbench_latest_runs" ADD COLUMN "started_at" timestamp with time zone DEFAULT now() NOT NULL;