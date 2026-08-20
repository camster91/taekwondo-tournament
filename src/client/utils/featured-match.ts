import type { ApiMatch } from './api-types';

export interface DisplaySettingsPayload {
  mode?: 'all' | 'ring' | 'featured';
  ringNumber?: number;
  featuredMatchId?: string;
}

export function parseDisplaySettings(settingsJson?: string | null): DisplaySettingsPayload {
  if (!settingsJson) return { mode: 'all' };
  try {
    const parsed = typeof settingsJson === 'string' ? JSON.parse(settingsJson) : settingsJson;
    const display = parsed?.display;
    if (!display || typeof display !== 'object') return { mode: 'all' };

    const mode = display.mode === 'ring' || display.mode === 'featured' ? display.mode : 'all';
    const ringNumber = typeof display.ringNumber === 'number' ? display.ringNumber : undefined;
    const featuredMatchId = typeof display.featuredMatchId === 'string' ? display.featuredMatchId : undefined;

    return { mode, ringNumber, featuredMatchId };
  } catch {
    return { mode: 'all' };
  }
}

export function formatMatchCompetitorName(slot: ApiMatch['competitor1']): string {
  if (!slot?.competitor) return 'TBD';
  const { firstName, lastName, schoolDojang } = slot.competitor;
  const fullName = `${firstName} ${lastName}`.trim();
  return schoolDojang ? `${fullName} (${schoolDojang})` : fullName;
}

export function formatMatchSummary(match: ApiMatch): string {
  const comp1 = formatMatchCompetitorName(match.competitor1);
  const comp2 = formatMatchCompetitorName(match.competitor2);
  const ring = match.ringNumber != null ? `Ring ${match.ringNumber}` : 'Unassigned Ring';
  const division = match._divisionName ? `${match._divisionName} · ` : '';
  const matchNum = `M#${match.matchNumber}`;
  return `${comp1} vs ${comp2} (${division}${matchNum}, ${ring})`;
}

export function filterFeaturedMatches(matches: ApiMatch[], query: string): ApiMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return matches;

  return matches.filter((m) => {
    const comp1 = formatMatchCompetitorName(m.competitor1).toLowerCase();
    const comp2 = formatMatchCompetitorName(m.competitor2).toLowerCase();
    const div = (m._divisionName || '').toLowerCase();
    const matchNum = `m#${m.matchNumber} match ${m.matchNumber} #${m.matchNumber}`.toLowerCase();
    const ring = m.ringNumber != null ? `ring ${m.ringNumber}` : 'unassigned';
    const status = m.status.toLowerCase();

    return (
      comp1.includes(q) ||
      comp2.includes(q) ||
      div.includes(q) ||
      matchNum.includes(q) ||
      ring.includes(q) ||
      status.includes(q)
    );
  });
}
