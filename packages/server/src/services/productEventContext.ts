// Where and on what a product event happened, derived on ingest from the
// request (cindyz, 2026-10-14; design reviewed by Tenny in #proj-analytics).
// Only coarse values are kept, as pipeline properties (`$` names are reserved
// for the pipeline): browser family and major version, OS family, device type,
// and the country CloudFront reports. The raw IP and User-Agent are never
// stored, logged or traced, and nothing here is taken from the client's own
// claims. Do not add finer fields (city, screen size, language, OS version):
// combined they start to fingerprint people (Tenny); discuss first.

import Bowser from "bowser";

export interface ProductEventContextHeaders {
  userAgent: string | undefined;
  /** `CloudFront-Viewer-Country`: ISO 3166-1 alpha-2, set by CloudFront. */
  country: string | undefined;
}

export type ProductEventContext = Readonly<Record<string, string | number>>;

const BROWSERS: Readonly<Record<string, string>> = {
  chrome: "chrome",
  chromium: "chrome",
  safari: "safari",
  firefox: "firefox",
  "microsoft edge": "edge",
  opera: "opera",
  "samsung internet for android": "samsung_internet",
};

const OPERATING_SYSTEMS: Readonly<Record<string, string>> = {
  windows: "windows",
  macos: "macos",
  ios: "ios",
  android: "android",
  linux: "linux",
  "chrome os": "chromeos",
};

const DEVICE_TYPES = new Set(["desktop", "mobile", "tablet"]);
const COUNTRY = /^[A-Z]{2}$/;

/** Unknown, empty or unparsable values become `other`; never a piece of the raw string. */
export function productEventContext(headers: ProductEventContextHeaders): ProductEventContext {
  let browser = "other";
  let browserVersion: number | null = null;
  let os = "other";
  let deviceType = "other";
  if (headers.userAgent) {
    try {
      const result = Bowser.getParser(headers.userAgent).getResult();
      browser = BROWSERS[result.browser.name?.toLowerCase() ?? ""] ?? "other";
      const major = Number.parseInt(result.browser.version ?? "", 10);
      if (browser !== "other" && Number.isInteger(major) && major > 0 && major < 1000) browserVersion = major;
      os = OPERATING_SYSTEMS[result.os.name?.toLowerCase() ?? ""] ?? "other";
      const platform = result.platform.type ?? "";
      deviceType = DEVICE_TYPES.has(platform) ? platform : "other";
    } catch {
      // Unparsable: every field stays `other`.
    }
  }
  const context: Record<string, string | number> = { $browser: browser, $os: os, $device_type: deviceType };
  if (browserVersion !== null) context.$browser_version = browserVersion;
  if (headers.country && COUNTRY.test(headers.country)) context.$country = headers.country;
  noteCountryHeader(headers.country !== undefined);
  return context;
}

let countryHeaderNoted = false;

// Once per process: whether CloudFront's country header reaches this server
// at all (Arkbriar verified prod's origin request policy; staging unchecked).
// Presence only, never the value.
function noteCountryHeader(present: boolean): void {
  if (countryHeaderNoted) return;
  countryHeaderNoted = true;
  console.info(`[product-events] CloudFront-Viewer-Country header ${present ? "present" : "absent"}`);
}

/** Test-only. */
export function resetProductEventContextForTest(): void {
  countryHeaderNoted = false;
}
