CREATE TABLE "attachment_preview_cache" (
	"attachment_id" uuid PRIMARY KEY NOT NULL,
	"content_key" text NOT NULL,
	"provider_version" integer NOT NULL,
	"preview" jsonb NOT NULL,
	"compute_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_hit_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachment_preview_cache" ADD CONSTRAINT "attachment_preview_cache_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;