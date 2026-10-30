// Where a public page must ask before keeping a visitor id (cindyz,
// 2026-10-15; list from the regions whose law requires opt-in consent for
// analytics cookies, to be confirmed by a lawyer). Everywhere else the id is on
// by default, with an opt-out in Cookie settings.
//
// The country comes from CloudFront (CloudFront-Viewer-Country, plus
// CloudFront-Viewer-Country-Region for Quebec). Anything we cannot place asks:
// a missing or malformed header, or a Canadian visitor without a province.
// Until the ALB bypass is closed (TRUST_CLOUDFRONT_VIEWER_HEADERS) a caller can
// forge these headers, but only to change what their own browser is asked.
//
// Global Privacy Control (`Sec-GPC: 1`, Tenny 2026-10-15; California requires
// honoring it) turns default-on into default-off. DNT is not honored unless a
// lawyer says so.
//
// For the lawyer: India, Turkey, Thailand, South Africa and Japan are
// default-on today; Tenny was unsure about each. The whole rule is this file.

import type { PublicVisitorIdMode } from "@botiverse/raft-shared";

const EU = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  // EU territory with its own ISO code: French overseas regions, Saint-Martin, Åland.
  "GF", "GP", "MQ", "RE", "YT", "MF", "AX",
];
const EEA_NOT_EU = ["IS", "LI", "NO"];

/** Countries where the visitor is asked first. Quebec is handled by province. */
export const ASK_FIRST_COUNTRIES: ReadonlySet<string> = new Set([
  ...EU,
  ...EEA_NOT_EU,
  "GB", // United Kingdom
  "CH", // Switzerland
  "BR", // Brazil
  "KR", // South Korea
  "SA", // Saudi Arabia
  "CN", // mainland China (Hong Kong, Macao and Taiwan have their own codes)
]);

const COUNTRY = /^[A-Z]{2}$/;
const PROVINCE = /^[A-Z0-9]{1,3}$/;

export function publicVisitorIdMode(headers: {
  country: string | undefined;
  region: string | undefined;
  /** The `Sec-GPC` request header. */
  gpc?: string | undefined;
}): PublicVisitorIdMode {
  const { country, region } = headers;
  if (!country || !COUNTRY.test(country)) return "ask";
  if (ASK_FIRST_COUNTRIES.has(country)) return "ask";
  if (country === "CA" && !(region && PROVINCE.test(region) && region !== "QC")) return "ask";
  return headers.gpc?.trim() === "1" ? "default_off" : "default_on";
}
