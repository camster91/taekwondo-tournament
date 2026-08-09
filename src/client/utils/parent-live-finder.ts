export interface ParentFinderMatch {
  id: string;
  matchNumber: number;
  status: string;
  ringNumber?: number | null;
  scheduledTime?: string | null;
  divisionName: string;
  competitor1?: { competitor?: { firstName: string; lastName: string; schoolDojang?: string | null } } | null;
  competitor2?: { competitor?: { firstName: string; lastName: string; schoolDojang?: string | null } } | null;
}

export interface ParentScoreboardPayload<T extends ParentFinderMatch = ParentFinderMatch> {
  divisions: Array<{ id: string; name: string; eventType: string; bracket: { id: string; matches: T[] } | null }>;
  displaySettings: { mode?: string; ringNumber?: number; featuredMatchId?: string };
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const favoriteKey = (tournamentId: string) => `bowin.parentFavorites.v1.${tournamentId}`;
const athleteName = (entry: ParentFinderMatch['competitor1']) => entry?.competitor
  ? `${entry.competitor.firstName} ${entry.competitor.lastName}`
  : 'Athlete';

export function filterParentMatches<T extends ParentFinderMatch>(matches: T[], query: string): T[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return matches;
  return matches.filter((match) => [
    match.divisionName,
    athleteName(match.competitor1), match.competitor1?.competitor?.schoolDojang,
    athleteName(match.competitor2), match.competitor2?.competitor?.schoolDojang,
  ].some((value) => value?.toLocaleLowerCase().includes(needle)));
}

export function buildParentMatchView(match: ParentFinderMatch, locale?: string, timeZone?: string) {
  const status = match.status === 'in_progress' ? 'Competing now'
    : match.status === 'ready' ? 'Up next'
      : match.status === 'completed' ? 'Completed' : 'Waiting for opponents';
  const schedule = match.scheduledTime
    ? `${new Intl.DateTimeFormat(locale, { timeZone, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(match.scheduledTime))} local time`
    : 'Start time has not been scheduled';
  return { status, schedule, location: match.ringNumber ? `Ring ${match.ringNumber}` : 'Ring not assigned' };
}

export function readParentFavorites(storage: Pick<Storage, 'getItem'>, tournamentId: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(favoriteKey(tournamentId)) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []);
  } catch {
    return new Set();
  }
}

export function writeParentFavorites(storage: StorageLike, tournamentId: string, favorites: Set<string>): void {
  storage.setItem(favoriteKey(tournamentId), JSON.stringify([...favorites].sort()));
}

export function describeParentMatchTransition(before: ParentFinderMatch[], after: ParentFinderMatch[], favorites: Set<string>): string {
  const previous = new Map(before.map((match) => [match.id, match]));
  const announcements: string[] = [];
  for (const match of after) {
    if (!favorites.has(match.id)) continue;
    const old = previous.get(match.id);
    if (!old || (old.status === match.status && old.ringNumber === match.ringNumber && old.scheduledTime === match.scheduledTime)) continue;
    const view = buildParentMatchView(match);
    const scheduleChange = old.scheduledTime !== match.scheduledTime ? `, schedule changed to ${view.schedule}` : '';
    announcements.push(`${athleteName(match.competitor1)} and ${athleteName(match.competitor2)}: ${view.status}, ${view.location}${scheduleChange}.`);
  }
  return announcements.join(' ');
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const requiredString = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${field}`);
  return value;
};

export function parseParentScoreboardPayload(value: unknown): ParentScoreboardPayload {
  if (!isRecord(value) || !Array.isArray(value.divisions) || !isRecord(value.displaySettings)) throw new Error('Invalid scoreboard response');
  const settings = value.displaySettings;
  if (settings.mode !== undefined && (typeof settings.mode !== 'string'
    || !/^(all|ring|featured|ring:\d+|featured:.+)$/.test(settings.mode))) throw new Error('Invalid display mode');
  if (settings.ringNumber !== undefined && (!Number.isInteger(settings.ringNumber) || Number(settings.ringNumber) < 1)) throw new Error('Invalid display ring');
  if (settings.featuredMatchId !== undefined && (typeof settings.featuredMatchId !== 'string' || !settings.featuredMatchId)) throw new Error('Invalid featured match');
  for (const division of value.divisions) {
    if (!isRecord(division)) throw new Error('Invalid division');
    requiredString(division.id, 'division id'); requiredString(division.name, 'division name'); requiredString(division.eventType, 'event type');
    if (division.bracket === null) continue;
    if (!isRecord(division.bracket) || !Array.isArray(division.bracket.matches)) throw new Error('Invalid bracket');
    requiredString(division.bracket.id, 'bracket id');
    for (const match of division.bracket.matches) {
      if (!isRecord(match)) throw new Error('Invalid match');
      requiredString(match.id, 'match id'); requiredString(match.bracketType, 'bracket type');
      if (typeof match.status !== 'string' || !['pending', 'ready', 'in_progress', 'completed', 'bye'].includes(match.status)) throw new Error('Invalid match status');
      if (!Number.isInteger(match.matchNumber) || Number(match.matchNumber) < 1) throw new Error('Invalid match number');
      if (!Number.isInteger(match.roundNumber) || Number(match.roundNumber) < 1) throw new Error('Invalid round number');
      if (match.ringNumber !== null && match.ringNumber !== undefined && (!Number.isInteger(match.ringNumber) || Number(match.ringNumber) < 1)) throw new Error('Invalid ring number');
      for (const score of [match.score1, match.score2]) {
        if (score !== null && score !== undefined && typeof score !== 'string' && (typeof score !== 'number' || !Number.isFinite(score))) throw new Error('Invalid match score');
      }
      if (match.winnerId !== null && match.winnerId !== undefined && typeof match.winnerId !== 'string') throw new Error('Invalid winner');
      if (match.scheduledTime !== null && match.scheduledTime !== undefined
        && (typeof match.scheduledTime !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(match.scheduledTime)
          || Number.isNaN(Date.parse(match.scheduledTime)))) throw new Error('Invalid scheduled time');
      for (const side of [match.competitor1, match.competitor2]) {
        if (side === null || side === undefined) continue;
        if (!isRecord(side) || !isRecord(side.competitor)) throw new Error('Invalid competitor');
        requiredString(side.id, 'competitor registration id');
        requiredString(side.competitor.firstName, 'competitor first name'); requiredString(side.competitor.lastName, 'competitor last name');
        if (side.competitor.schoolDojang !== null && side.competitor.schoolDojang !== undefined && typeof side.competitor.schoolDojang !== 'string') throw new Error('Invalid competitor school');
      }
    }
  }
  return value as unknown as ParentScoreboardPayload;
}
