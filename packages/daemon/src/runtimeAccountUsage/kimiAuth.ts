import { ambientProcessEnv } from "../processEnvPatch";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname, release } from "node:os";
import { basename, join } from "node:path";

import { runProbeChild } from "../drivers/probeChild";

/**
 * task #1282 — the Kimi Code client's credential, lock and OAuth locations,
 * resolved the way @botiverse/oar's kimi runtime resolves them (OAR does not
 * export its resolver): the client's `provider list --json` names the managed
 * provider; environment overrides win; a non-default host pair gets a digest
 * suffix on the storage name. Read from kimi-code 2.1.1 / 0.31.1
 * (`dist/main.mjs`, `packages/oauth`) and oar 0.56.0 (`runtimes/kimi/auth-config.js`).
 */

export const KIMI_CODE_MANAGED_PROVIDER = "managed:kimi-code";
export const KIMI_CODE_DEFAULT_BASE_URL = "https://api.kimi.com/coding/v1";
export const KIMI_CODE_DEFAULT_OAUTH_HOST = "https://auth.kimi.com";
export const KIMI_CODE_DEFAULT_OAUTH_KEY = "oauth/kimi-code";
/** The kimi-code OAuth client (kimi-code `KIMI_CODE_FLOW_CONFIG.clientId`). */
export const KIMI_CODE_OAUTH_CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";

export interface KimiCodeAuth {
  readonly baseUrl: string;
  readonly oauthHost: string;
  /** "file" when the client stores tokens in its credentials file; anything else is not readable by us. */
  readonly storage: "file" | "other";
  /** `kimi-code` by default, `kimi-code-env-<digest>` for a non-default host pair. */
  readonly storageName: string;
  /** `KIMI_CODE_HOME` or `~/.kimi-code`. */
  readonly home: string;
  readonly credentialPath: string;
  /** The sentinel the client locks with proper-lockfile; the lock directory is `<target>.lock`. */
  readonly lockTarget: string;
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizedEndpoint(value: string): string {
  return value.trim().replace(/\/+$/u, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function kimiOAuthKey(oauthHost: string, baseUrl: string): string {
  const host = normalizedEndpoint(oauthHost);
  const base = normalizedEndpoint(baseUrl);
  if (host === KIMI_CODE_DEFAULT_OAUTH_HOST && base === KIMI_CODE_DEFAULT_BASE_URL) return KIMI_CODE_DEFAULT_OAUTH_KEY;
  const digest = createHash("sha256").update(JSON.stringify({ oauthHost: host, baseUrl: base })).digest("hex").slice(0, 16);
  return `oauth/kimi-code-env-${digest}`;
}

export function kimiStorageName(key: string): string {
  const candidate = key.startsWith("oauth/") ? key.slice("oauth/".length) : key;
  if (candidate.length === 0 || candidate.startsWith(".") || basename(candidate) !== candidate) {
    throw new Error("Kimi returned an invalid OAuth credential key");
  }
  return candidate;
}

/** Pure projection of the client's `provider list --json` output plus the environment. */
export function kimiAuthFromProviderList(providerListJson: unknown, env: NodeJS.ProcessEnv): KimiCodeAuth | null {
  const root = isRecord(providerListJson) ? providerListJson : null;
  const providers = root && isRecord(root.providers) ? root.providers : null;
  const provider = providers && isRecord(providers[KIMI_CODE_MANAGED_PROVIDER]) ? providers[KIMI_CODE_MANAGED_PROVIDER] as Record<string, unknown> : null;
  if (provider === null || provider.type !== "kimi") return null;
  const configuredOAuth = isRecord(provider.oauth) ? provider.oauth : null;
  const envBaseUrl = text(env.KIMI_CODE_BASE_URL);
  const envOAuthHost = text(env.KIMI_CODE_OAUTH_HOST ?? env.KIMI_OAUTH_HOST);
  const hasEnvironmentOverride = envBaseUrl !== undefined || envOAuthHost !== undefined;
  const baseUrl = normalizedEndpoint(envBaseUrl ?? text(provider.baseUrl) ?? KIMI_CODE_DEFAULT_BASE_URL);
  const oauthHost = normalizedEndpoint(envOAuthHost ?? text(configuredOAuth?.oauthHost) ?? KIMI_CODE_DEFAULT_OAUTH_HOST);
  const expectedKey = kimiOAuthKey(oauthHost, baseUrl);
  const configuredKey = text(configuredOAuth?.key);
  const selectedKey = !hasEnvironmentOverride && configuredKey === expectedKey ? configuredKey : expectedKey;
  const configuredStorage = text(configuredOAuth?.storage);
  const storage: "file" | "other" = !hasEnvironmentOverride && configuredKey === expectedKey
    && configuredStorage !== undefined && configuredStorage !== "file"
    ? "other"
    : "file";
  const home = text(env.KIMI_CODE_HOME) ?? join(homedir(), ".kimi-code");
  const storageName = kimiStorageName(selectedKey);
  return {
    baseUrl,
    oauthHost,
    storage,
    storageName,
    home,
    credentialPath: join(home, "credentials", `${storageName}.json`),
    lockTarget: join(home, "oauth", storageName),
  };
}

export interface ResolveKimiAuthOptions {
  /** The kimi-code executable the probe found. */
  command: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  runProbeChildFn?: typeof runProbeChild;
  signal?: AbortSignal;
}

/** Runs `<kimi> provider list --json` as a bounded probe child and projects it; null when kimi names no managed provider. */
export async function resolveKimiCodeAuth(options: ResolveKimiAuthOptions): Promise<KimiCodeAuth | null> {
  const runChild = options.runProbeChildFn ?? runProbeChild;
  const env = options.env ?? ambientProcessEnv();
  const { stdout } = await runChild(options.command, ["provider", "list", "--json"], {
    env,
    timeoutMs: options.timeoutMs ?? 5000,
    stderr: "ignore",
    signal: options.signal,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  return kimiAuthFromProviderList(parsed, env);
}

/** The device headers the client sends; the platform names this daemon, never the client. */
export function kimiDeviceHeaders(home: string, options: { platform: string; version: string }): Record<string, string> {
  const ascii = (value: string, fallback = "unknown"): string => {
    const cleaned = value.replace(/[^\x20-\x7e]/g, "").trim();
    return cleaned.length > 0 ? cleaned : fallback;
  };
  return {
    "X-Msh-Platform": ascii(options.platform),
    "X-Msh-Version": ascii(options.version),
    "X-Msh-Device-Name": ascii(hostname()),
    "X-Msh-Device-Model": ascii(`${process.platform} ${process.arch}`),
    "X-Msh-Os-Version": ascii(release()),
    "X-Msh-Device-Id": readOrCreateKimiDeviceId(home),
  };
}

/** The client's `<home>/device_id`; created the way the client creates it when absent. */
export function readOrCreateKimiDeviceId(home: string): string {
  const file = join(home, "device_id");
  try {
    if (existsSync(file)) {
      const value = readFileSync(file, "utf8").trim();
      if (value.length > 0) return value;
    }
  } catch {
    // fall through to create
  }
  const id = randomUUID();
  try {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    writeFileSync(file, id, { encoding: "utf8", mode: 0o600 });
  } catch {
    // best effort, as the client does
  }
  return id;
}
