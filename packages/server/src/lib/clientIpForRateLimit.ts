import { isIP } from "node:net";
import type { Request } from "express";

// Production traffic is CloudFront -> ALB -> task, and the app trusts one proxy
// hop (`trust proxy 1`), so `req.ip` is the CloudFront edge address, not the
// visitor: every unauthenticated rate-limit bucket keyed on it is shared by
// everyone behind the same edge. CloudFront forwards the visitor address in
// `CloudFront-Viewer-Address` (and appends it to X-Forwarded-For), but those
// headers are only trustworthy when the ALB can be reached exclusively through
// CloudFront. Until that is enforced at the ALB, a direct caller can forge them.
//
// So the visitor address is only used when TRUST_CLOUDFRONT_VIEWER_HEADERS is
// explicitly "true", set by hand after the direct path is closed. It is never
// inferred: if the ALB is ever reopened, the flag does not flip back by itself,
// so turn it off together with any such change.
//
// For rate-limit keys only: the result is not persisted or traced. Stored IP
// fields keep using `req.ip` (collecting real visitor IPs is a separate decision).
export const TRUST_CLOUDFRONT_VIEWER_HEADERS_ENV = "TRUST_CLOUDFRONT_VIEWER_HEADERS";

type ClientIpRequest = Pick<Request, "ip"> & { headers?: Request["headers"] };

export function isTrustingCloudFrontViewerHeaders(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[TRUST_CLOUDFRONT_VIEWER_HEADERS_ENV]?.trim() === "true";
}

/** `CloudFront-Viewer-Address` is `<ip>:<port>`; IPv6 is unbracketed, so the port follows the last colon. */
function viewerAddressIp(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const separator = value.trim().lastIndexOf(":");
  if (separator <= 0) return null;
  const ip = value.trim().slice(0, separator);
  return isIP(ip) ? ip : null;
}

/**
 * X-Forwarded-For as the ALB delivers it: `<client-supplied...>, <viewer>, <edge>`.
 * CloudFront keeps whatever the client sent and appends the viewer; the ALB
 * appends the CloudFront edge. The viewer is therefore second from the right;
 * anything further left is client-controlled.
 */
function forwardedForViewerIp(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header.join(",") : header;
  if (!value) return null;
  const hops = value.split(",").map((hop) => hop.trim()).filter(Boolean);
  if (hops.length < 2) return null;
  const ip = hops[hops.length - 2]!;
  return isIP(ip) ? ip : null;
}

export function clientIpForRateLimit(req: ClientIpRequest, env: NodeJS.ProcessEnv = process.env): string {
  const proxyIp = req.ip ?? "unknown";
  if (!isTrustingCloudFrontViewerHeaders(env)) return proxyIp;
  return viewerAddressIp(req.headers?.["cloudfront-viewer-address"])
    ?? forwardedForViewerIp(req.headers?.["x-forwarded-for"])
    ?? proxyIp;
}
