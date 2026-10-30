import assert from "node:assert/strict";
import { ASK_FIRST_COUNTRIES, publicVisitorIdMode } from "./publicVisitorRegion";

const mode = (country: string | undefined, region?: string, gpc?: string) => publicVisitorIdMode({ country, region, gpc });

// cindyz, 2026-10-15: ask first where the law requires consent, on by default elsewhere.
test("asks first in the EEA, the UK, Switzerland, Brazil, South Korea, Saudi Arabia and mainland China", () => {
  for (const country of ["DE", "FR", "IE", "PL", "SE", "IS", "LI", "NO", "GB", "CH", "BR", "KR", "SA", "CN"]) {
    assert.equal(mode(country), "ask", country);
  }
  // EU territory with its own ISO code.
  for (const country of ["RE", "GP", "AX"]) assert.equal(mode(country), "ask", country);
  // All 27 EU members, 3 more EEA states, 7 EU territories, and 6 others.
  assert.equal(ASK_FIRST_COUNTRIES.size, 27 + 3 + 7 + 6);
});

test("is on by default elsewhere, including Hong Kong and Taiwan", () => {
  for (const country of ["US", "JP", "SG", "AU", "IN", "HK", "TW"]) assert.equal(mode(country), "default_on", country);
});

test("asks in Quebec, and in Canada when the province is unknown", () => {
  assert.equal(mode("CA", "QC"), "ask");
  assert.equal(mode("CA"), "ask");
  assert.equal(mode("CA", "not a province"), "ask");
  assert.equal(mode("CA", "ON"), "default_on");
  assert.equal(mode("CA", "BC"), "default_on");
});

test("asks when the country is missing or malformed", () => {
  for (const country of [undefined, "", "de", "XXX", "D1"]) assert.equal(mode(country), "ask", String(country));
});

// Tenny, 2026-10-15: Global Privacy Control keeps the id off where it would be on by default.
test("Global Privacy Control turns default-on into default-off, and asking stays asking", () => {
  assert.equal(mode("US", undefined, "1"), "default_off");
  assert.equal(mode("US", undefined, " 1 "), "default_off");
  assert.equal(mode("CA", "ON", "1"), "default_off");
  assert.equal(mode("US", undefined, "0"), "default_on");
  assert.equal(mode("DE", undefined, "1"), "ask");
  assert.equal(mode(undefined, undefined, "1"), "ask");
});
