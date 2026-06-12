import { useQuery } from '@tanstack/react-query';
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
import { getAuthHeaders } from '../context/AuthContext';
import { Card, CardHeader, CardBody } from '../components/ui';
import { StatTile } from '../components/ui';
import { PageHeader } from '../components/ui';
import { Button } from '../components/ui';

interface Tournament {
  id: string;
  name: string;
  date: string;
  status: string;
  location?: string;
  _count: { registrations: number; divisions: number };
}

interface CompetitorsResponse { competitors: any[]; total: number; }

interface AnalyticsData {
  totals: { competitors: number; tournaments: number; matches: number; completedMatches: number; recentRegistrations: number };
  beltDistribution: { belt: string; count: number }[];
  genderDistribution: { gender: string; count: number }[];
  topSchools: { school: string; count: number }[];
  ageDistribution: { range: string; count: number }[];
}

const BELT_COLORS: Record<string, string> = {
  'White': 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  'White / Single Yellow Stripe': 'bg-slate-50 text-slate-600 dark:bg-slate-800/50 dark:text-slate-400',
  'White / Double Yellow Stripe': 'bg-slate-50 text-slate-600 dark:bg-slate-800/50 dark:text-slate-400',
  'Yellow': 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  'Yellow / Single Green Stripe': 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300',
  'Yellow / Double Green Stripe': 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300',
  'Green': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  'Green / Single Blue Stripe': 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300',
  'Green / Double Blue Stripe': 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300',
  'Blue': 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300',
  'Blue / Single Red Stripe': 'bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300',
  'Blue / Double Red Stripe': 'bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300',
  'Red': 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
  'Red / Single Black Stripe': 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300',
  'Red / Double Black Stripe': 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300',
  'Black': 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900',
};

function compactNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 10_000) return (n / 1_000).toFixed(1) + 'k';
  return n.toLocaleString();
}

export default function Dashboard() {
  const navigate = useNavigate();

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

  const upcomingTournaments = tournaments?.filter((t) => t.status !== 'completed') || [];
  const totalDivisions = tournaments?.reduce((sum, t) => sum + t._count.divisions, 0) || 0;
  const totalMatches = analytics?.totals.matches || 0;
  const totalCompetitors = competitorsData?.total || 0;

  return (
    <div className="space-y-6 lg:space-y-8">
      {/* ── Hero greeting ── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950 p-6 lg:p-8 shadow-xl">
        <div className="absolute top-0 right-0 w-72 h-72 bg-indigo-500/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-1/3 w-48 h-48 bg-violet-500/15 rounded-full blur-3xl translate-y-1/2" />
        <div className="relative flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/20 text-emerald-300 text-xs font-medium mb-3">
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
              onClick={() => navigate('/tournaments')}
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
              description="Click a tournament to view divisions, brackets, and results"
              action={
                <Link to="/tournaments" className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 flex items-center gap-1">
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
                <div className="divide-y divide-slate-100 dark:divide-slate-800 border-t border-slate-100 dark:border-slate-800">
                  {tournaments.slice(0, 5).map((t, i) => (
                    <Link
                      key={t.id}
                      to={`/tournaments/${t.id}`}
                      className="group flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors animate-slide-up"
                      style={{ animationDelay: `${i * 40}ms` }}
                    >
                      <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700 flex items-center justify-center flex-shrink-0">
                        <Trophy className="h-4.5 w-4.5 text-slate-500 dark:text-slate-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm text-slate-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">{t.name}</div>
                        <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                          <span>{new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                          {t.location && <><span className="text-slate-300 dark:text-slate-600">·</span><span className="truncate">{t.location}</span></>}
                        </div>
                      </div>
                      <div className="hidden sm:flex items-center gap-5 text-xs text-slate-500 flex-shrink-0">
                        <div className="text-right">
                          <div className="font-semibold text-slate-900 dark:text-white">{t._count.registrations}</div>
                          <div className="text-[10px] uppercase tracking-wider">kids</div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold text-slate-900 dark:text-white">{t._count.divisions}</div>
                          <div className="text-[10px] uppercase tracking-wider">divisions</div>
                        </div>
                      </div>
                      <StatusBadge status={t.status} />
                      <ArrowUpRight className="h-4 w-4 text-slate-300 dark:text-slate-600 group-hover:text-indigo-500 transition-colors" />
                    </Link>
                  ))}
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
                description={`Across your ${totalCompetitors.toLocaleString()} competitors`}
                action={<Target className="h-4 w-4 text-slate-400" />}
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
                      <div className="flex-1 h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{
                            width: `${(count / max) * 100}%`,
                            background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
                          }}
                        />
                      </div>
                      <span className="text-sm font-semibold text-slate-900 dark:text-white tabular-nums w-10 text-right">{count}</span>
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
            <CardHeader title="Quick actions" />
            <CardBody className="px-3 pb-3 space-y-1">
              {[
                { label: 'Import competitors', sub: 'Excel file', icon: FileSpreadsheet, to: '/competitors', tone: 'from-emerald-500 to-teal-500' },
                { label: 'Create tournament', sub: 'New event', icon: Trophy, to: '/tournaments', tone: 'from-indigo-500 to-violet-500' },
                { label: 'Add competitor', sub: 'Single entry', icon: Plus, to: '/competitors', tone: 'from-amber-500 to-orange-500', isAction: true },
              ].map((a) => (
                <Link
                  key={a.label}
                  to={a.to}
                  className="group flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <div className={`h-9 w-9 rounded-lg bg-gradient-to-br ${a.tone} flex items-center justify-center shadow-sm flex-shrink-0`}>
                    <a.icon className="h-4 w-4 text-white" strokeWidth={2.5} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">{a.label}</div>
                    <div className="text-[11px] text-slate-500">{a.sub}</div>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600 group-hover:text-slate-500 group-hover:translate-x-0.5 transition-all" />
                </Link>
              ))}
            </CardBody>
          </Card>

          {/* Top schools */}
          {analytics && analytics.topSchools.length > 0 && (
            <Card>
              <CardHeader
                title="Top schools"
                description="Most represented dojangs"
                action={<School className="h-4 w-4 text-slate-400" />}
              />
              <CardBody className="px-5 pb-5 space-y-2.5">
                {analytics.topSchools.slice(0, 6).map((school, index) => {
                  const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`;
                  return (
                    <div key={school.school} className="flex items-center gap-3">
                      <span className="text-base w-6 text-center flex-shrink-0">{medal}</span>
                      <span className="text-sm text-slate-700 dark:text-slate-300 truncate flex-1">{school.school}</span>
                      <span className="text-sm font-semibold text-slate-900 dark:text-white tabular-nums">{school.count}</span>
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
                <CardHeader title="Getting started" />
                <CardBody className="px-5 pb-5">
                  <ol className="space-y-3">
                    {[
                      { text: 'Import competitors from Excel', done: steps[0] },
                      { text: 'Create your first tournament', done: steps[1] },
                      { text: 'Auto-generate divisions', done: steps[2] },
                      { text: 'Run the tournament day-of', done: steps[3] },
                    ].map((step, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <div className={`flex-shrink-0 h-5 w-5 rounded-full flex items-center justify-center ${step.done ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}`}>
                          {step.done ? <Check className="h-3 w-3" strokeWidth={3} /> : <span className="text-[10px] font-semibold">{i + 1}</span>}
                        </div>
                        <span className={`text-sm leading-relaxed ${step.done ? 'text-slate-500 line-through decoration-slate-300 dark:decoration-slate-700' : 'text-slate-700 dark:text-slate-300'}`}>{step.text}</span>
                      </li>
                    ))}
                  </ol>
                </CardBody>
              </Card>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
