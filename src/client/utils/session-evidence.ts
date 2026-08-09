const SESSION_EVIDENCE_KEY = 'bowin.auth.hadSession.v1';

export interface SessionEvidenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): unknown;
  removeItem(key: string): unknown;
}

export function createSessionEvidenceStore(storage: SessionEvidenceStorage | null | undefined) {
  return {
    markAuthenticated(): void {
      try { storage?.setItem(SESSION_EVIDENCE_KEY, '1'); } catch { /* storage is optional presentation evidence */ }
    },
    clear(): void {
      try { storage?.removeItem(SESSION_EVIDENCE_KEY); } catch { /* storage is optional presentation evidence */ }
    },
    consumeExpiredSessionEvidence(): boolean {
      try {
        const existed = storage?.getItem(SESSION_EVIDENCE_KEY) === '1';
        if (existed) storage?.removeItem(SESSION_EVIDENCE_KEY);
        return existed;
      } catch {
        return false;
      }
    },
  };
}

export function browserSessionEvidence() {
  return createSessionEvidenceStore(typeof window === 'undefined' ? null : window.localStorage);
}
