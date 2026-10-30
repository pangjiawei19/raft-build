import assert from "node:assert/strict";
import {
  attachDesktopAttentionHandler,
  DESKTOP_ATTENTION_EVENT,
  DESKTOP_ATTENTION_MIN_INTERVAL_MS,
} from "./desktopAttentionEvents";
import type { SocketClientKind } from "./platformScope";

function fakeSocket() {
  const handlers = new Map<string, (payload: unknown) => void>();
  return {
    socket: { on: (event: string, handler: (payload: unknown) => void) => { handlers.set(event, handler); } } as never,
    fire: (payload: unknown) => handlers.get(DESKTOP_ATTENTION_EVENT)?.(payload),
    listens: () => handlers.has(DESKTOP_ATTENTION_EVENT),
  };
}

test("only a Raft Desktop socket can report attention", () => {
  for (const clientKind of ["web", "mobile", "cli"] as SocketClientKind[]) {
    const s = fakeSocket();
    const recorded: string[] = [];
    attachDesktopAttentionHandler(s.socket, { userId: "u1", clientKind }, { record: async (id) => { recorded.push(id); } });
    s.fire({ attended: true });
    assert.equal(s.listens(), false, `${clientKind} socket must not get the handler`);
    assert.deepEqual(recorded, [], `${clientKind} socket must not silence browser pushes`);
  }
});

test("desktop attention records the socket's own user, ignores anything but attended:true, and throttles", () => {
  const s = fakeSocket();
  const recorded: string[] = [];
  let now = 0;
  attachDesktopAttentionHandler(s.socket, { userId: "u1", clientKind: "desktop" }, {
    record: async (id) => { recorded.push(id); },
    clear: async () => {},
    now: () => now,
  });

  for (const bad of [undefined, null, "attended", { attended: false }, { attended: "true" }, { userId: "u2" }]) s.fire(bad);
  assert.deepEqual(recorded, []);

  s.fire({ attended: true, userId: "someone-else" });
  assert.deepEqual(recorded, ["u1"], "the payload cannot choose whose pushes are silenced");

  now = DESKTOP_ATTENTION_MIN_INTERVAL_MS - 1;
  s.fire({ attended: true });
  assert.deepEqual(recorded, ["u1"], "a faster repeat is dropped");

  now = DESKTOP_ATTENTION_MIN_INTERVAL_MS;
  s.fire({ attended: true });
  assert.deepEqual(recorded, ["u1", "u1"]);
});

test("a failed record never throws out of the socket handler", async () => {
  const s = fakeSocket();
  attachDesktopAttentionHandler(s.socket, { userId: "u1", clientKind: "desktop" }, {
    record: async () => { throw new Error("redis down"); },
  });
  assert.doesNotThrow(() => s.fire({ attended: true }));
  await new Promise((r) => setImmediate(r));
});

test("attended:false clears the socket's own user at once; the next attended:true records immediately", () => {
  const s = fakeSocket();
  const log: string[] = [];
  let now = 0;
  attachDesktopAttentionHandler(s.socket, { userId: "u1", clientKind: "desktop" }, {
    record: async (id) => { log.push(`record:${id}`); },
    clear: async (id) => { log.push(`clear:${id}`); },
    now: () => now,
  });

  s.fire({ attended: true });
  now = 1_000;
  s.fire({ attended: false, userId: "someone-else" });
  assert.deepEqual(log, ["record:u1", "clear:u1"], "an away report clears its own user, whatever the payload says");

  now = 2_000;
  s.fire({ attended: true });
  assert.deepEqual(log, ["record:u1", "clear:u1", "record:u1"], "coming back is not held by the 30 s throttle");

  now = 3_000;
  s.fire({ attended: false });
  assert.deepEqual(log.length, 3, "a faster repeated clear is dropped");
  now = 1_000 + DESKTOP_ATTENTION_MIN_INTERVAL_MS;
  s.fire({ attended: false });
  assert.deepEqual(log, ["record:u1", "clear:u1", "record:u1", "clear:u1"]);
});

test("a browser socket cannot clear anyone's desktop attention", () => {
  const s = fakeSocket();
  const cleared: string[] = [];
  attachDesktopAttentionHandler(s.socket, { userId: "u1", clientKind: "web" }, { clear: async (id) => { cleared.push(id); } });
  s.fire({ attended: false });
  assert.deepEqual(cleared, []);
});

test("a failed clear never throws out of the socket handler", async () => {
  const s = fakeSocket();
  attachDesktopAttentionHandler(s.socket, { userId: "u1", clientKind: "desktop" }, {
    clear: async () => { throw new Error("redis down"); },
  });
  assert.doesNotThrow(() => s.fire({ attended: false }));
  await new Promise((r) => setImmediate(r));
});
