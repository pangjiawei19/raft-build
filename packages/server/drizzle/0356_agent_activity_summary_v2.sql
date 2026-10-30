CREATE TABLE "agent_activity_summary_v2" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"turn_key" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"outcome" text NOT NULL,
	"summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_activity_summary_v2" ADD CONSTRAINT "agent_activity_summary_v2_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_agent_activity_summary_v2_agent_turn" ON "agent_activity_summary_v2" USING btree ("agent_id","turn_key");--> statement-breakpoint
CREATE INDEX "idx_agent_activity_summary_v2_agent_ended" ON "agent_activity_summary_v2" USING btree ("agent_id","ended_at");