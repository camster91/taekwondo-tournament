export interface OfflineOperationLockManager {
  request<T>(
    name: string,
    options: { mode: 'exclusive'; ifAvailable: true },
    callback: (lock: { name: string } | null) => Promise<T | null>,
  ): Promise<T | null>;
}

export async function runWithOfflineOperationLock<T>(
  locks: OfflineOperationLockManager | undefined,
  task: () => Promise<T>,
): Promise<T | null> {
  if (!locks) return task();
  return locks.request(
    'bowin-offline-operation-sync',
    { mode: 'exclusive', ifAvailable: true },
    async (lock) => lock ? task() : null,
  );
}
