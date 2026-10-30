import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  KIMI_CODE_DEFAULT_OAUTH_KEY,
  kimiAuthFromProviderList,
  kimiOAuthKey,
  kimiStorageName,
  resolveKimiCodeAuth,
} from "./kimiAuth";

const DEFAULT_LIST = { providers: { "managed:kimi-code": { type: "kimi", baseUrl: "https://api.kimi.com/coding/v1", oauth: { key: "oauth/kimi-code", oauthHost: "https://auth.kimi.com", storage: "file" } } } };

test("task #1282: the default host pair maps to the client's default key; any other pair gets the oar digest suffix", () => {
  assert.equal(kimiOAuthKey("https://auth.kimi.com/", "https://api.kimi.com/coding/v1"), KIMI_CODE_DEFAULT_OAUTH_KEY);
  const custom = kimiOAuthKey("https://auth.example.test", "https://api.example.test/v1");
  assert.match(custom, /^oauth\/kimi-code-env-[0-9a-f]{16}$/);
  assert.equal(kimiStorageName(custom), custom.slice("oauth/".length));
  assert.throws(() => kimiStorageName("oauth/.hidden"));
});

test("task #1282: provider-list projection follows oar: env overrides win, configured non-default storage is 'other', paths hang off KIMI_CODE_HOME", () => {
  const home = "/tmp/kimi-home-fixture";
  const auth = kimiAuthFromProviderList(DEFAULT_LIST, { KIMI_CODE_HOME: home });
  assert.deepEqual(auth, {
    baseUrl: "https://api.kimi.com/coding/v1",
    oauthHost: "https://auth.kimi.com",
    storage: "file",
    storageName: "kimi-code",
    home,
    credentialPath: path.join(home, "credentials", "kimi-code.json"),
    lockTarget: path.join(home, "oauth", "kimi-code"),
  });
  const overridden = kimiAuthFromProviderList(DEFAULT_LIST, { KIMI_CODE_HOME: home, KIMI_CODE_OAUTH_HOST: "https://auth.example.test" });
  assert.match(overridden!.storageName, /^kimi-code-env-/);
  assert.equal(overridden!.oauthHost, "https://auth.example.test");
  const other = kimiAuthFromProviderList({ providers: { "managed:kimi-code": { type: "kimi", oauth: { key: "oauth/kimi-code", storage: "keyring" } } } }, { KIMI_CODE_HOME: home });
  assert.equal(other!.storage, "other");
  assert.equal(kimiAuthFromProviderList({ providers: {} }, {}), null);
  assert.equal(kimiAuthFromProviderList({ providers: { "managed:kimi-code": { type: "openai" } } }, {}), null);
});

test("task #1282: resolveKimiCodeAuth runs `<kimi> provider list --json` as a bounded child and projects its output", async () => {
  if (process.platform === "win32") return;
  const root = mkdtempSync(path.join(os.tmpdir(), "kimi-auth-"));
  try {
    const fake = path.join(root, "kimi");
    writeFileSync(fake, `#!/bin/sh\n[ "$1" = provider ] && [ "$2" = list ] && [ "$3" = --json ] || exit 2\ncat <<'JSON'\n${JSON.stringify(DEFAULT_LIST)}\nJSON\n`);
    chmodSync(fake, 0o755);
    const auth = await resolveKimiCodeAuth({ command: fake, env: { ...process.env, KIMI_CODE_HOME: root } });
    assert.equal(auth?.credentialPath, path.join(root, "credentials", "kimi-code.json"));
    assert.equal(auth?.lockTarget, path.join(root, "oauth", "kimi-code"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
