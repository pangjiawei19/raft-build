CREATE TABLE "channel_public_routes" (
	"channel_id" uuid PRIMARY KEY NOT NULL,
	"public_id" text DEFAULT replace(gen_random_uuid()::text, '-', '') NOT NULL,
	"public_changed_at" timestamp with time zone,
	CONSTRAINT "channel_public_routes_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "server_public_routes" (
	"server_id" uuid PRIMARY KEY NOT NULL,
	"public_id" text DEFAULT replace(gen_random_uuid()::text, '-', '') NOT NULL,
	"public_changed_at" timestamp with time zone,
	CONSTRAINT "server_public_routes_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "public_search_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_public_routes" ADD CONSTRAINT "channel_public_routes_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_public_routes" ADD CONSTRAINT "server_public_routes_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Public server SEO (#proj-public-server-seo), step 1: hand-written part.
-- Route rows for new servers, channels and threads. Created before the
-- backfill so a row inserted while this migration runs is not missed.
-- ON CONFLICT names the owner key only: an existing row means "already
-- issued", but a public_id collision must fail, never leave a row unrouted.
CREATE OR REPLACE FUNCTION "servers_create_public_route"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "server_public_routes" ("server_id") VALUES (NEW."id") ON CONFLICT ("server_id") DO NOTHING;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "servers_public_route_insert"
AFTER INSERT ON "servers"
FOR EACH ROW
EXECUTE FUNCTION "servers_create_public_route"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "channels_create_public_route"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "channel_public_routes" ("channel_id") VALUES (NEW."id") ON CONFLICT ("channel_id") DO NOTHING;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "channels_public_route_insert"
AFTER INSERT ON "channels"
FOR EACH ROW
WHEN (NEW."type" IN ('channel', 'thread'))
EXECUTE FUNCTION "channels_create_public_route"();--> statement-breakpoint
-- lastmod stamps. Each update trigger writes only the route row of the row
-- being updated (a leaf no other writer locks), so no lock-order cycle with
-- existing writers is possible.
CREATE OR REPLACE FUNCTION "servers_stamp_public_changed_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "server_public_routes" SET "public_changed_at" = now() WHERE "server_id" = NEW."id";
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "servers_public_changed_at"
AFTER UPDATE ON "servers"
FOR EACH ROW
WHEN (
  OLD."name" IS DISTINCT FROM NEW."name"
  OR OLD."slug" IS DISTINCT FROM NEW."slug"
  OR OLD."avatar_url" IS DISTINCT FROM NEW."avatar_url"
  OR OLD."publicly_visible" IS DISTINCT FROM NEW."publicly_visible"
  OR OLD."public_search_enabled" IS DISTINCT FROM NEW."public_search_enabled"
  OR OLD."deleted_at" IS DISTINCT FROM NEW."deleted_at"
)
EXECUTE FUNCTION "servers_stamp_public_changed_at"();--> statement-breakpoint
-- Channels: only while the row was or becomes a Guest-visible live channel,
-- or for a thread, so edits to private channels never move a public lastmod.
-- A thread change (archive, delete, type, or its parent message moving to
-- another channel, which 0297 writes into parent_channel_id) also changes the
-- thread lists of its OLD and NEW parent channels, so their route rows are
-- stamped too, but only for parents that are Guest-visible live channels (a
-- private channel's activity never reaches a public date). Every route row
-- this function touches is locked in channel_id order, so two concurrent
-- moves between the same channels cannot lock them in opposite orders.
CREATE OR REPLACE FUNCTION "channels_stamp_public_changed_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  route_id uuid;
BEGIN
  IF OLD."type" = 'thread' OR NEW."type" = 'thread' THEN
    FOR route_id IN
      SELECT DISTINCT candidate.id
      FROM (
        SELECT NEW."id" AS id
        UNION ALL
        SELECT parent."id" FROM "channels" parent
        WHERE parent."id" IN (OLD."parent_channel_id", NEW."parent_channel_id")
          AND parent."type" = 'channel'
          AND parent."guest_visible"
          AND parent."archived_at" IS NULL
          AND parent."deleted_at" IS NULL
      ) candidate
      ORDER BY candidate.id
    LOOP
      UPDATE "channel_public_routes" SET "public_changed_at" = now() WHERE "channel_id" = route_id;
    END LOOP;
  ELSIF (OLD."type" = 'channel' AND OLD."guest_visible" AND OLD."archived_at" IS NULL AND OLD."deleted_at" IS NULL)
    OR (NEW."type" = 'channel' AND NEW."guest_visible" AND NEW."archived_at" IS NULL AND NEW."deleted_at" IS NULL)
  THEN
    UPDATE "channel_public_routes" SET "public_changed_at" = now() WHERE "channel_id" = NEW."id";
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "channels_public_changed_at"
AFTER UPDATE ON "channels"
FOR EACH ROW
WHEN (
  OLD."name" IS DISTINCT FROM NEW."name"
  OR OLD."description" IS DISTINCT FROM NEW."description"
  OR OLD."type" IS DISTINCT FROM NEW."type"
  OR OLD."guest_visible" IS DISTINCT FROM NEW."guest_visible"
  OR OLD."archived_at" IS DISTINCT FROM NEW."archived_at"
  OR OLD."deleted_at" IS DISTINCT FROM NEW."deleted_at"
  OR OLD."parent_channel_id" IS DISTINCT FROM NEW."parent_channel_id"
)
EXECUTE FUNCTION "channels_stamp_public_changed_at"();--> statement-breakpoint
-- Messages: a content change moves updated_at on the same row, whoever writes
-- it, so an edited parent or reply moves its page's lastmod.
CREATE OR REPLACE FUNCTION "messages_stamp_content_updated_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."updated_at" := now();
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "messages_content_updated_at"
BEFORE UPDATE OF "content" ON "messages"
FOR EACH ROW
WHEN (OLD."content" IS DISTINCT FROM NEW."content")
EXECUTE FUNCTION "messages_stamp_content_updated_at"();--> statement-breakpoint
-- Backfill. Every server (a small table). Channels: only live channels and
-- threads of servers public today; the rest get rows when their server goes
-- public (public-visibility PATCH).
INSERT INTO "server_public_routes" ("server_id")
SELECT "id" FROM "servers"
ON CONFLICT ("server_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "channel_public_routes" ("channel_id")
SELECT c."id"
FROM "channels" AS c
JOIN "servers" AS s ON s."id" = c."server_id"
WHERE s."publicly_visible" = true
  AND c."deleted_at" IS NULL
  AND c."type" IN ('channel', 'thread')
ON CONFLICT ("channel_id") DO NOTHING;--> statement-breakpoint
-- The indexing master switch. Off: default_enabled false and no rules, so the
-- search API answers 404 / an empty index for every server until it is turned
-- on after owners of already-public servers have been notified.
INSERT INTO "feature_flags" (
	"key", "description", "enabled", "kill_switch", "randomization_unit",
	"default_enabled", "default_variant", "salt"
) VALUES (
	'public_server_search_index_v0',
	'Public Server search indexing master switch (raft.build pages and sitemap)',
	true, false, 'server', false, NULL, 'public_server_search_index_v0'
) ON CONFLICT ("key") DO NOTHING;
