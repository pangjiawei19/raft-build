import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { dbTest } from "../test/integration/dbTest";
import { addAgent, capAgentUnreadSummary, findOrCreateDM, getAgentUnreadCounts } from "./channelService";
import { createMessage } from "./messageService";
import { agents, channelAgents, channels, serverMembers, servers, users } from "../db/schema";
import { referenceAgentInboxChain } from "../test/agentInboxChainReference";

test("the resume unread summary keeps DMs first, then the most unread, and folds the rest into one line", () => {
  const counts: Record<string, number> = { "dm:@alice": 1 };
  for (let i = 0; i < 30; i += 1) counts[`#room-${String(i).padStart(2, "0")}`] = i + 1;
  const capped = capAgentUnreadSummary(counts, 5);
  assert.deepEqual(Object.keys(capped), [
    "dm:@alice", "#room-29", "#room-28", "#room-27", "#room-26", "(26 more conversations — run `raft inbox check` to list them)",
  ]);
  // Folded unread: rooms 00..25 hold 1..26.
  assert.equal(capped["(26 more conversations — run `raft inbox check` to list them)"], (26 * 27) / 2);
  assert.equal(capAgentUnreadSummary({ "#a": 1 }, 5)["#a"], 1);
});

dbTest("the resume unread summary leaves out a DM no target can open", async ({ db }) => {
  const [owner] = await db.insert(users).values({ email: "receipt-owner@test.com", name: "ReceiptOwner", passwordHash: "x", emailVerified: true }).returning();
  const [server] = await db.insert(servers).values({ name: "receipt", slug: "receipt", ownerId: owner.id }).returning();
  await db.insert(serverMembers).values({ serverId: server.id, userId: owner.id, role: "owner" });
  const [agent] = await db.insert(agents).values({ serverId: server.id, name: "receipt-agent", status: "active" }).returning();
  const [room] = await db.insert(channels).values({ serverId: server.id, name: "receipt-room", type: "channel" }).returning();
  assert.equal(await addAgent(room.id, agent.id), true);
  await createMessage(room.id, "user", owner.id, "hello room");
  const dm = await findOrCreateDM(server.id, owner.id, agent.id);
  await createMessage(dm!.id, "user", owner.id, "hello dm");
  // The single-member migration receipt DM: no peer, so no `dm:@...` target reads it,
  // and `raft inbox check` does not list it either.
  const [receiptDm] = await db.insert(channels).values({ serverId: server.id, name: `migration-receipt-${randomUUID().slice(0, 8)}`, type: "dm" }).returning();
  await db.insert(channelAgents).values({ channelId: receiptDm.id, agentId: agent.id });
  await createMessage(receiptDm.id, "user", "system", "migration receipt", "system");

  assert.deepEqual(await getAgentUnreadCounts(agent.id, await referenceAgentInboxChain(agent.id)), { "dm:@ReceiptOwner": 1, "#receipt-room": 1 });
});
