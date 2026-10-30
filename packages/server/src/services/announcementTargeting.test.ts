import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { asServerId, validateAnnouncementAudience } from "@botiverse/raft-shared";
import { dbTest as test } from "../test/integration/dbTest";
import { closeTestDatabase } from "../test/integration/database";
import { users, servers, serverMembers, announcements } from "../db/schema";
import { listUndismissedForUser, dismiss } from "./announcementService";
afterEach(closeTestDatabase);
test("targeting precedes FIFO; workspace membership and dismissal remain authoritative", async ({ db }) => {
  const [user, outsider] = await db.insert(users).values([
    { email: "target@test.invalid", name: "target", displayName: "Target", passwordHash: "test" },
    { email: "outside@test.invalid", name: "outside", displayName: "Outside", passwordHash: "test" },
  ]).returning();
  const [a, b] = await db.insert(servers).values([
    { name: "A", slug: "target-a", ownerId: user.id },
    { name: "B", slug: "target-b", ownerId: user.id },
  ]).returning();
  await db.insert(serverMembers).values([{ serverId: a.id, userId: user.id }, { serverId: b.id, userId: user.id }]);
  const [target, global] = await db.insert(announcements).values([
    { title: "A only", pages: [{ body: "A" }], status: "published", startsAt: new Date("2026-01-01"), audience: validateAnnouncementAudience({ type: "server_users", targets: [{ serverId: a.id, userIds: [user.id] }] }) },
    { title: "Global", pages: [{ body: "All" }], status: "published", startsAt: new Date("2026-02-01") },
  ]).returning();
  const load = (id: string, context?: string) => listUndismissedForUser(id, undefined, undefined, undefined, context ? asServerId(context) : undefined);
  assert.equal((await load(user.id, b.id))[0].id, global.id, "ineligible older row cannot block an eligible one");
  assert.equal((await load(user.id))[0].id, global.id, "older clients receive only account announcements");
  assert.equal((await load(outsider.id, a.id))[0].id, global.id, "spoofed server is not membership");
  const delivered = (await load(user.id, a.id))[0];
  assert.equal(delivered.id, target.id);
  assert.equal(delivered.deliveryVersion, 1);
  assert.deepEqual(delivered.deliveryScope, { type: "server", serverId: a.id });
  assert.equal("audience" in delivered, false, "recipient lists never enter user DTOs");
  assert.equal(await dismiss(user.id, target.id, undefined, asServerId(b.id)), false);
  assert.equal(await dismiss(outsider.id, target.id, undefined, asServerId(a.id)), false);
  assert.equal(await dismiss(user.id, target.id, undefined, asServerId(a.id)), true);
  assert.equal((await load(user.id, a.id))[0].id, global.id);
  await db.update(announcements).set({ audience: validateAnnouncementAudience({ type: "server_members", serverIds: [b.id] }) }).where(eq(announcements.id, global.id));
  assert.equal((await load(user.id, b.id))[0].id, global.id);
  await db.delete(serverMembers).where(eq(serverMembers.serverId, b.id));
  assert.deepEqual(await load(user.id, b.id), [], "departed members lose eligibility immediately");
  await db.update(announcements).set({ audience: validateAnnouncementAudience({ type: "users", userIds: [user.id] }) }).where(eq(announcements.id, global.id));
  assert.equal((await load(user.id, b.id))[0].id, global.id);
  assert.deepEqual(await load(outsider.id, a.id), []);
});

test("invalid targets do not block valid recipients and membership is checked at delivery time", async ({ db }) => {
  const [recipient, other] = await db.insert(users).values([
    { email: "mixed-target@test.invalid", name: "mixed-target", displayName: "Target", passwordHash: "test" },
    { email: "mixed-other@test.invalid", name: "mixed-other", displayName: "Other", passwordHash: "test" },
  ]).returning();
  const [active, deleted] = await db.insert(servers).values([
    { name: "Active", slug: "mixed-active", ownerId: recipient.id },
    { name: "Deleted", slug: "mixed-deleted", ownerId: recipient.id, deletedAt: new Date() },
  ]).returning();
  await db.insert(serverMembers).values([
    { serverId: active.id, userId: recipient.id },
    { serverId: deleted.id, userId: recipient.id },
  ]);
  const missingServer = crypto.randomUUID();
  const missingUser = crypto.randomUUID();
  const [announcement] = await db.insert(announcements).values({
    title: "Mixed validity", pages: [{ body: "Valid recipients still receive this" }],
    status: "published", startsAt: new Date("2026-01-01"),
    audience: validateAnnouncementAudience({ type: "server_users", targets: [
      { serverId: active.id, userIds: [recipient.id, other.id, missingUser] },
      { serverId: deleted.id, userIds: [recipient.id] },
      { serverId: missingServer, userIds: [recipient.id] },
    ] }),
  }).returning();
  const load = (userId: string, serverId: string) => listUndismissedForUser(userId, undefined, undefined, undefined, asServerId(serverId));
  assert.equal((await load(recipient.id, active.id))[0].id, announcement.id);
  assert.deepEqual(await load(recipient.id, deleted.id), [], "deleted Server is skipped");
  assert.deepEqual(await load(recipient.id, missingServer), [], "unknown Server is skipped");
  assert.deepEqual(await load(missingUser, active.id), [], "unknown account is skipped");
  assert.deepEqual(await load(other.id, active.id), [], "listed account without membership is skipped");
  await db.insert(serverMembers).values({ serverId: active.id, userId: other.id });
  assert.equal((await load(other.id, active.id))[0].id, announcement.id, "later membership is evaluated without republishing");
  await db.delete(serverMembers).where(eq(serverMembers.serverId, active.id));
  assert.deepEqual(await load(recipient.id, active.id), [], "membership loss takes effect without republishing");
});

test("Guest exclusion covers every audience and follows current Server role", async ({ db }) => {
  const [user] = await db.insert(users).values({ email: "guest@test.invalid", name: "guest", displayName: "Guest", passwordHash: "test" }).returning();
  const [a, b] = await db.insert(servers).values([{ name: "A", slug: "guest-a", ownerId: user.id }, { name: "B", slug: "guest-b", ownerId: user.id }]).returning();
  await db.insert(serverMembers).values({ serverId: a.id, userId: user.id, role: "guest" });
  const load = (context?: string) => listUndismissedForUser(user.id, undefined, undefined, undefined, context ? asServerId(context) : undefined);
  for (const audience of [{ type: "all" }, { type: "users", userIds: [user.id] }, { type: "server_members", serverIds: [a.id] }, { type: "server_users", targets: [{ serverId: a.id, userIds: [user.id] }] }]) {
    const [row] = await db.insert(announcements).values({ title: "Guest excluded", pages: [{ body: "Test" }], status: "published", startsAt: new Date("2026-01-01"), audience: validateAnnouncementAudience(audience) }).returning();
    assert.deepEqual(await load(a.id), [], audience.type);
    assert.deepEqual(await load(), [], "context omission cannot bypass Guest-only exclusion");
    assert.deepEqual(await load(b.id), [], "spoofed context cannot bypass Guest-only exclusion");
    assert.equal(await dismiss(user.id, row.id, undefined, asServerId(a.id)), false);
    await db.delete(announcements).where(eq(announcements.id, row.id));
  }
  await db.insert(serverMembers).values({ serverId: b.id, userId: user.id });
  const [global] = await db.insert(announcements).values({ title: "Global", pages: [{ body: "Test" }], status: "published", startsAt: new Date("2026-01-01") }).returning();
  assert.deepEqual(await load(a.id), [], "membership elsewhere cannot override current Guest role");
  assert.equal((await load(b.id))[0].id, global.id);
  await db.update(serverMembers).set({ role: "member" }).where(eq(serverMembers.serverId, a.id));
  assert.equal((await load(a.id))[0].id, global.id, "promotion applies live");
  await db.update(serverMembers).set({ role: "guest" }).where(eq(serverMembers.serverId, a.id));
  assert.deepEqual(await load(a.id), [], "demotion applies live");
});


test("historical Guest roles on deleted or joint storage Servers do not suppress account announcements", async ({ db }) => {
  const [user] = await db.insert(users).values({ email: "historical-guest@test.invalid", name: "historical-guest", displayName: "Former Guest", passwordHash: "test" }).returning();
  const [deleted, joint] = await db.insert(servers).values([
    { name: "Deleted", slug: "guest-deleted", ownerId: user.id, deletedAt: new Date() },
    { name: "Joint", slug: "guest-joint", ownerId: user.id, kind: "joint_storage" },
  ]).returning();
  await db.insert(serverMembers).values([{ serverId: deleted.id, userId: user.id, role: "guest" }, { serverId: joint.id, userId: user.id, role: "guest" }]);
  for (const audience of [{ type: "all" }, { type: "users", userIds: [user.id] }]) {
    const [row] = await db.insert(announcements).values({ title: "Account", pages: [{ body: "Test" }], status: "published", startsAt: new Date("2026-01-01"), audience: validateAnnouncementAudience(audience) }).returning();
    for (const context of [undefined, deleted.id, joint.id]) {
      const delivered = await listUndismissedForUser(user.id, undefined, undefined, undefined, context ? asServerId(context) : undefined);
      assert.equal(delivered[0].id, row.id, "inactive Guest rows are not current roles");
    }
    await db.delete(announcements).where(eq(announcements.id, row.id));
  }
});
