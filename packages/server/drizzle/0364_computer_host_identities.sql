CREATE TABLE "computer_host_identities" (
	"daemon_id" uuid PRIMARY KEY NOT NULL,
	"host_id_hash" text NOT NULL,
	"reported_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "computer_host_identities" ADD CONSTRAINT "computer_host_identities_daemon_id_daemons_id_fk" FOREIGN KEY ("daemon_id") REFERENCES "public"."daemons"("id") ON DELETE cascade ON UPDATE no action;