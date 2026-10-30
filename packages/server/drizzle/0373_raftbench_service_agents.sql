CREATE TABLE "raftbench_service_agents" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"server_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "raftbench_service_agents" ADD CONSTRAINT "raftbench_service_agents_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raftbench_service_agents" ADD CONSTRAINT "raftbench_service_agents_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_raftbench_service_agents_server" ON "raftbench_service_agents" USING btree ("server_id");--> statement-breakpoint
INSERT INTO "raftbench_service_agents" ("agent_id", "server_id", "created_at")
SELECT a."id", a."server_id", a."created_at"
FROM "raftbench_configs" AS c
JOIN "agents" AS a ON a."id" = c."agent_id" AND a."server_id" = c."server_id"
WHERE c."agent_id" IS NOT NULL;
