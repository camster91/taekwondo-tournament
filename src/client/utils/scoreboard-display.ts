export interface ScoreboardDisplaySettings {
  mode?: string;
  ringNumber?: number;
  featuredMatchId?: string;
}

export function resolveDisplayRing(
  settings: ScoreboardDisplaySettings,
  ringNumbers: number[],
  cycleEnabled: boolean,
  localRing: number | 'all',
  cycleIndex: number,
): number | 'all' {
  if (settings.mode === 'all') return 'all';
  const modeRing = settings.mode?.match(/^ring:(\d+)$/)?.[1];
  const directorRing = settings.ringNumber ?? (modeRing ? Number(modeRing) : undefined);
  if (directorRing && Number.isInteger(directorRing)) return directorRing;
  if (cycleEnabled && localRing === 'all' && ringNumbers.length > 0) {
    return ringNumbers[cycleIndex % ringNumbers.length];
  }
  return localRing;
}
