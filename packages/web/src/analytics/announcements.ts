/** Page-local deduplication belongs to the signed-in account, not a Server. */
const shownVersions = new Set<string>();
export function claimAnnouncementShown(id: string, version: number): boolean {
  const key = `${id}:${version}`;
  if (shownVersions.has(key)) return false;
  shownVersions.add(key);
  return true;
}
export function resetAnnouncementShown(): void { shownVersions.clear(); }
