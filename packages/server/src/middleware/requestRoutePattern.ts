import type { Request } from "express";

declare global {
  namespace Express {
    interface Request {
      observedRoutePattern?: string;
    }
  }
}

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEXISH_ID_SEGMENT = /^(?:[0-9a-f]{8}|[0-9a-f]{16,64})$/i;
const NUMERIC_ID_SEGMENT = /^\d+$/;

function normalizePathSegment(segment: string): string {
  if (UUID_SEGMENT.test(segment)) return ":id";
  if (HEXISH_ID_SEGMENT.test(segment)) return ":id";
  if (NUMERIC_ID_SEGMENT.test(segment)) return ":id";
  return segment;
}

function normalizePathname(pathname: string): string {
  const normalized = pathname
    .split("/")
    .map((segment) => (segment ? normalizePathSegment(segment) : segment))
    .join("/");
  return normalized || "/";
}

function normalizeQueryPattern(url: URL): string {
  const queryKeys = [...new Set(url.searchParams.keys())].sort();
  if (queryKeys.length === 0) return "";
  return `?${queryKeys.map((key) => `${key}=*`).join("&")}`;
}

function normalizeRequestPathFromUrl(rawUrl: string, includeQuery: boolean): string {
  const url = new URL(rawUrl, "http://localhost");
  const query = includeQuery ? normalizeQueryPattern(url) : "";
  return `${normalizePathname(url.pathname)}${query}`;
}

interface RouteCarrier {
  route?: { path?: unknown };
  baseUrl?: string;
  originalUrl?: string;
  url?: string;
}

function trimTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

// `req.route` is not cleared when a request leaves the router that matched it.
// An app-level route that calls next() (e.g. the route-scoped body parsers in
// app.ts) leaves its `req.route` behind while the request walks into a mounted
// router, where `baseUrl` has already changed; `baseUrl + route.path` then
// names a path nobody requested (`/internal/internal/machine/...`, task #9).
// So a template is only trusted when it actually matches the request path.
// Wildcard/optional segments are trusted as before (no simple segment check).
function templateMatchesPath(template: string, pathname: string): boolean {
  if (/[*{}()?+]/.test(template)) return true;
  const want = trimTrailingSlash(template).toLowerCase().split("/");
  const got = trimTrailingSlash(pathname).toLowerCase().split("/");
  if (want.length !== got.length) return false;
  return want.every((segment, i) => (segment.includes(":") ? got[i] !== "" : segment === got[i]));
}

/**
 * The matched route template (`/api/channels/:id`) for this request, or null
 * when no route matched. A stale `req.route` left by an app-level route is
 * used on its own when it matches the full path, and dropped otherwise.
 */
export function matchedRouteTemplate(req: RouteCarrier): string | null {
  const routePath = typeof req.route?.path === "string" ? req.route.path : null;
  if (!routePath) return null;
  const rawUrl = req.originalUrl || req.url || "/";
  let pathname: string;
  try {
    pathname = new URL(rawUrl, "http://localhost").pathname;
  } catch {
    return null;
  }
  const scoped = `${req.baseUrl || ""}${routePath}`;
  if (templateMatchesPath(scoped, pathname)) return scoped;
  if (req.baseUrl && templateMatchesPath(routePath, pathname)) return routePath;
  return null;
}

export interface RequestRoutePatternOptions {
  includeQuery?: boolean;
  unmatchedLabel?: string;
}

export function normalizeRequestRoutePattern(
  req: Request,
  {
    includeQuery = false,
    unmatchedLabel = "unmatched",
  }: RequestRoutePatternOptions = {},
): string {
  const template = matchedRouteTemplate(req);
  if (template) {
    const query = includeQuery
      ? normalizeQueryPattern(new URL(req.originalUrl || req.url, "http://localhost"))
      : "";
    return `${template}${query}`;
  }
  if (req.observedRoutePattern) {
    const query = includeQuery
      ? normalizeQueryPattern(new URL(req.originalUrl || req.url, "http://localhost"))
      : "";
    return `${req.observedRoutePattern}${query}`;
  }
  if (!includeQuery) return unmatchedLabel;
  return normalizeRequestPathFromUrl(req.originalUrl || req.url, true);
}
