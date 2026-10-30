ALTER TABLE "oauth_client_installs" ADD COLUMN "setup_completed_revision" integer;--> statement-breakpoint
ALTER TABLE "oauth_client_installs" ADD COLUMN "setup_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD COLUMN "setup_url" text;--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD COLUMN "setup_description" text;--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD COLUMN "setup_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_client_installs" ADD CONSTRAINT "oauth_client_installs_setup_completion_valid" CHECK (
    ("oauth_client_installs"."setup_completed_revision" IS NULL AND "oauth_client_installs"."setup_completed_at" IS NULL)
    OR ("oauth_client_installs"."setup_completed_revision" IS NOT NULL AND "oauth_client_installs"."setup_completed_revision" > 0 AND "oauth_client_installs"."setup_completed_at" IS NOT NULL)
  );--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD CONSTRAINT "oauth_clients_setup_revision_positive" CHECK ("oauth_clients"."setup_revision" > 0);