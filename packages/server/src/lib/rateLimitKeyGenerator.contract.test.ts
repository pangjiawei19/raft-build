import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// A rateLimit({...}) without keyGenerator falls back to express-rate-limit's
// default, which keys on req.ip: in production that is the CloudFront edge, so
// the bucket is shared by everyone behind it and clientIpForRateLimit (and its
// TRUST_CLOUDFRONT_VIEWER_HEADERS switch) never applies. Every limiter must say
// what it keys on.
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sourceFiles(path);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

/** The `{ ... }` options literal passed to each `rateLimit(` call. */
function rateLimitOptionBodies(source: string): Array<{ line: number; body: string }> {
  const bodies: Array<{ line: number; body: string }> = [];
  const call = /\brateLimit\(\s*\{/g;
  for (let match = call.exec(source); match; match = call.exec(source)) {
    let depth = 0;
    let end = match.index + match[0].length - 1;
    for (; end < source.length; end += 1) {
      if (source[end] === "{") depth += 1;
      else if (source[end] === "}" && --depth === 0) break;
    }
    bodies.push({ line: source.slice(0, match.index).split("\n").length, body: source.slice(match.index, end) });
  }
  return bodies;
}

test("every rateLimit({...}) declares its keyGenerator", () => {
  const missing = sourceFiles(SRC).flatMap((file) =>
    rateLimitOptionBodies(readFileSync(file, "utf8"))
      .filter(({ body }) => !/\bkeyGenerator\s*:/.test(body))
      .map(({ line }) => `${relative(SRC, file)}:${line}`),
  );
  assert.deepEqual(missing, [], "use keyGenerator: (req) => ipKeyGenerator(clientIpForRateLimit(req)) (or a user/machine-first key)");
});

test("no rateLimit({...}) keys on req.ip directly", () => {
  // `req.ip` is the CloudFront edge in production, so an explicit
  // `ipKeyGenerator(req.ip ...)` has the same shared-bucket problem as the
  // default and silently ignores TRUST_CLOUDFRONT_VIEWER_HEADERS.
  const direct = sourceFiles(SRC).flatMap((file) =>
    rateLimitOptionBodies(readFileSync(file, "utf8"))
      .filter(({ body }) => /\breq\.ip\b/.test(body))
      .map(({ line }) => `${relative(SRC, file)}:${line}`),
  );
  assert.deepEqual(direct, [], "key on clientIpForRateLimit(req), not req.ip");
});
