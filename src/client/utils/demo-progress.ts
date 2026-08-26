export type DemoPath = 'director' | 'scorekeeper' | 'checkin' | 'parent' | 'display';
export type DemoProgressStatus = 'new' | 'dismissed' | 'started' | 'completed';

export interface DemoProgress {
  version: 1;
  status: DemoProgressStatus;
  lastPath?: DemoPath;
  updatedAt?: string;
}

const PROGRESS_KEY = 'bowin.demoGuide.v1.state';
const PENDING_KEY = 'bowin.demoGuide.v1.pending';
const DEFAULT_PROGRESS: DemoProgress = { version: 1, status: 'new' };
const statuses = new Set<DemoProgressStatus>(['new', 'dismissed', 'started', 'completed']);
const paths = new Set<DemoPath>(['director', 'scorekeeper', 'checkin', 'parent', 'display']);

export function isDemoUser(user: { isDemo?: boolean } | null | undefined): boolean {
  return user?.isDemo === true;
}

export function markDemoEntryPending(): void {
  try { sessionStorage.setItem(PENDING_KEY, '1'); } catch { /* presentation state only */ }
}

export function consumeDemoEntryPending(): boolean {
  try {
    const pending = sessionStorage.getItem(PENDING_KEY) === '1';
    sessionStorage.removeItem(PENDING_KEY);
    return pending;
  } catch {
    return false;
  }
}

export function readDemoProgress(): DemoProgress {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return DEFAULT_PROGRESS;
    const value = JSON.parse(raw) as Partial<DemoProgress>;
    if (value.version !== 1 || !value.status || !statuses.has(value.status)) return DEFAULT_PROGRESS;
    if (value.lastPath && !paths.has(value.lastPath)) return DEFAULT_PROGRESS;
    return {
      version: 1,
      status: value.status,
      ...(value.lastPath ? { lastPath: value.lastPath } : {}),
      ...(typeof value.updatedAt === 'string' ? { updatedAt: value.updatedAt } : {}),
    };
  } catch {
    return DEFAULT_PROGRESS;
  }
}

export function writeDemoProgress(progress: DemoProgress): void {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch { /* presentation state only */ }
}

export function updateDemoProgress(status: DemoProgressStatus, lastPath?: DemoPath): DemoProgress {
  const progress: DemoProgress = {
    version: 1,
    status,
    updatedAt: new Date().toISOString(),
    ...(lastPath ? { lastPath } : {}),
  };
  writeDemoProgress(progress);
  return progress;
}

export function restartDemoGuide(): void {
  try { localStorage.removeItem(PROGRESS_KEY); } catch { /* presentation state only */ }
}

export function shouldOpenDemoGuide(input: { isDemo: boolean; pending: boolean; status: DemoProgressStatus }): boolean {
  return input.isDemo && (input.pending || input.status === 'new');
}

export function findLiveDemoTournament<T extends { id: string; publicSlug?: string | null; status?: string }>(tournaments: T[] | undefined): T | null {
  return tournaments?.find((tournament) => tournament.publicSlug === 'bowin-demo-live-championship') ?? null;
}
