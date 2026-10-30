-- Public server SEO, task #4: digests of the raft.build service credential
-- (lib/publicSearchServiceAccess.ts). Owned by the migration role; no grant
-- here gives the serving role anything. The serving process verifies at run
-- time that its own role (current_user) can only SELECT this table and turns
-- the service path off otherwise. Rotation is a single operator transaction
-- (insert the new current key, give the old one expires_at), see the PR.
CREATE TABLE "public_search_service_keys" (
	"key_id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"sha256" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_search_service_keys_key_id_shape" CHECK ("public_search_service_keys"."key_id" ~ '^[A-Za-z0-9_-]{1,32}$'),
	CONSTRAINT "public_search_service_keys_sha256_shape" CHECK ("public_search_service_keys"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_public_search_service_keys_current" ON "public_search_service_keys" USING btree ("client_id") WHERE expires_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_public_search_service_keys_client" ON "public_search_service_keys" USING btree ("client_id");--> statement-breakpoint
REVOKE ALL ON TABLE "public_search_service_keys" FROM PUBLIC;
