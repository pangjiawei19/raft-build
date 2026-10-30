#!/usr/bin/env -S node --import=@oxc-node/core/register
import "dotenv/config";
import {
  assertMentionDeliveryTableExists,
  assertAgentOpenIndexReady,
  createPool,
  describeAgentOpenIndexStatus,
  readAgentOpenIndexStatus,
} from "./mention-delivery-agent-open-index";

async function main() {
  const pool = createPool();
  const client = await pool.connect();
  try {
    await assertMentionDeliveryTableExists(client);
    const status = await readAgentOpenIndexStatus(client);
    assertAgentOpenIndexReady(status);
    console.error(describeAgentOpenIndexStatus(status));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
