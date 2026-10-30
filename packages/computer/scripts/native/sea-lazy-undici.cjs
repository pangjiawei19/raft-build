// Stands in for undici inside the SEA's cli.cjs. The agent CLI reaches undici
// only through a dynamic import (cli/src/proxy.ts), which esbuild turns into a
// lazy require of this module, so this runs on the first direct or proxied
// server request: the SEA loader then compiles undici from its own asset
// (seaEntries.mjs SEA_CLI_LAZY_ASSETS).
const load = globalThis[Symbol.for("raft.sea.loadLazyAsset")];
if (typeof load !== "function") throw new Error("raft-computer: the SEA loader did not install the lazy asset hook");
module.exports = load("undici");
