import assert from "node:assert/strict";

// Task #725: the server suppresses browser pushes only for sockets that say
// they are Raft Desktop. Desktop runs this same web bundle, so the socket must
// derive its client kind from the desktop preload global, not hardcode "web".

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() });
// Only the surface the imported modules touch at load; the desktop marker is
// toggled per test on this object, as the Electron preload sets it on window.
const fakeWindow: { raftDesktop?: unknown; addEventListener(): void; removeEventListener(): void } = {
  addEventListener() {},
  removeEventListener() {},
};
const hadWindow = "window" in globalThis;
if (!hadWindow) Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
const win = (globalThis as unknown as { window: typeof fakeWindow }).window;

const { getSocket, resetSocket } = await import("../src/api/socket");

afterEach(() => {
  resetSocket();
  delete win.raftDesktop;
});

afterAll(() => {
  if (!hadWindow) delete (globalThis as { window?: unknown }).window;
});

test("a browser tab connects as web", () => {
  assert.equal((getSocket().auth as { clientKind?: string }).clientKind, "web");
});

test("Raft Desktop connects as desktop", () => {
  win.raftDesktop = { isDesktop: true };
  assert.equal((getSocket().auth as { clientKind?: string }).clientKind, "desktop");
});

test("a page that only has some other raftDesktop shape still connects as web", () => {
  win.raftDesktop = { isDesktop: "yes" };
  assert.equal((getSocket().auth as { clientKind?: string }).clientKind, "web");
});
