CREATE TABLE "raftbench_configs" (
	"configured_by_user_id" uuid NOT NULL,
	"server_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"agent_id" uuid,
	"channel_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raftbench_latest_runs" (
	"server_id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"agent_id" uuid NOT NULL,
	"status" text NOT NULL,
	"from_at" timestamp with time zone NOT NULL,
	"to_at" timestamp with time zone NOT NULL,
	"fetched" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_seq" bigint DEFAULT 0 NOT NULL,
	"source_characters" integer DEFAULT 0 NOT NULL,
	"stop_reason" text DEFAULT 'more_pages' NOT NULL,
	"exhausted" boolean DEFAULT false NOT NULL,
	"report" jsonb,
	"submission_hash" text,
	"receipt_id" uuid,
	"failure_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "raftbench_latest_runs_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
ALTER TABLE "raftbench_configs" ADD CONSTRAINT "raftbench_configs_configured_by_user_id_users_id_fk" FOREIGN KEY ("configured_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raftbench_configs" ADD CONSTRAINT "raftbench_configs_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raftbench_configs" ADD CONSTRAINT "raftbench_configs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raftbench_latest_runs" ADD CONSTRAINT "raftbench_latest_runs_server_id_raftbench_configs_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."raftbench_configs"("server_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raftbench_latest_runs" ADD CONSTRAINT "raftbench_latest_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;