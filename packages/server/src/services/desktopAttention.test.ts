import { dbTest as test } from "../test/integration/dbTest";
import assert from "node:assert/strict";
import { getDb } from "../db/index";
import { pushSubscriptions, users } from "../db/schema";
import {
  __resetWebPushRuntimeForTests,
  __setWebPushRuntimeForTests,
  sendPushNotifications,
  sendPushToUsers,
} from "./pushService";
import {
  __resetDesktopAttentionForTests,
  clearDesktopAttention,
  DESKTOP_ATTENTION_WINDOW_MS,
  recordDesktopAttention,
  usersWithRecentDesktopAttention,
} from "./desktopAttention";

// Task #725: while someone is on Raft Desktop, message web pushes to them are
// skipped; everyone else, and the explicit test-notification path, are not.

async function seedUserWithWebPush(db: ReturnType<typeof getDb>, name: string) {
  const [user] = await db.insert(users).values({
    email: `${name.toLowerCase()}@test.com`,
    name,
    passwordHash: "x",
    emailVerified: true,
  }).returning();
  await db.insert(pushSubscriptions).values({
    userId: user.id,
    endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
    p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
    auth: "tBHItJI5svbpez7KI4CCXg",
  });
  return user;
}

function captureSends() {
  const endpoints: string[] = [];
  __setWebPushRuntimeForTests({
    enabled: true,
    lookup: async () => [{ address: "142.250.72.10", family: 4 }],
    sendNotification: async (subscription) => {
      endpoints.push(subscription.endpoint);
      return { statusCode: 201, body: "", headers: {} };
    },
  });
  return endpoints;
}

const payload = { title: "t", body: "b", tag: "desktop-attention", url: "/" };

test("message web push skips a user on Raft Desktop and still reaches everyone else", async ({ db }) => {
  __resetDesktopAttentionForTests();
  const sends = captureSends();
  try {
    const onDesktop = await seedUserWithWebPush(db, "OnDesktop");
    const inBrowser = await seedUserWithWebPush(db, "InBrowser");
    await recordDesktopAttention(onDesktop.id);

    await sendPushNotifications([
      { userId: onDesktop.id, payload },
      { userId: inBrowser.id, payload },
    ]);

    assert.deepEqual(sends, ["https://fcm.googleapis.com/fcm/send/InBrowser"]);
  } finally {
    __resetWebPushRuntimeForTests();
    __resetDesktopAttentionForTests();
  }
});

test("the settings test notification is never suppressed by desktop attention", async ({ db }) => {
  __resetDesktopAttentionForTests();
  const sends = captureSends();
  try {
    const user = await seedUserWithWebPush(db, "Tester");
    await recordDesktopAttention(user.id);

    const result = await sendPushToUsers([user.id], payload);

    assert.deepEqual(result, { attempted: 1, delivered: 1, failed: 0 });
    assert.deepEqual(sends, ["https://fcm.googleapis.com/fcm/send/Tester"]);
  } finally {
    __resetWebPushRuntimeForTests();
    __resetDesktopAttentionForTests();
  }
});

test("desktop attention lapses after the fixed ten-minute window", async () => {
  __resetDesktopAttentionForTests();
  try {
    assert.equal(DESKTOP_ATTENTION_WINDOW_MS, 10 * 60 * 1000);
    const at = 1_000_000;
    await recordDesktopAttention("user-a", at);
    assert.deepEqual([...await usersWithRecentDesktopAttention(["user-a", "user-b"], at + DESKTOP_ATTENTION_WINDOW_MS - 1)], ["user-a"]);
    assert.deepEqual([...await usersWithRecentDesktopAttention(["user-a"], at + DESKTOP_ATTENTION_WINDOW_MS)], []);
  } finally {
    __resetDesktopAttentionForTests();
  }
});

test("an away report from Raft Desktop lets browser pushes through at once", async ({ db }) => {
  __resetDesktopAttentionForTests();
  const sends = captureSends();
  try {
    const user = await seedUserWithWebPush(db, "WentAway");
    await recordDesktopAttention(user.id);
    await clearDesktopAttention(user.id);

    await sendPushNotifications([{ userId: user.id, payload }]);

    assert.deepEqual(sends, ["https://fcm.googleapis.com/fcm/send/WentAway"]);
  } finally {
    __resetWebPushRuntimeForTests();
    __resetDesktopAttentionForTests();
  }
});
