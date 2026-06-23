import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Trophy, Clock, Users, ChevronRight, Award, Zap, Radio, MapPin, Loader2, AlertCircle } from 'lucide-react';
import { Card, CardBody } from '../components/ui';
import { StatTile } from '../components/ui';
import { Button } from '../components/ui';

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
}

export default function PublicScoreboard() {
  const { tournamentId } = useParams();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [activeRing, setActiveRing] = useState<number | 'all'>('all');
  const [cycleEnabled, setCycleEnabled] = useState(true);
  const [cycleIndex, setCycleIndex] = useState(0);

  // Update time every second
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

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
  } = useQuery<Tournament>({
    queryKey: ['scoreboard-tournament', tournamentId],
    queryFn: async () => {
      const res = await fetch(`/api/public/tournaments/${tournamentId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = res.status === 404
          ? 'Tournament not found'
          : res.status === 400
          ? (body.error || 'Tournament is not open')
          : `Failed to load tournament (${res.status})`;
        throw new Error(msg);
      }
      return res.json();
    },
    retry: false,
  });

  // Fetch divisions with brackets via public endpoint (no auth required)
  const { data: divisions, isLoading: divisionsLoading } = useQuery<Division[]>({
    queryKey: ['scoreboard-divisions', tournamentId],
    queryFn: async () => {
      const res = await fetch(`/api/public/tournaments/${tournamentId}/scoreboard`);
      if (!res.ok) throw new Error('Failed to fetch scoreboard');
      return res.json();
    },
    refetchInterval: 3000, // TV mode: refresh every 3s
    enabled: !tournamentError, // Don't keep retrying the scoreboard if the tournament is bad
  });

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

  useEffect(() => {
    if (activeRing === 'all' && ringNumbers.length > 0) {
      const next = ringNumbers[cycleIndex % ringNumbers.length];
      if (next) setActiveRing(next);
    }
  }, [cycleIndex, ringNumbers.join(',')]);

  // All matches across all rings
  const allMatches = divisions?.flatMap((d) => d.bracket?.matches || []) || [];
  const matchesInActiveRing = activeRing === 'all'
    ? allMatches
    : matchesByRing[activeRing] || [];

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
    <div className="min-h-screen bg-[#0a0e1a] text-white overflow-hidden">
      {/* Error / not-found state. Replaces the old behavior of rendering an
          empty scoreboard template (NOW COMPETING / UP NEXT headings with
          no body) when the tournament ID is invalid. Closes #35.
          Same conditional handles 400 "Tournament is not open" — a common
          case for TV operators who paste the wrong URL mid-event. */}
      {tournamentError && (
        <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center">
          <AlertCircle className="h-20 w-20 text-red-400 mb-6" />
          <h1 className="text-3xl font-bold mb-3">
            {tournamentError.message || 'Could not load tournament'}
          </h1>
          <p className="text-slate-400 max-w-md">
            Check the URL with the tournament director. The display link looks like
            <code className="block mt-3 px-3 py-2 bg-slate-800/60 rounded text-sm font-mono">
              /display/&lt;tournament-id&gt;
            </code>
          </p>
        </div>
      )}
      {/* Loading state. Spinner only shown while the tournament query is
          in-flight. After the tournament loads we keep the layout rendered
          even while divisions re-fetch (3s polling) so the TV doesn't flash.
          Closes #33. */}
      {tournamentLoading && !tournamentError && (
        <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center">
          <Loader2 className="h-16 w-16 text-indigo-400 mb-6 animate-spin" />
          <h1 className="text-2xl font-bold mb-2">Loading tournament…</h1>
          <p className="text-slate-400">Fetching live brackets and match data</p>
        </div>
      )}
      {/* Main board — only render once we have a valid tournament. */}
      {!tournamentLoading && !tournamentError && (
      <>
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border-b border-white/5">
        <div className="px-4 md:px-8 py-3 md:py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-br from-indigo-500 to-violet-500 blur-md opacity-50" />
              <div className="relative h-12 w-12 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shadow-lg">
                <Trophy className="h-6 w-6 text-white" strokeWidth={2.5} />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight">{tournament?.name || 'Tournament'}</h1>
                <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-300 text-[10px] font-semibold uppercase tracking-wider">
                  <Radio className="h-2.5 w-2.5" /> Live
                </span>
              </div>
              <p className="text-slate-400 text-sm flex items-center gap-1.5">
                {tournament?.location && <><MapPin className="h-3 w-3" /> {tournament.location} ·</>}
                {tournament?.date && new Date(tournament.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <div className="text-3xl font-mono font-bold text-white tabular-nums">
                {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
              <div className="text-slate-400 text-xs">
                {stats.completed} / {stats.totalMatches} matches complete
              </div>
            </div>
          </div>
        </div>

        {/* Ring tabs — using Button components */}
        <div className="px-4 md:px-8 pb-0 flex items-end justify-between border-t border-white/5 pt-2 overflow-x-auto">
          <div className="flex items-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setActiveRing('all'); setCycleEnabled(false); }}
              className={`rounded-t-lg ${activeRing === 'all' ? 'bg-[#0a0e1a] text-white border-t border-l border-r border-white/10' : 'text-slate-400 hover:text-white'}`}
            >
              All rings
            </Button>
            {ringNumbers.map((ring) => (
              <Button
                key={ring}
                variant="ghost"
                size="sm"
                onClick={() => { setActiveRing(ring); setCycleEnabled(false); }}
                className={`rounded-t-lg flex items-center gap-2 ${activeRing === ring ? 'bg-[#0a0e1a] text-white border-t border-l border-r border-white/10' : 'text-slate-400 hover:text-white'}`}
              >
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
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
                className="ml-2 text-xs text-slate-500 hover:text-white"
              >
                Resume auto-cycle
              </Button>
            )}
          </div>
          <div className="text-xs text-slate-500 pb-3">
            Auto-refresh every 3s · Last update {currentTime.toLocaleTimeString()}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="h-1 bg-slate-800/60">
          <div
            className="h-full bg-gradient-to-r from-indigo-500 via-violet-500 to-pink-500 transition-all duration-500"
            style={{ width: `${stats.totalMatches > 0 ? (stats.completed / stats.totalMatches) * 100 : 0}%` }}
          />
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:h-[calc(100vh-180px)]">
        {/* Left Column - Current Matches (TV hero) */}
        <div className="w-full md:w-1/2 p-4 md:p-6 border-r border-white/5 overflow-hidden">
          <div className="flex items-center mb-6">
            <Zap className="h-6 w-6 text-amber-400 mr-2" />
            <h2 className="text-2xl font-bold text-amber-400 uppercase tracking-wider">Now competing</h2>
          </div>

          {inProgressMatches.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-500">
              <Clock className="h-20 w-20 mb-4 opacity-50" />
              <p className="text-2xl">No matches in progress</p>
              <p className="text-sm text-slate-600 mt-2">Stand by for the next match</p>
            </div>
          ) : (
            <div className="space-y-3 overflow-y-auto max-h-[calc(100vh-280px)] pr-2">
              {inProgressMatches.map((match) => {
                const division = getDivisionForMatch(match);
                return (
                  <Card key={match.id} className="overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500/15 via-slate-900 to-slate-900 border-2 border-amber-500/40">
                    <CardBody className="p-6">
                      <div className="relative">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full blur-3xl" />
                        <div className="relative">
                          <div className="flex items-center justify-between mb-4">
                            <div className="text-sm text-amber-300 font-semibold uppercase tracking-wider">
                              {division?.name} · Match #{match.matchNumber}
                            </div>
                            <div className="flex items-center gap-1.5 text-xs text-amber-300">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" /> LIVE
                            </div>
                          </div>
                          <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center">
                            <div className="min-w-0">
                              <div className="text-xl md:text-3xl lg:text-4xl font-bold tracking-tight">
                                {getCompetitorName(match.competitor1)}
                              </div>
                              <div className="text-slate-400 text-sm mt-0.5">
                                {getCompetitorSchool(match.competitor1) || '—'}
                              </div>
                            </div>
                            <div className="px-2 md:px-4 text-xl md:text-2xl font-black text-slate-600 tracking-widest">VS</div>
                            <div className="min-w-0 text-right">
                              <div className="text-xl md:text-3xl lg:text-4xl font-bold tracking-tight">
                                {getCompetitorName(match.competitor2)}
                              </div>
                              <div className="text-slate-400 text-sm mt-0.5">
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
          <div className="mt-6">
            <div className="flex items-center mb-3">
              <Clock className="h-4 w-4 text-sky-400 mr-2" />
              <h3 className="text-sm font-semibold text-sky-400 uppercase tracking-wider">Up next</h3>
            </div>
            {readyMatches.length === 0 ? (
              <p className="text-slate-500 text-sm">No upcoming matches</p>
            ) : (
              <div className="space-y-1.5 max-h-[180px] overflow-y-auto pr-1">
                {readyMatches.map((match, index) => {
                  const division = getDivisionForMatch(match);
                  return (
                    <div
                      key={match.id}
                      className={`bg-slate-900/60 rounded-lg px-3 py-2 flex items-center justify-between transition-colors ${
                        index === 0 ? 'ring-1 ring-sky-500/50 bg-sky-950/30' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-400 flex-shrink-0">
                          {index + 1}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">
                            {getCompetitorName(match.competitor1)} vs {getCompetitorName(match.competitor2)}
                          </div>
                          <div className="text-xs text-slate-500 truncate">{division?.name}</div>
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-slate-600 flex-shrink-0" />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column - Recent Results & Stats */}
        <div className="w-full md:w-1/2 p-4 md:p-6">
          <div className="flex items-center mb-6">
            <Award className="h-6 w-6 text-green-400 mr-2" />
            <h2 className="text-2xl font-bold text-green-400">RECENT RESULTS</h2>
          </div>

          {recentResults.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-500">
              <Trophy className="h-16 w-16 mb-4" />
              <p className="text-xl">No results yet</p>
            </div>
          ) : (
            <div className="space-y-3">
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
                  <Card key={match.id} className="bg-gray-900/50">
                    <CardBody className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="text-sm text-gray-500 mb-1">{division?.name}</div>
                          <div className="flex items-center">
                            <Award className="h-5 w-5 text-yellow-400 mr-2" />
                            <span className="font-bold text-green-400">
                              {getCompetitorName(winner)}
                            </span>
                            <span className="mx-2 text-gray-600">defeated</span>
                            <span className="text-gray-400">{getCompetitorName(loser)}</span>
                          </div>
                        </div>
                        {(match.score1 || match.score2) && (
                          <div className="text-lg font-mono font-bold text-gray-400">
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
          <div className="mt-8">
            <div className="flex items-center mb-4">
              <Users className="h-5 w-5 text-purple-400 mr-2" />
              <h3 className="text-xl font-semibold text-purple-400">DIVISION STATUS</h3>
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
                  <div className="bg-gray-900/30 border border-gray-700/50 rounded-lg p-6 text-center">
                    <Users className="h-8 w-8 text-gray-600 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">
                      No divisions generated yet. The director is still setting up categories.
                    </p>
                  </div>
                );
              }
              if (divisionsWithBrackets.length === 0) {
                return (
                  <div className="bg-gray-900/30 border border-gray-700/50 rounded-lg p-6 text-center">
                    <Users className="h-8 w-8 text-gray-600 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">
                      Divisions are set, but brackets haven't been generated yet.
                    </p>
                  </div>
                );
              }
              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                      className={`p-3 rounded-lg ${
                        isActive
                          ? 'bg-yellow-900/30 border border-yellow-500/50'
                          : isDone
                          ? 'bg-green-900/20 border border-green-500/30'
                          : 'bg-gray-900/50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-sm truncate flex-1">
                          {division.name}
                        </div>
                        {isActive && <Zap className="h-4 w-4 text-yellow-400 ml-2" />}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {completed}/{total} complete
                      </div>
                      <div className="mt-1 h-1 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${isDone ? 'bg-green-500' : 'bg-blue-500'}`}
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
