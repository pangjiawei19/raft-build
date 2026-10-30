CREATE TABLE "app_bot_bindings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"install_id" uuid NOT NULL,
	"server_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"handle" text NOT NULL,
	"requested_permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	"uninstalled_at" timestamp with time zone,
	CONSTRAINT "app_bot_generation_positive" CHECK ("app_bot_bindings"."generation" > 0),
	CONSTRAINT "app_bot_handle_nonempty" CHECK (length(btrim("app_bot_bindings"."handle")) > 0)
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "managed_by_app_install_id" uuid;--> statement-breakpoint
ALTER TABLE "oauth_client_installs" ADD COLUMN "bot_grant" text;--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD COLUMN "enable_bot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_bot_bindings" ADD CONSTRAINT "app_bot_bindings_install_id_oauth_client_installs_id_fk" FOREIGN KEY ("install_id") REFERENCES "public"."oauth_client_installs"("id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "app_bot_bindings" VALIDATE CONSTRAINT "app_bot_bindings_install_id_oauth_client_installs_id_fk";--> statement-breakpoint
ALTER TABLE "app_bot_bindings" ADD CONSTRAINT "app_bot_bindings_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "app_bot_bindings" VALIDATE CONSTRAINT "app_bot_bindings_server_id_servers_id_fk";--> statement-breakpoint
ALTER TABLE "app_bot_bindings" ADD CONSTRAINT "app_bot_bindings_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "app_bot_bindings" VALIDATE CONSTRAINT "app_bot_bindings_agent_id_agents_id_fk";--> statement-breakpoint
CREATE UNIQUE INDEX "idx_app_bot_install_live" ON "app_bot_bindings" USING btree ("install_id") WHERE state != 'uninstalled';--> statement-breakpoint
CREATE UNIQUE INDEX "idx_app_bot_agent_install" ON "app_bot_bindings" USING btree ("agent_id") WHERE state = 'active';--> statement-breakpoint
CREATE INDEX "idx_app_bot_server" ON "app_bot_bindings" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "idx_app_bot_state" ON "app_bot_bindings" USING btree ("install_id","state");--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_managed_by_app_install_id_oauth_client_installs_id_fk" FOREIGN KEY ("managed_by_app_install_id") REFERENCES "public"."oauth_client_installs"("id") ON DELETE set null ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "agents" VALIDATE CONSTRAINT "agents_managed_by_app_install_id_oauth_client_installs_id_fk";
