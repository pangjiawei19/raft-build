import { createApiTest } from "../test/integration/apiTest";
import assert from "node:assert/strict";

import argon2 from "argon2";
import { and, eq } from "drizzle-orm";

import { getDb } from "../db/index";
import { featureFlags, pushRegistrations, pushSubscriptions, sessionFamilies, sessions, users } from "../db/schema";
import { openTestApp } from "../test/integration/app";
import { __resetWebPushRuntimeForTests, __setWebPushRuntimeForTests } from "../services/pushService";
import { __resetFcmTransportForTests, __setFcmAccessTokenSourceForTests } from "../services/fcmPushProvider";
import { MOBILE_PUSH_FCM_FEATURE_FLAG_KEY } from "../services/featureFlagService";
import { addMember, createServer } from "../services/serverService";

const test = createApiTest({ humanActivityMuteFlagDefaultEnabled: true, onboardingOpenerFlagDefaultEnabled: false });
const RETIRED_MOBILE_PUSH_DELIVERY_FLAG_KEY = "mobile_push_delivery_v0";

async function login(baseUrl: string, email: string, password = "password123") {
  return (await loginSession(baseUrl, email, password)).accessToken;
}

async function loginSession(baseUrl: string, email: string, password = "password123") {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200, `login for ${email} expected 200`);
  return await res.json() as { accessToken: string; refreshToken: string };
}

function headers(token: string, serverId: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "X-Server-Id": serverId,
  };
}

async function seedVerifiedUser(email: string, name: string) {
  const passwordHash = await argon2.hash("password123");
  const [user] = await getDb().insert(users).values({
    email,
    name,
    passwordHash,
    emailVerified: true,
    profileSetupCompletedAt: new Date(),
  }).returning();
  return user;
}

test("mobile push registrations validate the APNs tuple and upsert by installation/provider", async () => {
  const { baseUrl, close } = await openTestApp("pglite://", 0, { humanActivityMuteFlagDefaultEnabled: true, onboardingOpenerFlagDefaultEnabled: false });
  try {
    const owner = await seedVerifiedUser("push-owner@slock.test", "push-owner");
    const other = await seedVerifiedUser("push-other@slock.test", "push-other");
    const server = await createServer("Push API", "push-api", owner.id);
    await addMember(server.id, other.id);
    const ownerToken = await login(baseUrl, owner.email);
    const otherToken = await login(baseUrl, other.email);

    const missingEnv = await fetch(`${baseUrl}/api/push/registrations`, {
      method: "POST",
      headers: headers(ownerToken, server.id),
      body: JSON.stringify({
        installationId: "ios-install-1",
        provider: "apns",
        topic: "ai.slock.app",
        deviceToken: "token-1",
      }),
    });
    assert.equal(missingEnv.status, 400);

    const partialTuple = await fetch(`${baseUrl}/api/push/registrations`, {
      method: "POST",
      headers: headers(ownerToken, server.id),
      body: JSON.stringify({
        installationId: "ios-install-1",
        provider: "apns",
        env: "sandbox",
        topic: "ai.slock.app",
      }),
    });
    assert.equal(partialTuple.status, 400);

    const maliciousTuple = await fetch(`${baseUrl}/api/push/registrations`, {
      method: "POST",
      headers: headers(ownerToken, server.id),
      body: JSON.stringify({
        installationId: "alice@example.com secret marker",
        provider: "apns",
        env: "sandbox",
        topic: "ai.slock.app.dev",
        deviceToken: "token-1",
      }),
    });
    assert.equal(maliciousTuple.status, 400, "persistent installation identity must have a bounded safe shape");

    const oversizedTuple = await fetch(`${baseUrl}/api/push/registrations`, {
      method: "POST",
      headers: headers(ownerToken, server.id),
      body: JSON.stringify({
        installationId: "i".repeat(129),
        provider: "apns",
        env: "sandbox",
        topic: "ai.slock.app.dev",
        deviceToken: "token-1",
      }),
    });
    assert.equal(oversizedTuple.status, 400);

    const create = await fetch(`${baseUrl}/api/push/registrations`, {
      method: "POST",
      headers: headers(ownerToken, server.id),
      body: JSON.stringify({
        installationId: "ios-install-1",
        provider: "apns",
        env: "sandbox",
        topic: "ai.slock.app.dev",
        deviceToken: "token-1",
        appVersion: "1.0.0",
      }),
    });
    assert.equal(create.status, 200, await create.clone().text());
    const createBody = await create.json() as { revoke_capability: string };
    assert.match(createBody.revoke_capability, /^[A-Za-z0-9._-]+$/);

    const update = await fetch(`${baseUrl}/api/push/registrations`, {
      method: "POST",
      headers: headers(ownerToken, server.id),
      body: JSON.stringify({
        installationId: "ios-install-1",
        provider: "apns",
        env: "production",
        topic: "ai.slock.app",
        deviceToken: "token-2",
        appVersion: "1.0.1",
      }),
    });
    assert.equal(update.status, 200, await update.clone().text());
    const updateBody = await update.json() as { revoke_capability: string };
    assert.equal(updateBody.revoke_capability, createBody.revoke_capability, "same family registration must return a stable capability");

    const rows = await getDb().select().from(pushRegistrations).where(eq(pushRegistrations.installationId, "ios-install-1"));
    assert.equal(rows.length, 1, "same installation/provider should be idempotently upserted");
    assert.equal(rows[0].provider, "apns");
    assert.equal(rows[0].env, "production");
    assert.equal(rows[0].topic, "ai.slock.app");
    assert.equal(rows[0].deviceToken, "token-2");
    assert.equal(rows[0].appVersion, "1.0.1");
    assert.equal(rows[0].userId, owner.id);
    assert.equal(rows[0].serverId, server.id);
    assert.ok(rows[0].sessionFamilyId);

    const accountSwitch = await fetch(`${baseUrl}/api/push/registrations`, {
      method: "POST",
      headers: headers(otherToken, server.id),
      body: JSON.stringify({
        installationId: "ios-install-1",
        provider: "apns",
        env: "production",
        topic: "ai.slock.app",
        deviceToken: "token-3",
      }),
    });
    assert.equal(accountSwitch.status, 200, await accountSwitch.clone().text());

    const [rebound] = await getDb().select().from(pushRegistrations).where(eq(pushRegistrations.installationId, "ios-install-1"));
    assert.equal(rebound.userId, other.id, "login/account switch mutates only the current binding");
    assert.equal(rebound.serverId, server.id);
    assert.equal(rebound.deviceToken, "token-3");

    const unbind = await fetch(`${baseUrl}/api/push/registrations/ios-install-1`, {
      method: "DELETE",
      headers: headers(otherToken, server.id),
    });
    assert.equal(unbind.status, 200, await unbind.clone().text());
    assert.deepEqual(await unbind.json(), { ok: true, unbound: 1 });

    const [afterDelete] = await getDb().select().from(pushRegistrations).where(and(
      eq(pushRegistrations.installationId, "ios-install-1"),
      eq(pushRegistrations.provider, "apns"),
    ));
    assert.ok(afterDelete, "logout/unbind keeps the installation row");
    assert.equal(afterDelete.userId, null);
    assert.equal(afterDelete.serverId, null);
    assert.equal(afterDelete.revokedAt, null);
  } finally {
    await close();
  }
});

test("mobile push registrations accept the FCM tuple: colon tokens, production only", async () => {
  const { baseUrl, close } = await openTestApp("pglite://", 0, { humanActivityMuteFlagDefaultEnabled: true, onboardingOpenerFlagDefaultEnabled: false });
  try {
    const owner = await seedVerifiedUser("push-fcm-owner@slock.test", "push-fcm-owner");
    const server = await createServer("Push FCM API", "push-fcm-api", owner.id);
    const ownerToken = await login(baseUrl, owner.email);
    const fcmToken = `dGVzdA:APA91b${"x".repeat(150)}`;
    const register = (body: Record<string, unknown>) => fetch(`${baseUrl}/api/push/registrations`, {
      method: "POST",
      headers: headers(ownerToken, server.id),
      body: JSON.stringify({
        installationId: "android-install-1",
        provider: "fcm",
        env: "production",
        topic: "build.raft.app",
        deviceToken: fcmToken,
        ...body,
      }),
    });

    const sandbox = await register({ env: "sandbox" });
    assert.equal(sandbox.status, 400, "FCM has no sandbox environment");

    const malformed = await register({ deviceToken: "token with spaces" });
    assert.equal(malformed.status, 400);

    const apnsWithColon = await register({ provider: "apns", deviceToken: fcmToken });
    assert.equal(apnsWithColon.status, 400, "APNs tokens keep their stricter shape");

    const create = await register({});
    assert.equal(create.status, 200, await create.clone().text());
    const body = await create.json() as { registration: { provider: string; env: string } };
    assert.equal(body.registration.provider, "fcm");
    assert.equal(body.registration.env, "production");

    const [row] = await getDb().select().from(pushRegistrations).where(and(
      eq(pushRegistrations.installationId, "android-install-1"),
      eq(pushRegistrations.provider, "fcm"),
    ));
    assert.equal(row?.deviceToken, fcmToken);
    assert.equal(row?.userId, owner.id);
  } finally {
    await close();
  }
});

test("push delivery status reports per server whether this installation gets FCM pushes", async () => {
  const { baseUrl, close } = await openTestApp("pglite://", 0, { humanActivityMuteFlagDefaultEnabled: true, onboardingOpenerFlagDefaultEnabled: false });
  try {
    const owner = await seedVerifiedUser("push-status-owner@slock.test", "push-status-owner");
    const other = await seedVerifiedUser("push-status-other@slock.test", "push-status-other");
    const serverA = await createServer("Push Status A", "push-status-a", owner.id);
    const serverB = await createServer("Push Status B", "push-status-b", owner.id);
    const foreign = await createServer("Push Status Foreign", "push-status-foreign", other.id);
    const ownerToken = await login(baseUrl, owner.email);
    const status = async (installationId: string | null) => {
      const query = installationId === null ? "" : `?installationId=${encodeURIComponent(installationId)}`;
      return fetch(`${baseUrl}/api/push/delivery-status${query}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    };
    const servers = async (installationId: string) => {
      const res = await status(installationId);
      assert.equal(res.status, 200, await res.clone().text());
      return (await res.json() as { servers: Record<string, { fcmActive: boolean }> }).servers;
    };
    const setFlag = (key: string, values: { defaultEnabled?: boolean; killSwitch?: boolean }) =>
      getDb().update(featureFlags).set(values).where(eq(featureFlags.key, key));

    assert.equal((await fetch(`${baseUrl}/api/push/delivery-status?installationId=a`)).status, 401);
    assert.equal((await status(null)).status, 400);
    assert.equal((await status("bad id with spaces")).status, 400);

    __setFcmAccessTokenSourceForTests({ projectId: "raft-test", getAccessToken: async () => "test-token" });
    await setFlag(MOBILE_PUSH_FCM_FEATURE_FLAG_KEY, { defaultEnabled: true });

    // Not registered yet: every server the user belongs to, none active, other servers absent.
    assert.deepEqual(await servers("android-status-1"), {
      [serverA.id]: { fcmActive: false },
      [serverB.id]: { fcmActive: false },
    });
    assert.equal(Object.hasOwn(await servers("android-status-1"), foreign.id), false);

    const register = await fetch(`${baseUrl}/api/push/registrations`, {
      method: "POST",
      headers: headers(ownerToken, serverA.id),
      body: JSON.stringify({
        installationId: "android-status-1",
        provider: "fcm",
        env: "production",
        topic: "build.raft.app",
        deviceToken: "android-status-fid",
      }),
    });
    assert.equal(register.status, 200, await register.clone().text());

    // Registered while bound to server A, but delivery is per user: both servers are covered.
    assert.deepEqual(await servers("android-status-1"), {
      [serverA.id]: { fcmActive: true },
      [serverB.id]: { fcmActive: true },
    });
    assert.deepEqual(await servers("android-status-other-install"), {
      [serverA.id]: { fcmActive: false },
      [serverB.id]: { fcmActive: false },
    }, "another installation has no registration");

    await setFlag(RETIRED_MOBILE_PUSH_DELIVERY_FLAG_KEY, { killSwitch: true });
    assert.equal((await servers("android-status-1"))[serverA.id]?.fcmActive, true, "the retired master switch no longer gates FCM");

    await getDb().delete(featureFlags).where(eq(featureFlags.key, RETIRED_MOBILE_PUSH_DELIVERY_FLAG_KEY));
    assert.equal((await servers("android-status-1"))[serverA.id]?.fcmActive, true, "removing the retired row keeps FCM active");

    await setFlag(MOBILE_PUSH_FCM_FEATURE_FLAG_KEY, { defaultEnabled: false });
    assert.equal((await servers("android-status-1"))[serverA.id]?.fcmActive, false);
    await setFlag(MOBILE_PUSH_FCM_FEATURE_FLAG_KEY, { defaultEnabled: true });

    __setFcmAccessTokenSourceForTests(null);
    assert.equal((await servers("android-status-1"))[serverA.id]?.fcmActive, false, "FCM not configured");
    __resetFcmTransportForTests();
    __setFcmAccessTokenSourceForTests({ projectId: "raft-test", getAccessToken: async () => "test-token" });

    await getDb().update(pushRegistrations)
      .set({ revokedAt: new Date(), userId: null, serverId: null })
      .where(eq(pushRegistrations.installationId, "android-status-1"));
    assert.equal((await servers("android-status-1"))[serverA.id]?.fcmActive, false, "revoked registration");
  } finally {
    __resetFcmTransportForTests();
    await close();
  }
});

test("family revoke capability is unauthenticated, idempotent for 30 days, and terminal-invalid after retention", async () => {
  const { baseUrl, close } = await openTestApp("pglite://", 0, { humanActivityMuteFlagDefaultEnabled: true, onboardingOpenerFlagDefaultEnabled: false });
  try {
    const owner = await seedVerifiedUser("push-family@slock.test", "push-family");
    const server = await createServer("Push Family API", "push-family-api", owner.id);
    const session = await loginSession(baseUrl, owner.email);

    const registration = await fetch(`${baseUrl}/api/push/registrations`, {
      method: "POST",
      headers: headers(session.accessToken, server.id),
      body: JSON.stringify({
        installationId: "ios-family-install",
        provider: "apns",
        env: "production",
        topic: "ai.slock.app",
        deviceToken: "family-token",
      }),
    });
    assert.equal(registration.status, 200, await registration.clone().text());
    const { revoke_capability: capability } = await registration.json() as { revoke_capability: string };

    const refresh = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    assert.equal(refresh.status, 200, await refresh.clone().text());
    const rotated = await refresh.json() as { accessToken: string; refreshToken: string };
    const afterRotation = await fetch(`${baseUrl}/api/push/registrations`, {
      method: "POST",
      headers: headers(rotated.accessToken, server.id),
      body: JSON.stringify({
        installationId: "ios-family-install",
        provider: "apns",
        env: "production",
        topic: "ai.slock.app",
        deviceToken: "family-token-rotated",
      }),
    });
    assert.equal(afterRotation.status, 200, await afterRotation.clone().text());
    const afterRotationBody = await afterRotation.json() as { revoke_capability: string };
    assert.equal(afterRotationBody.revoke_capability, capability, "refresh rotation must preserve the family capability");

    const revoke = await fetch(`${baseUrl}/api/push/family-revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability }),
    });
    assert.equal(revoke.status, 204);

    const [family] = await getDb().select().from(sessionFamilies).where(eq(sessionFamilies.revokeCapabilityNonce, capability.split(".")[1]));
    assert.ok(family?.revokedAt);
    assert.ok(family.capabilityRetainUntil);
    assert.ok(family.capabilityRetainUntil.getTime() - family.revokedAt.getTime() >= 30 * 24 * 60 * 60 * 1000);
    const remainingSessions = await getDb().select().from(sessions).where(eq(sessions.familyId, family.id));
    assert.equal(remainingSessions.length, 0, "family revoke must invalidate every refresh session in the family");

    const replay = await fetch(`${baseUrl}/api/push/family-revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability }),
    });
    assert.equal(replay.status, 204, "replay inside retention is terminal idempotent success");

    await getDb().update(sessionFamilies).set({ capabilityRetainUntil: new Date(Date.now() - 1) }).where(eq(sessionFamilies.id, family.id));
    const expiredReplay = await fetch(`${baseUrl}/api/push/family-revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability }),
    });
    assert.equal(expiredReplay.status, 403, "expired capability is terminal-invalid for mobile to clear pending signout");

    const invalid = await fetch(`${baseUrl}/api/push/family-revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability: capability.slice(0, -1) + "x" }),
    });
    assert.equal(invalid.status, 403);
    const malformed = await fetch(`${baseUrl}/api/push/family-revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability: "bad capability" }),
    });
    assert.equal(malformed.status, 400);
  } finally {
    await close();
  }
});

test("online logout marks the entire push family dead while retaining idempotent capability acknowledgement", async () => {
  const { baseUrl, close } = await openTestApp("pglite://", 0, { humanActivityMuteFlagDefaultEnabled: true, onboardingOpenerFlagDefaultEnabled: false });
  try {
    const owner = await seedVerifiedUser("push-logout@slock.test", "push-logout");
    const server = await createServer("Push Logout API", "push-logout-api", owner.id);
    const session = await loginSession(baseUrl, owner.email);
    const registration = await fetch(`${baseUrl}/api/push/registrations`, {
      method: "POST",
      headers: headers(session.accessToken, server.id),
      body: JSON.stringify({
        installationId: "ios-logout-install",
        provider: "apns",
        env: "production",
        topic: "ai.slock.app",
        deviceToken: "logout-token",
      }),
    });
    const { revoke_capability: capability } = await registration.json() as { revoke_capability: string };

    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    assert.equal(logout.status, 200);

    const [family] = await getDb().select().from(sessionFamilies).where(eq(sessionFamilies.revokeCapabilityNonce, capability.split(".")[1]));
    assert.ok(family.revokedAt);
    assert.equal(family.revokedReason, "logout");
    assert.equal((await getDb().select().from(sessions).where(eq(sessions.familyId, family.id))).length, 0);

    const capabilityAck = await fetch(`${baseUrl}/api/push/family-revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability }),
    });
    assert.equal(capabilityAck.status, 204);
  } finally {
    await close();
  }
});

test("web push subscribe stores only public HTTPS endpoints", async () => {
  const { baseUrl, close } = await openTestApp("pglite://", 0, { humanActivityMuteFlagDefaultEnabled: true, onboardingOpenerFlagDefaultEnabled: false });
  __setWebPushRuntimeForTests({ enabled: true });
  try {
    const owner = await seedVerifiedUser("push-subscribe@slock.test", "push-subscribe");
    const token = await login(baseUrl, owner.email);
    const keys = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };
    const subscribe = (endpoint: unknown) => fetch(`${baseUrl}/api/push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ endpoint, keys }),
    });

    const rejected = [
      "http://fcm.googleapis.com/fcm/send/plain-http",
      "https://8.8.8.8/push/ip-literal",
      "https://127.0.0.1:8080/push/loopback",
      "https://[::1]/push/loopback-v6",
      "https://10.0.0.5/push/private-range",
      "https://169.254.169.254/latest/meta-data",
      "https://localhost/push",
      "https://printer.local/push",
      "https://vault.internal/push",
      "https://user:secret@fcm.googleapis.com/fcm/send/userinfo",
      "not a url",
      ["https://fcm.googleapis.com/fcm/send/array"],
    ];
    for (const endpoint of rejected) {
      const res = await subscribe(endpoint);
      assert.equal(res.status, 400, `${JSON.stringify(endpoint)} must be refused`);
    }
    assert.equal((await getDb().select().from(pushSubscriptions)).length, 0, "refused endpoints store nothing");

    const accepted = [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/abc",
      "https://db5p.notify.windows.com/w/?token=abc",
    ];
    for (const endpoint of accepted) {
      const res = await subscribe(endpoint);
      assert.equal(res.status, 200, `${endpoint} must be accepted: ${await res.clone().text()}`);
    }
    const stored = (await getDb().select({ endpoint: pushSubscriptions.endpoint }).from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, owner.id))).map((row) => row.endpoint).sort();
    assert.deepEqual(stored, [...accepted].sort());
  } finally {
    __resetWebPushRuntimeForTests();
    await close();
  }
});
