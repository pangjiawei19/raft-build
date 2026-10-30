import assert from "node:assert/strict";
import {
  __resetMediaPreviewErrorThrottleForTest,
  __setMediaPreviewErrorEmitterForTest,
  classifyMediaErrorMessage,
  mediaErrorCodeName,
  mediaUrlAgeBucket,
  reportMediaPreviewError,
} from "../src/utils/mediaPreviewErrorTrace";

afterEach(() => {
  __setMediaPreviewErrorEmitterForTest(null);
  __resetMediaPreviewErrorThrottleForTest();
});

test("browser media error messages are classified without passing the text through", () => {
  assert.equal(classifyMediaErrorMessage("MEDIA_ELEMENT_ERROR: Format error"), "chrome_fetch_failure");
  assert.equal(classifyMediaErrorMessage("PipelineStatus::DEMUXER_ERROR_NO_SUPPORTED_STREAMS: FFmpegDemuxer: no supported streams"), "demuxer");
  assert.equal(classifyMediaErrorMessage("PipelineStatus::DEMUXER_ERROR_COULD_NOT_OPEN: FFmpegDemuxer: open context failed"), "demuxer");
  assert.equal(classifyMediaErrorMessage("PIPELINE_ERROR_DECODE: video decoder reinitialization failed"), "decoder");
  assert.equal(classifyMediaErrorMessage(""), "empty");
  assert.equal(classifyMediaErrorMessage(undefined), "empty");
  assert.equal(classifyMediaErrorMessage("https://cdn.example.test/x.mp4 failed"), "other");
});

test("media error codes are reported by name", () => {
  assert.deepEqual([1, 2, 3, 4, 0, undefined].map(mediaErrorCodeName), ["aborted", "network", "decode", "src_not_supported", "unknown", "unknown"]);
});

test("url age is bucketed around the 5-minute and 1-hour presigned TTLs", () => {
  const now = 10_000_000;
  assert.equal(mediaUrlAgeBucket(null, now), "unknown");
  assert.equal(mediaUrlAgeBucket(0, now), "unknown");
  assert.equal(mediaUrlAgeBucket(now - 30_000, now), "<1m");
  assert.equal(mediaUrlAgeBucket(now - 4 * 60_000, now), "1-5m");
  assert.equal(mediaUrlAgeBucket(now - 6 * 60_000, now), "5-60m");
  assert.equal(mediaUrlAgeBucket(now - 61 * 60_000, now), ">60m");
  assert.equal(mediaUrlAgeBucket(now + 1_000, now), "unknown");
});

test("reports carry only closed-set fields and are throttled per signature with a suppressed count", () => {
  const emitted: Array<{ name: string; attrs: Record<string, unknown> }> = [];
  __setMediaPreviewErrorEmitterForTest((name, attrs) => emitted.push({ name, attrs }));
  const now = 50_000_000;
  const report = {
    mediaKind: "video" as const,
    errorCode: "src_not_supported" as const,
    errorClass: "chrome_fetch_failure" as const,
    urlRefreshed: false,
    urlIssuedAtMs: now - 6 * 60_000,
    outcome: "refreshing" as const,
  };
  for (let i = 0; i < 5; i += 1) reportMediaPreviewError(report, now + i);
  assert.equal(emitted.length, 3);
  assert.equal(emitted[0].name, "slock.media_preview.error");
  assert.deepEqual(Object.keys(emitted[0].attrs).sort(), [
    "browser_family", "error_class", "error_code", "media_kind", "outcome", "suppressed_count", "url_age_bucket", "url_refreshed",
  ]);
  assert.equal(emitted[0].attrs.url_age_bucket, "5-60m");
  assert.equal(emitted[0].attrs.suppressed_count, 0);

  reportMediaPreviewError(report, now + 61_000);
  assert.equal(emitted.length, 4);
  assert.equal(emitted[3].attrs.suppressed_count, 2);
});
