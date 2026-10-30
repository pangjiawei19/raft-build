import { sql } from "drizzle-orm";
import type { DatabaseExecutor } from "../db/index";

/**
 * Public server SEO: give a server and every live channel and thread in it a
 * public route row. Migration 0347 filled only servers that were public at
 * the time, and new rows get one from the insert triggers, so this covers
 * older rows of a server that goes public later. Idempotent; ids never change.
 */
export async function backfillServerChannelPublicIds(executor: DatabaseExecutor, serverId: string): Promise<void> {
  await executor.execute(sql`
    INSERT INTO server_public_routes (server_id) VALUES (${serverId}::uuid)
    ON CONFLICT (server_id) DO NOTHING
  `);
  await executor.execute(sql`
    INSERT INTO channel_public_routes (channel_id)
    SELECT c.id FROM channels c
    WHERE c.server_id = ${serverId}::uuid
      AND c.deleted_at IS NULL
      AND c.type IN ('channel', 'thread')
    ON CONFLICT (channel_id) DO NOTHING
  `);
}
