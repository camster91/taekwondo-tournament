export function purgeOfflineOwnerData(
  ownerId: string,
  venueSnapshots: { clearOwner(ownerId: string): void },
  offlineOperations: { removeOwner(ownerId: string): unknown },
): void {
  venueSnapshots.clearOwner(ownerId);
  try { offlineOperations.removeOwner(ownerId); } catch { /* best effort on logout */ }
}
