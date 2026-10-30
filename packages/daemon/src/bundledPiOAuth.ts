import type { Credential, CredentialStore } from "@earendil-works/pi-ai";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";

// Despite its SDK name, this is platform-neutral static registration: no Bun
// runtime is used. Pi's default lazy imports deliberately evade bundlers, so a
// Computer SEA cannot resolve them from its nonexistent SDK directory. Register
// the complete SDK flow set for both the Built-in and Pi runtime entry paths.
// The registry is module state: it only reaches pi-coding-agent when the daemon
// and pi-coding-agent resolve the same pi-ai copy (OAR #386).
registerBunOAuthFlows();

/** Offline artifact check: exercise the same lazy OAuth derivation as a stored login. */
export async function verifyBundledPiOAuth(): Promise<void> {
  const oauth = openaiCodexProvider().auth?.oauth;
  if (!oauth) throw new Error("Bundled OpenAI Codex provider has no OAuth flow");
  const access = "raft-bundle-check-not-a-credential";
  const auth = await oauth.toAuth({
    type: "oauth",
    access,
    refresh: "unused",
    expires: Number.MAX_SAFE_INTEGER,
  });
  if (auth.apiKey !== access) throw new Error("Bundled OAuth derivation returned an unexpected result");

  // Agent sessions derive OAuth through pi-coding-agent's own pi-ai import. A
  // second pi-ai copy there misses the registration above and looks for
  // github-copilot.js beside the bundle.
  const copilot: Credential = { type: "oauth", access, refresh: "unused", expires: Number.MAX_SAFE_INTEGER };
  const credentials: CredentialStore = {
    read: async (providerId) => (providerId === "github-copilot" ? copilot : undefined),
    list: async () => [{ providerId: "github-copilot", type: "oauth" }],
    modify: async (providerId) => (providerId === "github-copilot" ? copilot : undefined),
    delete: async () => {},
  };
  const runtime = await ModelRuntime.create({
    credentials,
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const sessionAuth = await new ModelRegistry(runtime).getProviderAuth("github-copilot");
  if (sessionAuth?.auth.apiKey !== access) {
    throw new Error("Bundled pi-coding-agent OAuth derivation returned an unexpected result");
  }
}
