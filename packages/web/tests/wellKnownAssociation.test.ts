import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The association files that make "scan → open the app" possible.
 *
 * These are served from `_worker.js`, not from `public/.well-known/`, because
 * Cloudflare Pages drops dot-directories at upload. Measured before writing the
 * code: with the file present in `dist/.well-known/`, the deployed site still
 * answered `200 text/html` — the SPA shell — byte-identical to a nonexistent
 * path. **200, not 404**, so "the URL responds" proves nothing here.
 *
 * These tests therefore assert the WORKER owns the paths and the routing config
 * actually sends them there. A file sitting in `public/` would pass a naive
 * existence check and fail in production, silently.
 */

const routes = JSON.parse(
  readFileSync(fileURLToPath(new URL("../public/_routes.json", import.meta.url)), "utf8"),
);

test("the Worker is routed for /.well-known/*, or it never sees the request", () => {
  // Without this include, Pages serves the path from static assets — where the
  // files do not exist — and the SPA fallback answers instead.
  assert.ok(
    routes.include.includes("/.well-known/*"),
    `_routes.json must route /.well-known/* to the Worker: ${JSON.stringify(routes.include)}`,
  );
});

test("both association paths are answered before static assets are consulted", async () => {
  const { default: handler } = await import("../public/_worker");
  // If ASSETS were reached, we would get the SPA shell — so this stub throws to
  // prove the association paths never fall through.
  const env = {
    ASSETS: {
      fetch: () => {
        throw new Error("association paths must not reach static assets");
      },
    },
  };

  for (const [path, check] of [
    // Whole-body equality, not field spot-checks. An earlier version asserted
    // only that `sha256_cert_fingerprints` had length 2, which cannot tell a
    // correct fingerprint from a corrupted one: @Aiden mutated the last byte of
    // the rotated signer's cert and the suite stayed green. A wrong fingerprint
    // is exactly the failure that matters here — it makes devices on that signer
    // fail verification silently, with no error anywhere — so the assertion has
    // to be as precise as the property. Every byte an OS reads is compared.
    ["/.well-known/assetlinks.json", (body: unknown) => {
      assert.deepEqual(body, [
        {
          relation: ["delegate_permission/common.handle_all_urls"],
          target: {
            namespace: "android_app",
            package_name: "build.raft.app",
            sha256_cert_fingerprints: [
              // Legacy signer, then rotated signer. A device trusts exactly one
              // of these, so neither may drift or be dropped.
              "B4:91:93:81:D8:F9:CE:DE:4F:8E:B8:F6:D1:32:F6:DF:E0:D6:D1:5B:F6:D1:F6:30:57:D5:EB:A0:45:16:1A:45",
              "5F:08:BB:E8:2A:27:CC:DA:D2:6C:13:52:3A:60:B5:67:0D:3A:A7:63:3E:8E:D2:FD:71:FA:6B:57:51:F9:B0:B1",
            ],
          },
        },
      ]);
    }],
    ["/.well-known/apple-app-site-association", (body: unknown) => {
      // Pin the complete scope: keep download and add only channel/DM families.
      // A broad catch-all would divert unrelated website URLs to the app.
      assert.deepEqual(body, {
        applinks: {
          details: [
            {
              appIDs: ["XDAPXFY8FZ.build.raft.app"],
              components: [
                { "/": "/download", comment: "mobile download entry only" },
                { "/": "/s/*/channel/", exclude: true, comment: "no channel id" },
                { "/": "/s/*/*/channel/*", exclude: true, comment: "nested route, not a channel permalink" },
                { "/": "/s/*/channel/*/*", exclude: true, comment: "extra segment after the channel id" },
                { "/": "/s/*/dm/", exclude: true, comment: "no dm id" },
                { "/": "/s/*/*/dm/*", exclude: true, comment: "nested route, not a dm permalink" },
                { "/": "/s/*/dm/*/*", exclude: true, comment: "extra segment after the dm id" },
                {
                  "/": "/s/*/channel/*",
                  comment: "channel and reply permalinks; native validates identity and query anchors",
                },
                {
                  "/": "/s/*/dm/*",
                  comment: "direct-message permalinks; native validates identity and query anchors",
                },
              ],
            },
          ],
        },
      });
    }],
  ] as const) {
    const response = await handler.fetch(new Request(`https://app.raft.build${path}`), env);
    assert.equal(response.status, 200, `${path} must be 200`);
    // The load-bearing assertion: JSON, not the HTML the SPA would have served.
    assert.equal(
      response.headers.get("content-type"),
      "application/json",
      `${path} must be JSON — 200 + text/html is the silent failure mode`,
    );
    assert.equal(response.headers.get("location"), null, `${path} must not redirect`);
    check(await response.json());
  }
});

test("change-password redirects temporarily before static assets are consulted", async () => {
  const { default: handler } = await import("../public/_worker");
  const env = {
    ASSETS: {
      fetch: () => {
        throw new Error("change-password must not reach the SPA assets");
      },
    },
  };

  const response = await handler.fetch(
    new Request("https://app.raft.build/.well-known/change-password"),
    env,
  );
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://app.raft.build/change-password");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(await response.text(), "");
});

test("unknown well-known paths are real empty 404s instead of the SPA shell", async () => {
  const { default: handler } = await import("../public/_worker");
  let reachedAssets = 0;
  const env = {
    ASSETS: {
      fetch: () => {
        reachedAssets += 1;
        return new Response("<!doctype html>", { headers: { "content-type": "text/html" } });
      },
    },
  };

  for (const path of [
    "/.well-known/resource-that-should-not-exist-whose-status-code-should-not-be-200",
    "/.well-known/acme-challenge/xyz",
    "/.well-known",
  ]) {
    const response = await handler.fetch(new Request(`https://app.raft.build${path}`), env);
    assert.equal(response.status, 404, `${path} must be a real 404`);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(await response.text(), "");
  }
  assert.equal(reachedAssets, 0, "unknown well-known paths must not reach the SPA fallback");

  // And the two we do own must still not touch assets.
  await handler.fetch(new Request("https://app.raft.build/.well-known/assetlinks.json"), env);
  assert.equal(reachedAssets, 0, "our own paths must not fall through");
});

// This test models the path-only, case-sensitive '*' patterns used above, not
// Apple's device/CDN verification or the native identity/anchor parser.
// https://developer.apple.com/documentation/bundleresources/applinks/details-swift.dictionary/components-swift.dictionary
// '*' matches zero or more characters (including '/'); query/fragment are not
// constrained because these components specify neither '?' nor '#'.
test("AASA covers conversation and message links without claiming unrelated web routes", async () => {
  const { default: handler } = await import("../public/_worker");
  const response = await handler.fetch(
    new Request("https://app.raft.build/.well-known/apple-app-site-association"),
    { ASSETS: { fetch: () => { throw new Error("AASA must bypass assets"); } } },
  );
  const body = await response.json();
  const components = body.applinks.details[0].components as Array<Record<string, unknown>>;
  // The first matching component decides; an `exclude` match keeps the URL on web.
  const rules = components.map((component) => {
    const keys = Object.keys(component).sort();
    assert.ok(
      keys.join() === "/,comment" || keys.join() === "/,comment,exclude",
      `unexpected component keys ${keys.join()}`,
    );
    if ("exclude" in component) assert.equal(component.exclude, true);
    const pattern = component["/"] as string;
    return {
      exclude: component.exclude === true,
      regex: new RegExp(`^${pattern.split("*").map((part) =>
        part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      ).join(".*")}$`),
    };
  });
  const matches = (path: string) => {
    const pathname = new URL(path, "https://app.raft.build").pathname;
    const rule = rules.find(({ regex }) => regex.test(pathname));
    return rule !== undefined && !rule.exclude;
  };
  for (const path of [
    "/download",
    "/download?source=qr",
    "/s/qa-workspace/channel/channel-id",
    "/s/qa-workspace/channel/channel-id?thread=channel-id%3Aparent-id&msg=message-id",
    "/s/other-workspace/dm/dm-id",
    "/s/other-workspace/dm/dm-id?msg=message-id",
  ]) assert.equal(matches(path), true, `must associate ${path}`);
  for (const path of [
    "/", "/join", "/join/invite-token", "/download/extra", "/downloads",
    "/login", "/change-password", "/s/qa-workspace", "/s/qa-workspace/members",
    "/s/qa-workspace/settings", "/s/qa-workspace/channels/id",
    "/s/qa-workspace/Channel/id", "/s/qa-workspace/DM/id",
    "/channel/id", "/dm/id", "/other/s/qa-workspace/channel/id",
    "/?next=/s/qa-workspace/channel/id", "/#s/qa-workspace/dm/id",
    // `*` spans `/`, so these reach the include patterns unless excluded first;
    // the native parser accepts only `/s/<slug>/(channel|dm)/<id>`.
    "/s/qa-workspace/channel/", "/s/qa-workspace/dm/",
    "/s/qa-workspace/settings/channel/id", "/s/qa-workspace/settings/dm/id",
    "/s/qa-workspace/channel/id/extra", "/s/qa-workspace/dm/id/extra",
    "/s/qa-workspace/channel/id/", "/s/a/b/channel/id",
  ]) assert.equal(matches(path), false, `must stay on web ${path}`);
});
