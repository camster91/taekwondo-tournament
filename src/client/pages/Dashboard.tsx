import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Trophy, Users, LayoutGrid, Plus, ArrowRight, School, Calendar, Target } from 'lucide-react';
import { StatsSkeleton, CardSkeleton } from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';
import { StatusBadge } from '../components/ui/Badge';

interface Tournament {
  id: string;
  name: string;
  date: string;
  status: string;
  _count: {
    registrations: number;
    divisions: number;
  };
}

interface CompetitorsResponse {
  competitors: any[];
  total: number;
}

interface AnalyticsData {
  totals: {
    competitors: number;
    tournaments: number;
    matches: number;
    completedMatches: number;
    recentRegistrations: number;
  };
  beltDistribution: { belt: string; count: number }[];
  genderDistribution: { gender: string; count: number }[];
  topSchools: { school: string; count: number }[];
  ageDistribution: { range: string; count: number }[];
}

const BELT_COLORS: Record<string, string> = {
  White: 'bg-gray-100 text-gray-800',
  Yellow: 'bg-yellow-100 text-yellow-800',
  Green: 'bg-green-100 text-green-800',
  Blue: 'bg-blue-100 text-blue-800',
  Red: 'bg-red-100 text-red-800',
  Black: 'bg-gray-900 text-white',
};

export default function Dashboard() {
  const { data: tournaments, isLoading: tournamentsLoading } = useQuery<Tournament[]>({
    queryKey: ['tournaments'],
    queryFn: async () => {
      const res = await fetch('/api/tournaments');
      return res.json();
    },
  });

  const { data: competitorsData, isLoading: competitorsLoading } = useQuery<CompetitorsResponse>({
    queryKey: ['competitors', 'count'],
    queryFn: async () => {
      const res = await fetch('/api/competitors?limit=1');
      return res.json();
    },
  });

  const { data: analytics, isLoading: analyticsLoading } = useQuery<AnalyticsData>({
    queryKey: ['analytics', 'dashboard'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/dashboard');
      return res.json();
    },
  });

  const isLoading = tournamentsLoading || competitorsLoading || analyticsLoading;

  const upcomingTournaments = tournaments?.filter(
    (t) => t.status !== 'completed'
  ) || [];

  const stats = [
    {
      name: 'Total Competitors',
      value: competitorsData?.total || 0,
      icon: Users,
      color: 'bg-blue-500',
    },
    {
      name: 'Active Tournaments',
      value: upcomingTournaments.length,
      icon: Trophy,
      color: 'bg-green-500',
    },
    {
      name: 'Total Divisions',
      value: tournaments?.reduce((sum, t) => sum + t._count.divisions, 0) || 0,
      icon: LayoutGrid,
      color: 'bg-purple-500',
    },
    {
      name: 'Recent Registrations',
      value: analytics?.totals.recentRegistrations || 0,
      icon: Calendar,
      color: 'bg-orange-500',
      subtitle: 'Last 30 days',
    },
  ];

  return (
    <div>
      {/* Page Header - responsive */}
      <div className="page-header mb-6 sm:mb-8">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">
            Welcome to Tournament Manager
          </p>
        </div>
        <Link
          to="/tournaments"
          className="btn btn-primary"
        >
          <Plus className="h-4 w-4 mr-2" />
          New Tournament
        </Link>
      </div>

      {/* Stats - responsive grid */}
      {isLoading ? (
        <div className="mb-6 sm:mb-8">
          <StatsSkeleton />
        </div>
      ) : (
        <div className="stats-grid mb-6 sm:mb-8">
          {stats.map((stat) => (
            <div key={stat.name} className="stat-card">
              <div className="flex items-center">
                <div className={`${stat.color} p-2 sm:p-3 rounded-lg flex-shrink-0`}>
                  <stat.icon className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
                </div>
                <div className="ml-3 sm:ml-4 min-w-0">
                  <p className="stat-label truncate">{stat.name}</p>
                  <p className="stat-value">{stat.value}</p>
                  {stat.subtitle && (
                    <p className="text-xs text-gray-400 dark:text-gray-500">{stat.subtitle}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Analytics Section */}
      {analytics && (analytics.beltDistribution.length > 0 || analytics.topSchools.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6 sm:mb-8">
          {/* Belt Distribution */}
          {analytics.beltDistribution.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h3 className="text-base font-medium text-gray-900 dark:text-white flex items-center">
                  <Target className="h-5 w-5 mr-2 text-primary-500" />
                  Belt Distribution
                </h3>
              </div>
              <div className="card-body">
                <div className="space-y-3">
                  {analytics.beltDistribution.map((item) => {
                    const maxCount = Math.max(...analytics.beltDistribution.map((b) => b.count));
                    const percentage = maxCount > 0 ? (item.count / maxCount) * 100 : 0;
                    return (
                      <div key={item.belt} className="flex items-center gap-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium w-16 text-center ${BELT_COLORS[item.belt] || 'bg-gray-100'}`}>
                          {item.belt}
                        </span>
                        <div className="flex-1 h-4 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary-500 rounded-full transition-all duration-500"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 w-10 text-right">
                          {item.count}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Top Schools */}
          {analytics.topSchools.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h3 className="text-base font-medium text-gray-900 dark:text-white flex items-center">
                  <School className="h-5 w-5 mr-2 text-primary-500" />
                  Top Schools/Dojangs
                </h3>
              </div>
              <div className="card-body">
                <div className="space-y-2">
                  {analytics.topSchools.slice(0, 8).map((school, index) => (
                    <div key={school.school} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                      <div className="flex items-center gap-3">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                          index === 0 ? 'bg-yellow-100 text-yellow-700' :
                          index === 1 ? 'bg-gray-200 text-gray-700' :
                          index === 2 ? 'bg-orange-100 text-orange-700' :
                          'bg-gray-100 text-gray-500'
                        }`}>
                          {index + 1}
                        </span>
                        <span className="text-sm text-gray-700 dark:text-gray-300 truncate max-w-[180px]">
                          {school.school}
                        </span>
                      </div>
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">
                        {school.count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recent Tournaments */}
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <h2 className="text-base sm:text-lg font-medium text-gray-900 dark:text-white">
            Recent Tournaments
          </h2>
          <Link
            to="/tournaments"
            className="text-sm text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 flex items-center touch-target"
          >
            View all
            <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </div>
        <div className="card-body p-0">
          {tournamentsLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          ) : tournaments && tournaments.length > 0 ? (
            <>
              {/* Mobile Card View */}
              <div className="mobile-cards p-4 space-y-3">
                {tournaments.slice(0, 5).map((tournament) => (
                  <Link
                    key={tournament.id}
                    to={`/tournaments/${tournament.id}`}
                    className="mobile-card block hover:border-primary-300 dark:hover:border-primary-600 transition-colors"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="font-semibold text-gray-900 dark:text-white">{tournament.name}</div>
                      <StatusBadge status={tournament.status} />
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                      {new Date(tournament.date).toLocaleDateString()}
                    </div>
                    <div className="flex gap-4 text-sm">
                      <span className="text-gray-600 dark:text-gray-400">
                        <span className="font-medium text-gray-900 dark:text-white">{tournament._count.registrations}</span> competitors
                      </span>
                      <span className="text-gray-600 dark:text-gray-400">
                        <span className="font-medium text-gray-900 dark:text-white">{tournament._count.divisions}</span> divisions
                      </span>
                    </div>
                  </Link>
                ))}
              </div>

              {/* Desktop Table View */}
              <div className="desktop-table overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Tournament</th>
                      <th>Date</th>
                      <th>Competitors</th>
                      <th>Divisions</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-800">
                    {tournaments.slice(0, 5).map((tournament) => (
                      <tr key={tournament.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="font-medium text-gray-900 dark:text-white">{tournament.name}</td>
                        <td className="text-gray-600 dark:text-gray-400">
                          {new Date(tournament.date).toLocaleDateString()}
                        </td>
                        <td className="text-gray-600 dark:text-gray-400">{tournament._count.registrations}</td>
                        <td className="text-gray-600 dark:text-gray-400">{tournament._count.divisions}</td>
                        <td>
                          <StatusBadge status={tournament.status} />
                        </td>
                        <td>
                          <Link
                            to={`/tournaments/${tournament.id}`}
                            className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <EmptyState
              icon={Trophy}
              title="No tournaments yet"
              description="Get started by creating your first tournament."
              action={{
                label: 'Create Tournament',
                onClick: () => window.location.href = '/tournaments',
              }}
            />
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card">
          <div className="card-body">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
              Quick Actions
            </h3>
            <div className="space-y-3">
              <Link
                to="/competitors"
                className="block p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-primary-500 dark:hover:border-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
              >
                <div className="flex items-center">
                  <Users className="h-5 w-5 text-primary-600 dark:text-primary-400" />
                  <span className="ml-3 font-medium text-gray-900 dark:text-white">Import Competitors</span>
                </div>
                <p className="mt-1 ml-8 text-sm text-gray-500 dark:text-gray-400">
                  Import from Excel file
                </p>
              </Link>
              <Link
                to="/tournaments"
                className="block p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-primary-500 dark:hover:border-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
              >
                <div className="flex items-center">
                  <Trophy className="h-5 w-5 text-primary-600 dark:text-primary-400" />
                  <span className="ml-3 font-medium text-gray-900 dark:text-white">Create Tournament</span>
                </div>
                <p className="mt-1 ml-8 text-sm text-gray-500 dark:text-gray-400">
                  Start a new tournament
                </p>
              </Link>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
              Getting Started
            </h3>
            <ol className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
              <li className="flex items-start">
                <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 font-medium text-xs">
                  1
                </span>
                <span className="ml-3">
                  Import your competitors from an Excel file
                </span>
              </li>
              <li className="flex items-start">
                <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 font-medium text-xs">
                  2
                </span>
                <span className="ml-3">
                  Create a tournament and register competitors
                </span>
              </li>
              <li className="flex items-start">
                <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 font-medium text-xs">
                  3
                </span>
                <span className="ml-3">
                  Auto-generate divisions based on rules
                </span>
              </li>
              <li className="flex items-start">
                <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 font-medium text-xs">
                  4
                </span>
                <span className="ml-3">
                  Generate brackets and export PDFs
                </span>
              </li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
