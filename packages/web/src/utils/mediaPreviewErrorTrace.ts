/**
 * slock.media_preview.error — why an inline media preview (video today) failed
 * to load, and what the card did about it.
 *
 * Bug-triage task #14: the inline video card used to show "this video may use
 * a codec this browser cannot preview" for every failure. The usual cause was
 * the 5-minute presigned link expiring, which Chrome reports with the same
 * MediaError code as a real codec problem. PR #9554 refreshes the link before
 * trusting the code; this event shows which failures still reach users, per
 * browser, so the remaining "codec" warnings can be checked against reality.
 *
 * Fields (closed sets, agreed with @AndyLok in #proj-o11y):
 *   media_kind        video / audio
 *   error_code        MediaError code by name, or url_request_failed when the
 *                     /attachments/:id/url request itself failed
 *   error_class       the browser's error message, classified locally
 *   url_refreshed     whether the link had already been refreshed once
 *   url_age_bucket    how long ago the failing link was issued
 *   outcome           what the card did: refresh the link, or show a state
 *   browser_family    coarse UA bucket (shared with the auth boot trace)
 *   suppressed_count  events swallowed by throttling since the last report
 *
 * Deliberately NOT recorded: the raw error message, attachment id, filename,
 * URL. Consumer: @AndyLok's daily report (error_class × browser_family ×
 * url_refreshed); registered in packages/shared traceFamilyRegistry.
 */

import { authBootBrowserBucketFromUserAgent, emitWebEvent } from "./webAuthTrace";
import type { MediaPreviewErrorTraceEventName } from "./webAuthTrace";

const MEDIA_PREVIEW_ERROR: MediaPreviewErrorTraceEventName = "slock.media_preview.error";

type MediaPreviewErrorEmitter = (
  name: MediaPreviewErrorTraceEventName,
  attrs: Record<string, unknown>,
) => void;

let emitter: MediaPreviewErrorEmitter = emitWebEvent;

/** Test seam: observe emissions without coupling to the trace pipeline. */
export function __setMediaPreviewErrorEmitterForTest(next: MediaPreviewErrorEmitter | null): void {
  emitter = next ?? emitWebEvent;
}

export type MediaPreviewErrorCode =
  | "aborted"
  | "network"
  | "decode"
  | "src_not_supported"
  | "unknown"
  | "url_request_failed";

export type MediaPreviewErrorClass =
  | "chrome_fetch_failure"  // Chrome's bare message for a failed (403/404) media request
  | "demuxer"               // Chrome "PipelineStatus::DEMUXER_ERROR_*": container/codec unsupported
  | "decoder"               // a decoder failure message
  | "empty"                 // no message (also used for url_request_failed)
  | "other";

export type MediaPreviewOutcome = "refreshing" | "shown_unavailable" | "shown_unsupported";

export type MediaPreviewUrlAgeBucket = "<1m" | "1-5m" | "5-60m" | ">60m" | "unknown";

// Chrome gives a failed media request (403/404) MEDIA_ERR_SRC_NOT_SUPPORTED with
// this bare message, while a real codec/container problem says
// "PipelineStatus::DEMUXER_...". Chrome-only: Safari and Firefox word their
// messages differently, so there a failed request after a refresh still falls
// through to the codec warning.
const CHROME_MEDIA_FETCH_FAILURE_MESSAGE = "MEDIA_ELEMENT_ERROR: Format error";

export function classifyMediaErrorMessage(message: string | null | undefined): MediaPreviewErrorClass {
  if (!message) return "empty";
  if (message === CHROME_MEDIA_FETCH_FAILURE_MESSAGE) return "chrome_fetch_failure";
  if (/DEMUXER_ERROR/.test(message)) return "demuxer";
  if (/decod/i.test(message)) return "decoder";
  return "other";
}

export function mediaErrorCodeName(code: number | null | undefined): MediaPreviewErrorCode {
  switch (code) {
    case 1: return "aborted";
    case 2: return "network";
    case 3: return "decode";
    case 4: return "src_not_supported";
    default: return "unknown";
  }
}

export function mediaUrlAgeBucket(issuedAtMs: number | null, nowMs: number = Date.now()): MediaPreviewUrlAgeBucket {
  if (!issuedAtMs) return "unknown";
  const ageMs = nowMs - issuedAtMs;
  if (ageMs < 0) return "unknown";
  if (ageMs < 60_000) return "<1m";
  if (ageMs <= 5 * 60_000) return "1-5m";
  // Inline media links are signed for an hour, but the real validity can be
  // shorter when the server signs with temporary credentials: errors in 5-60m
  // point there, >60m is the normal expiry.
  if (ageMs <= 60 * 60_000) return "5-60m";
  return ">60m";
}

const THROTTLE_WINDOW_MS = 60_000;
const MAX_REPORTS_PER_WINDOW = 3;

interface SignatureBucket {
  windowStartMs: number;
  reported: number;
  suppressed: number;
}

const bucketsBySignature = new Map<string, SignatureBucket>();

export function __resetMediaPreviewErrorThrottleForTest(): void {
  bucketsBySignature.clear();
}

function throttleDecision(signature: string, nowMs: number): { report: boolean; suppressedToCarry: number } {
  const bucket = bucketsBySignature.get(signature);
  if (!bucket || nowMs - bucket.windowStartMs >= THROTTLE_WINDOW_MS) {
    const carried = bucket?.suppressed ?? 0;
    bucketsBySignature.set(signature, { windowStartMs: nowMs, reported: 1, suppressed: 0 });
    return { report: true, suppressedToCarry: carried };
  }
  if (bucket.reported < MAX_REPORTS_PER_WINDOW) {
    bucket.reported += 1;
    const carried = bucket.suppressed;
    bucket.suppressed = 0;
    return { report: true, suppressedToCarry: carried };
  }
  bucket.suppressed += 1;
  return { report: false, suppressedToCarry: 0 };
}

export type MediaPreviewKind = "video" | "audio";

export interface MediaPreviewErrorReport {
  mediaKind: MediaPreviewKind;
  errorCode: MediaPreviewErrorCode;
  errorClass: MediaPreviewErrorClass;
  urlRefreshed: boolean;
  urlIssuedAtMs: number | null;
  outcome: MediaPreviewOutcome;
}

export function reportMediaPreviewError(input: MediaPreviewErrorReport, nowMs: number = Date.now()): void {
  try {
    const signature = `${input.mediaKind}|${input.errorCode}|${input.errorClass}|${input.outcome}`;
    const { report, suppressedToCarry } = throttleDecision(signature, nowMs);
    if (!report) return;
    emitter(MEDIA_PREVIEW_ERROR, {
      media_kind: input.mediaKind,
      error_code: input.errorCode,
      error_class: input.errorClass,
      url_refreshed: input.urlRefreshed,
      url_age_bucket: mediaUrlAgeBucket(input.urlIssuedAtMs, nowMs),
      outcome: input.outcome,
      browser_family: authBootBrowserBucketFromUserAgent(typeof navigator === "undefined" ? null : navigator.userAgent),
      suppressed_count: suppressedToCarry,
    });
  } catch {
    // Telemetry must never break the preview.
  }
}
