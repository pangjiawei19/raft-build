CREATE TABLE "agent_migration_hosted_targets" (
	"migration_id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"hosted_model" text,
	"import_limits" jsonb,
	"runtime_snapshot" jsonb,
	"file_set_object_key" text,
	"file_set_sha256" text,
	"import_summary" jsonb,
	"review_ready_at" timestamp with time zone,
	"review_confirmed_at" timestamp with time zone,
	"importer_lease_id" text,
	"importer_lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_migrations" ALTER COLUMN "target_machine_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_migrations" ALTER COLUMN "target_machine_name_snapshot" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_migrations" ADD COLUMN "target_kind" text DEFAULT 'computer' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_migration_hosted_targets" ADD CONSTRAINT "agent_migration_hosted_targets_migration_id_agent_migrations_id_fk" FOREIGN KEY ("migration_id") REFERENCES "public"."agent_migrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_migrations" ADD CONSTRAINT "agent_migrations_target_kind_shape" CHECK (("agent_migrations"."target_kind" = 'computer' AND "agent_migrations"."target_machine_id" IS NOT NULL AND "agent_migrations"."target_machine_name_snapshot" IS NOT NULL) OR ("agent_migrations"."target_kind" = 'hosted' AND "agent_migrations"."target_machine_id" IS NULL AND "agent_migrations"."target_machine_name_snapshot" IS NULL)) NOT VALID;--> statement-breakpoint
ALTER TABLE "agent_migrations" VALIDATE CONSTRAINT "agent_migrations_target_kind_shape";