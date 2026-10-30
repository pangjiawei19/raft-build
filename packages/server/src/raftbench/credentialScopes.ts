/** A dedicated service credential has exactly the two capabilities it needs. */
export function hasExactRaftbenchServiceScopes(scopes: readonly string[]): boolean {
  return scopes.length === 2 && scopes.includes("read") && scopes.includes("raftbench");
}
