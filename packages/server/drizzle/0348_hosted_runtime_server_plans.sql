CREATE TABLE "hosted_runtime_server_plans" (
	"server_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"synced_plan" text,
	"synced_at" timestamp with time zone,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error_code" text,
	CONSTRAINT "hosted_runtime_server_plans_server_id_provider_pk" PRIMARY KEY("server_id","provider")
);
--> statement-breakpoint
ALTER TABLE "hosted_runtime_server_plans" ADD CONSTRAINT "hosted_runtime_server_plans_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;