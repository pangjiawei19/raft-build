import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createApiTest } from "../test/integration/apiTest";
import { seedThreadFixture } from "../routes/channels.api.fixtures";
import { __resetDesktopAttentionForTests, usersWithRecentDesktopAttention } from "../services/desktopAttention";

// Task #725 end to end over a real socket: a Raft Desktop connection reporting
// an attended window marks its own user as "on desktop"; the same report from a
// browser connection does nothing.

const requireWeb = createRequire(new URL("../../../web/package.json", import.meta.url));
const { io: clientIo } = requireWeb("socket.io-client");
const test = createApiTest({ humanActivityMuteFlagDefaultEnabled: true, onboardingOpenerFlagDefaultEnabled: false });
const waitEvent = (socket: any, event: string, timeoutMs = 4_000) => new Promise<any>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`no ${event}`)), timeoutMs);
  socket.once(event, (value: any) => { clearTimeout(timer); resolve(value); });
});

async function attendedWithin(userIds: string[], timeoutMs: number): Promise<Set<string>> {
  const deadline = Date.now() + timeoutMs;
  let seen = await usersWithRecentDesktopAttention(userIds);
  while (seen.size === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20));
    seen = await usersWithRecentDesktopAttention(userIds);
  }
  return seen;
}

test("a desktop socket's attention report marks its user; a browser socket's does not", async ({ app }) => {
  __resetDesktopAttentionForTests();
  const f = await seedThreadFixture(app.baseUrl);
  const browser = clientIo(app.baseUrl, { auth: { token: f.followerToken, serverId: f.serverId, clientKind: "web" }, transports: ["websocket"], autoConnect: false });
  const desktop = clientIo(app.baseUrl, { auth: { token: f.ownerToken, serverId: f.serverId, clientKind: "desktop" }, transports: ["websocket"], autoConnect: false });
  try {
    const browserReady = waitEvent(browser, "rooms:joined"); browser.connect(); await browserReady;
    const desktopReady = waitEvent(desktop, "rooms:joined"); desktop.connect(); await desktopReady;

    browser.emit("desktop:attention", { attended: true });
    desktop.emit("desktop:attention", { attended: true });

    assert.deepEqual([...await attendedWithin([f.ownerId, f.followerId], 2_000)], [f.ownerId]);
    // Give the browser report the same time to land; it must still be absent.
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual([...await usersWithRecentDesktopAttention([f.followerId])], []);
  } finally {
    browser.close();
    desktop.close();
    __resetDesktopAttentionForTests();
  }
});

test("a desktop socket's away report clears its user over a real connection", async ({ app }) => {
  __resetDesktopAttentionForTests();
  const f = await seedThreadFixture(app.baseUrl);
  const desktop = clientIo(app.baseUrl, { auth: { token: f.ownerToken, serverId: f.serverId, clientKind: "desktop" }, transports: ["websocket"], autoConnect: false });
  try {
    const ready = waitEvent(desktop, "rooms:joined"); desktop.connect(); await ready;
    desktop.emit("desktop:attention", { attended: true });
    assert.deepEqual([...await attendedWithin([f.ownerId], 2_000)], [f.ownerId]);

    desktop.emit("desktop:attention", { attended: false });
    const deadline = Date.now() + 2_000;
    let seen = await usersWithRecentDesktopAttention([f.ownerId]);
    while (seen.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
      seen = await usersWithRecentDesktopAttention([f.ownerId]);
    }
    assert.deepEqual([...seen], []);
  } finally {
    desktop.close();
    __resetDesktopAttentionForTests();
  }
});
