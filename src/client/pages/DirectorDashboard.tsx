import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getAuthHeaders } from '../context/AuthContext';
import {
  LayoutDashboard,
  ArrowLeft,
  Users,
  Trophy,
  Clock,
  AlertTriangle,
  CheckCircle,
  Play,
  Pause,
  Activity,
  Timer,
  Target,
  TrendingUp,
} from 'lucide-react';
import { CardSkeleton } from '../components/ui/Skeleton';

interface DivisionStats {
  id: string;
  name: string;
  totalMatches: number;
  completedMatches: number;
  inProgressMatches: number;
  estimatedMinutesRemaining: number;
  status: 'not_started' | 'in_progress' | 'completed';
  ring?: string;
}

interface RingStatus {
  ring: string;
  currentMatch?: {
    id: string;
    divisionName: string;
    competitor1: string;
    competitor2: string;
    startedAt?: string;
  };
  upcomingMatches: number;
  status: 'active' | 'idle' | 'completed';
}

interface TournamentProgress {
  tournament: {
    id: string;
    name: string;
    date: string;
    status: string;
  };
  divisions: {
    total: number;
    completed: number;
    inProgress: number;
    notStarted: number;
  };
  matches: {
    total: number;
    completed: number;
    inProgress: number;
    scheduled: number;
  };
  competitors: {
    total: number;
    checkedIn: number;
    competing: number;
    eliminated: number;
  };
  estimatedTimeRemaining: number; // minutes
  rings: RingStatus[];
  divisionDetails: DivisionStats[];
  warnings: string[];
}

const AVERAGE_MATCH_DURATION = 5; // minutes per match

export default function DirectorDashboard() {
  const { id: tournamentId } = useParams<{ id: string }>();

  const { data: progress, isLoading } = useQuery<TournamentProgress>({
    queryKey: ['director-dashboard', tournamentId],
    queryFn: async () => {
      // Fetch tournament data
      const [tournamentRes, divisionsRes] = await Promise.all([
        fetch(`/api/tournaments/${tournamentId}`, { headers: getAuthHeaders() }),
        fetch(`/api/divisions/tournament/${tournamentId}?withMatches=true`, { headers: getAuthHeaders() }),
      ]);

      if (!tournamentRes.ok) throw new Error('Failed to fetch tournament');

      const tournament = await tournamentRes.json();
      const divisions: any[] = divisionsRes.ok ? await divisionsRes.json() : [];

      // Flatten all matches from brackets, annotated with divisionId and divisionName
      const matches = divisions.flatMap((d: any) =>
        (d.bracket?.matches ?? []).map((m: any) => ({
          ...m,
          _divisionId: d.id,
          _divisionName: d.name,
        }))
      );

      // A division is "completed" when all its matches are done, "in_progress" when any match is active
      const completedDivisions = divisions.filter((d: any) => {
        const dm = matches.filter((m: any) => m._divisionId === d.id);
        return dm.length > 0 && dm.every((m: any) => m.status === 'completed' || m.status === 'bye');
      }).length;
      const inProgressDivisions = divisions.filter((d: any) =>
        matches.some((m: any) => m._divisionId === d.id && m.status === 'in_progress')
      ).length;

      const completedMatches = matches.filter((m: any) => m.status === 'completed').length;
      const inProgressMatches = matches.filter((m: any) => m.status === 'in_progress').length;
      const scheduledMatches = matches.filter((m: any) => m.status === 'ready' || m.status === 'pending').length;

      // Group matches by ring number for ring status
      const ringMap = new Map<string, any[]>();
      matches.forEach((m: any) => {
        const ring = m.ringNumber != null ? `Ring ${m.ringNumber}` : null;
        if (!ring) return; // skip unassigned
        if (!ringMap.has(ring)) ringMap.set(ring, []);
        ringMap.get(ring)!.push(m);
      });

      const rings: RingStatus[] = [];
      ringMap.forEach((ringMatches, ring) => {
        const currentMatch = ringMatches.find((m: any) => m.status === 'in_progress');
        const upcoming = ringMatches.filter((m: any) => m.status === 'ready' || m.status === 'pending').length;
        const allCompleted = ringMatches.every((m: any) => m.status === 'completed' || m.status === 'bye');

        const getCompetitorName = (slot: any) => {
          const comp = slot?.competitor;
          return comp ? `${comp.firstName} ${comp.lastName}` : 'TBD';
        };

        rings.push({
          ring,
          currentMatch: currentMatch ? {
            id: currentMatch.id,
            divisionName: currentMatch._divisionName || 'Unknown',
            competitor1: getCompetitorName(currentMatch.competitor1),
            competitor2: getCompetitorName(currentMatch.competitor2),
            startedAt: currentMatch.updatedAt,
          } : undefined,
          upcomingMatches: upcoming,
          status: currentMatch ? 'active' : allCompleted ? 'completed' : 'idle',
        });
      });

      // Calculate division details
      const divisionDetails: DivisionStats[] = divisions.map((d: any) => {
        const divMatches = matches.filter((m: any) => m._divisionId === d.id);
        const completed = divMatches.filter((m: any) => m.status === 'completed').length;
        const inProgress = divMatches.filter((m: any) => m.status === 'in_progress').length;
        const remaining = divMatches.length - completed;

        return {
          id: d.id,
          name: d.name,
          totalMatches: divMatches.length,
          completedMatches: completed,
          inProgressMatches: inProgress,
          estimatedMinutesRemaining: remaining * AVERAGE_MATCH_DURATION,
          status: completed === divMatches.length && divMatches.length > 0
            ? 'completed'
            : inProgress > 0 || completed > 0
              ? 'in_progress'
              : 'not_started',
          ring: d.ring,
        };
      });

      // Generate warnings
      const warnings: string[] = [];

      // Divisions with no bracket
      const noBracket = divisions.filter((d: any) => !d.bracket);
      if (noBracket.length > 0) {
        warnings.push(`${noBracket.length} division(s) have no bracket generated`);
      }

      // Idle rings with pending matches
      rings.forEach((r) => {
        if (r.status === 'idle' && r.upcomingMatches > 0) {
          warnings.push(`Ring ${r.ring} is idle with ${r.upcomingMatches} pending matches`);
        }
      });

      // Long running matches (>10 min)
      const longMatches = matches.filter((m: any) => {
        if (m.status !== 'in_progress') return false;
        const startTime = new Date(m.updatedAt).getTime();
        const elapsed = (Date.now() - startTime) / 60000;
        return elapsed > 10;
      });
      if (longMatches.length > 0) {
        warnings.push(`${longMatches.length} match(es) running longer than 10 minutes`);
      }

      const remainingMatches = matches.length - completedMatches;
      const estimatedTimeRemaining = remainingMatches * AVERAGE_MATCH_DURATION;

      return {
        tournament: {
          id: tournament.id,
          name: tournament.name,
          date: tournament.date,
          status: tournament.status,
        },
        divisions: {
          total: divisions.length,
          completed: completedDivisions,
          inProgress: inProgressDivisions,
          notStarted: divisions.length - completedDivisions - inProgressDivisions,
        },
        matches: {
          total: matches.length,
          completed: completedMatches,
          inProgress: inProgressMatches,
          scheduled: scheduledMatches,
        },
        competitors: {
          total: tournament._count?.registrations || 0,
          checkedIn: 0, // Would need registration checkin data
          competing: inProgressMatches * 2,
          eliminated: completedMatches, // Rough estimate
        },
        estimatedTimeRemaining,
        rings: rings.sort((a, b) => a.ring.localeCompare(b.ring)),
        divisionDetails: divisionDetails.sort((a, b) => {
          // Sort by status (in_progress first), then by name
          if (a.status === 'in_progress' && b.status !== 'in_progress') return -1;
          if (b.status === 'in_progress' && a.status !== 'in_progress') return 1;
          return a.name.localeCompare(b.name);
        }),
        warnings,
      };
    },
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <CardSkeleton />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
        <CardSkeleton />
      </div>
    );
  }

  if (!progress) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 dark:text-gray-400">Tournament not found</p>
      </div>
    );
  }

  const divisionProgress = progress.divisions.total > 0
    ? Math.round((progress.divisions.completed / progress.divisions.total) * 100)
    : 0;
  const matchProgress = progress.matches.total > 0
    ? Math.round((progress.matches.completed / progress.matches.total) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <Link
            to={`/tournaments/${tournamentId}`}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 flex items-center mb-2"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Tournament
          </Link>
          <h1 className="page-title flex items-center">
            <LayoutDashboard className="h-6 w-6 mr-2" />
            Director Dashboard
          </h1>
          <p className="text-gray-600 dark:text-gray-400">{progress.tournament.name}</p>
        </div>
        <div className="text-right">
          <div className="text-sm text-gray-500 dark:text-gray-400">Last updated</div>
          <div className="text-lg font-medium text-gray-900 dark:text-white">{new Date().toLocaleTimeString()}</div>
        </div>
      </div>

      {/* Warnings */}
      {progress.warnings.length > 0 && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
          <div className="flex items-center mb-2">
            <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mr-2" />
            <h3 className="font-medium text-yellow-800 dark:text-yellow-200">Attention Required</h3>
          </div>
          <ul className="space-y-1">
            {progress.warnings.map((warning, i) => (
              <li key={i} className="text-sm text-yellow-700 dark:text-yellow-300 flex items-center">
                <span className="w-1.5 h-1.5 bg-yellow-500 dark:bg-yellow-400 rounded-full mr-2" />
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card">
          <div className="card-body">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Divisions</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {progress.divisions.completed}/{progress.divisions.total}
                </p>
                <p className="text-sm text-gray-400 dark:text-gray-500">{divisionProgress}% complete</p>
              </div>
              <div className="h-12 w-12 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                <Target className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
            <div className="mt-3 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-500"
                style={{ width: `${divisionProgress}%` }}
              />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Matches</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {progress.matches.completed}/{progress.matches.total}
                </p>
                <p className="text-sm text-gray-400 dark:text-gray-500">{matchProgress}% complete</p>
              </div>
              <div className="h-12 w-12 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                <Trophy className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
            </div>
            <div className="mt-3 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-600 transition-all duration-500"
                style={{ width: `${matchProgress}%` }}
              />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Active Matches</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{progress.matches.inProgress}</p>
                <p className="text-sm text-gray-400 dark:text-gray-500">
                  {progress.matches.scheduled} scheduled
                </p>
              </div>
              <div className="h-12 w-12 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center">
                <Activity className="h-6 w-6 text-purple-600 dark:text-purple-400" />
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Est. Time Remaining</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {progress.estimatedTimeRemaining > 60
                    ? `${Math.floor(progress.estimatedTimeRemaining / 60)}h ${progress.estimatedTimeRemaining % 60}m`
                    : `${progress.estimatedTimeRemaining}m`}
                </p>
                <p className="text-sm text-gray-400 dark:text-gray-500">~5 min/match</p>
              </div>
              <div className="h-12 w-12 bg-orange-100 dark:bg-orange-900/30 rounded-full flex items-center justify-center">
                <Timer className="h-6 w-6 text-orange-600 dark:text-orange-400" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Ring Status */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white flex items-center">
            <TrendingUp className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" />
            Ring Status
          </h2>
        </div>
        <div className="card-body">
          {progress.rings.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-center py-4">
              No rings assigned yet. Assign rings in the schedule page.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {progress.rings.map((ring) => (
                <div
                  key={ring.ring}
                  className={`p-4 rounded-lg border-2 ${
                    ring.status === 'active'
                      ? 'border-green-500 dark:border-green-600 bg-green-50 dark:bg-green-900/30'
                      : ring.status === 'completed'
                      ? 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700'
                      : 'border-yellow-400 dark:border-yellow-600 bg-yellow-50 dark:bg-yellow-900/30'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-bold text-lg text-gray-900 dark:text-white">Ring {ring.ring}</h3>
                    <span
                      className={`flex items-center text-sm ${
                        ring.status === 'active'
                          ? 'text-green-600 dark:text-green-400'
                          : ring.status === 'completed'
                          ? 'text-gray-500 dark:text-gray-400'
                          : 'text-yellow-600 dark:text-yellow-400'
                      }`}
                    >
                      {ring.status === 'active' ? (
                        <>
                          <Play className="h-4 w-4 mr-1" />
                          Active
                        </>
                      ) : ring.status === 'completed' ? (
                        <>
                          <CheckCircle className="h-4 w-4 mr-1" />
                          Done
                        </>
                      ) : (
                        <>
                          <Pause className="h-4 w-4 mr-1" />
                          Idle
                        </>
                      )}
                    </span>
                  </div>
                  {ring.currentMatch ? (
                    <div className="text-sm">
                      <p className="text-gray-600 dark:text-gray-400 mb-1">{ring.currentMatch.divisionName}</p>
                      <p className="font-medium text-gray-900 dark:text-white">
                        {ring.currentMatch.competitor1} vs {ring.currentMatch.competitor2}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500 dark:text-gray-400">No active match</p>
                  )}
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                    {ring.upcomingMatches} match{ring.upcomingMatches !== 1 ? 'es' : ''} remaining
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Division Progress */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white flex items-center">
            <Users className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" />
            Division Progress
          </h2>
        </div>
        <div className="card-body">
          {progress.divisionDetails.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-center py-4">
              No divisions created yet.
            </p>
          ) : (
            <div className="space-y-3">
              {progress.divisionDetails.map((division) => {
                const percent = division.totalMatches > 0
                  ? Math.round((division.completedMatches / division.totalMatches) * 100)
                  : 0;

                return (
                  <div key={division.id} className="flex items-center gap-4">
                    <div className="w-8 flex-shrink-0">
                      {division.status === 'completed' ? (
                        <CheckCircle className="h-5 w-5 text-green-500 dark:text-green-400" />
                      ) : division.status === 'in_progress' ? (
                        <Play className="h-5 w-5 text-blue-500 dark:text-blue-400" />
                      ) : (
                        <Clock className="h-5 w-5 text-gray-400 dark:text-gray-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <Link
                          to={`/tournaments/${tournamentId}/divisions/${division.id}/bracket`}
                          className="text-sm font-medium truncate text-gray-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400"
                        >
                          {division.name}
                        </Link>
                        <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                          {division.completedMatches}/{division.totalMatches} matches
                        </span>
                      </div>
                      <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            division.status === 'completed'
                              ? 'bg-green-500'
                              : division.status === 'in_progress'
                              ? 'bg-blue-500'
                              : 'bg-gray-300 dark:bg-gray-600'
                          }`}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                    {division.ring && (
                      <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-2 py-1 rounded">
                        Ring {division.ring}
                      </span>
                    )}
                    <span className="text-xs text-gray-500 dark:text-gray-400 w-16 text-right">
                      ~{division.estimatedMinutesRemaining}m
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Link
          to={`/tournaments/${tournamentId}/divisions`}
          className="btn btn-secondary justify-center"
        >
          <Target className="h-4 w-4 mr-2" />
          Manage Divisions
        </Link>
        <Link
          to={`/tournaments/${tournamentId}/schedule`}
          className="btn btn-secondary justify-center"
        >
          <Clock className="h-4 w-4 mr-2" />
          View Schedule
        </Link>
        <Link
          to={`/scorekeeper/${tournamentId}`}
          target="_blank"
          className="btn btn-secondary justify-center"
        >
          <Activity className="h-4 w-4 mr-2" />
          Scorekeeper
        </Link>
        <Link
          to={`/display/${tournamentId}`}
          target="_blank"
          className="btn btn-secondary justify-center"
        >
          <Trophy className="h-4 w-4 mr-2" />
          Public Display
        </Link>
      </div>
    </div>
  );
}
