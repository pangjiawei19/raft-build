import { dbTest as test } from "../test/integration/dbTest";
import { closeTestDatabase } from "../test/integration/database";
import assert from "node:assert/strict";

import { eq } from "drizzle-orm";
import { BasicTracer, MemoryTraceSink } from "@botiverse/raft-shared";

import { getDb } from "../db/index";
import {
  channels,
  featureFlags,
  messages,
  mobilePushOutbox,
  pushRegistrations,
  serverMembers,
  servers,
  sessionFamilies,
  sessions,
  users,
} from "../db/schema";
import { recordInboxNotificationFacts } from "./inboxNotificationService";
import {
  __resetApnsPushProviderForTests,
  __resetFcmPushProviderForTests,
  __resetMobilePushDeliveryRuntimeForTests,
  __setApnsPushProviderForTests,
  __setFcmPushProviderForTests,
  __setMobilePushDeliveryRuntimeForTests,
  startMobilePushOutboxWorker,
  upsertPushRegistration,
  type ApnsDeliveryInput,
} from "./pushService";
import {
  ConfiguredFcmPushProvider,
  FcmDeliveryError,
  isTerminalFcmTokenError,
  __resetFcmTransportForTests,
  fcmAccessTokenSourceFromEnv,
  parseFcmErrorReason,
  type FcmDeliveryInput,
  type FcmHttpClient,
} from "./fcmPushProvider";
import { MOBILE_PUSH_FCM_FEATURE_FLAG_KEY } from "./featureFlagService";

process.env.JWT_SECRET ||= "push-fcm-test-secret";

const FCM_TOKEN = "dGVzdC1pbnN0YW5jZQ:APA91bH-test_token";

async function seedFixture() {
  const db = getDb();
  const [owner] = await db.insert(users).values({
    email: "fcm-owner@test.com",
    name: "FcmOwner",
    passwordHash: "x",
    emailVerified: true,
  }).returning();
  const [other] = await db.insert(users).values({
    email: "fcm-other@test.com",
    name: "FcmOther",
    passwordHash: "x",
    emailVerified: true,
  }).returning();
  const [server] = await db.insert(servers).values({ name: "Fcm Push", slug: "fcm-push", ownerId: owner.id }).returning();
  await db.insert(serverMembers).values({ serverId: server.id, userId: owner.id, role: "owner" });
  const [channel] = await db.insert(channels).values({ serverId: server.id, name: "general", type: "channel" }).returning();
  const [message] = await db.insert(messages).values({
    channelId: channel.id,
    senderType: "user",
    senderId: other.id,
    content: "hello android",
    seq: 1,
  }).returning();
  const [family] = await db.insert(sessionFamilies).values({ userId: owner.id }).returning();
  await db.insert(sessions).values({
    userId: owner.id,
    familyId: family.id,
    tokenHash: `token-${family.id}`,
    expiresAt: new Date(Date.now() + 60_000),
  });
  await upsertPushRegistration({
    installationId: "ios-install",
    provider: "apns",
    userId: owner.id,
    serverId: server.id,
    sessionFamilyId: family.id,
    deviceToken: "apns-token",
    topic: "build.raft.app",
    env: "production",
  });
  const fcmRegistration = await upsertPushRegistration({
    installationId: "android-install",
    provider: "fcm",
    userId: owner.id,
    serverId: server.id,
    sessionFamilyId: family.id,
    deviceToken: FCM_TOKEN,
    topic: "build.raft.app",
    env: "production",
  });
  return { owner, server, channel, message, fcmRegistration };
}

async function recordMessage(fixture: Awaited<ReturnType<typeof seedFixture>>) {
  await recordInboxNotificationFacts([{
    receiverType: "user",
    receiverId: fixture.owner.id,
    serverId: fixture.server.id,
    kind: "channel",
    sourceChannelId: fixture.channel.id,
    messageId: fixture.message.id,
    messageSeq: fixture.message.seq,
    activityAt: fixture.message.createdAt,
  }]);
}

async function enableFcmGate() {
  await getDb().update(featureFlags).set({ defaultEnabled: true }).where(eq(featureFlags.key, MOBILE_PUSH_FCM_FEATURE_FLAG_KEY));
}

function captureProviders(fcmSend: (input: FcmDeliveryInput) => Promise<{ status: "sent" | "skipped" }>) {
  const apns: ApnsDeliveryInput[] = [];
  const fcm: FcmDeliveryInput[] = [];
  const scheduled: Promise<void>[] = [];
  __setApnsPushProviderForTests({
    async send(input) {
      apns.push(input);
      return { status: "sent" };
    },
  });
  __setFcmPushProviderForTests({
    async send(input) {
      fcm.push(input);
      return fcmSend(input);
    },
  });
  __setMobilePushDeliveryRuntimeForTests({
    schedule: (work) => scheduled.push(work()),
    sleep: async () => {},
    jitterMs: () => 1,
  });
  return { apns, fcm, scheduled };
}

function resetProviders() {
  __resetApnsPushProviderForTests();
  __resetFcmPushProviderForTests();
  __resetMobilePushDeliveryRuntimeForTests();
}

test("FCM gate is seeded off: Android registrations are not attempted while APNs still delivers", async ({ db }) => {
  const captured = captureProviders(async () => ({ status: "sent" }));
  try {
    const [seeded] = await getDb().select().from(featureFlags).where(eq(featureFlags.key, MOBILE_PUSH_FCM_FEATURE_FLAG_KEY));
    assert.equal(seeded?.defaultEnabled, false, "FCM must ship off by default");

    const fixture = await seedFixture();
    await recordMessage(fixture);
    await Promise.all(captured.scheduled.splice(0));

    assert.equal(captured.fcm.length, 0, "gate off: the FCM provider must never be called");
    assert.equal(captured.apns.length, 1, "the FCM gate must not affect APNs");
    const [outbox] = await getDb().select().from(mobilePushOutbox).where(eq(mobilePushOutbox.messageId, fixture.message.id));
    assert.equal(outbox?.status, "sent");
    assert.equal(outbox?.attemptedCount, 1, "gated FCM rows are not counted as attempts");
  } finally {
    resetProviders();
    await closeTestDatabase();
  }
});

test("FCM gate on with no legacy master row: Android gets a data message with the identity fields the client reads", async ({ db }) => {
  const captured = captureProviders(async () => ({ status: "sent" }));
  try {
    const fixture = await seedFixture();
    await getDb().delete(featureFlags).where(eq(featureFlags.key, "mobile_push_delivery_v0"));
    await enableFcmGate();
    await recordMessage(fixture);
    await Promise.all(captured.scheduled.splice(0));

    assert.equal(captured.apns.length, 1);
    assert.equal(captured.fcm.length, 1);
    const [delivery] = captured.fcm;
    assert.equal(delivery.deviceToken, FCM_TOKEN);
    assert.equal(delivery.registrationId, fixture.fcmRegistration.id);
    const { notificationKey, ...data } = delivery.message.data;
    assert.deepEqual(data, {
      serverId: fixture.server.id,
      channelId: fixture.channel.id,
      messageId: fixture.message.id,
      kind: "channel",
      category: "RAFT_MESSAGE",
      title: "#general · Fcm Push",
      body: "FcmOther: hello android",
      badge: "1",
    });
    assert.equal(notificationKey, delivery.message.collapseKey);
    for (const value of Object.values(delivery.message.data)) assert.equal(typeof value, "string");

    const [outbox] = await getDb().select().from(mobilePushOutbox).where(eq(mobilePushOutbox.messageId, fixture.message.id));
    assert.equal(outbox?.status, "sent");
    assert.equal(outbox?.sentCount, 2);
  } finally {
    resetProviders();
    await closeTestDatabase();
  }
});

test("FCM UNREGISTERED revokes only the Android registration", async ({ db }) => {
  const captured = captureProviders(async () => {
    throw new FcmDeliveryError("gone", { statusCode: 404, reason: "UNREGISTERED" });
  });
  try {
    const fixture = await seedFixture();
    await enableFcmGate();
    await recordMessage(fixture);
    await Promise.all(captured.scheduled.splice(0));

    assert.equal(captured.fcm.length, 1, "a terminal token error is not retried");
    const rows = await getDb().select().from(pushRegistrations);
    const android = rows.find((row) => row.provider === "fcm");
    const ios = rows.find((row) => row.provider === "apns");
    assert.ok(android?.revokedAt, "UNREGISTERED must revoke the FCM registration");
    assert.equal(android?.revokedReason, "UNREGISTERED");
    assert.equal(android?.userId, null);
    assert.equal(ios?.revokedAt, null, "the APNs registration is untouched");
  } finally {
    resetProviders();
    await closeTestDatabase();
  }
});

test("FCM INVALID_ARGUMENT drops the push without retrying or revoking", async ({ db }) => {
  const captured = captureProviders(async () => {
    throw new FcmDeliveryError("bad request", { statusCode: 400, reason: "INVALID_ARGUMENT" });
  });
  try {
    const fixture = await seedFixture();
    await enableFcmGate();
    await recordMessage(fixture);
    await Promise.all(captured.scheduled.splice(0));

    assert.equal(captured.fcm.length, 1);
    const [android] = await getDb().select().from(pushRegistrations).where(eq(pushRegistrations.provider, "fcm"));
    assert.equal(android?.revokedAt, null);
    const [outbox] = await getDb().select().from(mobilePushOutbox).where(eq(mobilePushOutbox.messageId, fixture.message.id));
    assert.equal(outbox?.droppedCount, 1);
    assert.equal(outbox?.sentCount, 1, "APNs still delivered");
  } finally {
    resetProviders();
    await closeTestDatabase();
  }
});

test("FCM transient failures retry within the shared bound", async ({ db }) => {
  let attempts = 0;
  const captured = captureProviders(async () => {
    attempts += 1;
    if (attempts < 3) throw new FcmDeliveryError("busy", { statusCode: 503, reason: "UNAVAILABLE" });
    return { status: "sent" };
  });
  try {
    const fixture = await seedFixture();
    await enableFcmGate();
    await recordMessage(fixture);
    await Promise.all(captured.scheduled.splice(0));

    assert.equal(attempts, 3);
    const [outbox] = await getDb().select().from(mobilePushOutbox).where(eq(mobilePushOutbox.messageId, fixture.message.id));
    assert.equal(outbox?.status, "sent");
    assert.equal(outbox?.sentCount, 2);
  } finally {
    resetProviders();
    await closeTestDatabase();
  }
});

test("configured FCM provider skips without credentials and never calls the network", async () => {
  let calls = 0;
  const provider = new ConfiguredFcmPushProvider(
    () => async () => {
      calls += 1;
      return { statusCode: 200, body: "{}" };
    },
    () => null,
  );
  const result = await provider.send({
    registrationId: "r",
    installationId: "i",
    deviceToken: FCM_TOKEN,
    message: { data: { serverId: "s" }, collapseKey: "c" },
  });
  assert.deepEqual(result, { status: "skipped", reason: "provider_not_configured" });
  assert.equal(calls, 0);
});

test("configured FCM provider sends an HTTP v1 data message and maps errors", async () => {
  const requests: Parameters<FcmHttpClient>[0][] = [];
  let nextResponse = { statusCode: 200, body: "{\"name\":\"projects/raft-mobile/messages/1\"}" };
  const provider = new ConfiguredFcmPushProvider(
    () => async (request) => {
      requests.push(request);
      return nextResponse;
    },
    () => ({ projectId: "raft-mobile", getAccessToken: async () => "access-token" }),
  );
  const input: FcmDeliveryInput = {
    registrationId: "r",
    installationId: "i",
    deviceToken: FCM_TOKEN,
    message: { data: { serverId: "s", title: "t" }, collapseKey: "collapse" },
  };

  assert.deepEqual(await provider.send(input), { status: "sent" });
  assert.equal(requests[0].url, "https://fcm.googleapis.com/v1/projects/raft-mobile/messages:send");
  assert.equal(requests[0].headers.authorization, "Bearer access-token");
  assert.deepEqual(JSON.parse(requests[0].body), {
    message: {
      fid: FCM_TOKEN,
      data: { serverId: "s", title: "t" },
      android: { priority: "HIGH", ttl: "3600s", collapse_key: "collapse" },
    },
  });

  nextResponse = {
    statusCode: 404,
    body: JSON.stringify({
      error: {
        code: 404,
        status: "NOT_FOUND",
        details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }],
      },
    }),
  };
  await assert.rejects(provider.send(input), (err: unknown) => {
    assert.ok(err instanceof FcmDeliveryError);
    assert.equal(err.statusCode, 404);
    assert.equal(err.reason, "UNREGISTERED");
    return true;
  });
});

test("FCM error reason prefers the FCM errorCode over the RPC status", () => {
  assert.equal(parseFcmErrorReason(JSON.stringify({ error: { status: "INVALID_ARGUMENT" } })), "INVALID_ARGUMENT");
  assert.equal(parseFcmErrorReason(JSON.stringify({
    error: { status: "PERMISSION_DENIED", details: [{ errorCode: "SENDER_ID_MISMATCH" }] },
  })), "SENDER_ID_MISMATCH");
  assert.equal(parseFcmErrorReason("not json"), undefined);
  assert.equal(parseFcmErrorReason(""), undefined);
});

test("production refuses a service account key and accepts only a federation config", async () => {
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    credentials: process.env.FCM_CREDENTIALS_JSON,
    projectId: process.env.FCM_PROJECT_ID,
  };
  try {
    __resetFcmTransportForTests();
    process.env.NODE_ENV = "production";
    process.env.FCM_PROJECT_ID = "raft-mobile";
    process.env.FCM_CREDENTIALS_JSON = JSON.stringify({ type: "service_account", project_id: "raft-mobile" });
    assert.equal(fcmAccessTokenSourceFromEnv(), null, "a key JSON must not become the production credential");

    process.env.FCM_CREDENTIALS_JSON = JSON.stringify({
      type: "external_account",
      audience: "//iam.googleapis.com/projects/1/locations/global/workloadIdentityPools/p/providers/aws",
      subject_token_type: "urn:ietf:params:aws:token-type:aws4_request",
      token_url: "https://sts.googleapis.com/v1/token",
      credential_source: { environment_id: "aws1" },
    });
    assert.equal(fcmAccessTokenSourceFromEnv()?.projectId, "raft-mobile");
  } finally {
    for (const [name, value] of [
      ["NODE_ENV", previous.nodeEnv],
      ["FCM_CREDENTIALS_JSON", previous.credentials],
      ["FCM_PROJECT_ID", previous.projectId],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    __resetFcmTransportForTests();
  }
});

test("a post-commit kick drain is traced, and a dropped FCM delivery names its reason and HTTP status", async ({ db }) => {
  const sink = new MemoryTraceSink();
  const tracer = new BasicTracer({ sink });
  const captured = captureProviders(async () => {
    throw new FcmDeliveryError("bad request", { statusCode: 400, reason: "INVALID_ARGUMENT" });
  });
  const worker = startMobilePushOutboxWorker({
    tracer,
    clock: { scheduleEvery: () => Symbol("timer"), clearInterval() {} },
  });
  try {
    const fixture = await seedFixture();
    await enableFcmGate();
    await recordMessage(fixture);
    await Promise.all(captured.scheduled.splice(0));

    const kick = sink.getAllSpans().find((span) => span.attrs?.trigger === "post_commit_kick");
    assert.ok(kick, "the post-commit kick drain must open its own drain span");
    assert.equal(kick?.name, "server.push.mobile_outbox.drain");
    assert.equal(kick?.attrs?.claimed_count, 1);
    const drop = kick?.events.find((event) => event.name === "push.mobile.delivery.drop");
    assert.equal(drop?.attrs?.provider, "fcm");
    assert.equal(drop?.attrs?.reason, "INVALID_ARGUMENT");
    assert.equal(drop?.attrs?.http_status, 400);

    const [outbox] = await getDb().select().from(mobilePushOutbox).where(eq(mobilePushOutbox.messageId, fixture.message.id));
    assert.equal(outbox?.lastError, "fcm dropped: INVALID_ARGUMENT http=400");
  } finally {
    worker.stop();
    resetProviders();
    await closeTestDatabase();
  }
});

test("a failed credential exchange is classified without its message text", async () => {
  const exchangeError = Object.assign(new Error("caller arn:aws:sts::1:assumed-role/x is not allowed"), {
    response: { status: 400, data: { error: "invalid_grant", error_description: "secretish detail" } },
  });
  let fcmCalls = 0;
  const provider = new ConfiguredFcmPushProvider(
    () => async () => {
      fcmCalls += 1;
      return { statusCode: 200, body: "{}" };
    },
    () => ({ projectId: "raft-mobile", getAccessToken: async () => { throw exchangeError; } }),
  );
  await assert.rejects(provider.send({
    registrationId: "r",
    installationId: "i",
    deviceToken: FCM_TOKEN,
    message: { data: {}, collapseKey: "c" },
  }), (err: unknown) => {
    assert.ok(err instanceof FcmDeliveryError);
    assert.equal(err.reason, "credential_exchange_failed:invalid_grant");
    assert.equal(err.statusCode, 400);
    assert.doesNotMatch(String(err.reason), /arn:|secretish/);
    assert.equal(isTerminalFcmTokenError(new FcmDeliveryError("x", { statusCode: 404, reason: "credential_exchange_failed:not_found" })), false,
      "a token-exchange 404 must never revoke the device registration");
    return true;
  });
  assert.equal(fcmCalls, 0, "FCM is not called without a token");
});
