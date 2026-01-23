import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Trophy, Users, LayoutGrid, Plus, ArrowRight } from 'lucide-react';

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

export default function Dashboard() {
  const { data: tournaments } = useQuery<Tournament[]>({
    queryKey: ['tournaments'],
    queryFn: async () => {
      const res = await fetch('/api/tournaments');
      return res.json();
    },
  });

  const { data: competitorsData } = useQuery<CompetitorsResponse>({
    queryKey: ['competitors', 'count'],
    queryFn: async () => {
      const res = await fetch('/api/competitors?limit=1');
      return res.json();
    },
  });

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
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">
            Welcome to the Taekwondo Tournament Manager
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

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {stats.map((stat) => (
          <div key={stat.name} className="card">
            <div className="card-body">
              <div className="flex items-center">
                <div className={`${stat.color} p-3 rounded-lg`}>
                  <stat.icon className="h-6 w-6 text-white" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-500">{stat.name}</p>
                  <p className="text-2xl font-semibold text-gray-900">
                    {stat.value}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Recent Tournaments */}
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <h2 className="text-lg font-medium text-gray-900">
            Recent Tournaments
          </h2>
          <Link
            to="/tournaments"
            className="text-sm text-primary-600 hover:text-primary-700 flex items-center"
          >
            View all
            <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </div>
        <div className="card-body p-0">
          {tournaments && tournaments.length > 0 ? (
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
              <tbody className="divide-y divide-gray-200 bg-white">
                {tournaments.slice(0, 5).map((tournament) => (
                  <tr key={tournament.id}>
                    <td className="font-medium">{tournament.name}</td>
                    <td>
                      {new Date(tournament.date).toLocaleDateString()}
                    </td>
                    <td>{tournament._count.registrations}</td>
                    <td>{tournament._count.divisions}</td>
                    <td>
                      <span
                        className={`badge ${
                          tournament.status === 'completed'
                            ? 'badge-green'
                            : tournament.status === 'in_progress'
                            ? 'badge-yellow'
                            : 'badge-blue'
                        }`}
                      >
                        {tournament.status}
                      </span>
                    </td>
                    <td>
                      <Link
                        to={`/tournaments/${tournament.id}`}
                        className="text-primary-600 hover:text-primary-700"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <Trophy className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-2">No tournaments yet</p>
              <Link
                to="/tournaments"
                className="mt-4 inline-block text-primary-600 hover:text-primary-700"
              >
                Create your first tournament
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card">
          <div className="card-body">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Quick Actions
            </h3>
            <div className="space-y-3">
              <Link
                to="/competitors"
                className="block p-3 rounded-lg border border-gray-200 hover:border-primary-500 hover:bg-primary-50 transition-colors"
              >
                <div className="flex items-center">
                  <Users className="h-5 w-5 text-primary-600" />
                  <span className="ml-3 font-medium">Import Competitors</span>
                </div>
                <p className="mt-1 ml-8 text-sm text-gray-500">
                  Import from Excel file
                </p>
              </Link>
              <Link
                to="/tournaments"
                className="block p-3 rounded-lg border border-gray-200 hover:border-primary-500 hover:bg-primary-50 transition-colors"
              >
                <div className="flex items-center">
                  <Trophy className="h-5 w-5 text-primary-600" />
                  <span className="ml-3 font-medium">Create Tournament</span>
                </div>
                <p className="mt-1 ml-8 text-sm text-gray-500">
                  Start a new tournament
                </p>
              </Link>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Getting Started
            </h3>
            <ol className="space-y-3 text-sm text-gray-600">
              <li className="flex items-start">
                <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-primary-100 text-primary-600 font-medium text-xs">
                  1
                </span>
                <span className="ml-3">
                  Import your competitors from an Excel file
                </span>
              </li>
              <li className="flex items-start">
                <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-primary-100 text-primary-600 font-medium text-xs">
                  2
                </span>
                <span className="ml-3">
                  Create a tournament and register competitors
                </span>
              </li>
              <li className="flex items-start">
                <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-primary-100 text-primary-600 font-medium text-xs">
                  3
                </span>
                <span className="ml-3">
                  Auto-generate divisions based on rules
                </span>
              </li>
              <li className="flex items-start">
                <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-primary-100 text-primary-600 font-medium text-xs">
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
