#!/usr/bin/env -S node --import=@oxc-node/core/register
import "dotenv/config";
import {
  assertMentionDeliveryTableExists,
  assertAgentOpenIndexReady,
  createPool,
  CREATE_AGENT_OPEN_INDEX_SQL,
  DROP_LEGACY_AGENT_OPEN_INDEX_SQL,
  describeAgentOpenIndexStatus,
  readAgentOpenIndexStatus,
  AGENT_OPEN_INDEX_LOCK_TIMEOUT,
  AGENT_OPEN_INDEX_NAME,
  AGENT_OPEN_INDEX_STATEMENT_TIMEOUT,
  LEGACY_AGENT_OPEN_INDEX_NAME,
} from "./mention-delivery-agent-open-index";
import type pg from "pg";

// Only after the new index verifies: recovery never goes without an index.
async function dropLegacyIndex(client: pg.PoolClient) {
  console.error(`Dropping ${LEGACY_AGENT_OPEN_INDEX_NAME} concurrently if it exists`);
  await client.query(DROP_LEGACY_AGENT_OPEN_INDEX_SQL);
}

async function main() {
  const pool = createPool();
  const client = await pool.connect();
  try {
    await assertMentionDeliveryTableExists(client);

    await client.query(`SELECT set_config('statement_timeout', $1, false)`, [
      AGENT_OPEN_INDEX_STATEMENT_TIMEOUT,
    ]);
    await client.query(`SELECT set_config('lock_timeout', $1, false)`, [
      AGENT_OPEN_INDEX_LOCK_TIMEOUT,
    ]);

    const before = await readAgentOpenIndexStatus(client);
    if (before.exists) {
      assertAgentOpenIndexReady(before);
      console.error(describeAgentOpenIndexStatus(before));
      console.error(`${AGENT_OPEN_INDEX_NAME} already exists`);
      await dropLegacyIndex(client);
      return;
    }

    console.error(
      `Creating ${AGENT_OPEN_INDEX_NAME} concurrently ` +
        `(statement_timeout=${AGENT_OPEN_INDEX_STATEMENT_TIMEOUT}, lock_timeout=${AGENT_OPEN_INDEX_LOCK_TIMEOUT})`,
    );
    await client.query(CREATE_AGENT_OPEN_INDEX_SQL);

    const after = await readAgentOpenIndexStatus(client);
    assertAgentOpenIndexReady(after);
    console.error(describeAgentOpenIndexStatus(after));
    await dropLegacyIndex(client);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
