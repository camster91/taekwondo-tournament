import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Trophy, Clock, Users, ChevronRight, Award, Zap, Building2 } from 'lucide-react';

interface Match {
  id: string;
  matchNumber: number;
  roundNumber: number;
  bracketType: string;
  status: string;
  score1: string | null;
  score2: string | null;
  winnerId: string | null;
  ringNumber: number | null;
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
  const [activeDivisionIndex, setActiveDivisionIndex] = useState(0);
  const [cycleEnabled, setCycleEnabled] = useState(true);

  // Update time every second
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch tournament via public endpoint (no auth required)
  const { data: tournament } = useQuery<Tournament>({
    queryKey: ['scoreboard-tournament', tournamentId],
    queryFn: async () => {
      const res = await fetch(`/api/public/tournaments/${tournamentId}`);
      if (!res.ok) throw new Error('Failed to fetch tournament');
      return res.json();
    },
  });

  // Fetch divisions with brackets via public endpoint (no auth required)
  const { data: divisions } = useQuery<Division[]>({
    queryKey: ['scoreboard-divisions', tournamentId],
    queryFn: async () => {
      const res = await fetch(`/api/public/tournaments/${tournamentId}/scoreboard`);
      if (!res.ok) throw new Error('Failed to fetch scoreboard');
      return res.json();
    },
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  // Filter to divisions with active matches
  const activeDivisions =
    divisions?.filter((d) => {
      if (!d.bracket) return false;
      const hasActiveMatches = d.bracket.matches.some(
        (m) => m.status === 'in_progress' || m.status === 'ready'
      );
      return hasActiveMatches;
    }) || [];

  // Auto-cycle through divisions
  useEffect(() => {
    if (!cycleEnabled || activeDivisions.length <= 1) return;

    const timer = setInterval(() => {
      setActiveDivisionIndex((prev) => (prev + 1) % activeDivisions.length);
    }, 15000); // 15 seconds per division

    return () => clearInterval(timer);
  }, [cycleEnabled, activeDivisions.length]);

  // Keep index in bounds
  useEffect(() => {
    if (activeDivisionIndex >= activeDivisions.length) {
      setActiveDivisionIndex(0);
    }
  }, [activeDivisions.length, activeDivisionIndex]);

  // Get all matches across all divisions
  const allMatches = divisions?.flatMap((d) => d.bracket?.matches || []) || [];

  // Current matches in progress
  const inProgressMatches = allMatches.filter((m) => m.status === 'in_progress');

  // Ready matches (up next)
  const readyMatches = allMatches
    .filter((m) => m.status === 'ready')
    .slice(0, 6);

  // Recent completed matches
  const recentResults = allMatches
    .filter((m) => m.status === 'completed' && m.winnerId)
    .slice(-8)
    .reverse();

  // Stats
  const stats = {
    totalMatches: allMatches.length,
    completed: allMatches.filter((m) => m.status === 'completed').length,
    inProgress: inProgressMatches.length,
    remaining: allMatches.filter((m) => m.status === 'pending' || m.status === 'ready').length,
  };

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
    <div className="min-h-screen bg-gray-950 text-white overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-red-900 via-gray-900 to-red-900 px-8 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <Trophy className="h-10 w-10 text-yellow-400 mr-4" />
            <div>
              <h1 className="text-3xl font-bold">{tournament?.name || 'Tournament'}</h1>
              <p className="text-gray-400">
                {tournament?.location && `${tournament.location} • `}
                {tournament?.date && new Date(tournament.date).toLocaleDateString()}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link
              to={`/tournaments/${tournamentId}/school`}
              className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <Building2 className="h-4 w-4" />
              School Lookup
            </Link>
            <div className="text-right">
              <div className="text-4xl font-mono font-bold text-yellow-400">
                {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
              <div className="text-gray-400 text-sm">
                {stats.completed} / {stats.totalMatches} matches complete
              </div>
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-4 h-2 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-yellow-500 to-green-500 transition-all duration-500"
            style={{ width: `${stats.totalMatches > 0 ? (stats.completed / stats.totalMatches) * 100 : 0}%` }}
          />
        </div>
      </div>

      <div className="flex h-[calc(100vh-140px)]">
        {/* Left Column - Current Matches */}
        <div className="w-1/2 p-6 border-r border-gray-800">
          <div className="flex items-center mb-6">
            <Zap className="h-6 w-6 text-yellow-400 mr-2" />
            <h2 className="text-2xl font-bold text-yellow-400">NOW COMPETING</h2>
          </div>

          {inProgressMatches.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-500">
              <Clock className="h-16 w-16 mb-4" />
              <p className="text-xl">No matches in progress</p>
            </div>
          ) : (
            <div className="space-y-4">
              {inProgressMatches.map((match) => {
                const division = getDivisionForMatch(match);
                return (
                  <div
                    key={match.id}
                    className="bg-gradient-to-r from-yellow-900/30 to-gray-900 rounded-xl p-6 border-2 border-yellow-500/50 animate-pulse"
                  >
                    <div className="text-sm text-yellow-400 mb-3 font-semibold">
                      {division?.name} • Match #{match.matchNumber}
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="text-2xl font-bold">
                          {getCompetitorName(match.competitor1)}
                        </div>
                        <div className="text-gray-400">
                          {getCompetitorSchool(match.competitor1)}
                        </div>
                      </div>
                      <div className="px-6 text-3xl font-bold text-gray-500">VS</div>
                      <div className="flex-1 text-right">
                        <div className="text-2xl font-bold">
                          {getCompetitorName(match.competitor2)}
                        </div>
                        <div className="text-gray-400">
                          {getCompetitorSchool(match.competitor2)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Up Next Queue */}
          <div className="mt-8">
            <div className="flex items-center mb-4">
              <Clock className="h-5 w-5 text-blue-400 mr-2" />
              <h3 className="text-xl font-semibold text-blue-400">UP NEXT</h3>
            </div>
            {readyMatches.length === 0 ? (
              <p className="text-gray-500">No upcoming matches</p>
            ) : (
              <div className="space-y-2">
                {readyMatches.map((match, index) => {
                  const division = getDivisionForMatch(match);
                  const isOnDeck = index < 2;
                  const isWarmingUp = index >= 2 && index < 4;
                  return (
                    <div
                      key={match.id}
                      className={`bg-gray-900/50 rounded-lg p-3 flex items-center justify-between ${
                        isOnDeck
                          ? 'ring-2 ring-blue-500/50'
                          : isWarmingUp
                          ? 'ring-1 ring-yellow-500/30'
                          : ''
                      }`}
                    >
                      <div className="flex items-center">
                        <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center text-sm font-bold mr-3">
                          {index + 1}
                        </div>
                        <div>
                          <div className="font-semibold flex items-center gap-2">
                            {getCompetitorName(match.competitor1)} vs{' '}
                            {getCompetitorName(match.competitor2)}
                            {isOnDeck && (
                              <span className="text-xs font-bold px-2 py-0.5 rounded bg-blue-600 text-white">
                                ON DECK
                              </span>
                            )}
                            {isWarmingUp && (
                              <span className="text-xs font-bold px-2 py-0.5 rounded bg-yellow-600 text-white">
                                WARMING UP
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-gray-500">
                            {division?.name}
                            {match.ringNumber != null && (
                              <span className="ml-2 text-blue-400">Ring {match.ringNumber}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-gray-600" />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column - Recent Results & Stats */}
        <div className="w-1/2 p-6">
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
                  <div key={match.id} className="bg-gray-900/50 rounded-lg p-4">
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
                  </div>
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
            <div className="grid grid-cols-2 gap-2">
              {divisions
                ?.filter((d) => d.bracket)
                .map((division) => {
                  const completed =
                    division.bracket?.matches.filter((m) => m.status === 'completed').length || 0;
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
                  );
                })}
            </div>
          </div>
        </div>
      </div>

      {/* Footer - Active Division Cycle Indicator */}
      {activeDivisions.length > 1 && (
        <div className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 px-8 py-2">
          <div className="flex items-center justify-center gap-2">
            {activeDivisions.map((_, index) => (
              <button
                key={index}
                onClick={() => {
                  setActiveDivisionIndex(index);
                  setCycleEnabled(false);
                }}
                className={`w-3 h-3 rounded-full transition-all ${
                  index === activeDivisionIndex ? 'bg-yellow-400 w-8' : 'bg-gray-600'
                }`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
