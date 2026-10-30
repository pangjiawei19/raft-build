-- Agent archive: one row per archived agent (where its workspace is, the
-- pending workspace operation). The new table's FKs reference the
-- hot agents, servers and users tables; a 5s lock timeout (the deploy
-- retries) keeps this DDL from queueing writes behind it.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "agent_archives" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"server_id" uuid NOT NULL,
	"archived_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_by_user_id" uuid,
	"machine_id" uuid,
	"machine_name_snapshot" text,
	"workspace_state" text NOT NULL,
	"pending_op" text,
	"op_id" uuid,
	"op_requested_at" timestamp with time zone,
	"op_requested_by_user_id" uuid,
	"op_dispatched_at" timestamp with time zone,
	"op_attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"last_error_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_archives_op_consistent" CHECK (("agent_archives"."pending_op" is null) = ("agent_archives"."op_id" is null))
);
--> statement-breakpoint
ALTER TABLE "agent_archives" ADD CONSTRAINT "agent_archives_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_archives" ADD CONSTRAINT "agent_archives_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_archives" ADD CONSTRAINT "agent_archives_archived_by_user_id_users_id_fk" FOREIGN KEY ("archived_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_archives" ADD CONSTRAINT "agent_archives_op_requested_by_user_id_users_id_fk" FOREIGN KEY ("op_requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_archives_server" ON "agent_archives" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "idx_agent_archives_pending" ON "agent_archives" USING btree ("machine_id") WHERE pending_op is not null;