import { useCallback, useRef, useState } from "react";
import type { SyntheticEvent } from "react";
import api from "../api/client";
import {
  classifyMediaErrorMessage,
  mediaErrorCodeName,
  reportMediaPreviewError,
} from "../utils/mediaPreviewErrorTrace";
import type { MediaPreviewKind } from "../utils/mediaPreviewErrorTrace";

// Inline media previews play from a presigned link (1 hour for inline
// video/audio, server-side). The browser keeps sending range requests to it
// for as long as the page is open, so an expired link surfaces as a media
// error. Chrome even reports a 403 on first load as "format not supported", so
// the error code alone can't tell an expired link from a real codec problem.
// Refresh the link once before trusting the code; a link older than this is
// refreshed again on the next error.
const MEDIA_URL_REFRESH_AFTER_MS = 60_000;

export type InlineMediaFailure = "unsupported" | "unavailable";

type MediaEvent = SyntheticEvent<HTMLMediaElement>;

/**
 * Fetches the inline URL for a media attachment on demand and recovers from
 * media errors by fetching a fresh link and resuming at the same position
 * (and playing again if it was playing). Spread `mediaEvents` onto the
 * <video>/<audio> element; call `load` when the card becomes visible and
 * `abort` on unmount.
 */
export function useRefreshingMediaUrl({
  attachmentId,
  localPreviewUrl,
  disabled,
  mediaKind,
}: {
  attachmentId: string;
  localPreviewUrl: string | null | undefined;
  disabled: boolean;
  mediaKind: MediaPreviewKind;
}) {
  const requestRef = useRef<Promise<void> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const urlFetchedAtRef = useRef(0);
  const urlRefreshedRef = useRef(false);
  const playIntentRef = useRef(false);
  const resumeRef = useRef<{ time: number; play: boolean } | null>(null);
  const [fetchedUrl, setFetchedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<InlineMediaFailure | null>(null);
  const url = localPreviewUrl ?? fetchedUrl;

  const requestUrl = useCallback(() => {
    if (localPreviewUrl || disabled || requestRef.current) return;
    setLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const request = api.get(`/attachments/${attachmentId}/url?disposition=inline`, { signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        urlFetchedAtRef.current = Date.now();
        setFetchedUrl(data.url);
        setFailure(null);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.error(`Failed to load inline ${mediaKind} attachment URL:`, err);
        reportMediaPreviewError({
          mediaKind,
          errorCode: "url_request_failed",
          errorClass: "empty",
          urlRefreshed: urlRefreshedRef.current,
          urlIssuedAtMs: null,
          outcome: "shown_unavailable",
        });
        setFailure("unavailable");
      })
      .finally(() => {
        if (requestRef.current === request) {
          requestRef.current = null;
        }
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    requestRef.current = request;
  }, [attachmentId, disabled, localPreviewUrl, mediaKind]);

  // Read through a ref so `load` stays stable: callers wire it into an
  // IntersectionObserver effect, and re-running that effect when the link is
  // swapped would let its cleanup abort the refresh request in flight.
  const urlRef = useRef(url);
  urlRef.current = url;
  const load = useCallback(() => {
    if (!urlRef.current) requestUrl();
  }, [requestUrl]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Swap in a fresh link; onLoadedMetadata continues from `resumeRef`.
  const refresh = useCallback(() => {
    setFetchedUrl(null);
    setFailure(null);
    requestUrl();
  }, [requestUrl]);

  const onError = useCallback((event: MediaEvent) => {
    const media = event.currentTarget;
    const error = media.error;
    console.warn(`Inline ${mediaKind} attachment failed to load:`, {
      attachmentId,
      code: error?.code,
      message: error?.message,
    });
    resumeRef.current = { time: media.currentTime, play: playIntentRef.current };
    const errorCode = mediaErrorCodeName(error?.code);
    const errorClass = classifyMediaErrorMessage(error?.message);
    const urlIssuedAtMs = localPreviewUrl ? null : urlFetchedAtRef.current;
    const urlRefreshed = urlRefreshedRef.current;
    const canRefreshUrl = !localPreviewUrl
      && (!urlRefreshed || Date.now() - urlFetchedAtRef.current > MEDIA_URL_REFRESH_AFTER_MS);
    // A decode error, or a "source not supported" that isn't Chrome's message
    // for a failed request, is a real codec/container problem. The Chrome check
    // is Chrome-only (see classifyMediaErrorMessage): in Safari/Firefox a link
    // that still can't be fetched after the refresh counts as unsupported.
    const unsupported = errorCode === "decode"
      || (errorCode === "src_not_supported" && errorClass !== "chrome_fetch_failure");
    const outcome = canRefreshUrl ? "refreshing" : unsupported ? "shown_unsupported" : "shown_unavailable";
    reportMediaPreviewError({ mediaKind, errorCode, errorClass, urlRefreshed, urlIssuedAtMs, outcome });
    if (canRefreshUrl) {
      urlRefreshedRef.current = true;
      refresh();
      return;
    }
    setFailure(unsupported ? "unsupported" : "unavailable");
  }, [attachmentId, localPreviewUrl, mediaKind, refresh]);

  const onLoadedMetadata = useCallback((event: MediaEvent) => {
    const media = event.currentTarget;
    const resume = resumeRef.current;
    resumeRef.current = null;
    if (!resume) return;
    if (resume.time > 0) media.currentTime = resume.time;
    if (resume.play) void media.play()?.catch(() => {});
  }, []);

  const onPlay = useCallback(() => {
    playIntentRef.current = true;
  }, []);

  const onPause = useCallback(() => {
    playIntentRef.current = false;
  }, []);

  const retry = useCallback(() => {
    if (localPreviewUrl) {
      setFailure(null);
      return;
    }
    refresh();
  }, [localPreviewUrl, refresh]);

  return {
    url,
    loading,
    failure,
    load,
    abort,
    retry,
    mediaEvents: { onError, onLoadedMetadata, onPlay, onPause },
  };
}
