import { useState, useRef, useEffect } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import SafeLink from '../components/ui/SafeLink';
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
  RefreshCw,
  AlertCircle,
  Bell,
} from 'lucide-react';
import { CardSkeleton } from '../components/ui/Skeleton';
import { Card, CardHeader, CardBody } from '../components/ui';
import { PageHeader } from '../components/ui';
import { Button } from '../components/ui';
import { Input } from '../components/ui';
import { StatTile } from '../components/ui';
import Spinner from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';
import OperationStatus from '../components/ui/OperationStatus';
import type { ApiDivision, ApiMatch, ApiTournamentSummary } from '../../shared/contracts';
import { useOfflineOperations } from '../hooks/useOfflineOperations';
import {
  parseDirectorDashboardFilters,
  serializeDirectorDashboardFilters,
  updateSearchParams,
} from '../utils/url-state';

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

interface OperationalQueryAnswer {
  answer: string;
  generatedAt: string;
  evidence: Array<{ label: string; href: string; observedAt: string }>;
}

interface AttentionAlert {
  id: string;
  kind: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  summary: string;
  recommendation: string;
  href: string;
  affectedLabels: string[];
}

interface AttentionResponse {
  alerts: AttentionAlert[];
  generatedAt: string;
}

// P2-10: SOS Alert interface
interface SOSAlert {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  category: string;
  title: string;
  description: string | null;
  // SH-4 scope: Match.ring became a free-form string. SOSAlert's
  // ringNumber is a separate column (see 20260909_add_video_url_
  // and_sos_alerts) and is NOT part of the SH-4 reconciliation,
  // so the SOSAlert client snapshot keeps the legacy field name.
  ringNumber: number | null;
  divisionId: string | null;
  resolved: boolean;
  resolvedAt: string | null;
  raisedBy: string | null;
  raisedByName: string | null;
  createdAt: string;
}

const AVERAGE_MATCH_DURATION = 5; // minutes per match

export default function DirectorDashboard() {
  const { id: tournamentId } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const demoReadOnly = isDemoUser(user);
  const offlineOperations = useOfflineOperations(tournamentId);

  // Read filters from URL
  const urlFilters = parseDirectorDashboardFilters(searchParams);
  
  // Display mode state (M8). Three modes:
  // - 'all': auto-cycle through every ring with active matches (default)
  // - 'ring': pin to a single ring number
  // - 'featured': pin to a specific match ID (e.g. the finals)
  const [displayMode, setDisplayMode] = useState<'all' | 'ring' | 'featured'>('all');
  const [displayRing, setDisplayRing] = useState<number>(urlFilters.ring ? parseInt(urlFilters.ring) : 1);
  const [displayMatchId, setDisplayMatchId] = useState<string>('');
  const [operationalQuestion, setOperationalQuestion] = useState('');
  
  // P2-10: SOS alert state
  const [showNewAlert, setShowNewAlert] = useState(false);
  const [alertCategory, setAlertCategory] = useState('ring');
  const [alertSeverity, setAlertSeverity] = useState<'info' | 'warning' | 'critical'>('warning');
  const [alertTitle, setAlertTitle] = useState('');
  const [alertDescription, setAlertDescription] = useState('');
  const [alertRingNumber, setAlertRingNumber] = useState<number | null>(null);
  
  // Ring sync indicator state (P1-9)
  const [ringUpdates, setRingUpdates] = useState<Record<string, number>>({});
  const [currentTime, setCurrentTime] = useState(Date.now());
  const previousDataRef = useRef<string>('');

  // Sync filters to URL when they change
  useEffect(() => {
    const filters = serializeDirectorDashboardFilters({
      ring: displayMode === 'ring' ? String(displayRing) : undefined,
      alertsOnly: urlFilters.alertsOnly,
    });
    const newParams = updateSearchParams(searchParams, filters);
    if (newParams.toString() !== searchParams.toString()) {
      setSearchParams(newParams, { replace: true });
    }
  }, [displayMode, displayRing, urlFilters.alertsOnly, searchParams, setSearchParams]);

  // Update current time every second for relative timestamps
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const displaySettingsMutation = useMutation({
    mutationFn: async () => {
      const payload =
        displayMode === 'all' ? {}
        : displayMode === 'ring' ? { mode: 'ring', ring: displayRing }
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

  const { data: progress, isLoading, isError, error, refetch } = useQuery<TournamentProgress>({
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
        const ring = m.ring != null ? `Ring ${m.ring}` : null;
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
  
  // Track ring updates for sync freshness indicator (P1-9) - moved from onSuccess to useEffect per React Query v5
  useEffect(() => {
    if (progress?.rings) {
      const currentDataStr = JSON.stringify(progress.rings.map(r => ({
        ring: r.ring,
        status: r.status,
        currentMatch: r.currentMatch?.id,
        upcomingMatches: r.upcomingMatches,
      })));
      
      if (currentDataStr !== previousDataRef.current) {
        const now = Date.now();
        const updates: Record<string, number> = {};
        progress.rings.forEach(ring => {
          updates[ring.ring] = now;
        });
        setRingUpdates(prev => ({ ...prev, ...updates }));
        previousDataRef.current = currentDataStr;
      }
    }
  }, [progress]);

  const attentionQuery = useQuery<AttentionResponse>({
    queryKey: ['tournament-attention', tournamentId],
    enabled: Boolean(tournamentId),
    queryFn: async () => {
      const response = await fetch(`/api/tournaments/${tournamentId}/attention`, { headers: getAuthHeaders() });
      if (!response.ok) throw new Error('The command centre could not load current alerts.');
      return response.json() as Promise<AttentionResponse>;
    },
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });

  // P2-10: SOS alerts query
  const sosAlertsQuery = useQuery<{ alerts: SOSAlert[] }>({
    queryKey: ['sos-alerts', tournamentId],
    enabled: Boolean(tournamentId),
    queryFn: async () => {
      const response = await fetch(`/api/sos-alerts/tournament/${tournamentId}`, { headers: getAuthHeaders() });
      if (!response.ok) throw new Error('Failed to load SOS alerts');
      return response.json() as Promise<{ alerts: SOSAlert[] }>;
    },
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });

  // P2-10: Create SOS alert mutation
  const createSOSAlert = useMutation({
    mutationFn: async (data: { severity: string; category: string; title: string; description?: string; ring?: number }) => {
      const response = await fetch(`/api/sos-alerts/tournament/${tournamentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error('Failed to create alert');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sos-alerts'] });
      setShowNewAlert(false);
      setAlertTitle('');
      setAlertDescription('');
      setAlertRingNumber(null);
    },
  });

  // P2-10: Resolve SOS alert mutation
  const resolveSOSAlert = useMutation({
    mutationFn: async (alertId: string) => {
      const response = await fetch(`/api/sos-alerts/${alertId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ resolved: true }),
      });
      if (!response.ok) throw new Error('Failed to resolve alert');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sos-alerts'] });
    },
  });

  const operationalQueryMutation = useMutation({
    mutationFn: async (question: string): Promise<OperationalQueryAnswer> => {
      const response = await fetch(`/api/tournaments/${tournamentId}/operational-query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ question }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'The operational question could not be answered.');
      return body as OperationalQueryAnswer;
    },
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

  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Director Dashboard"
          description="Tournament data unavailable"
        >
          <Link
            to={`/tournaments/${tournamentId}`}
            className="text-sm text-surface-600 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300 flex items-center mb-2"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Tournament
          </Link>
        </PageHeader>
        <OperationStatus
          state="rejected"
          message={error instanceof Error ? error.message : 'Failed to load tournament progress'}
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      </div>
    );
  }

  if (!progress) {
    return (
      <div className="text-center py-12">
        <p className="text-surface-600 dark:text-surface-400">Tournament not found</p>
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
            <div className="text-sm text-surface-600 dark:text-surface-400">Last updated</div>
            <div className="text-lg font-medium text-surface-900 dark:text-white">{new Date().toLocaleTimeString()}</div>
          </div>
        }
      >
        <Link
          to={`/tournaments/${tournamentId}`}
          className="text-sm text-surface-600 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300 flex items-center mb-2"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Tournament
        </Link>
      </PageHeader>

      <section aria-label="Ask about tournament operations">
        <Card>
          <CardHeader title="Ask about tournament operations" description="Read-only answers use current server records. Supported: blocked divisions, the next number of minutes, a late ring, and schools needing check-in." />
          <CardBody className="space-y-3">
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                const question = operationalQuestion.trim();
                if (question) operationalQueryMutation.mutate(question);
              }}
            >
              <label htmlFor="operational-question" className="sr-only">Operational question</label>
              <Input
                id="operational-question"
                value={operationalQuestion}
                onChange={(event) => setOperationalQuestion(event.target.value)}
                placeholder="For example: Why is Ring 3 late?"
                aria-describedby="operational-query-help"
                disabled={operationalQueryMutation.isPending}
              />
              <Button type="submit" loading={operationalQueryMutation.isPending} disabled={!operationalQuestion.trim()}>Ask</Button>
            </form>
            <p id="operational-query-help" className="text-sm text-surface-600 dark:text-surface-400">This never changes tournament data.</p>
            {operationalQueryMutation.isError && (
              <OperationStatus
                state="rejected"
                message={operationalQueryMutation.error instanceof Error ? operationalQueryMutation.error.message : 'The operational question could not be answered.'}
                actionLabel="Retry"
                onAction={() => {
                  const question = operationalQuestion.trim();
                  if (question) operationalQueryMutation.mutate(question);
                }}
              />
            )}
            {operationalQueryMutation.data && (
              <div role="status" className="rounded-lg border border-info/20 bg-info/10 p-3 text-sm text-info dark:border-info/30 dark:bg-info/20 dark:text-info">
                <p>{operationalQueryMutation.data.answer}</p>
                <p className="mt-1 text-xs">Current as of {new Date(operationalQueryMutation.data.generatedAt).toLocaleTimeString()}.</p>
                {operationalQueryMutation.data.evidence.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5">{operationalQueryMutation.data.evidence.map((item) => <li key={`${item.href}:${item.label}`}><Link className="underline" to={item.href}>{item.label}</Link> <span className="text-xs">({new Date(item.observedAt).toLocaleTimeString()})</span></li>)}</ul>}
              </div>
            )}
          </CardBody>
        </Card>
      </section>

      {/* Server-backed command centre */}
      <section aria-labelledby="attention-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
          <h2 id="attention-heading" className="text-lg font-semibold text-surface-900 dark:text-white">Attention required</h2>
          <p className="text-sm text-surface-600 dark:text-surface-400">Live operational risks, ordered by severity.</p>
          </div>
        </div>
        {attentionQuery.isLoading && (
          <div className="flex items-center gap-2 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <Spinner size="sm" />
            <span className="text-sm text-gray-600 dark:text-gray-300">Checking tournament-day risks…</span>
          </div>
        )}
        {attentionQuery.isError && (
          <OperationStatus
            state="rejected"
            message="The command centre is unavailable. Existing tournament data is still shown."
            actionLabel="Retry"
            onAction={() => void attentionQuery.refetch()}
          />
        )}
        {attentionQuery.data?.alerts.length === 0 && offlineOperations.needsReview.length === 0 && (
          <div role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
            <CheckCircle className="h-5 w-5" aria-hidden="true" /> No current operational alerts.
          </div>
        )}
        {offlineOperations.needsReview.length > 0 && (
          <article className="rounded-lg border border-danger/30 bg-danger/10 p-4 dark:border-danger/40 dark:bg-danger/20">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
                <div>
                  <h3 className="font-semibold text-red-900 dark:text-red-100">Offline changes need review</h3>
                  <p className="mt-1 text-sm text-gray-800 dark:text-gray-200">
                    {offlineOperations.needsReview.length} score or check-in change on this device was rejected or has uncertain delivery.
                  </p>
                  <p className="mt-2 text-sm font-medium text-gray-900 dark:text-white">
                    Recommended: open the affected workflow, compare server state, then retry, acknowledge, or discard the local change.
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button as={Link} to={`/checkin/${tournamentId}`} variant="secondary" size="sm">Check-in review</Button>
                <Button as={Link} to={`/scorekeeper/${tournamentId}`} variant="danger" size="sm">Score review</Button>
              </div>
            </div>
          </article>
        )}
        {attentionQuery.data?.alerts.map((alert) => {
          const critical = alert.severity === 'critical';
          return (
            <article
              key={alert.id}
              className={`rounded-lg border p-4 ${critical
                ? 'border-danger/30 bg-danger/10 dark:border-danger/40 dark:bg-danger/20'
                : 'border-warning/30 bg-warning/10 dark:border-warning/40 dark:bg-warning/20'}`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex gap-3">
                  <AlertTriangle className={`mt-0.5 h-5 w-5 shrink-0 ${critical ? 'text-danger' : 'text-warning'}`} aria-hidden="true" />
                  <div>
                    <h3 className={`font-semibold ${critical ? 'text-danger dark:text-danger' : 'text-warning dark:text-warning'}`}>{alert.title}</h3>
                    <p className="mt-1 text-sm text-surface-800 dark:text-surface-200">{alert.summary}</p>
                    <p className="mt-1 text-sm text-surface-700 dark:text-surface-300">Affected: {alert.affectedLabels.join('; ')}</p>
                    <p className="mt-2 text-sm font-medium text-surface-900 dark:text-white">Recommended: {alert.recommendation}</p>
                  </div>
                </div>
                <Button as={Link} to={alert.href} variant={critical ? 'danger' : 'secondary'} size="sm" className="shrink-0">
                  Review
                </Button>
              </div>
            </article>
          );
        })}
      </section>

      {/* P2-10: SOS Alerts Section */}
      <section aria-labelledby="sos-alerts-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 id="sos-alerts-heading" className="text-lg font-semibold text-surface-900 dark:text-white flex items-center gap-2">
              <Bell className="h-5 w-5" />
              SOS Alerts
            </h2>
            <p className="text-sm text-surface-600 dark:text-surface-400">Staff-raised urgent issues requiring immediate attention</p>
          </div>
          <Button variant="primary" size="sm" onClick={() => setShowNewAlert(true)}>
            <AlertCircle className="h-4 w-4 mr-1" />
            Raise Alert
          </Button>
        </div>

        {sosAlertsQuery.isLoading && (
          <div className="flex items-center gap-2 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <Spinner size="sm" />
            <span className="text-sm text-gray-600 dark:text-gray-300">Loading alerts…</span>
          </div>
        )}

        {sosAlertsQuery.isError && (
          <OperationStatus
            state="rejected"
            message="Failed to load SOS alerts"
            actionLabel="Retry"
            onAction={() => void sosAlertsQuery.refetch()}
          />
        )}

        {sosAlertsQuery.data?.alerts.filter(a => !a.resolved).length === 0 && !sosAlertsQuery.isLoading && !sosAlertsQuery.isError && (
          <div role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
            <CheckCircle className="h-5 w-5" aria-hidden="true" /> No active SOS alerts.
          </div>
        )}

        {sosAlertsQuery.data?.alerts.filter(a => !a.resolved).map((alert) => {
          const critical = alert.severity === 'critical';
          const warning = alert.severity === 'warning';
          return (
            <article
              key={alert.id}
              className={`rounded-lg border p-4 ${
                critical
                  ? 'border-danger/30 bg-danger/10 dark:border-danger/40 dark:bg-danger/20'
                  : warning
                    ? 'border-warning/30 bg-warning/10 dark:border-warning/40 dark:bg-warning/20'
                    : 'border-info/20 bg-info/10 dark:border-info/30 dark:bg-info/20'
              }`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex gap-3">
                  <AlertCircle
                    className={`mt-0.5 h-5 w-5 shrink-0 ${
                      critical ? 'text-danger' : warning ? 'text-warning' : 'text-info'
                    }`}
                    aria-hidden="true"
                  />
                  <div>
                    <h3
                      className={`font-semibold ${
                        critical
                          ? 'text-danger dark:text-danger'
                          : warning
                            ? 'text-warning dark:text-warning'
                            : 'text-info dark:text-info'
                      }`}
                    >
                      {alert.title}
                      {alert.ring && ` (Ring ${alert.ring})`}
                    </h3>
                    {alert.description && (
                      <p className="mt-1 text-sm text-gray-800 dark:text-gray-200">{alert.description}</p>
                    )}
                    <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                      Raised {new Date(alert.createdAt).toLocaleTimeString()}
                      {alert.raisedByName && ` by ${alert.raisedByName}`}
                    </p>
                  </div>
                </div>
                <Button
                  onClick={() => resolveSOSAlert.mutate(alert.id)}
                  variant="secondary"
                  size="sm"
                  className="shrink-0"
                  disabled={resolveSOSAlert.isPending}
                >
                  Resolve
                </Button>
              </div>
            </article>
          );
        })}

        {/* New Alert Modal */}
        {showNewAlert && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={() => setShowNewAlert(false)}>
            <div className="bg-white dark:bg-surface-800 rounded-xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-xl font-bold mb-4 text-surface-900 dark:text-white">Raise SOS Alert</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Severity</label>
                  <select
                    value={alertSeverity}
                    onChange={(e) => setAlertSeverity(e.target.value as 'info' | 'warning' | 'critical')}
                    className="w-full p-2 border border-surface-300 dark:border-surface-600 rounded-lg bg-white dark:bg-surface-700 text-surface-900 dark:text-white"
                  >
                    <option value="info">Info</option>
                    <option value="warning">Warning</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Category</label>
                  <select
                    value={alertCategory}
                    onChange={(e) => setAlertCategory(e.target.value)}
                    className="w-full p-2 border border-surface-300 dark:border-surface-600 rounded-lg bg-white dark:bg-surface-700 text-surface-900 dark:text-white"
                  >
                    <option value="ring">Ring Issue</option>
                    <option value="division">Division Issue</option>
                    <option value="equipment">Equipment</option>
                    <option value="medical">Medical</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                {alertCategory === 'ring' && (
                  <div>
                    <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Ring Number</label>
                    <input
                      type="number"
                      min="1"
                      value={alertRingNumber || ''}
                      onChange={(e) => setAlertRingNumber(e.target.value ? parseInt(e.target.value) : null)}
                      className="w-full p-2 border border-surface-300 dark:border-surface-600 rounded-lg bg-white dark:bg-surface-700 text-surface-900 dark:text-white"
                      placeholder="e.g. 1, 2, 3"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Title *</label>
                  <input
                    type="text"
                    value={alertTitle}
                    onChange={(e) => setAlertTitle(e.target.value)}
                    className="w-full p-2 border border-surface-300 dark:border-surface-600 rounded-lg bg-white dark:bg-surface-700 text-surface-900 dark:text-white"
                    placeholder="Brief description"
                    maxLength={200}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Description</label>
                  <textarea
                    value={alertDescription}
                    onChange={(e) => setAlertDescription(e.target.value)}
                    className="w-full p-2 border border-surface-300 dark:border-surface-600 rounded-lg bg-white dark:bg-surface-700 text-surface-900 dark:text-white"
                    rows={3}
                    placeholder="Additional details (optional)"
                    maxLength={1000}
                  />
                </div>
                <div className="flex gap-3">
                  <Button
                    variant="primary"
                    onClick={() => {
                      if (alertTitle.trim()) {
                        createSOSAlert.mutate({
                          severity: alertSeverity,
                          category: alertCategory,
                          title: alertTitle.trim(),
                          description: alertDescription.trim() || undefined,
                          ring: alertCategory === 'ring' ? alertRingNumber || undefined : undefined,
                        });
                      }
                    }}
                    disabled={!alertTitle.trim() || createSOSAlert.isPending}
                    className="flex-1"
                  >
                    {createSOSAlert.isPending ? 'Creating...' : 'Create Alert'}
                  </Button>
                  <Button variant="secondary" onClick={() => setShowNewAlert(false)} className="flex-1">
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

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
            <EmptyState
              icon={Monitor}
              title="No rings assigned yet"
              description="Assign rings in the schedule page to track ring status here."
              action={{
                label: 'View Schedule',
                onClick: () => window.location.href = `/tournaments/${tournamentId}/schedule`
              }}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {progress.rings.map((ring) => {
                const lastUpdate = ringUpdates[ring.ring];
                const secondsAgo = lastUpdate ? Math.floor((currentTime - lastUpdate) / 1000) : null;
                const freshnessLabel = secondsAgo === null 
                  ? '' 
                  : secondsAgo < 5 
                  ? 'just now' 
                  : secondsAgo < 60 
                  ? `${secondsAgo}s ago` 
                  : `${Math.floor(secondsAgo / 60)}m ago`;
                
                return (
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
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-lg text-gray-900 dark:text-white">{ring.ring}</h3>
                        {secondsAgo !== null && secondsAgo < 15 && (
                          <RefreshCw className="w-3 h-3 text-green-600 dark:text-green-400 animate-spin" aria-label="Recently updated" />
                        )}
                      </div>
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
                    {freshnessLabel && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                        Updated {freshnessLabel}
                      </div>
                    )}
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
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Division Progress */}
      <Card>
        <CardHeader title="Division Progress" />
        <CardBody>
          {progress.divisionDetails.length === 0 ? (
            <EmptyState
              icon={Target}
              title="No divisions created yet"
              description="Generate divisions from registered competitors to track progress here."
              action={{
                label: 'Manage Divisions',
                onClick: () => window.location.href = `/tournaments/${tournamentId}/divisions`
              }}
            />
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
                      <span className="text-xs bg-gray-100 dark:bg-gray-700 text-surface-700 dark:text-surface-300 px-2 py-1 rounded">
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
          as={SafeLink}
          to={`/scorekeeper/${tournamentId}`}
          target="_blank"
          variant="secondary"
          className="justify-center"
        >
          <Activity className="h-4 w-4 mr-2" />
          Scorekeeper
        </Button>
        <Button
          as={SafeLink}
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
              <label htmlFor="display-mode" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Mode</label>
              <select
                id="display-mode"
                value={displayMode}
                disabled={demoReadOnly}
                onChange={(e) => setDisplayMode(e.target.value as 'all' | 'ring' | 'featured')}
                className="h-10 px-3 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 text-sm text-surface-900 dark:text-surface-100 w-full sm:w-auto"
              >
                <option value="all">All rings (auto-cycle)</option>
                <option value="ring">Single ring</option>
                <option value="featured">Featured match</option>
              </select>
            </div>
            {displayMode === 'ring' && (
              <div className="flex-1">
                <label htmlFor="display-ring" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Ring</label>
                <select
                  id="display-ring"
                  value={displayRing}
                  disabled={demoReadOnly}
                  onChange={(e) => setDisplayRing(parseInt(e.target.value, 10))}
                  className="h-10 px-3 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 text-sm text-surface-900 dark:text-surface-100 w-full sm:w-auto"
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
                <label htmlFor="display-match" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Match ID</label>
                <input
                  id="display-match"
                  type="text"
                  value={displayMatchId}
                  disabled={demoReadOnly}
                  onChange={(e) => setDisplayMatchId(e.target.value)}
                  placeholder="e.g. 7f59a9ad-6b08-4867-96e5-d5a8a29a682b"
                  className="h-10 px-3 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 text-sm text-surface-900 dark:text-surface-100 font-mono w-full"
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



