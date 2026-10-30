// Stands in for @botiverse/kimi-code-sdk inside the SEA's computer.cjs. The
// daemon reaches the SDK only through a dynamic import, which esbuild turns
// into a lazy require of this module, so this runs on the first Kimi launch:
// the SEA loader then compiles the SDK from its own asset (seaEntries.mjs).
const load = globalThis[Symbol.for("raft.sea.loadLazyAsset")];
if (typeof load !== "function") throw new Error("raft-computer: the SEA loader did not install the lazy asset hook");
module.exports = load("@botiverse/kimi-code-sdk");
