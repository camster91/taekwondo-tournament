// ParentScoreboard - mobile-first view of the tournament scoreboard.
// Distinct from PublicScoreboard which is designed for the venue TV
// (oversized time, ring dashboard, auto-cycle). This view is for the
// parent in the stands checking on their kid: vertical scroll, one
// column, focus on NOW COMPETING + UP NEXT in plain English, no QR
// code (they're already on the phone), no ring cycling.
//
// Reachable at /scoreboard/parent/:tournamentId. No auth required -
// this is intentionally a public URL a parent can bookmark.
import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { buildScoreboardApiUrl } from '../utils/public-scoreboard-url';
import { Clock, AlertCircle, RefreshCw, ArrowLeft, Search, Star } from 'lucide-react';
import { Button, Card, CardBody, Input } from '../components/ui';
import { getScoreboardUnavailableMessage } from '../utils/scoreboard-availability';
import { resolveParentScoreboardState } from '../utils/parent-scoreboard-state';
import { fetchJson } from '../utils/api-status';
import { buildParentMatchView, describeParentMatchTransition, filterParentMatches, parseParentScoreboardPayload, readParentFavorites, writeParentFavorites } from '../utils/parent-live-finder';

interface Match {
  id: string;
  matchNumber: number;
  roundNumber: number;
  bracketType: string;
  ringNumber?: number | null;
  scheduledTime?: string | null;
  status: string;
  score1: number | null;
  score2: number | null;
  winnerId: string | null;
  competitor1: {
    id: string;
    competitor: { firstName: string; lastName: string; schoolDojang: string | null };
  } | null;
  competitor2: {
    id: string;
    competitor: { firstName: string; lastName: string; schoolDojang: string | null };
  } | null;
}

interface Division {
  id: string;
  name: string;
  eventType: string;
  bracket: { id: string; matches: Match[] } | null;
}

interface Tournament {
  id: string;
  name: string;
  date: string;
  location: string | null;
  status: string;
}

export default function ParentScoreboard() {
  const { tournamentId } = useParams();
  const [searchParams] = useSearchParams();
  const publicKey = searchParams.get('key');
  const [finderQuery, setFinderQuery] = useState('');
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    if (!tournamentId || typeof window === 'undefined') return new Set();
    return readParentFavorites(window.localStorage, tournamentId);
  });
  const [liveAnnouncement, setLiveAnnouncement] = useState('');
  const previousMatches = useRef<Array<Match & { divisionName: string; eventType: string }>>([]);

  // Refresh every 5s - slower than the TV version (3s) to save battery
  // on the parent's phone.
  const { data: tournament, isLoading: tournamentLoading, error: tournamentError, refetch: retryTournament } = useQuery<Tournament>({
    queryKey: ['parent-scoreboard-tournament', tournamentId],
    queryFn: async () => {
      return fetchJson<Tournament>(fetch, `/api/public/tournaments/${tournamentId}`);
    },
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    retry: false,
  });

  const { data: scoreboardData, isLoading: scoreboardLoading, error: scoreboardError, refetch: retryScoreboard, dataUpdatedAt: scoreboardUpdatedAt } = useQuery<{
    divisions: Division[];
    displaySettings: { mode?: string; ringNumber?: number; featuredMatchId?: string };
  }>({
    queryKey: ['parent-scoreboard-data', tournamentId, publicKey],
    queryFn: async () => {
      const payload = await fetchJson<unknown>(fetch, buildScoreboardApiUrl(tournamentId || '', publicKey));
      return parseParentScoreboardPayload(payload) as { divisions: Division[]; displaySettings: { mode?: string; ringNumber?: number; featuredMatchId?: string } };
    },
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    enabled: !!tournament && !tournamentError,
    retry: false,
  });

  const divisions = scoreboardData?.divisions || [];
  const displaySettings = scoreboardData?.displaySettings;
  const scoreboardUnavailableMessage = getScoreboardUnavailableMessage(scoreboardError);
  const pageState = resolveParentScoreboardState({
    tournamentLoading,
    tournamentError,
    tournamentReady: Boolean(tournament),
    scoreboardLoading,
    scoreboardError,
    scoreboardReady: Boolean(scoreboardData),
  });

  // Pick "now competing" + "up next" matches. Status values from the
  // bracket-generator: 'ready', 'in_progress', 'completed'.
  const allMatches = useMemo(() => {
    const matches: Array<Match & { divisionName: string; eventType: string }> = [];
    for (const d of divisions) {
      if (!d.bracket?.matches) continue;
      for (const m of d.bracket.matches) {
        matches.push({ ...m, divisionName: d.name, eventType: d.eventType });
      }
    }
    return matches;
  }, [divisions]);

  const modeRing = Number(displaySettings?.mode?.match(/^ring:(\d+)$/)?.[1] || 0) || undefined;
  const configuredRing = displaySettings?.ringNumber ?? modeRing;
  const visibleMatches = configuredRing
    ? allMatches.filter((match) => match.ringNumber === configuredRing)
    : allMatches;
  const nowCompeting = visibleMatches
    .filter((m) => m.status === 'in_progress')
    .sort((a, b) => a.roundNumber - b.roundNumber || a.matchNumber - b.matchNumber);
  const upNext = visibleMatches
    .filter((m) => m.status === 'ready')
    .sort((a, b) => a.roundNumber - b.roundNumber || a.matchNumber - b.matchNumber)
    .slice(0, 5);
  const recent = visibleMatches
    .filter((m) => m.status === 'completed')
    .sort((a, b) => a.roundNumber - b.roundNumber || a.matchNumber - b.matchNumber)
    .slice(-3)
    .reverse();
  const finderMatches = useMemo(() => filterParentMatches(allMatches, finderQuery), [allMatches, finderQuery]);

  useEffect(() => {
    setFavorites(tournamentId && typeof window !== 'undefined' ? readParentFavorites(window.localStorage, tournamentId) : new Set());
    setFinderQuery('');
    setLiveAnnouncement('');
    previousMatches.current = [];
  }, [tournamentId]);

  useEffect(() => {
    const announcement = describeParentMatchTransition(previousMatches.current, allMatches, favorites);
    previousMatches.current = allMatches;
    if (announcement) setLiveAnnouncement(announcement);
  }, [allMatches, favorites]);

  const toggleFavorite = (matchId: string) => {
    if (!tournamentId) return;
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(matchId)) next.delete(matchId); else next.add(matchId);
      try { writeParentFavorites(window.localStorage, tournamentId, next); } catch { /* Favorites remain usable for this visit. */ }
      return next;
    });
  };

  // If director set featuredMatchId, override the "now competing" with
  // that match (even if it's not in_progress). Used for finals.
  let featured: (Match & { divisionName: string; eventType: string }) | null = null;
  const featuredMatchId = displaySettings?.featuredMatchId || displaySettings?.mode?.match(/^featured:(.+)$/)?.[1];
  if (featuredMatchId) {
    featured = allMatches.find((m) => m.id === featuredMatchId) || null;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header - tournament context */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <Link
            to="/"
            className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 inline-flex items-center mb-1"
          >
            <ArrowLeft className="h-3 w-3 mr-1" />
            Back
          </Link>
          {tournament ? (
            <>
              <h1 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
                {tournament.name}
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {new Date(tournament.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                {tournament.location && ` · ${tournament.location}`}
              </p>
            </>
          ) : tournamentError ? (
            <p className="text-sm text-red-600">Tournament not found</p>
          ) : (
            <p className="text-sm text-gray-500">Loading...</p>
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {pageState === 'tournament-unavailable' ? (
          <Card>
            <CardBody className="p-6 text-center">
              <div role="alert">
                <AlertCircle className="h-10 w-10 text-amber-500 mx-auto mb-3" aria-hidden="true" />
                <h1 className="font-semibold text-gray-900 dark:text-white mb-1">Tournament unavailable</h1>
                <p className="text-sm text-gray-600 dark:text-gray-300">This link may be inactive. Ask the tournament director for the current scoreboard link.</p>
                <button type="button" onClick={() => void retryTournament()} className="mt-4 min-h-11 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold">Try again</button>
              </div>
            </CardBody>
          </Card>
        ) : pageState === 'loading-tournament' ? (
          <p className="text-sm text-gray-600 dark:text-gray-300" role="status">Loading tournament…</p>
        ) : pageState === 'scoreboard-unavailable' ? (
          <Card>
            <CardBody className="p-6 text-center">
              <div role="alert">
                <AlertCircle className="h-10 w-10 text-amber-500 mx-auto mb-3" aria-hidden="true" />
                <h2 className="font-semibold text-gray-900 dark:text-white mb-1">Live scoreboard unavailable</h2>
                <p className="text-sm text-gray-600 dark:text-gray-300">{scoreboardUnavailableMessage}</p>
                <button type="button" onClick={() => void retryScoreboard()} className="mt-4 min-h-11 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold">Try again</button>
              </div>
            </CardBody>
          </Card>
        ) : pageState === 'loading-scoreboard' ? (
          <p className="text-sm text-gray-600 dark:text-gray-300" role="status">Loading live matches…</p>
        ) : (
        <>
        {pageState === 'stale-scoreboard' && (
          <Card>
            <CardBody className="p-4">
              <div role="alert" className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
                <div>
                  <h2 className="font-semibold text-gray-900 dark:text-white">Showing the last confirmed scoreboard</h2>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Live updates are temporarily unavailable. Match information below may be out of date.</p>
                  {scoreboardUpdatedAt > 0 && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Last confirmed at {new Date(scoreboardUpdatedAt).toLocaleTimeString()}.</p>}
                  <button type="button" onClick={() => { if (tournamentError) void retryTournament(); if (scoreboardError) void retryScoreboard(); }} className="mt-3 min-h-11 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold">Try again</button>
                </div>
              </div>
            </CardBody>
          </Card>
        )}
        <section aria-labelledby="live-finder-heading">
          <h2 id="live-finder-heading" className="text-base font-semibold text-gray-900 dark:text-white">Find an athlete</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Search by athlete, division, or school to see where and when they compete.</p>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-gray-400" aria-hidden="true" />
            <Input aria-label="Search athletes, divisions, or schools" value={finderQuery} onChange={(event) => setFinderQuery(event.target.value)} className="pl-10" />
          </div>
          {(finderQuery || favorites.size > 0) && (
            <div className="mt-3 space-y-2" aria-live="polite">
              {finderMatches.filter((match) => finderQuery || favorites.has(match.id)).length === 0 ? (
                <p className="rounded-lg bg-gray-100 p-4 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-300">No matching athletes or divisions were found.</p>
              ) : finderMatches.filter((match) => finderQuery || favorites.has(match.id)).map((match) => (
                <FinderMatchCard key={match.id} match={match} favorite={favorites.has(match.id)} onToggleFavorite={() => toggleFavorite(match.id)} />
              ))}
            </div>
          )}
          <p className="sr-only" aria-live="polite" aria-atomic="true">{liveAnnouncement}</p>
        </section>
        {/* NOW COMPETING - most attention-grabbing block */}
        <section>
          <h2 className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 mb-2 flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
            Now Competing
          </h2>
          {featured ? (
            <MatchCard m={featured} highlight />
          ) : nowCompeting.length === 0 ? (
            <EmptyBlock message="No matches in progress right now." />
          ) : (
            <div className="space-y-2">
              {nowCompeting.map((m) => <MatchCard key={m.id} m={m} highlight />)}
            </div>
          )}
        </section>

        {/* UP NEXT */}
        {upNext.length > 0 && (
          <section>
            <h2 className="text-xs font-bold uppercase tracking-wider text-blue-700 dark:text-blue-400 mb-2">
              Up Next
            </h2>
            <div className="space-y-2">
              {upNext.map((m) => <MatchCard key={m.id} m={m} />)}
            </div>
          </section>
        )}

        {/* RECENT RESULTS */}
        {recent.length > 0 && (
          <section>
            <h2 className="text-xs font-bold uppercase tracking-wider text-green-700 dark:text-green-400 mb-2">
              Recent Results
            </h2>
            <div className="space-y-2">
              {recent.map((m) => <MatchCard key={m.id} m={m} />)}
            </div>
          </section>
        )}

        {/* Empty state when nothing is happening at all */}
        {!tournamentError && nowCompeting.length === 0 && upNext.length === 0 && recent.length === 0 && tournament && (
          <Card>
            <CardBody className="p-6 text-center">
              <Clock className="h-10 w-10 text-gray-400 mx-auto mb-2" aria-hidden="true" />
              <p className="text-sm text-gray-700 dark:text-gray-300">
                The tournament hasn't started yet. Check back when divisions begin.
              </p>
            </CardBody>
          </Card>
        )}
        </>
        )}

        <p className="text-[10px] text-gray-400 text-center pt-4">
          Refreshes every 5 seconds. <RefreshCw className="inline h-2.5 w-2.5" />
        </p>
      </main>
    </div>
  );
}

function FinderMatchCard({ match, favorite, onToggleFavorite }: {
  match: Match & { divisionName: string; eventType: string };
  favorite: boolean;
  onToggleFavorite: () => void;
}) {
  const view = buildParentMatchView(match);
  const athletes = [match.competitor1, match.competitor2]
    .filter(Boolean)
    .map((entry) => `${entry!.competitor.firstName} ${entry!.competitor.lastName}`)
    .join(' vs ');
  return (
    <Card>
      <CardBody className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">{athletes || `Match ${match.matchNumber}`}</h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{match.divisionName}</p>
            <p className="mt-2 text-sm font-medium text-gray-900 dark:text-white">{view.status} · {view.location}</p>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{view.schedule}</p>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={onToggleFavorite} aria-pressed={favorite} aria-label={`${favorite ? 'Remove' : 'Save'} ${athletes || `match ${match.matchNumber}`} ${favorite ? 'from' : 'to'} favorites`}>
            <Star className={`h-4 w-4 ${favorite ? 'fill-current' : ''}`} aria-hidden="true" />
            {favorite ? 'Saved' : 'Save'}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function MatchCard({ m, highlight }: { m: Match & { divisionName: string; eventType: string }; highlight?: boolean }) {
  const name1 = m.competitor1?.competitor
    ? `${m.competitor1.competitor.firstName} ${m.competitor1.competitor.lastName}`
    : 'TBD';
  const name2 = m.competitor2?.competitor
    ? `${m.competitor2.competitor.firstName} ${m.competitor2.competitor.lastName}`
    : 'TBD';
  const winner1 = m.winnerId === m.competitor1?.id;
  const winner2 = m.winnerId === m.competitor2?.id;
  const eventLabel = m.eventType === 'patterns' ? 'Patterns' : 'Sparring';

  return (
    <Card className={highlight ? 'border-2 border-amber-400 shadow-md' : ''}>
      <CardBody className="p-3">
        <div className="flex items-center justify-between mb-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 truncate">
            {m.divisionName}
          </div>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${m.eventType === 'patterns'
              ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
              : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'}`}>
            {eventLabel}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className={`flex-1 text-right text-sm font-semibold ${winner1 ? 'text-green-700 dark:text-green-400' : 'text-gray-900 dark:text-white'}`}>
            {name1}
          </div>
          <div className="flex flex-col items-center min-w-[60px]">
            {m.status === 'completed' ? (
              <div className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">
                {m.score1 ?? 0} - {m.score2 ?? 0}
              </div>
            ) : (
              <div className="text-xs text-gray-400">vs</div>
            )}
          </div>
          <div className={`flex-1 text-left text-sm font-semibold ${winner2 ? 'text-green-700 dark:text-green-400' : 'text-gray-900 dark:text-white'}`}>
            {name2}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function EmptyBlock({ message }: { message: string }) {
  return (
    <div className="rounded-lg bg-gray-100 dark:bg-gray-800 p-4 text-center text-sm text-gray-600 dark:text-gray-400">
      {message}
    </div>
  );
}
