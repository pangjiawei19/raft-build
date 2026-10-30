import { createApiTest } from "../test/integration/apiTest";
import assert from "node:assert/strict";
const test = createApiTest({ humanActivityMuteFlagDefaultEnabled: true, onboardingOpenerFlagDefaultEnabled: false });

import { isDesktopTarget, lookupDesktopAsset, lookupDesktopPlatforms, parseUpdateFeed } from "./desktopDownload";

// The real latest-mac.yml of desktop-beta v0.1.42, as electron-builder wrote it.
const MAC_FEED = `version: 0.1.42
files:
- url: Raft-Desktop-0.1.42-x64.zip
  sha512: 2FOw==
  size: 179049932
- url: Raft-Desktop-0.1.42-arm64.zip
  sha512: sAKC==
  size: 173576747
- url: Raft-Desktop-0.1.42-x64.dmg
  sha512: 6LE8==
  size: 167443598
- url: Raft-Desktop-0.1.42-arm64.dmg
  sha512: mcEM==
  size: 162809563
path: Raft-Desktop-0.1.42-x64.zip
sha512: 2FOw==
releaseDate: '2026-10-12T16:47:42.526Z'
minimumSystemVersion: 22.0.0
`;

// The real latest-linux.yml of v0.1.42 (indented list, as the release job writes it).
const LINUX_FEED = `version: 0.1.42
files:
  - url: Raft-Desktop-0.1.42-x86_64.AppImage
    sha512: Rp82==
    size: 137221139
    blockMapSize: 144423
  - url: Raft-Desktop-0.1.42-amd64.deb
    sha512: B+WQ==
    size: 117049482
path: Raft-Desktop-0.1.42-x86_64.AppImage
sha512: Rp82==
releaseDate: '2026-10-12T16:26:07.802Z'
`;

const BASE = "https://github.com/botiverse/desktop-beta/releases";

function feedFetch(feeds: Record<string, string>): { fetch: typeof fetch; requested: string[] } {
  const requested: string[] = [];
  const fake = (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    const name = url.split("/").pop() ?? "";
    const body = feeds[name];
    return body === undefined
      ? new Response("Not Found", { status: 404 })
      : new Response(body, { status: 200 });
  }) as typeof fetch;
  return { fetch: fake, requested };
}

test("parses the real electron-builder feeds: version plus every listed file", () => {
  assert.deepEqual(parseUpdateFeed(MAC_FEED), {
    version: "0.1.42",
    files: ["Raft-Desktop-0.1.42-x64.zip", "Raft-Desktop-0.1.42-arm64.zip", "Raft-Desktop-0.1.42-x64.dmg", "Raft-Desktop-0.1.42-arm64.dmg"],
  });
  assert.deepEqual(parseUpdateFeed(LINUX_FEED)?.files, ["Raft-Desktop-0.1.42-x86_64.AppImage", "Raft-Desktop-0.1.42-amd64.deb"]);
  // `path:` (the legacy single-file key) is not a list entry and must not be read as one.
  assert.equal(parseUpdateFeed(MAC_FEED)?.files.length, 4);
  assert.equal(parseUpdateFeed("files:\n- url: a.dmg\n"), null, "a feed without a version is no feed");
});

test("the version must be plain semver: it becomes a path segment of the redirect", () => {
  assert.equal(parseUpdateFeed("version: ../../../../evil/x/releases/download/v1\nfiles:\n- url: a-arm64.dmg\n"), null);
  assert.equal(parseUpdateFeed("version: 1.2.3?x=1\nfiles:\n"), null);
  assert.equal(parseUpdateFeed("version: 0.1.43-beta.1\nfiles:\n")?.version, "0.1.43-beta.1");
});

test("each target resolves to its installer from the Latest release's own feed", async () => {
  const { fetch, requested } = feedFetch({ "latest-mac.yml": MAC_FEED, "latest-linux.yml": LINUX_FEED });
  const expect = {
    mac: "Raft-Desktop-0.1.42-arm64.dmg",
    "mac-arm64": "Raft-Desktop-0.1.42-arm64.dmg",
    "mac-x64": "Raft-Desktop-0.1.42-x64.dmg",
    "linux-appimage": "Raft-Desktop-0.1.42-x86_64.AppImage",
    "linux-deb": "Raft-Desktop-0.1.42-amd64.deb",
  } as const;
  for (const [target, file] of Object.entries(expect)) {
    const result = await lookupDesktopAsset(target as keyof typeof expect, { fetch, releasesBase: BASE });
    assert.deepEqual(result, { outcome: "asset", url: `${BASE}/download/v0.1.42/${file}`, version: "0.1.42" }, target);
  }
  // Always the auto-update feed of the Latest release: never a pinned version.
  assert.ok(requested.every((url) => url.startsWith(`${BASE}/latest/download/latest-`)), requested.join("\n"));
});

test("a universal build wins for every Mac target once a release carries one", async () => {
  const feed = MAC_FEED.replace("files:\n", "files:\n- url: Raft-Desktop-0.1.42-universal.dmg\n  size: 1\n");
  const { fetch } = feedFetch({ "latest-mac.yml": feed });
  for (const target of ["mac", "mac-arm64", "mac-x64"] as const) {
    const result = await lookupDesktopAsset(target, { fetch, releasesBase: BASE });
    assert.equal(result.outcome === "asset" && result.url.endsWith("/Raft-Desktop-0.1.42-universal.dmg"), true, target);
  }
});

test("a platform that has not shipped (no feed) is no_build, not an error", async () => {
  const { fetch } = feedFetch({ "latest-mac.yml": MAC_FEED });
  assert.deepEqual(await lookupDesktopAsset("windows", { fetch, releasesBase: BASE }), { outcome: "no_build" });
});

test("a feed that lists no installer for the target is no_build, never another file", async () => {
  // e.g. a Mac feed with only the update zips: a .zip is not what a download button promises.
  const zipsOnly = MAC_FEED.replace(/- url: [^\n]*\.dmg\n(  [^\n]*\n)*/g, "");
  assert.equal(parseUpdateFeed(zipsOnly)?.files.some((f) => f.endsWith(".dmg")), false);
  const { fetch } = feedFetch({ "latest-mac.yml": zipsOnly });
  assert.deepEqual(await lookupDesktopAsset("mac", { fetch, releasesBase: BASE }), { outcome: "no_build" });
});

test("upstream failures are errors, distinct from a missing build", async () => {
  const failing = (async () => new Response("boom", { status: 500 })) as typeof fetch;
  assert.equal((await lookupDesktopAsset("mac", { fetch: failing, releasesBase: BASE })).outcome, "upstream_error");
  const throwing = (async () => { throw new Error("offline"); }) as typeof fetch;
  assert.equal((await lookupDesktopAsset("mac", { fetch: throwing, releasesBase: BASE })).outcome, "upstream_error");
});

test("only known targets are accepted", () => {
  assert.equal(isDesktopTarget("mac"), true);
  assert.equal(isDesktopTarget("windows"), true);
  assert.equal(isDesktopTarget("toString"), false, "no prototype keys");
  assert.equal(isDesktopTarget(undefined), false);
});

test("mount: public, and a known target 302s to the release asset", async ({ app }) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = feedFetch({ "latest-mac.yml": MAC_FEED }).fetch;
  try {
    const response = await originalFetch(`${app.baseUrl}/api/desktop-download?target=mac-x64`, { redirect: "manual" });
    assert.equal(response.status, 302, "mounted and reachable without a session");
    assert.equal(response.headers.get("location"), `${BASE}/download/v0.1.42/Raft-Desktop-0.1.42-x64.dmg`);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

test("route: no target goes to the chooser; the UA is never used to guess", async ({ app }) => {
  // An iPad sends a Mac UA. Guessing from it would hand an iPad a .dmg.
  const iPadOS = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
  try {
    const response = await fetch(`${app.baseUrl}/api/desktop-download`, { redirect: "manual", headers: { "user-agent": iPadOS } });
    assert.equal(response.status, 302);
    assert.match(response.headers.get("location") ?? "", /\/download$/);
  } finally {
    await app.close();
  }
});

test("route: no build or GitHub down → the Latest release page, never a dead JSON page", async ({ app }) => {
  const originalFetch = globalThis.fetch;
  try {
    for (const fake of [feedFetch({}).fetch, (async () => new Response("boom", { status: 500 })) as typeof fetch]) {
      globalThis.fetch = fake;
      const response = await originalFetch(`${app.baseUrl}/api/desktop-download?target=windows`, { redirect: "manual" });
      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), `${BASE}/latest`);
    }
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

test("platforms: what the Latest release offers, so shipping a platform needs no web edit", async () => {
  const { fetch } = feedFetch({ "latest-mac.yml": MAC_FEED, "latest-linux.yml": LINUX_FEED });
  assert.deepEqual(await lookupDesktopPlatforms({ fetch, releasesBase: BASE }), {
    mac: { status: "available", version: "0.1.42", universal: false },
    linux: { status: "available", version: "0.1.42" },
    windows: { status: "none" },
  });
  const withWindows = feedFetch({
    "latest-mac.yml": MAC_FEED.replace("files:\n", "files:\n- url: Raft-Desktop-0.1.42-universal.dmg\n"),
    "latest-linux.yml": LINUX_FEED,
    "latest.yml": "version: 0.1.42\nfiles:\n  - url: Raft-Desktop-0.1.42-x64.exe\n    size: 1\n",
  });
  const platforms = await lookupDesktopPlatforms({ fetch: withWindows.fetch, releasesBase: BASE });
  assert.equal(platforms.mac.universal, true);
  assert.deepEqual(platforms.windows, { status: "available", version: "0.1.42" });
});

test("platforms: GitHub not answering is unknown, not none (the web keeps its defaults)", async () => {
  const failing = (async () => new Response("boom", { status: 503 })) as typeof fetch;
  assert.deepEqual(await lookupDesktopPlatforms({ fetch: failing, releasesBase: BASE }), {
    mac: { status: "unknown" }, linux: { status: "unknown" }, windows: { status: "unknown" },
  });
});

test("feeds are reused for a minute, failures for ten seconds", async () => {
  const cache = new Map();
  let now = 0;
  const { fetch, requested } = feedFetch({ "latest-mac.yml": MAC_FEED });
  await lookupDesktopAsset("mac", { fetch, releasesBase: BASE, cache, now: () => now });
  await lookupDesktopAsset("mac-x64", { fetch, releasesBase: BASE, cache, now: () => now });
  assert.equal(requested.length, 1, "second click within the minute reuses the feed");
  now = 61_000;
  await lookupDesktopAsset("mac", { fetch, releasesBase: BASE, cache, now: () => now });
  assert.equal(requested.length, 2, "then it is read again");
  let calls = 0;
  const flaky = (async () => { calls += 1; return new Response("boom", { status: 500 }); }) as typeof fetch;
  await lookupDesktopAsset("linux-deb", { fetch: flaky, releasesBase: BASE, cache, now: () => now });
  await lookupDesktopAsset("linux-deb", { fetch: flaky, releasesBase: BASE, cache, now: () => now });
  assert.equal(calls, 1, "while GitHub is down, a failure is not re-awaited on every click");
  now += 11_000;
  await lookupDesktopAsset("linux-deb", { fetch: flaky, releasesBase: BASE, cache, now: () => now });
  assert.equal(calls, 2, "and is retried after ten seconds");
});

test("mount: the platforms endpoint is public JSON", async ({ app }) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = feedFetch({ "latest-mac.yml": MAC_FEED }).fetch;
  try {
    const response = await originalFetch(`${app.baseUrl}/api/desktop-download/platforms`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.mac.status, "available");
    assert.equal(body.windows.status, "none");
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});
