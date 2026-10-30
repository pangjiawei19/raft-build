import { dbTest as test } from "../test/integration/dbTest";
import { closeTestDatabase, openTestDatabase } from "../test/integration/database";
import assert from "node:assert/strict";
import { getDb } from "../db/index";
import { users } from "../db/schema";
import { productFeedbackReporterId } from "./productFeedbackService";
import {
  ensureProductFeedbackRouteBinding,
  ProductFeedbackRouteBindingError,
  resetProductFeedbackRouteBindingCacheForTest,
} from "./productFeedbackRouteBindingService";


const APP_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "00000000-0000-4000-8000-000000000001";
const INTEGRATION_ID = "22222222-2222-4222-8222-222222222223";
const ROOT = Buffer.from("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", "hex").toString("base64url");
const REPORTER_SECRET = "reporter-id-secret-for-test";
const ENV = {
  HANDS_FEEDBACK_BASE_URL: "https://hands.example",
  HANDS_FEEDBACK_APP_ID: APP_ID,
  HANDS_FEEDBACK_CONVERSATION_APP_TOKEN: "conversation-token",
  HANDS_FEEDBACK_CONVERSATION_CREDENTIAL_REVISION: "revision-1",
  HANDS_FEEDBACK_REPORTER_INTEGRATION_ID: INTEGRATION_ID,
  HANDS_FEEDBACK_ROUTE_SUBJECT_KEY_ID: "v1",
  HANDS_FEEDBACK_ROUTE_SUBJECT_ROOT: ROOT,
  HANDS_FEEDBACK_REPORTER_ID_SECRET: REPORTER_SECRET,
} as NodeJS.ProcessEnv;

afterEach(async () => {
  resetProductFeedbackRouteBindingCacheForTest();
  await closeTestDatabase();
});

async function seed(): Promise<void> {
  await openTestDatabase("pglite://");
  await getDb().insert(users).values({
    id: USER_ID,
    email: "route-user@example.com",
    name: "route_user",
    passwordHash: "test",
    emailVerified: true,
  });
}

test("route binding pins the root, binds before upstream work, and caches only exact success", async () => {
  await seed();
  let calls = 0;
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    const sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.match(String(sent.route_subject), /^rfr_v1_/);
    assert.equal(new Headers(init?.headers).get("X-Hands-Reporter-Id"), productFeedbackReporterId(USER_ID, REPORTER_SECRET));
    return Response.json({ changed: true, subject_version: "v1" }, { status: 201 });
  };
  await ensureProductFeedbackRouteBinding({ userId: USER_ID, env: ENV, fetchImpl });
  await ensureProductFeedbackRouteBinding({ userId: USER_ID, env: ENV, fetchImpl });
  assert.equal(calls, 1);

  resetProductFeedbackRouteBindingCacheForTest();
  const swapped = { ...ENV, HANDS_FEEDBACK_ROUTE_SUBJECT_ROOT: Buffer.alloc(32, 9).toString("base64url") };
  await assert.rejects(
    ensureProductFeedbackRouteBinding({ userId: USER_ID, env: swapped, fetchImpl }),
    ProductFeedbackRouteBindingError,
  );
  assert.equal(calls, 1, "root swap must fail before Hands traffic");
});

test("route binding failures carry a fixed reason code for the operator log", async () => {
  await seed();
  const reasonOf = async (env: NodeJS.ProcessEnv, fetchImpl: typeof fetch): Promise<string> => {
    resetProductFeedbackRouteBindingCacheForTest();
    try {
      await ensureProductFeedbackRouteBinding({ userId: USER_ID, env, fetchImpl });
    } catch (error) {
      assert.ok(error instanceof ProductFeedbackRouteBindingError);
      return error.reason;
    }
    throw new Error("expected a route binding failure");
  };
  const ok = (async () => Response.json({ changed: true, subject_version: "v1" }, { status: 201 })) as typeof fetch;
  assert.equal(await reasonOf({ ...ENV, HANDS_FEEDBACK_APP_ID: "not-a-uuid" }, ok), "config_invalid");
  assert.equal(await reasonOf({ ...ENV, HANDS_FEEDBACK_ROUTE_SUBJECT_ROOT: "a".repeat(64) }, ok), "root_invalid");
  const rejected = (async () => new Response("no", { status: 403 })) as typeof fetch;
  assert.equal(await reasonOf(ENV, rejected), "hands_status_403");
  const odd = (async () => Response.json({ changed: true }, { status: 201 })) as typeof fetch;
  assert.equal(await reasonOf(ENV, odd), "hands_unexpected_body");
  await ensureProductFeedbackRouteBinding({ userId: USER_ID, env: ENV, fetchImpl: ok });
  const swapped = { ...ENV, HANDS_FEEDBACK_ROUTE_SUBJECT_ROOT: Buffer.alloc(32, 9).toString("base64url") };
  assert.equal(await reasonOf(swapped, ok), "root_commitment_mismatch");
});

// A fresh task (empty cache) right after a deploy: every active reporter binds at
// once, and Hands may be slow to connect (Eric, 2026-10-15: 5xx bursts per deploy).
test("concurrent first requests for one reporter share a single Hands call", async () => {
  await seed();
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const fetchImpl = (async () => {
    calls += 1;
    await gate;
    return Response.json({ changed: true, subject_version: "v1" }, { status: 201 });
  }) as typeof fetch;
  const binds = Array.from({ length: 5 }, () => ensureProductFeedbackRouteBinding({ userId: USER_ID, env: ENV, fetchImpl }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  release();
  await Promise.all(binds);
  assert.equal(calls, 1);
});

test("a transient Hands failure is retried once; a definite answer is not", async () => {
  await seed();
  const connectTimeout = Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } });
  const outcomes: Array<() => Response> = [];
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    const next = outcomes.shift();
    if (!next) throw connectTimeout;
    return next();
  }) as typeof fetch;
  const bind = () => ensureProductFeedbackRouteBinding({ userId: USER_ID, env: ENV, fetchImpl, retryDelayMs: 0 });
  const reasonOf = async (): Promise<string> => {
    try {
      await bind();
    } catch (error) {
      assert.ok(error instanceof ProductFeedbackRouteBindingError);
      return error.reason;
    }
    return "ok";
  };

  // Network error then success: one retry, bound.
  outcomes.push(() => { throw connectTimeout; }, () => Response.json({ changed: true, subject_version: "v1" }, { status: 201 }));
  assert.equal(await reasonOf(), "ok");
  assert.equal(calls, 2);

  // Network error twice: the low-level code reaches the operator log, not "request_failed".
  resetProductFeedbackRouteBindingCacheForTest();
  calls = 0;
  assert.equal(await reasonOf(), "network_UND_ERR_CONNECT_TIMEOUT");
  assert.equal(calls, 2);

  // 5xx is transient too.
  resetProductFeedbackRouteBindingCacheForTest();
  calls = 0;
  outcomes.push(() => new Response("busy", { status: 503 }), () => new Response("busy", { status: 503 }));
  assert.equal(await reasonOf(), "hands_status_503");
  assert.equal(calls, 2);

  // A 4xx is Hands' answer: no retry.
  resetProductFeedbackRouteBindingCacheForTest();
  calls = 0;
  outcomes.push(() => new Response("no", { status: 403 }));
  assert.equal(await reasonOf(), "hands_status_403");
  assert.equal(calls, 1);

  // A timeout (AbortSignal) is reported as such.
  resetProductFeedbackRouteBindingCacheForTest();
  calls = 0;
  const timeout = () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); };
  outcomes.push(timeout, timeout);
  assert.equal(await reasonOf(), "timeout");
  assert.equal(calls, 2);
});

test("the root commitment is checked once per process, and a database failure has its own reason", async () => {
  await seed();
  const ok = (async () => Response.json({ changed: true, subject_version: "v1" }, { status: 201 })) as typeof fetch;
  let dbCalls = 0;
  const realDb = getDb();
  const countingExecutor = new Proxy(realDb, {
    get(target, prop, receiver) {
      if (prop === "insert" || prop === "select") dbCalls += 1;
      return Reflect.get(target, prop, receiver);
    },
  });
  await ensureProductFeedbackRouteBinding({ userId: USER_ID, env: ENV, fetchImpl: ok, executor: countingExecutor });
  const afterFirst = dbCalls;
  assert.ok(afterFirst > 0);
  await ensureProductFeedbackRouteBinding({
    userId: USER_ID, reporterId: "another-reporter", env: ENV, fetchImpl: ok, executor: countingExecutor,
  });
  assert.equal(dbCalls, afterFirst, "a verified commitment is not re-read on later requests");

  resetProductFeedbackRouteBindingCacheForTest();
  const failingExecutor = new Proxy(realDb, {
    get(target, prop, receiver) {
      if (prop === "insert") return () => { throw new Error("connection terminated"); };
      return Reflect.get(target, prop, receiver);
    },
  });
  await assert.rejects(
    ensureProductFeedbackRouteBinding({ userId: USER_ID, env: ENV, fetchImpl: ok, executor: failingExecutor }),
    (error: unknown) => error instanceof ProductFeedbackRouteBindingError && error.reason === "commitment_failed",
  );
});
