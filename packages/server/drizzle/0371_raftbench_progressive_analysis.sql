ALTER TABLE "raftbench_configs" ADD COLUMN "history_from" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE "raftbench_findings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"server_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"pattern" jsonb NOT NULL,
	"source_refs" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "raftbench_configs" ADD COLUMN "read_messages" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "raftbench_configs" ADD COLUMN "read_through_seq" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "raftbench_configs" ADD COLUMN "completed_batches" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "raftbench_configs" ADD COLUMN "scanned_through_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "raftbench_findings" ADD CONSTRAINT "raftbench_findings_server_id_raftbench_configs_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."raftbench_configs"("server_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_raftbench_finding_fingerprint" ON "raftbench_findings" USING btree ("server_id","revision","fingerprint");