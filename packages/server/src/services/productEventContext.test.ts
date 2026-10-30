import assert from "node:assert/strict";
import { productEventContext, resetProductEventContextForTest } from "./productEventContext";

const UA = {
  chromeWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  safariIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
  edgeMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
  samsungAndroid: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
  androidTablet: "Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
};

test("the request's browser, OS and device type are kept only as coarse families", () => {
  const cases: Array<[string, Record<string, string | number>]> = [
    [UA.chromeWindows, { $browser: "chrome", $browser_version: 141, $os: "windows", $device_type: "desktop" }],
    [UA.safariIphone, { $browser: "safari", $browser_version: 17, $os: "ios", $device_type: "mobile" }],
    [UA.firefoxLinux, { $browser: "firefox", $browser_version: 131, $os: "linux", $device_type: "desktop" }],
    [UA.edgeMac, { $browser: "edge", $browser_version: 141, $os: "macos", $device_type: "desktop" }],
    [UA.samsungAndroid, { $browser: "samsung_internet", $browser_version: 26, $os: "android", $device_type: "mobile" }],
    [UA.androidTablet, { $browser: "chrome", $browser_version: 141, $os: "android", $device_type: "tablet" }],
  ];
  for (const [userAgent, expected] of cases) {
    assert.deepEqual(productEventContext({ userAgent, country: undefined }), expected, userAgent);
  }
});

test("a missing or unknown user agent is `other`, never a piece of the raw string", () => {
  const other = { $browser: "other", $os: "other", $device_type: "other" };
  assert.deepEqual(productEventContext({ userAgent: undefined, country: undefined }), other);
  assert.deepEqual(productEventContext({ userAgent: "", country: undefined }), other);
  const odd = productEventContext({ userAgent: "curl/8.7.1 alice@example.com token-123", country: undefined });
  assert.equal(JSON.stringify(odd).includes("alice"), false);
  assert.equal(JSON.stringify(odd).includes("token"), false);
  assert.equal(odd.$browser, "other");
});

test("country is kept only as CloudFront's two-letter code", () => {
  assert.equal(productEventContext({ userAgent: undefined, country: "US" }).$country, "US");
  for (const bad of ["us", "USA", "U1", "", "XX-1"]) {
    assert.equal(productEventContext({ userAgent: undefined, country: bad }).$country, undefined, bad);
  }
  assert.equal(productEventContext({ userAgent: undefined, country: undefined }).$country, undefined);
});

test("whether the country header arrives is logged once per process, never its value", () => {
  resetProductEventContextForTest();
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    productEventContext({ userAgent: undefined, country: "JP" });
    productEventContext({ userAgent: undefined, country: "DE" });
    assert.equal(info.mock.calls.length, 1);
    assert.deepEqual(info.mock.calls[0], ["[product-events] CloudFront-Viewer-Country header present"]);
  } finally {
    info.mockRestore();
  }
});
