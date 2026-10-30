import assert from "node:assert/strict";
import { asServerId } from "./brandedIds";
import { asAnnouncementRecipientUserId, matchesAnnouncementAudience, validateAnnouncementAudience } from "../announcement-audience";

const serverA = asServerId("00000000-0000-0000-0000-000000000001");
const serverB = asServerId("00000000-0000-0000-0000-000000000002");
const alice = asAnnouncementRecipientUserId("00000000-0000-0000-0000-000000000003");
const bob = asAnnouncementRecipientUserId("00000000-0000-0000-0000-000000000004");

test("server audiences require the matching current workspace and current membership", () => {
  const members = validateAnnouncementAudience({ type: "server_members", serverIds: [serverA] });
  const selected = validateAnnouncementAudience({ type: "server_users", targets: [{ serverId: serverA, userIds: [alice] }] });
  assert.equal(matchesAnnouncementAudience(members, bob, serverA, true), true);
  assert.equal(matchesAnnouncementAudience(selected, alice, serverA, true), true);
  assert.equal(matchesAnnouncementAudience(selected, bob, serverA, true), false);
  for (const audience of [members, selected]) {
    assert.equal(matchesAnnouncementAudience(audience, alice, serverB, true), false);
    assert.equal(matchesAnnouncementAudience(audience, alice, serverA, false), false);
    assert.equal(matchesAnnouncementAudience(audience, alice, null, false), false);
  }
});

test("user targeting is account-wide; legacy announcements retain all-user eligibility", () => {
  const audience = validateAnnouncementAudience({ type: "users", userIds: [alice] });
  assert.equal(matchesAnnouncementAudience(audience, alice, serverB, false), true);
  assert.equal(matchesAnnouncementAudience(audience, alice, null, false), true);
  assert.equal(matchesAnnouncementAudience(audience, bob, serverA, true), false);
  assert.equal(matchesAnnouncementAudience(validateAnnouncementAudience(undefined), bob, null, false), true);
});

test("ID normalization deduplicates without widening the requested server/user pairs", () => {
  assert.deepEqual(validateAnnouncementAudience({ type: "server_users", targets: [
    { serverId: serverA, userIds: [alice, alice] },
    { serverId: serverA, userIds: [bob] },
    { serverId: serverB, userIds: [bob] },
  ] }), { type: "server_users", targets: [
    { serverId: serverA, userIds: [alice, bob] }, { serverId: serverB, userIds: [bob] },
  ] });
});

test("malformed or ambiguous targeting fails closed rather than becoming all-user delivery", () => {
  for (const input of [null, {}, { type: "other" }, { type: "all", userIds: [alice] },
    { type: "users", userIds: [] }, { type: "users", userIds: ["alice@example.com"] },
    { type: "server_members", serverIds: [alice], extra: true },
    { type: "server_users", targets: [{ serverId: serverA, userIds: [] }] },
  ]) assert.throws(() => validateAnnouncementAudience(input));
});
