import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "../db/schema";

// 0347's channels_public_changed_at trigger (public server SEO lastmod): a
// thread change, including its parent message moving channel (0297 writes the
// new parent_channel_id), stamps the route rows of the thread and of its OLD
// and NEW parent channels when those are Guest-visible live channels. It locks
// those route rows in channel_id order, so two moves in opposite directions
// between the same channels wait for each other instead of deadlocking. These
// cases pin the order, the outcome under concurrency and the private-parent
// exclusion.

const REAL_PG_URL_ENV = "CHANNEL_CONVERSION_REAL_PG_URL";
const REAL_PG_URL = process.env[REAL_PG_URL_ENV];
const REAL_PG_REQUIRED = process.env.CHANNEL_CONVERSION_REAL_PG_REQUIRED === "1";
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

function databaseUrlFor(adminUrl: string, databaseName: string): string {
  const parsed = new URL(adminUrl);
  assert.match(parsed.protocol, /^postgres(?:ql)?:$/, `${REAL_PG_URL_ENV} must be a PostgreSQL URL`);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

const MOVE_PARENT = "UPDATE messages SET channel_id = $2 WHERE id = $1";
const LOCK_ROUTE_NOWAIT = "SELECT 1 FROM channel_public_routes WHERE channel_id = $1 FOR UPDATE NOWAIT";
const STAMPED = "SELECT channel_id::text AS id FROM channel_public_routes WHERE public_changed_at IS NOT NULL ORDER BY 1";

test.skipIf(!REAL_PG_URL && !REAL_PG_REQUIRED)(
  "a thread move stamps both public parent channels in channel_id order, concurrent opposite moves both commit, private parents stay unstamped",
  async () => {
    assert.ok(REAL_PG_URL, `${REAL_PG_URL_ENV} is required`);
    const databaseName = `slock_public_route_stamp_${process.pid}_${randomBytes(4).toString("hex")}`;
    const admin = new pg.Client({ connectionString: REAL_PG_URL, application_name: "public-route-stamp-admin" });
    const clients: pg.Client[] = [];
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      const testUrl = databaseUrlFor(REAL_PG_URL, databaseName);
      const setupPool = new pg.Pool({ connectionString: testUrl, max: 1 });
      await migrate(drizzle(setupPool, { schema }), { migrationsFolder: MIGRATIONS_FOLDER });

      // Fixed id order: channel A < channel B < thread X < thread Y, so the
      // sorted lock order for any move between A and B starts at A.
      const [channelA, channelB, threadX, threadY] = Array.from({ length: 4 }, () => randomUUID()).sort();
      const privateChannel = randomUUID();
      const ownerId = randomUUID();
      const serverId = randomUUID();
      const parentX = randomUUID();
      const parentY = randomUUID();
      await setupPool.query(
        `INSERT INTO users (id, email, name, password_hash, email_verified) VALUES ($1::uuid, $1::text || '@prs.test', 'prs-' || $1::text, 'x', true)`,
        [ownerId],
      );
      await setupPool.query(`INSERT INTO servers (id, name, slug, owner_id) VALUES ($1::uuid, 'prs', 'prs-' || $1::text, $2)`, [serverId, ownerId]);
      await setupPool.query(
        `INSERT INTO channels (id, server_id, name, type, guest_visible) VALUES
           ($1, $4, 'prs-a', 'channel', true), ($2, $4, 'prs-b', 'channel', true), ($3, $4, 'prs-members', 'channel', false)`,
        [channelA, channelB, privateChannel, serverId],
      );
      await setupPool.query(
        `INSERT INTO messages (id, channel_id, sender_type, sender_id, content) VALUES ($1, $2, 'user', $5, 'x'), ($3, $4, 'user', $5, 'y')`,
        [parentX, channelA, parentY, channelB, ownerId],
      );
      await setupPool.query(
        `INSERT INTO channels (id, server_id, name, type, parent_message_id) VALUES ($1, $3, 'prs-x', 'thread', $4), ($2, $3, 'prs-y', 'thread', $5)`,
        [threadX, threadY, serverId, parentX, parentY],
      );
      const routes = await setupPool.query<{ n: number }>("SELECT count(*)::int AS n FROM channel_public_routes");
      assert.equal(routes.rows[0]!.n, 5, "fixture: the insert trigger gave every channel and thread a route row");
      await setupPool.end();

      const connect = async (name: string) => {
        const client = new pg.Client({ connectionString: testUrl, application_name: name });
        await client.connect();
        clients.push(client);
        return client;
      };
      const blocker = await connect("public-route-stamp-blocker");
      const mover = await connect("public-route-stamp-mover");
      const mover2 = await connect("public-route-stamp-mover-2");
      const probe = await connect("public-route-stamp-probe");

      const waitUntilBlocked = async (applicationName: string) => {
        for (let attempt = 0; attempt < 200; attempt += 1) {
          const { rows } = await probe.query(
            "SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
            [applicationName],
          );
          if (rows.length > 0) return;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        assert.fail(`${applicationName} never waited on a lock`);
      };

      // 1. Order. B's route row is held; moving Y from B to A must take A's
      //    route row first (lowest id) and then wait on B. While it waits, A
      //    is already locked, which a NOWAIT probe observes. Locking OLD before
      //    NEW (B first) would wait before touching A and the probe would win.
      await blocker.query("BEGIN");
      await blocker.query("SELECT 1 FROM channel_public_routes WHERE channel_id = $1 FOR UPDATE", [channelB]);
      await mover.query("BEGIN");
      const moveY = mover.query(MOVE_PARENT, [parentY, channelA]);
      await waitUntilBlocked("public-route-stamp-mover");
      await probe.query("BEGIN");
      await assert.rejects(
        probe.query(LOCK_ROUTE_NOWAIT, [channelA]),
        (error: { code?: string }) => error.code === "55P03",
        "the move locked A (lower id) before waiting on B",
      );
      await probe.query("ROLLBACK");
      await blocker.query("COMMIT");
      await moveY;
      await mover.query("COMMIT");

      // 2. Concurrency. Opposite moves between the same two channels: X goes
      //    A -> B and, while that is uncommitted, Y goes B -> A. The second
      //    waits for the first (both need A's route row first) and both
      //    commit; neither is aborted with 40P01.
      await probe.query(MOVE_PARENT, [parentY, channelB]); // Y back under B (case 1 moved it to A)
      await mover.query("BEGIN");
      await mover.query(MOVE_PARENT, [parentX, channelB]);
      await mover2.query("BEGIN");
      const moveBack = mover2.query(MOVE_PARENT, [parentY, channelA]).then(() => "done", (error: { code?: string }) => error.code ?? "error");
      await waitUntilBlocked("public-route-stamp-mover-2");
      await mover.query("COMMIT");
      assert.equal(await moveBack, "done", "the opposite move completes after the first commits");
      await mover2.query("COMMIT");

      // 3. Outcome and exclusion: public parents and both threads are stamped;
      //    a thread moving into a channel that is not Guest-visible stamps the
      //    thread but never that channel.
      await probe.query("UPDATE channel_public_routes SET public_changed_at = NULL");
      await probe.query(MOVE_PARENT, [parentX, privateChannel]);
      const stamped = (await probe.query<{ id: string }>(STAMPED)).rows.map((row) => row.id);
      assert.deepEqual(stamped, [channelB, threadX].sort(), "old public parent and the thread; never the members-only channel");

      await probe.query("UPDATE channel_public_routes SET public_changed_at = NULL");
      await probe.query("UPDATE channels SET deleted_at = now() WHERE id = $1", [threadY]);
      const parentOfY = (await probe.query<{ v: string }>("SELECT parent_channel_id::text AS v FROM channels WHERE id = $1", [threadY])).rows[0]!.v;
      const stampedOnDelete = (await probe.query<{ id: string }>(STAMPED)).rows.map((row) => row.id);
      assert.deepEqual(stampedOnDelete, [parentOfY, threadY].sort(), "deleting a thread stamps it and its public parent");
    } finally {
      for (const client of clients) await client.end().catch(() => {});
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`).catch(() => {});
      await admin.end();
    }
  },
);
