import { useState, useEffect, useMemo } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trophy, Clock, Users, ChevronRight, Award, Zap, Radio, MapPin, Loader2, AlertCircle } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Card, CardBody } from '../components/ui';
import { StatTile } from '../components/ui';
import { Button } from '../components/ui';
import { buildScoreboardApiUrl } from '../utils/public-scoreboard-url';
import { resolveDisplayRing } from '../utils/scoreboard-display';
import { BowinLogo } from '../components/brand/BowinLogo';
import { getScoreboardUnavailableMessage } from '../utils/scoreboard-availability';
import { fetchJson } from '../utils/api-status';
import { resolveParentScoreboardState } from '../utils/parent-scoreboard-state';

interface Match {
  id: string;
  matchNumber: number;
  roundNumber: number;
  bracketType: string;
  ringNumber?: number | null;
  scheduledTime?: string | null;
  status: string;
  score1: string | null;
  score2: string | null;
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
  bracket: {
    id: string;
    matches: Match[];
  } | null;
}

interface Tournament {
  id: string;
  name: string;
  date: string;
  location: string | null;
  brandName?: string | null;
  brandPrimaryColor?: string | null;
  brandLogoUrl?: string | null;
  publicScoreboardRefreshMs?: number | null;
}

export default function PublicScoreboard() {
  const { tournamentId } = useParams();
  const [searchParams] = useSearchParams();
  const publicKey = searchParams.get('key');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [activeRing, setActiveRing] = useState<number | 'all'>('all');
  const [cycleEnabled, setCycleEnabled] = useState(true);
  const [cycleIndex, setCycleIndex] = useState(0);
  const [lastFetchAt, setLastFetchAt] = useState<Date | null>(null);

  // Update time every second
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const queryClient = useQueryClient();

  // Fetch tournament via public endpoint (no auth required).
  // Treats 400 (not open) and 404 (not found) the same as a real fetch error so
  // the error UI can render instead of silently showing a blank board.
  // Closes #35 — invalid tournament IDs used to render the empty template
  // with NOW COMPETING / UP NEXT headings, looking like a tournament with
  // zero matches. Same hook for #33 (no loading state at all).
  const {
    data: tournament,
    isLoading: tournamentLoading,
    error: tournamentError,
    refetch: retryTournament,
  } = useQuery<Tournament>({
    queryKey: ['scoreboard-tournament', tournamentId],
    queryFn: async () => {
      return fetchJson<Tournament>(fetch, `/api/public/tournaments/${tournamentId}`);
    },
    refetchInterval: (query) => {
      const data = query.state.data as Tournament | undefined;
      return data?.publicScoreboardRefreshMs ?? 10_000;
    },
    refetchIntervalInBackground: false,
    retry: false,
  });

  // Fetch divisions with brackets via public endpoint (no auth required).
  // Returns `{ divisions, displaySettings }` — displaySettings carries
  // director overrides (mode: 'all' | 'ring:N' | 'featured:<matchId>').
  // Closes M8 from the UI audit.
  const { data: scoreboardData, isLoading: divisionsLoading, error: scoreboardError, refetch: retryScoreboard } = useQuery<{
    divisions: Division[];
    displaySettings: { mode?: string; ringNumber?: number; featuredMatchId?: string };
  }>({
    queryKey: ['scoreboard-data', tournamentId, publicKey],
    queryFn: async () => {
      const data = await fetchJson<{
        divisions: Division[];
        displaySettings: { mode?: string; ringNumber?: number; featuredMatchId?: string };
      }>(fetch, buildScoreboardApiUrl(tournamentId || '', publicKey));
      setLastFetchAt(new Date());
      return data;
    },
    refetchInterval: () => {
      const tournamentData = queryClient.getQueryData<Tournament>(['scoreboard-tournament', tournamentId]);
      return tournamentData?.publicScoreboardRefreshMs ?? 5000;
    },
    refetchIntervalInBackground: false,
    enabled: !tournamentError, // Don't keep retrying the scoreboard if the tournament is bad
    retry: false,
  });
  const divisions = scoreboardData?.divisions;
  const displaySettings = scoreboardData?.displaySettings;
  const scoreboardUnavailableMessage = getScoreboardUnavailableMessage(scoreboardError);
  const pageState = resolveParentScoreboardState({
    tournamentLoading,
    tournamentError,
    tournamentReady: Boolean(tournament),
    scoreboardLoading: divisionsLoading,
    scoreboardError,
    scoreboardReady: Boolean(scoreboardData),
  });

  useEffect(() => {
    // A heartbeat means this display has just received current scoreboard data.
    // Cached stale data must not keep a failing display looking healthy.
    if (pageState !== 'ready') return;
    const encodedId = encodeURIComponent(tournamentId || '');
    const query = publicKey ? `?key=${encodeURIComponent(publicKey)}` : '';
    const heartbeat = () => {
      void fetch(`/api/public/tournaments/${encodedId}/display-heartbeat${query}`, {
        method: 'POST',
        keepalive: true,
      }).catch(() => undefined);
    };
    heartbeat();
    const timer = window.setInterval(heartbeat, 15_000);
    return () => window.clearInterval(timer);
  }, [pageState, publicKey, tournamentId]);

  // Stale-data warning. If 15+ seconds have passed since the last successful
  // fetch, the venue Wi-Fi may be flaky or the backend is down. Show an
  // explicit warning in the header so the director notices. Closes the
  // polish tail of M10 from the UI audit.
  const staleSeconds = lastFetchAt ? Math.floor((currentTime.getTime() - lastFetchAt.getTime()) / 1000) : null;
  const isStale = staleSeconds != null && staleSeconds > 15;

  // Group by ring. Matches without a ringNumber are NOT bucketed into a
  // default ring — they go into a separate "unassigned" bucket so the LIVE
  // badge count reflects reality, not a || 1 fallback. Closes #30.
  const matchesByRing = useMemo(() => {
    const out: Record<number, Match[]> = { 1: [], 2: [], 3: [], 4: [] };
    for (const d of divisions || []) {
      for (const m of d.bracket?.matches || []) {
        if (m.ringNumber == null) continue; // unassigned — render separately
        const ring = m.ringNumber;
        if (!out[ring]) out[ring] = [];
        out[ring].push(m);
      }
    }
    return out;
  }, [divisions]);

  const ringNumbers = Object.keys(matchesByRing).filter((k) => matchesByRing[+k].length > 0).map(Number).sort();

  // Auto-cycle: rotate through rings that have active matches
  useEffect(() => {
    if (!cycleEnabled || ringNumbers.length <= 1) return;
    const timer = setInterval(() => {
      setCycleIndex((i) => (i + 1) % ringNumbers.length);
    }, 12000);
    return () => clearInterval(timer);
  }, [cycleEnabled, ringNumbers.length]);

  // All matches across all rings
  const allMatches = divisions?.flatMap((d) => d.bracket?.matches || []) || [];
  const effectiveRing = resolveDisplayRing(displaySettings || {}, ringNumbers, cycleEnabled, activeRing, cycleIndex);
  const directorFeaturedMatchId = displaySettings?.featuredMatchId
    || displaySettings?.mode?.match(/^featured:(.+)$/)?.[1];
  const matchesInActiveRing = directorFeaturedMatchId
    ? allMatches.filter((match) => match.id === directorFeaturedMatchId)
    : effectiveRing === 'all'
    ? allMatches
    : matchesByRing[effectiveRing] || [];

  const inProgressMatches = matchesInActiveRing.filter((m) => m.status === 'in_progress');
  const readyMatches = matchesInActiveRing
    .filter((m) => m.status === 'ready')
    .sort((a, b) => (a.scheduledTime || '').localeCompare(b.scheduledTime || ''))
    .slice(0, 8);
  const recentResults = matchesInActiveRing
    .filter((m) => m.status === 'completed' && m.winnerId)
    .slice(-10)
    .reverse();

  const stats = {
    totalMatches: allMatches.length,
    completed: allMatches.filter((m) => m.status === 'completed').length,
    inProgress: allMatches.filter((m) => m.status === 'in_progress').length,
  };

  // Helpers used by both the TV hero and the right column.
  const getCompetitorName = (competitor: Match['competitor1']) => {
    if (!competitor) return 'TBD';
    return `${competitor.competitor.firstName} ${competitor.competitor.lastName}`;
  };

  const getCompetitorSchool = (competitor: Match['competitor1']) => {
    if (!competitor) return '';
    return competitor.competitor.schoolDojang || '';
  };

  const getDivisionForMatch = (match: Match) => {
    return divisions?.find((d) => d.bracket?.matches.some((m) => m.id === match.id));
  };

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white overflow-hidden antialiased">
      {/* Error / not-found state. Replaces the old behavior of rendering an
          empty scoreboard template (NOW COMPETING / UP NEXT headings with
          no body) when the tournament ID is invalid. Closes #35.
          Same conditional handles 400 "Tournament is not open" — a common
          case for TV operators who paste the wrong URL mid-event. */}
      {pageState === 'tournament-unavailable' && (
        <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center">
          <AlertCircle className="h-20 w-20 text-danger400 mb-6" />
          <h1 className="text-3xl font-bold mb-3">
            {tournamentError?.message || 'Could not load tournament'}
          </h1>
          <p className="text-surface-300 max-w-md">
            Check the URL with the tournament director. The display link looks like
            <code className="block mt-3 px-3 py-2 bg-surface-800/60 rounded text-sm font-mono">
              /display/&lt;tournament-id&gt;
            </code>
          </p>
          <button type="button" onClick={() => void retryTournament()} className="mt-5 min-h-11 rounded-lg border border-surface-500 px-4 py-2 font-semibold">Try again</button>
        </div>
      )}
      {/* Loading state. Spinner only shown while the tournament query is
          in-flight. After the tournament loads we keep the layout rendered
          even while divisions re-fetch (3s polling) so the TV doesn't flash.
          Closes #33. */}
      {(pageState === 'loading-tournament' || pageState === 'loading-scoreboard') && (
        <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center">
          <Loader2 className="h-16 w-16 text-primary-400 mb-6 animate-spin" />
          <h1 className="text-2xl font-bold mb-2">Loading tournament…</h1>
          <p className="text-surface-300">Fetching live brackets and match data</p>
        </div>
      )}
      {/* Main board — only render once we have a valid tournament. */}
      {pageState === 'scoreboard-unavailable' && (
        <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center" role="alert">
          <AlertCircle className="h-20 w-20 text-warning400 mb-6" aria-hidden="true" />
          <h1 className="text-3xl font-bold mb-3">Live scoreboard unavailable</h1>
          <p className="text-surface-300 max-w-md">{scoreboardUnavailableMessage}</p>
          <button type="button" onClick={() => void retryScoreboard()} className="mt-5 min-h-11 rounded-lg border border-surface-500 px-4 py-2 font-semibold">Try again</button>
        </div>
      )}
      {(pageState === 'ready' || pageState === 'stale-scoreboard') && (
      <>
      {pageState === 'stale-scoreboard' && (
        <div role="alert" className="border-b border-amber-400/40 bg-warning/400/15 px-4 py-3 text-center text-warning100">
          <p className="font-semibold">Showing the last confirmed scoreboard</p>
          <p className="text-sm">Live updates are temporarily unavailable. Match information below may be out of date.</p>
          {lastFetchAt && <p className="mt-1 text-xs">Last confirmed at {lastFetchAt.toLocaleTimeString()}.</p>}
          <button type="button" onClick={() => { if (tournamentError) void retryTournament(); if (scoreboardError) void retryScoreboard(); }} className="mt-2 min-h-11 rounded-lg border border-amber-300/60 px-4 py-2 text-sm font-semibold">Try again</button>
        </div>
      )}
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-900 via-primary-950 to-slate-900 border-b border-white/5">
        <div className="px-4 md:px-8 lg:px-12 py-4 md:py-5 lg:py-6 flex items-center justify-between">
          <div className="flex items-center gap-4 md:gap-6">
            {tournament?.brandLogoUrl ? (
              <img src={tournament.brandLogoUrl} alt={`${tournament.brandName || tournament.name} logo`} className="h-12 w-auto md:h-14 lg:h-16" />
            ) : (
              <Trophy className="h-12 w-12 md:h-14 md:w-14 lg:h-16 lg:w-16" style={{ color: tournament?.brandPrimaryColor || '#DC2626' }} />
            )}
            <div>
              <div className="flex items-center gap-2 md:gap-3">
                <h1 className="text-2xl md:text-4xl lg:text-5xl xl:text-6xl font-bold tracking-tight">{tournament?.brandName || tournament?.name || 'Tournament'}</h1>
                <span
                  data-testid="live-badge"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-danger/500/20 border border-red-500/40 text-danger200 text-sm md:text-base lg:text-lg font-bold uppercase tracking-wider"
                >
                  <span className="h-2.5 w-2.5 rounded-full bg-danger/400 animate-pulse" /> Live
                </span>
              </div>
              <p className="text-surface-300 text-base md:text-lg lg:text-xl xl:text-2xl flex items-center gap-2 mt-1">
                {tournament?.location && <><MapPin className="h-4 w-4 md:h-5 md:w-5 lg:h-6 lg:w-6" /> {tournament.location} ·</>}
                {tournament?.date && new Date(tournament.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-6 md:gap-8">
            <div className="text-right">
              <div className="text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-mono font-bold text-white tabular-nums">
                {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
              <div className="text-surface-300 text-sm md:text-base lg:text-lg xl:text-xl font-medium">
                {stats.completed} / {stats.totalMatches} matches complete
              </div>
            </div>
            {/* Mobile-view QR code. Spectators standing by the TV can scan
                this to get the same scoreboard on their phone without
                typing the long URL. Closes M5 from the UI audit. */}
            <div className="hidden md:flex flex-col items-center gap-1" data-testid="mobile-qr">
              <div className="bg-white p-1.5 rounded-md">
                <QRCodeSVG
                  value={typeof window !== 'undefined' ? window.location.href : `/display/${tournament?.id ?? ''}`}
                  size={64}
                  level="M"
                />
              </div>
              <div className="text-[10px] text-surface-400 uppercase tracking-wider font-medium">
                Scan to view on phone
              </div>
            </div>
          </div>
        </div>

        {/* Mobile-only banner: point parents to the simpler mobile view.
            On the venue TV this banner hides (md:hidden). */}
        <div className="md:hidden px-4 py-2 bg-primary-950/40 border-b border-white/5">
          <Link
            to={`/scoreboard/parent/${tournamentId}${publicKey ? `?key=${encodeURIComponent(publicKey)}` : ''}`}
            className="text-xs text-primary-300 hover:text-primary-200 underline"
          >
            📱 Better view for phones →
          </Link>
        </div>

        {/* Ring tabs — using Button components. Hidden on mobile since
            parents should be on the dedicated /scoreboard/parent view. */}
        <div className="hidden md:block px-4 md:px-8 pb-0">
          <div className="flex items-end justify-between border-t border-white/5 pt-2 overflow-x-auto">
            <div className="flex items-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setActiveRing('all'); setCycleEnabled(false); }}
              className={`rounded-t-lg ${effectiveRing === 'all' ? 'bg-[#0a0e1a] text-white border-t border-l border-r border-white/10' : 'text-surface-300 hover:text-white'}`}
            >
              All rings
            </Button>
            {ringNumbers.map((ring) => (
              <Button
                key={ring}
                variant="ghost"
                size="sm"
                onClick={() => { setActiveRing(ring); setCycleEnabled(false); }}
                className={`rounded-t-lg flex items-center gap-2 ${effectiveRing === ring ? 'bg-[#0a0e1a] text-white border-t border-l border-r border-white/10' : 'text-surface-300 hover:text-white'}`}
              >
                <span className="h-2 w-2 rounded-full bg-success/400 animate-pulse" />
                Ring {ring}
                <span className="text-xs opacity-60">
                  ({matchesByRing[ring]?.filter((m) => m.status === 'in_progress').length || 0} live)
                </span>
              </Button>
            ))}
            {activeRing !== 'all' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setActiveRing('all'); setCycleEnabled(true); }}
                className="ml-2 text-xs text-surface-300 hover:text-white"
              >
                Resume auto-cycle
              </Button>
            )}
          </div>
          </div>
          <div className={`text-xs pb-3 flex items-center gap-2 ${isStale ? 'text-warning400' : 'text-surface-300'}`}>
            <span className={`h-2 w-2 rounded-full ${isStale ? 'bg-warning/400' : 'bg-success/400 animate-pulse'}`} />
            <span data-testid="auto-refresh-status">
              {isStale
                ? `STALE — no update for ${staleSeconds}s. Check venue Wi-Fi.`
                : `Auto-refresh every 5s · Last update ${lastFetchAt ? lastFetchAt.toLocaleTimeString() : currentTime.toLocaleTimeString()}`}
            </span>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="h-1 bg-surface-800/60">
          <div
            className="h-full bg-gradient-to-r from-primary-500 via-accent-500 to-pink-500 transition-all duration-500"
            style={{ width: `${stats.totalMatches > 0 ? (stats.completed / stats.totalMatches) * 100 : 0}%` }}
          />
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:h-[calc(100vh-200px)]">
        {/* Left Column - Current Matches (TV hero) */}
        <div className="w-full md:w-1/2 p-4 md:p-6 lg:p-8 border-r border-white/5 overflow-hidden">
          <div className="flex items-center mb-6 md:mb-8">
            <Zap className="h-7 w-7 md:h-8 md:w-8 lg:h-10 lg:w-10 text-warning400 mr-3" />
            <h2 className="text-3xl md:text-4xl lg:text-5xl xl:text-6xl font-bold text-warning400 uppercase tracking-wider">Now competing</h2>
          </div>

          {inProgressMatches.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-surface-300">
              <Clock className="h-24 w-24 md:h-28 md:w-28 lg:h-32 lg:w-32 mb-6 opacity-50" />
              <p className="text-3xl md:text-4xl lg:text-5xl xl:text-6xl font-semibold">No matches in progress</p>
              <p className="text-lg md:text-xl lg:text-2xl text-surface-400 mt-3">Stand by for the next match</p>
            </div>
          ) : (
            <div className="space-y-4 md:space-y-5 overflow-y-auto max-h-[calc(100vh-320px)] pr-2">
              {inProgressMatches.map((match) => {
                const division = getDivisionForMatch(match);
                return (
                  <Card key={match.id} className="overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500/15 via-slate-900 to-slate-900 border-2 border-amber-500/40 shadow-2xl">
                    <CardBody className="p-6 md:p-7 lg:p-8">
                      <div className="relative">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-warning/500/10 rounded-full blur-3xl" />
                        <div className="relative">
                          <div className="flex items-center justify-between mb-5 md:mb-6">
                            <div className="text-base md:text-lg lg:text-xl xl:text-2xl text-warning300 font-semibold uppercase tracking-wider">
                              {division?.name} · Match #{match.matchNumber}
                            </div>
                            <div className="flex items-center gap-2 text-sm md:text-base lg:text-lg xl:text-xl text-warning300 font-bold">
                              <span className="h-2 w-2 md:h-2.5 md:w-2.5 rounded-full bg-warning/400 animate-pulse" /> LIVE
                            </div>
                          </div>
                          <div className="grid grid-cols-[1fr_auto_1fr] gap-4 md:gap-5 lg:gap-6 items-center">
                            <div className="min-w-0">
                              <div className="text-2xl md:text-3xl lg:text-4xl xl:text-5xl font-bold tracking-tight leading-tight">
                                {getCompetitorName(match.competitor1)}
                              </div>
                              <div className="text-surface-300 text-base md:text-lg lg:text-xl xl:text-2xl mt-1.5 md:mt-2">
                                {getCompetitorSchool(match.competitor1) || '—'}
                              </div>
                            </div>
                            <div className="px-3 md:px-5 text-2xl md:text-3xl lg:text-4xl xl:text-5xl font-black text-surface-300 tracking-widest">VS</div>
                            <div className="min-w-0 text-right">
                              <div className="text-2xl md:text-3xl lg:text-4xl xl:text-5xl font-bold tracking-tight leading-tight">
                                {getCompetitorName(match.competitor2)}
                              </div>
                              <div className="text-surface-300 text-base md:text-lg lg:text-xl xl:text-2xl mt-1.5 md:mt-2">
                                {getCompetitorSchool(match.competitor2) || '—'}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardBody>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Up Next Queue */}
          <div className="mt-6 md:mt-8">
            <div className="flex items-center mb-4">
              <Clock className="h-5 w-5 md:h-6 md:w-6 text-sky-400 mr-2" />
              <h3 className="text-base md:text-lg lg:text-xl font-semibold text-sky-400 uppercase tracking-wider">Up next</h3>
            </div>
            {readyMatches.length === 0 ? (
              <p className="text-surface-300 text-base md:text-lg">No upcoming matches</p>
            ) : (
              <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                {readyMatches.map((match, index) => {
                  const division = getDivisionForMatch(match);
                  return (
                    <div
                      key={match.id}
                      className={`bg-surface-900/60 rounded-lg px-4 py-3 flex items-center justify-between transition-colors ${
                        index === 0 ? 'ring-2 ring-sky-500/50 bg-sky-950/30' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-surface-800 flex items-center justify-center text-sm md:text-base font-bold text-surface-300 flex-shrink-0">
                          {index + 1}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm md:text-base lg:text-lg font-medium truncate">
                            {getCompetitorName(match.competitor1)} vs {getCompetitorName(match.competitor2)}
                          </div>
                          <div className="text-xs md:text-sm lg:text-base text-surface-400 truncate">{division?.name}</div>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 md:h-6 md:w-6 text-surface-300 flex-shrink-0" />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column - Recent Results & Stats */}
        <div className="w-full md:w-1/2 p-4 md:p-6 lg:p-8">
          <div className="flex items-center mb-6 md:mb-8">
            <Award className="h-7 w-7 md:h-8 md:w-8 lg:h-10 lg:w-10 text-success400 mr-3" />
            <h2 className="text-3xl md:text-4xl lg:text-5xl xl:text-6xl font-bold text-success400 uppercase tracking-wider">Recent Results</h2>
          </div>

          {recentResults.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-surface-300">
              <Trophy className="h-20 w-20 md:h-24 md:w-24 mb-5" />
              <p className="text-2xl md:text-3xl lg:text-4xl font-semibold">No results yet</p>
            </div>
          ) : (
            <div className="space-y-3 md:space-y-4">
              {recentResults.map((match) => {
                const division = getDivisionForMatch(match);
                const winner =
                  match.winnerId === match.competitor1?.id
                    ? match.competitor1
                    : match.competitor2;
                const loser =
                  match.winnerId === match.competitor1?.id
                    ? match.competitor2
                    : match.competitor1;

                return (
                  <Card key={match.id} className="bg-surface-900/60 border border-surface-700/50">
                    <CardBody className="p-4 md:p-5 lg:p-6">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm md:text-base lg:text-lg text-surface-400 mb-2">{division?.name}</div>
                          <div className="flex items-center flex-wrap gap-2">
                            <Award className="h-5 w-5 md:h-6 md:w-6 text-yellow-400 flex-shrink-0" />
                            <span className="font-bold text-success400 text-base md:text-lg lg:text-xl truncate">
                              {getCompetitorName(winner)}
                            </span>
                            <span className="text-surface-400 text-sm md:text-base lg:text-lg">defeated</span>
                            <span className="text-surface-300 text-base md:text-lg lg:text-xl truncate">{getCompetitorName(loser)}</span>
                          </div>
                        </div>
                        {(match.score1 || match.score2) && (
                          <div className="text-xl md:text-2xl lg:text-3xl font-mono font-bold text-surface-300 flex-shrink-0">
                            {match.score1 || '0'} - {match.score2 || '0'}
                          </div>
                        )}
                      </div>
                    </CardBody>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Division Summary */}
          <div className="mt-8 md:mt-10">
            <div className="flex items-center mb-4 md:mb-5">
              <Users className="h-6 w-6 md:h-7 md:w-7 text-purple-400 mr-3" />
              <h3 className="text-xl md:text-2xl lg:text-3xl font-semibold text-purple-400">DIVISION STATUS</h3>
            </div>
            {(() => {
              // Show a division row only if it has a bracket with matches.
              // Divisions without brackets (categorization done, brackets
              // not yet generated) still count for the "is anything here"
              // check below — we want to tell the user "brackets pending",
              // not "no divisions" in that case.
              const divisionsWithBrackets = divisions?.filter((d) => d.bracket) ?? [];
              const hasAnyDivisions = (divisions?.length ?? 0) > 0;
              if (!hasAnyDivisions) {
                return (
                  <div className="bg-surface-900/30 border border-surface-700/50 rounded-lg p-6 text-center">
                    <Users className="h-8 w-8 text-surface-300 mx-auto mb-2" />
                    <p className="text-sm text-surface-300">
                      No divisions generated yet. The director is still setting up categories.
                    </p>
                  </div>
                );
              }
              if (divisionsWithBrackets.length === 0) {
                return (
                  <div className="bg-surface-900/30 border border-surface-700/50 rounded-lg p-6 text-center">
                    <Users className="h-8 w-8 text-surface-300 mx-auto mb-2" />
                    <p className="text-sm text-surface-300">
                      Divisions are set, but brackets haven't been generated yet.
                    </p>
                  </div>
                );
              }
              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
                  {divisionsWithBrackets.map((division) => {
                    const completed =
                      division.bracket?.matches?.filter((m) => m.status === 'completed').length || 0;
                    const total = division.bracket?.matches.length || 0;
                    const isActive = division.bracket?.matches.some(
                      (m) => m.status === 'in_progress'
                    );
                    const isDone = completed === total;

                  return (
                    <div
                      key={division.id}
                      className={`p-4 md:p-5 rounded-xl ${
                        isActive
                          ? 'bg-yellow-900/30 border-2 border-yellow-500/50 shadow-lg'
                          : isDone
                          ? 'bg-success/900/20 border-2 border-green-500/30'
                          : 'bg-surface-900/60 border border-surface-700/40'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-sm md:text-base lg:text-lg truncate flex-1">
                          {division.name}
                        </div>
                        {isActive && <Zap className="h-5 w-5 md:h-6 md:w-6 text-yellow-400 flex-shrink-0" />}
                      </div>
                      <div className="text-xs md:text-sm lg:text-base text-surface-400 mt-1.5 font-medium">
                        {completed}/{total} complete
                      </div>
                      <div className="mt-2 h-1.5 md:h-2 bg-surface-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${isDone ? 'bg-success/500' : 'bg-info/500'} transition-all duration-500`}
                          style={{ width: `${total > 0 ? (completed / total) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  )}
                )}
              </div>
              );
            })()}
          </div>
        </div>
      </div>
      </>
      )}
    </div>
  );
}
