import { expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { dbTest as test } from "../test/integration/dbTest";
import { agents, raftbenchServiceAgents } from "../db/schema";
import { invalidateRaftBenchServiceAgentBindings, isRaftBenchServiceAgent } from "../services/agentService";

test("binding cache shares negative/positive lookups, refreshes at 30 seconds and invalidates immediately", async ({ db, seed, onTestFinished }) => {
  const owner = await seed.human();
  const server = await seed.server({ owner });
  const [agent] = await db.insert(agents).values({ serverId: server.id, name: "synthetic-service", runtime: "external" }).returning();
  vi.useFakeTimers({ toFake: ["Date"] });
  onTestFinished(() => { vi.useRealTimers(); });
  invalidateRaftBenchServiceAgentBindings();
  expect(await isRaftBenchServiceAgent(agent.id)).toBe(false);
  const select = vi.spyOn(db, "select");
  onTestFinished(() => select.mockRestore());
  await Promise.all(Array.from({ length: 20 }, () => isRaftBenchServiceAgent(agent.id)));
  expect(select).not.toHaveBeenCalled();
  await db.insert(raftbenchServiceAgents).values({ serverId: server.id, agentId: agent.id });
  expect(await isRaftBenchServiceAgent(agent.id)).toBe(false); // Another replica has at most the TTL.
  vi.setSystemTime(Date.now() + 30_001);
  select.mockClear();
  expect(await Promise.all(Array.from({ length: 20 }, () => isRaftBenchServiceAgent(agent.id)))).toEqual(Array(20).fill(true));
  expect(select).toHaveBeenCalledTimes(1); // One refresh for concurrent polls.
  select.mockClear();
  await Promise.all(Array.from({ length: 20 }, () => isRaftBenchServiceAgent(agent.id)));
  expect(select).not.toHaveBeenCalled();
  await db.delete(raftbenchServiceAgents).where(eq(raftbenchServiceAgents.agentId, agent.id));
  invalidateRaftBenchServiceAgentBindings();
  expect(await isRaftBenchServiceAgent(agent.id)).toBe(false);
  await db.insert(raftbenchServiceAgents).values({ serverId: server.id, agentId: agent.id });
  invalidateRaftBenchServiceAgentBindings();
  expect(await isRaftBenchServiceAgent(agent.id)).toBe(true);
});

test("one dedicated identity cannot be marked for two servers", async ({ db, seed }) => {
  const owner = await seed.human();
  const first = await seed.server({ owner });
  const second = await seed.server({ owner });
  const [agent] = await db.insert(agents).values({ serverId: first.id, name: "synthetic-service", runtime: "external" }).returning();
  await db.insert(raftbenchServiceAgents).values({ serverId: first.id, agentId: agent.id });
  await expect(db.insert(raftbenchServiceAgents).values({ serverId: second.id, agentId: agent.id })).rejects.toThrow();
});
