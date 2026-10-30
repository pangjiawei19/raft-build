import { createApiTest } from "../test/integration/apiTest";
import assert from "node:assert/strict";

import argon2 from "argon2";
import { ACTIVITY_SYNC_CONTRACT_REVISION } from "@botiverse/raft-sync-core";

import { getDb } from "../db/index";
import { users } from "../db/schema";
import { openTestApp } from "../test/integration/app";
import { createServer } from "../services/serverService";
import { ACTIVITY_CONTRACT_HEADER_VALUE } from "./activityContractHeader";

const test = createApiTest({ humanActivityMuteFlagDefaultEnabled: true, onboardingOpenerFlagDefaultEnabled: false });

test("Activity sync endpoints report the contract revision on every response", async () => {
  const { baseUrl, close } = await openTestApp("pglite://", 0, { humanActivityMuteFlagDefaultEnabled: true, onboardingOpenerFlagDefaultEnabled: false });
  try {
    const passwordHash = await argon2.hash("password123");
    const [owner] = await getDb().insert(users).values({
      email: "activity-contract@slock.test",
      name: "activity-contract",
      passwordHash,
      emailVerified: true,
      profileSetupCompletedAt: new Date(),
    }).returning();
    const server = await createServer("Activity Contract", "activity-contract", owner.id);
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: owner.email, password: "password123" }),
    });
    const { accessToken } = await login.json() as { accessToken: string };
    const headers = { Authorization: `Bearer ${accessToken}`, "X-Server-Id": server.id };

    assert.equal(ACTIVITY_CONTRACT_HEADER_VALUE, `raft.activity-sync;revision=${ACTIVITY_SYNC_CONTRACT_REVISION}`);

    // Rejected requests carry it too: a client must be able to tell a contract
    // mismatch from a bad request without a second round trip.
    const badSnapshot = await fetch(`${baseUrl}/api/channels/activity/snapshot`, { headers });
    assert.equal(badSnapshot.status, 400);
    assert.equal(badSnapshot.headers.get("x-raft-contract"), ACTIVITY_CONTRACT_HEADER_VALUE);
    assert.match(badSnapshot.headers.get("access-control-expose-headers") ?? "", /X-Raft-Contract/);

    const badDifference = await fetch(`${baseUrl}/api/channels/activity/difference?requestId=r1`, {
      headers: { ...headers, "X-Raft-Contract-Revision": "1" },
    });
    assert.equal(badDifference.status, 400);
    assert.equal(badDifference.headers.get("x-raft-contract"), ACTIVITY_CONTRACT_HEADER_VALUE);

    // A client revision never changes the outcome, even when it is garbage.
    const garbage = await fetch(`${baseUrl}/api/channels/activity/snapshot`, {
      headers: { ...headers, "X-Raft-Contract-Revision": "not-a-number" },
    });
    assert.equal(garbage.status, 400);
    assert.equal(garbage.headers.get("x-raft-contract"), ACTIVITY_CONTRACT_HEADER_VALUE);
  } finally {
    await close();
  }
});
