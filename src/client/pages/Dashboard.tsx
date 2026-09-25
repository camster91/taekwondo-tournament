import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Trophy,
  Users,
  LayoutGrid,
  Plus,
  ArrowRight,
  School,
  Calendar,
  Target,
  TrendingUp,
  Sparkles,
  Zap,
  ListChecks,
  FileSpreadsheet,
  Check,
  Activity,
  Award,
  Sparkle,
  ArrowUpRight,
} from 'lucide-react';
import { StatsSkeleton, CardSkeleton } from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';
import { StatusBadge } from '../components/ui/Badge';
import { getAuthHeaders, useAuth } from '../context/AuthContext';
import DemoGuide from '../components/demo/DemoGuide';
import OnboardingChecklist from '../components/OnboardingChecklist';
import {
  consumeDemoEntryPending,
  findLiveDemoTournament,
  isDemoUser,
  readDemoProgress,
  restartDemoGuide,
  shouldOpenDemoGuide,
  updateDemoProgress,
  type DemoPath,
} from '../utils/demo-progress';
import { Card, CardHeader, CardBody } from '../components/ui';
import { StatTile } from '../components/ui';
import { PageHeader } from '../components/ui';
import { Button } from '../components/ui';
import {
  getRoleAwareTournamentDestination,
  getRoleAwareTournamentLabel,
  getRoleAwareTournamentAriaLabel,
  type UserRole,
} from '../utils/tournament-navigation';

interface Tournament {
  id: string;
  name: string;
  date: string;
  status: string;
  location?: string;
  publicSlug?: string | null;
  _count: { registrations: number; divisions: number };
}

/**
 * The competitors query is only used to read `.total` (the count badge).
 * Keep the type minimal — the full Competitor shape isn't needed here
 * and a future schema change to Competitor shouldn't ripple into the
 * dashboard's compile pass.
 */
interface CompetitorsResponse { competitors: unknown[]; total: number; }

interface AnalyticsData {
  totals: { competitors: number; tournaments: number; matches: number; completedMatches: number; recentRegistrations: number };
  beltDistribution: { belt: string; count: number }[];
  genderDistribution: { gender: string; count: number }[];
  topSchools: { school: string; count: number }[];
  ageDistribution: { range: string; count: number }[];
}

const BELT_COLORS: Record<string, string> = {
  'White': 'bg-surface-100 text-primary-700 dark:bg-primary-800 dark:text-primary-300',
  'White / Single Yellow Stripe': 'bg-surface-50 text-primary-600 dark:bg-primary-800/50 dark:text-primary-400',
  'White / Double Yellow Stripe': 'bg-surface-50 text-primary-600 dark:bg-primary-800/50 dark:text-primary-400',
  'Yellow': 'bg-warning/100 text-warning800 dark:bg-warning/900/30 dark:text-warning300',
  'Yellow / Single Green Stripe': 'bg-warning/50 text-warning700 dark:bg-warning/900/20 dark:text-warning300',
  'Yellow / Double Green Stripe': 'bg-warning/50 text-warning700 dark:bg-warning/900/20 dark:text-warning300',
  'Green': 'bg-success/100 text-success/800 dark:bg-success/900/30 dark:text-success/300',
  'Green / Single Blue Stripe': 'bg-success/50 text-success/700 dark:bg-success/900/20 dark:text-success/300',
  'Green / Double Blue Stripe': 'bg-success/50 text-success/700 dark:bg-success/900/20 dark:text-success/300',
  'Blue': 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300',
  'Blue / Single Red Stripe': 'bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300',
  'Blue / Double Red Stripe': 'bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300',
  'Red': 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
  'Red / Single Black Stripe': 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300',
  'Red / Double Black Stripe': 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300',
  'Black': 'bg-primary-900 text-white dark:bg-surface-100 dark:text-primary-900',
};

function compactNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 10_000) return (n / 1_000).toFixed(1) + 'k';
  return n.toLocaleString();
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [demoGuideOpen, setDemoGuideOpen] = useState(false);

  const { data: tournaments, isLoading: tournamentsLoading } = useQuery<Tournament[]>({
    queryKey: ['tournaments'],
    queryFn: async () => {
      const res = await fetch('/api/tournaments', { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch tournaments');
      return res.json();
    },
  });

  const { data: competitorsData, isLoading: competitorsLoading } = useQuery<CompetitorsResponse>({
    queryKey: ['competitors', 'count'],
    queryFn: async () => {
      const res = await fetch('/api/competitors?limit=1', { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch competitors');
      return res.json();
    },
  });

  const { data: analytics, isLoading: analyticsLoading } = useQuery<AnalyticsData>({
    queryKey: ['analytics', 'dashboard'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/dashboard', { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch analytics');
      return res.json();
    },
  });

  const isLoading = tournamentsLoading || competitorsLoading || analyticsLoading;
  const demoUser = isDemoUser(user);
  const liveDemoTournament = findLiveDemoTournament(tournaments);

  useEffect(() => {
    if (!demoUser || tournamentsLoading) return;
    const pending = consumeDemoEntryPending();
    const progress = readDemoProgress();
    if (shouldOpenDemoGuide({ isDemo: demoUser, pending, status: progress.status })) setDemoGuideOpen(true);
  }, [demoUser, tournamentsLoading]);

  const dismissDemoGuide = useCallback(() => {
    updateDemoProgress('dismissed');
    setDemoGuideOpen(false);
  }, []);
  const chooseDemoPath = useCallback((path: DemoPath, destination: string) => {
    updateDemoProgress('started', path);
    setDemoGuideOpen(false);
    navigate(destination);
  }, [navigate]);
  const completeDemoGuide = useCallback(() => {
    updateDemoProgress('completed');
    setDemoGuideOpen(false);
  }, []);
  const reopenDemoGuide = useCallback(() => {
    restartDemoGuide();
    setDemoGuideOpen(true);
  }, []);
  const retryDemoGuide = useCallback(() => window.location.reload(), []);

  const upcomingTournaments = tournaments?.filter((t) => t.status !== 'completed') || [];
  const totalDivisions = tournaments?.reduce((sum, t) => sum + t._count.divisions, 0) || 0;
  const totalMatches = analytics?.totals.matches || 0;
  const totalCompetitors = competitorsData?.total || 0;

  return (
    <div className="space-y-6 lg:space-y-8">
      {demoUser && (
        <div className="flex flex-col gap-3 rounded-xl border border-primary-200 bg-primary-50 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-primary-900/60 dark:bg-primary-950/30">
          <div>
            <p className="font-semibold text-primary-950 dark:text-white">Explore the fabricated live tournament</p>
            <p className="mt-0.5 text-sm text-primary-600 dark:text-primary-300">Choose a Director, Scorekeeper, Check-in, Parent, or Venue Display journey.</p>
          </div>
          <Button onClick={reopenDemoGuide} variant="primary" size="sm">Open demo guide</Button>
        </div>
      )}
      <DemoGuide
        open={demoGuideOpen}
        tournamentId={liveDemoTournament?.id ?? null}
        publicSlug={liveDemoTournament?.publicSlug ?? null}
        onClose={dismissDemoGuide}
        onChoose={chooseDemoPath}
        onComplete={completeDemoGuide}
        onRetry={retryDemoGuide}
      />
      {/* ── Hero greeting ── */}
      <div data-tour="dashboard-hero" className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary-900 via-primary-900 to-primary-950 p-6 lg:p-8 shadow-xl">
        <div className="absolute top-0 right-0 w-72 h-72 bg-primary-500/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-1/3 w-48 h-48 bg-accent-500/15 rounded-full blur-3xl translate-y-1/2" />
        <div className="relative flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-success/500/15 border border-success/500/20 text-success/300 text-xs font-medium mb-3">
              <span className="live-dot" /> All systems normal
            </div>
            <h1 className="text-2xl lg:text-3xl font-bold tracking-tight text-white">
              Welcome back
            </h1>
            <p className="mt-1 text-sm lg:text-base text-white/60 max-w-xl">
              {totalCompetitors > 0
                ? `You have ${totalCompetitors.toLocaleString()} competitors across ${tournaments?.length || 0} tournament${tournaments?.length === 1 ? '' : 's'}. Pick up where you left off.`
                : 'Start by importing competitors or creating your first tournament.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button as={Link} to="/competitors" variant="secondary" size="sm">
              <FileSpreadsheet className="h-4 w-4" /> Import Excel
            </Button>
            <Button
              onClick={() => navigate('/tournaments?create=1')}
              variant="gradient"
              size="sm"
            >
              <Plus className="h-4 w-4" /> New Tournament
            </Button>
          </div>
        </div>

        {/* Stat row inside hero */}
        <div className="relative mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
          {isLoading ? (
            <StatsSkeleton />
          ) : (
            <>
              <StatTile label="Competitors" value={totalCompetitors} trend="+12 this week" />
              <StatTile label="Active tournaments" value={upcomingTournaments.length} trend={upcomingTournaments.length > 0 ? 'In progress' : 'Ready to start'} />
              <StatTile label="Divisions" value={totalDivisions} trend="auto-categorized" />
              <StatTile label="Matches" value={totalMatches} trend={`${analytics?.totals.completedMatches || 0} completed`} />
            </>
          )}
        </div>
      </div>

      {/* ── Main grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Tournaments (2/3) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Recent tournaments */}
          <Card>
            <CardHeader
              title="Recent tournaments"
              as="h2"
              description="Click a tournament to view divisions, brackets, and results"
              action={
                <Link to="/tournaments" className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 flex items-center gap-1">
                  All tournaments <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
            />
            <CardBody className="p-0">
              {tournamentsLoading ? (
                <div className="px-5 pb-5 space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)}
                </div>
              ) : tournaments && tournaments.length > 0 ? (
                <div className="divide-y divide-surface-100 dark:divide-surface-800 border-t border-surface-100 dark:border-surface-800">
                  {tournaments.slice(0, 5).map((t, i) => {
                    const userRole = (user?.role || 'viewer') as UserRole;
                    const destination = getRoleAwareTournamentDestination(t, userRole);
                    const ariaLabel = getRoleAwareTournamentAriaLabel(t, userRole);
                    return (
                    <Link
                      key={t.id}
                      to={destination}
                      aria-label={ariaLabel}
                      className="group flex items-center gap-4 px-5 py-3.5 hover:bg-surface-50 dark:hover:bg-surface-800/40 transition-colors animate-slide-up"
                      style={{ animationDelay: `${i * 40}ms` }}
                    >
                      <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-primary-100 to-primary-200 dark:from-primary-800 dark:to-primary-700 flex items-center justify-center flex-shrink-0">
                        <Trophy className="h-4.5 w-4.5 text-primary-600 dark:text-primary-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm text-primary-900 dark:text-white truncate group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">{t.name}</div>
                        <div className="text-xs text-primary-600 mt-0.5 flex items-center gap-2 flex-wrap">
                          <span>{new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                          {t.location && <><span className="text-primary-300 dark:text-primary-600">·</span><span className="truncate">{t.location}</span></>}
                        </div>
                      </div>
                      <div className="hidden sm:flex items-center gap-5 text-xs text-primary-600 flex-shrink-0">
                        <div className="text-right">
                          <div className="font-semibold text-primary-900 dark:text-white">{t._count.registrations}</div>
                          <div className="text-[10px] uppercase tracking-wider">kids</div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold text-primary-900 dark:text-white">{t._count.divisions}</div>
                          <div className="text-[10px] uppercase tracking-wider">divisions</div>
                        </div>
                      </div>
                      <StatusBadge status={t.status} />
                      <ArrowUpRight className="h-4 w-4 text-primary-300 dark:text-primary-600 group-hover:text-primary-500 transition-colors" />
                    </Link>
                  );
                  })}
                </div>
              ) : (
                <div className="p-5 pt-0">
                  <EmptyState
                    icon={Trophy}
                    title="No tournaments yet"
                    description="Get started by creating your first tournament — or try the demo to see how it works."
                    action={{ label: 'Create Tournament', onClick: () => navigate('/tournaments') }}
                  />
                </div>
              )}
            </CardBody>
          </Card>

          {/* Belt distribution */}
          {analytics && analytics.beltDistribution.length > 0 && (
            <Card>
              <CardHeader
                title="Belt distribution"
                as="h2"
                description={`Across your ${totalCompetitors.toLocaleString()} competitors`}
                action={<Target className="h-4 w-4 text-primary-600" />}
              />
              <CardBody className="px-5 pb-5 space-y-2.5">
                {(() => {
                  // Group by main belt color (White / Yellow / Green / Blue / Red / Black) for cleaner display
                  const grouped: Record<string, number> = {};
                  for (const item of analytics.beltDistribution) {
                    const main = item.belt.split(' /')[0].trim();
                    grouped[main] = (grouped[main] || 0) + item.count;
                  }
                  const entries = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
                  const max = Math.max(...entries.map(e => e[1]));
                  return entries.map(([belt, count]) => (
                    <div key={belt} className="flex items-center gap-3">
                      <span className={`pill ${BELT_COLORS[belt] || 'pill-neutral'} min-w-[68px] justify-center`}>{belt}</span>
                      <div className="flex-1 h-2 bg-surface-100 dark:bg-primary-800 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{
                            width: `${(count / max) * 100}%`,
                            background: 'linear-gradient(90deg, #0B1220, #E11D48)',
                          }}
                        />
                      </div>
                      <span className="text-sm font-semibold text-primary-900 dark:text-white tabular-nums w-10 text-right">{count}</span>
                    </div>
                  ));
                })()}
              </CardBody>
            </Card>
          )}
        </div>

        {/* Right column: Top schools + Quick actions + Getting started */}
        <div className="space-y-6">
          {/* Quick actions */}
          <Card>
            <CardHeader title="Quick actions" as="h2" />
            <CardBody className="px-3 pb-3 space-y-1">
              {[
                              { label: 'Import competitors', sub: 'Excel file', icon: FileSpreadsheet, to: '/competitors', tone: 'from-success/500 to-teal-500' },
                              // "Create tournament" was here but it duplicates the hero
                              // CTA + Getting Started step 2 — same prompt three times
                              // is confusing. Replaced with "View all tournaments"
                              // which is what directors want once they have a few.
                              { label: 'View all tournaments', sub: 'Manage + search', icon: ListChecks, to: '/tournaments', tone: 'from-primary-500 to-accent-500' },
                              { label: 'Add competitor', sub: 'Single entry', icon: Plus, to: '/competitors', tone: 'from-amber-500 to-orange-500', isAction: true },
                            ].map((a) => (
                <Link
                  key={a.label}
                  to={a.to}
                  className="group flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-800/40 transition-colors"
                >
                  <div className={`h-9 w-9 rounded-lg bg-gradient-to-br ${a.tone} flex items-center justify-center shadow-sm flex-shrink-0`}>
                    <a.icon className="h-4 w-4 text-white" strokeWidth={2.5} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-primary-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">{a.label}</div>
                    <div className="text-[11px] text-primary-600">{a.sub}</div>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-primary-300 dark:text-primary-600 group-hover:text-primary-500 group-hover:translate-x-0.5 transition-all" />
                </Link>
              ))}
            </CardBody>
          </Card>

          {/* Top schools */}
          {analytics && analytics.topSchools.length > 0 && (
            <Card>
              <CardHeader
                title="Top schools"
                as="h2"
                description="Most represented dojangs"
                action={<School className="h-4 w-4 text-primary-600" />}
              />
              <CardBody className="px-5 pb-5 space-y-2.5">
                {analytics.topSchools.slice(0, 6).map((school, index) => {
                  const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`;
                  return (
                    <div key={school.school} className="flex items-center gap-3">
                      <span className="text-base w-6 text-center flex-shrink-0">{medal}</span>
                      <span className="text-sm text-primary-700 dark:text-primary-300 truncate flex-1">{school.school}</span>
                      <span className="text-sm font-semibold text-primary-900 dark:text-white tabular-nums">{school.count}</span>
                    </div>
                  );
                })}
              </CardBody>
            </Card>
          )}

          {/* Getting started — auto-dismiss when nearly complete */}
          {(() => {
            const steps = [
              totalCompetitors > 0,
              (tournaments?.length || 0) > 0,
              totalDivisions > 0,
              false, // "Run the tournament day-of" is always pending
            ];
            const completedCount = steps.filter(Boolean).length;
            // Hide once user is 3/4 of the way through (only "run day-of" remains)
            if (completedCount >= 3) return null;
            return (
              <Card>
                <CardHeader title="Getting started" as="h2" />
                <CardBody className="px-5 pb-5">
                  <ol className="space-y-3">
                    {[
                      { text: 'Import competitors from Excel', done: steps[0] },
                      { text: 'Create your first tournament', done: steps[1] },
                      { text: 'Auto-generate divisions', done: steps[2] },
                      { text: 'Run the tournament day-of', done: steps[3] },
                    ].map((step, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <div className={`flex-shrink-0 h-5 w-5 rounded-full flex items-center justify-center ${step.done ? 'bg-success/100 dark:bg-success/900/30 text-success/600 dark:text-success/400' : 'bg-surface-100 dark:bg-primary-800 text-primary-400'}`}>
                          {step.done ? <Check className="h-3 w-3" strokeWidth={3} /> : <span className="text-[10px] font-semibold">{i + 1}</span>}
                        </div>
                        <span className={`text-sm leading-relaxed ${step.done ? 'text-primary-500 line-through decoration-surface-300 dark:decoration-surface-700' : 'text-primary-700 dark:text-primary-300'}`}>{step.text}</span>
                      </li>
                    ))}
                  </ol>
                </CardBody>
              </Card>
            );
          })()}
        </div>
      </div>

      {/* P2-18: Onboarding checklist. Demo sessions get the demo guide
          instead; the fixed setup panel covered the guide's controls and
          its org-setup steps don't apply to the fabricated showcase. */}
      {!demoUser && <OnboardingChecklist />}
    </div>
  );
}
