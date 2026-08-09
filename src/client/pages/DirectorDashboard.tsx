import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAuthHeaders, useAuth } from '../context/AuthContext';
import { isDemoUser } from '../utils/demo-progress';
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
  Monitor,
} from 'lucide-react';
import { CardSkeleton } from '../components/ui/Skeleton';
import { Card, CardHeader, CardBody } from '../components/ui';
import { PageHeader } from '../components/ui';
import { Button } from '../components/ui';
import { StatTile } from '../components/ui';
import type { ApiDivision, ApiMatch, ApiTournamentSummary } from '../utils/api-types';

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
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const demoReadOnly = isDemoUser(user);

  // Display mode state (M8). Three modes:
  // - 'all': auto-cycle through every ring with active matches (default)
  // - 'ring': pin to a single ring number
  // - 'featured': pin to a specific match ID (e.g. the finals)
  const [displayMode, setDisplayMode] = useState<'all' | 'ring' | 'featured'>('all');
  const [displayRing, setDisplayRing] = useState<number>(1);
  const [displayMatchId, setDisplayMatchId] = useState<string>('');

  const displaySettingsMutation = useMutation({
    mutationFn: async () => {
      const payload =
        displayMode === 'all' ? {}
        : displayMode === 'ring' ? { mode: 'ring', ringNumber: displayRing }
        : { mode: 'featured', featuredMatchId: displayMatchId };
      const res = await fetch(`/api/tournaments/${tournamentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ settings: { display: payload } }),
      });
      if (!res.ok) throw new Error('Failed to update display settings');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['director-dashboard', tournamentId] });
    },
  });

  const { data: progress, isLoading } = useQuery<TournamentProgress>({
    queryKey: ['director-dashboard', tournamentId],
    queryFn: async () => {
      const [tournamentRes, divisionsRes] = await Promise.all([
        fetch(`/api/tournaments/${tournamentId}`, { headers: getAuthHeaders() }),
        fetch(`/api/divisions/tournament/${tournamentId}?withMatches=true`, { headers: getAuthHeaders() }),
      ]);

      if (!tournamentRes.ok) throw new Error('Failed to fetch tournament');

      const tournament = (await tournamentRes.json()) as ApiTournamentSummary;
      const divisions: ApiDivision[] = divisionsRes.ok ? await divisionsRes.json() : [];

      const matches: ApiMatch[] = divisions.flatMap((d) =>
        (d.bracket?.matches ?? []).map((m) => ({
          ...m,
          _divisionId: d.id,
          _divisionName: d.name,
        }))
      );

      const completedDivisions = divisions.filter((d) => {
        const dm = matches.filter((m) => m._divisionId === d.id);
        return dm.length > 0 && dm.every((m) => m.status === 'completed' || m.status === 'bye');
      }).length;
      const inProgressDivisions = divisions.filter((d) =>
        matches.some((m) => m._divisionId === d.id && m.status === 'in_progress')
      ).length;

      const completedMatches = matches.filter((m) => m.status === 'completed').length;
      const inProgressMatches = matches.filter((m) => m.status === 'in_progress').length;
      const scheduledMatches = matches.filter((m) => m.status === 'ready' || m.status === 'pending').length;

      const ringMap = new Map<string, ApiMatch[]>();
      matches.forEach((m) => {
        const ring = m.ringNumber != null ? `Ring ${m.ringNumber}` : null;
        if (!ring) return;
        if (!ringMap.has(ring)) ringMap.set(ring, []);
        ringMap.get(ring)!.push(m);
      });

      const rings: RingStatus[] = [];
      ringMap.forEach((ringMatches, ring) => {
        const currentMatch = ringMatches.find((m) => m.status === 'in_progress');
        const upcoming = ringMatches.filter((m) => m.status === 'ready' || m.status === 'pending').length;
        const allCompleted = ringMatches.every((m) => m.status === 'completed' || m.status === 'bye');

        const getCompetitorName = (slot: ApiMatch['competitor1']) => {
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
            // The DB column is `DateTime?`; we coerce null to undefined
            // here because RingStatus.startedAt is typed as optional
            // (not nullable) for the renderer's convenience.
            startedAt: currentMatch.updatedAt ?? undefined,
          } : undefined,
          upcomingMatches: upcoming,
          status: currentMatch ? 'active' : allCompleted ? 'completed' : 'idle',
        });
      });

      // Backfill from configured ring count. The schedule generator persists
      // config.ringCount to tournament.settings.rings.count when the user
      // regenerates the schedule, so the dashboard shows configured-but-empty
      // rings (status: 'idle', 0 upcoming) instead of "No rings assigned yet".
      // Closes #34.
      let configuredRingCount = 0;
      try {
        const settings = tournament.settings ? JSON.parse(tournament.settings) : null;
        configuredRingCount = settings?.rings?.count || 0;
      } catch {
        configuredRingCount = 0;
      }
      if (configuredRingCount > 0) {
        for (let i = 1; i <= configuredRingCount; i++) {
          const ringKey = `Ring ${i}`;
          if (!rings.some((r) => r.ring === ringKey)) {
            rings.push({
              ring: ringKey,
              upcomingMatches: 0,
              status: 'idle',
            });
          }
        }
      }

      const divisionDetails: DivisionStats[] = divisions.map((d) => {
        const divMatches = matches.filter((m) => m._divisionId === d.id);
        const completed = divMatches.filter((m) => m.status === 'completed').length;
        const inProgress = divMatches.filter((m) => m.status === 'in_progress').length;
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
          // Division-level ring assignment isn't part of the
          // divisions response — rings live on individual matches
          // and surface via the `rings` field on the response. The
          // DivisionStats type keeps the optional field for future
          // use, but it's never populated here today.
        };
      });

      const warnings: string[] = [];

      const noBracket = divisions.filter((d) => !d.bracket);
      if (noBracket.length > 0) {
        warnings.push(`${noBracket.length} division(s) have no bracket generated`);
      }

      rings.forEach((r) => {
        if (r.status === 'idle' && r.upcomingMatches > 0) {
          warnings.push(`Ring ${r.ring} is idle with ${r.upcomingMatches} pending matches`);
        }
      });

      const longMatches = matches.filter((m) => {
        if (m.status !== 'in_progress') return false;
        // updatedAt is `string | null` from the API; a match can be
        // in_progress with a null updatedAt (e.g. legacy rows). Fall
        // back to "right now" so the warning doesn't trip on the
        // unparseable case — better to skip the warning than crash.
        const startTime = m.updatedAt ? new Date(m.updatedAt).getTime() : Date.now();
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
          checkedIn: 0,
          competing: inProgressMatches * 2,
          eliminated: completedMatches,
        },
        estimatedTimeRemaining,
        rings: rings.sort((a, b) => a.ring.localeCompare(b.ring)),
        divisionDetails: divisionDetails.sort((a, b) => {
          if (a.status === 'in_progress' && b.status !== 'in_progress') return -1;
          if (b.status === 'in_progress' && a.status !== 'in_progress') return 1;
          return a.name.localeCompare(b.name);
        }),
        warnings,
      };
    },
    refetchInterval: 10000,
  refetchIntervalInBackground: false,
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
        <p className="text-gray-600 dark:text-gray-400">Tournament not found</p>
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
      <PageHeader
        title="Director Dashboard"
        description={progress.tournament.name}
        actions={
          <div className="text-right">
            <div className="text-sm text-gray-600 dark:text-gray-400">Last updated</div>
            <div className="text-lg font-medium text-gray-900 dark:text-white">{new Date().toLocaleTimeString()}</div>
          </div>
        }
      >
        <Link
          to={`/tournaments/${tournamentId}`}
          className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 flex items-center mb-2"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Tournament
        </Link>
      </PageHeader>

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
        <StatTile
          label="Divisions"
          value={`${progress.divisions.completed}/${progress.divisions.total}`}
          icon={<Target className="h-6 w-6" />}
          trend={{ value: `${divisionProgress}% complete`, direction: 'flat' }}
          accent="indigo"
        />
        <StatTile
          label="Matches"
          value={`${progress.matches.completed}/${progress.matches.total}`}
          icon={<Trophy className="h-6 w-6" />}
          trend={{ value: `${matchProgress}% complete`, direction: 'flat' }}
          accent="success"
        />
        <StatTile
          label="Active Matches"
          value={progress.matches.inProgress}
          icon={<Activity className="h-6 w-6" />}
          trend={{ value: `${progress.matches.scheduled} scheduled`, direction: 'flat' }}
          accent="warning"
        />
        <StatTile
          label="Est. Time Remaining"
          value={
            progress.estimatedTimeRemaining > 60
              ? `${Math.floor(progress.estimatedTimeRemaining / 60)}h ${progress.estimatedTimeRemaining % 60}m`
              : `${progress.estimatedTimeRemaining}m`
          }
          icon={<Timer className="h-6 w-6" />}
          trend={{ value: '~5 min/match', direction: 'flat' }}
          accent="default"
        />
      </div>

      {/* Ring Status */}
      <Card>
        <CardHeader title="Ring Status" />
        <CardBody>
          {progress.rings.length === 0 ? (
            <p className="text-gray-600 dark:text-gray-400 text-center py-4">
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
                    <h3 className="font-bold text-lg text-gray-900 dark:text-white">{ring.ring}</h3>
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
                    <p className="text-sm text-gray-600 dark:text-gray-400">No active match</p>
                  )}
                  <p className="text-xs text-gray-600 dark:text-gray-500 mt-2">
                    {ring.upcomingMatches} match{ring.upcomingMatches !== 1 ? 'es' : ''} remaining
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Division Progress */}
      <Card>
        <CardHeader title="Division Progress" />
        <CardBody>
          {progress.divisionDetails.length === 0 ? (
            <p className="text-gray-600 dark:text-gray-400 text-center py-4">
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
                        <Clock className="h-5 w-5 text-gray-600 dark:text-gray-500" />
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
                        <span className="text-xs text-gray-600 dark:text-gray-400 ml-2">
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
                    <span className="text-xs text-gray-600 dark:text-gray-400 w-16 text-right">
                      ~{division.estimatedMinutesRemaining}m
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Button
          as={Link}
          to={`/tournaments/${tournamentId}/divisions`}
          variant="secondary"
          className="justify-center"
        >
          <Target className="h-4 w-4 mr-2" />
          Manage Divisions
        </Button>
        <Button
          as={Link}
          to={`/tournaments/${tournamentId}/schedule`}
          variant="secondary"
          className="justify-center"
        >
          <Clock className="h-4 w-4 mr-2" />
          View Schedule
        </Button>
        <Button
          as={Link}
          to={`/scorekeeper/${tournamentId}`}
          target="_blank"
          variant="secondary"
          className="justify-center"
        >
          <Activity className="h-4 w-4 mr-2" />
          Scorekeeper
        </Button>
        <Button
          as={Link}
          to={`/display/${tournamentId}`}
          target="_blank"
          variant="secondary"
          className="justify-center"
        >
          <Trophy className="h-4 w-4 mr-2" />
          Public Display
        </Button>
      </div>

      {/* Display Mode Toggle — closes M8 from the UI audit. Pin the
          venue TV to a specific ring or a specific match so the
          director can make sure the crowd sees what matters. */}
      <Card>
        <CardHeader title="Public Display Mode" description="Pin the venue TV to a specific ring or match." />
        <CardBody>
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1">
              <label htmlFor="display-mode" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mode</label>
              <select
                id="display-mode"
                value={displayMode}
                disabled={demoReadOnly}
                onChange={(e) => setDisplayMode(e.target.value as 'all' | 'ring' | 'featured')}
                className="h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 w-full sm:w-auto"
              >
                <option value="all">All rings (auto-cycle)</option>
                <option value="ring">Single ring</option>
                <option value="featured">Featured match</option>
              </select>
            </div>
            {displayMode === 'ring' && (
              <div className="flex-1">
                <label htmlFor="display-ring" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Ring</label>
                <select
                  id="display-ring"
                  value={displayRing}
                  disabled={demoReadOnly}
                  onChange={(e) => setDisplayRing(parseInt(e.target.value, 10))}
                  className="h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 w-full sm:w-auto"
                >
                  {Array.from(
                    new Set(
                      progress.divisionDetails
                        .flatMap((d) => d.ring)
                        .filter((r): r is string => Boolean(r))
                    )
                  )
                    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
                    .map((r) => (
                      <option key={r} value={parseInt(r, 10) || 0}>Ring {r}</option>
                    ))}
                </select>
              </div>
            )}
            {displayMode === 'featured' && (
              <div className="flex-1">
                <label htmlFor="display-match" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Match ID</label>
                <input
                  id="display-match"
                  type="text"
                  value={displayMatchId}
                  disabled={demoReadOnly}
                  onChange={(e) => setDisplayMatchId(e.target.value)}
                  placeholder="e.g. 7f59a9ad-6b08-4867-96e5-d5a8a29a682b"
                  className="h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 font-mono w-full"
                />
              </div>
            )}
            <Button
              variant="primary"
              onClick={() => displaySettingsMutation.mutate()}
              loading={displaySettingsMutation.isPending}
              disabled={demoReadOnly}
            >
              <Monitor className="h-4 w-4 mr-2" /> Apply
            </Button>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            {demoReadOnly ? 'Public display controls are read-only in the public demo.' : <>The public scoreboard at <a href={`/display/${tournamentId}`} target="_blank" rel="noopener noreferrer" className="underline">/display/{tournamentId}</a> will read this and filter its view.</>}
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
