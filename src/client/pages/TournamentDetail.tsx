import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import {
  Users,
  LayoutGrid,
  Settings,
  Plus,
  Trash2,
  Check,
  ArrowRight,
  Calendar,
  ClipboardCheck,
  Timer,
  FileDown,
  Monitor,
  Medal,
  LayoutDashboard,
  Search,
  X,
  ChevronLeft,
  Globe,
  Lock,
  Copy,
  Flag,
} from 'lucide-react';
import { getAuthHeaders } from '../context/AuthContext';
import { StatsSkeleton, TableSkeleton } from '../components/ui/Skeleton';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState from '../components/ui/EmptyState';
import { StatusBadge } from '../components/ui/Badge';
import { PageLoader } from '../components/ui/Spinner';

interface Tournament {
  id: string;
  name: string;
  date: string;
  location: string | null;
  status: string;
  _count: {
    registrations: number;
    divisions: number;
  };
}

interface Competitor {
  id: string;
  firstName: string;
  lastName: string;
  gender: string;
  belt: string;
  danRank: number | null;
  weightLbs: number | null;
  schoolDojang: string | null;
}

interface Registration {
  id: string;
  competitorId: string;
  patterns: boolean;
  sparring: boolean;
  ageAtTournament: number | null;
  competitor: Competitor;
}

export default function TournamentDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedCompetitors, setSelectedCompetitors] = useState<string[]>([]);
  const [registerPatterns, setRegisterPatterns] = useState(true);
  const [registerSparring, setRegisterSparring] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [modalSearch, setModalSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Registration | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: ['tournament', id],
    queryFn: async () => {
      const res = await fetch(`/api/tournaments/${id}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch tournament');
      return res.json();
    },
  });

  const { data: registrations, isLoading: regsLoading } = useQuery<Registration[]>({
    queryKey: ['registrations', id],
    queryFn: async () => {
      const res = await fetch(`/api/tournaments/${id}/registrations`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch registrations');
      return res.json();
    },
  });

  const { data: allCompetitors } = useQuery({
    queryKey: ['competitors', 'all'],
    queryFn: async () => {
      const res = await fetch('/api/competitors?limit=1000', { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch competitors');
      return res.json();
    },
    enabled: showAddModal,
  });

  const bulkRegisterMutation = useMutation({
    mutationFn: async (data: {
      competitorIds: string[];
      patterns: boolean;
      sparring: boolean;
    }) => {
      const res = await fetch(`/api/tournaments/${id}/registrations/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to register competitors');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['registrations', id] });
      queryClient.invalidateQueries({ queryKey: ['tournament', id] });
      setShowAddModal(false);
      setSelectedCompetitors([]);
    },
  });

  const removeRegistrationMutation = useMutation({
    mutationFn: async (regId: string) => {
      await fetch(`/api/tournaments/${id}/registrations/${regId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['registrations', id] });
      queryClient.invalidateQueries({ queryKey: ['tournament', id] });
    },
  });

  const updateRegistrationMutation = useMutation({
    mutationFn: async ({
      regId,
      patterns,
      sparring,
    }: {
      regId: string;
      patterns: boolean;
      sparring: boolean;
    }) => {
      const res = await fetch(`/api/tournaments/${id}/registrations/${regId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ patterns, sparring }),
      });
      if (!res.ok) throw new Error('Failed to update registration');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['registrations', id] });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async (status: string) => {
      const res = await fetch(`/api/tournaments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tournament', id] });
    },
  });

  const registrationUrl = `${window.location.origin}/register?tournament=${id}`;

  const copyRegistrationLink = () => {
    navigator.clipboard.writeText(registrationUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const registeredIds = new Set(registrations?.map((r) => r.competitorId) || []);
  const availableCompetitors =
    allCompetitors?.competitors?.filter(
      (c: Competitor) => !registeredIds.has(c.id)
    ) || [];

  const getBeltColor = (belt: string) => {
    const lower = belt.toLowerCase();
    if (lower.includes('black')) return 'bg-gray-900 text-white';
    if (lower.includes('red')) return 'bg-red-500 text-white';
    if (lower.includes('blue')) return 'bg-blue-500 text-white';
    if (lower.includes('green')) return 'bg-green-500 text-white';
    if (lower.includes('yellow')) return 'bg-yellow-400 text-gray-900';
    if (lower.includes('white')) return 'bg-white text-gray-900 border';
    return 'bg-gray-200';
  };

  const filteredRegistrations = registrations?.filter((r) => {
    const name = `${r.competitor.firstName} ${r.competitor.lastName}`.toLowerCase();
    const school = r.competitor.schoolDojang?.toLowerCase() || '';
    const query = searchQuery.toLowerCase();
    return name.includes(query) || school.includes(query);
  });

  const filteredAvailable = availableCompetitors.filter((c: Competitor) => {
    const name = `${c.firstName} ${c.lastName}`.toLowerCase();
    const school = c.schoolDojang?.toLowerCase() || '';
    const query = modalSearch.toLowerCase();
    return name.includes(query) || school.includes(query);
  });

  if (tournamentLoading) {
    return <PageLoader />;
  }

  if (!tournament) {
    return (
      <div className="card">
        <EmptyState
          icon={Users}
          title="Tournament not found"
          description="This tournament may have been deleted."
          action={{ label: 'Back to Tournaments', onClick: () => window.history.back() }}
        />
      </div>
    );
  }

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-4">
        <Link
          to="/tournaments"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Back to Tournaments
        </Link>
      </div>

      {/* Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between mb-6 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{tournament.name}</h1>
            <StatusBadge status={tournament.status} />
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            {new Date(tournament.date).toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
            {tournament.location && <span>• {tournament.location}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/tournaments/${id}/settings`} className="btn btn-secondary">
            <Settings className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Settings</span>
          </Link>
          <Link to={`/tournaments/${id}/schedule`} className="btn btn-secondary">
            <Calendar className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Schedule</span>
          </Link>
          <Link to={`/tournaments/${id}/divisions`} className="btn btn-primary">
            <LayoutGrid className="h-4 w-4 mr-2" />
            Manage Divisions
            <ArrowRight className="h-4 w-4 ml-2" />
          </Link>
        </div>
      </div>

      {/* Tournament Day Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <Link
          to={`/tournaments/${id}/director`}
          className="card hover:shadow-lg transition-shadow border-2 border-primary-200"
        >
          <div className="card-body flex items-center">
            <div className="bg-primary-600 p-3 rounded-lg">
              <LayoutDashboard className="h-6 w-6 text-white" />
            </div>
            <div className="ml-4 flex-1">
              <p className="font-semibold text-gray-900">Director Dashboard</p>
              <p className="text-sm text-gray-500">Tournament control center</p>
            </div>
            <ArrowRight className="h-5 w-5 text-gray-400" />
          </div>
        </Link>

        <Link
          to={`/checkin/${id}`}
          className="card hover:shadow-lg transition-shadow"
        >
          <div className="card-body flex items-center">
            <div className="bg-blue-500 p-3 rounded-lg">
              <ClipboardCheck className="h-6 w-6 text-white" />
            </div>
            <div className="ml-4 flex-1">
              <p className="font-semibold text-gray-900">Check-In</p>
              <p className="text-sm text-gray-500">Verify competitor attendance</p>
            </div>
            <ArrowRight className="h-5 w-5 text-gray-400" />
          </div>
        </Link>

        <Link
          to={`/scorekeeper/${id}`}
          className="card hover:shadow-lg transition-shadow"
        >
          <div className="card-body flex items-center">
            <div className="bg-green-500 p-3 rounded-lg">
              <Timer className="h-6 w-6 text-white" />
            </div>
            <div className="ml-4 flex-1">
              <p className="font-semibold text-gray-900">Scorekeeper</p>
              <p className="text-sm text-gray-500">Record match results</p>
            </div>
            <ArrowRight className="h-5 w-5 text-gray-400" />
          </div>
        </Link>

        <a
          href={`/api/brackets/tournament/${id}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="card hover:shadow-lg transition-shadow"
        >
          <div className="card-body flex items-center">
            <div className="bg-purple-500 p-3 rounded-lg">
              <FileDown className="h-6 w-6 text-white" />
            </div>
            <div className="ml-4 flex-1">
              <p className="font-semibold text-gray-900">Export Brackets</p>
              <p className="text-sm text-gray-500">Download all bracket PDFs</p>
            </div>
            <ArrowRight className="h-5 w-5 text-gray-400" />
          </div>
        </a>

        <Link
          to={`/display/${id}`}
          target="_blank"
          className="card hover:shadow-lg transition-shadow"
        >
          <div className="card-body flex items-center">
            <div className="bg-yellow-500 p-3 rounded-lg">
              <Monitor className="h-6 w-6 text-white" />
            </div>
            <div className="ml-4 flex-1">
              <p className="font-semibold text-gray-900">Live Scoreboard</p>
              <p className="text-sm text-gray-500">Public display for spectators</p>
            </div>
            <ArrowRight className="h-5 w-5 text-gray-400" />
          </div>
        </Link>

        <Link
          to={`/tournaments/${id}/results`}
          className="card hover:shadow-lg transition-shadow"
        >
          <div className="card-body flex items-center">
            <div className="bg-red-500 p-3 rounded-lg">
              <Medal className="h-6 w-6 text-white" />
            </div>
            <div className="ml-4 flex-1">
              <p className="font-semibold text-gray-900">Results</p>
              <p className="text-sm text-gray-500">View standings and medals</p>
            </div>
            <ArrowRight className="h-5 w-5 text-gray-400" />
          </div>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div className="card">
          <div className="card-body flex items-center">
            <div className="bg-blue-500 p-3 rounded-lg">
              <Users className="h-6 w-6 text-white" />
            </div>
            <div className="ml-4">
              <p className="text-sm text-gray-500">Registered</p>
              <p className="text-2xl font-semibold">{registrations?.length || 0}</p>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-body flex items-center">
            <div className="bg-green-500 p-3 rounded-lg">
              <LayoutGrid className="h-6 w-6 text-white" />
            </div>
            <div className="ml-4">
              <p className="text-sm text-gray-500">Divisions</p>
              <p className="text-2xl font-semibold">{tournament._count.divisions}</p>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-body flex items-center">
            <div className="bg-purple-500 p-3 rounded-lg">
              <Settings className="h-6 w-6 text-white" />
            </div>
            <div className="ml-4">
              <p className="text-sm text-gray-500">Status</p>
              <p className="text-2xl font-semibold capitalize">{tournament.status}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tournament Status Controls */}
      {tournament.status === 'registration' ? (
        <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-300 flex-1 min-w-0">
              <Globe className="h-5 w-5 flex-shrink-0" />
              <span className="font-medium">Open for Registration</span>
              <span className="text-sm truncate hidden sm:block">{registrationUrl}</span>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={copyRegistrationLink} className="btn btn-secondary text-sm py-1.5 px-3 flex items-center gap-1">
                <Copy className="h-3.5 w-3.5" />
                {copiedLink ? 'Copied!' : 'Copy Link'}
              </button>
              <button
                onClick={() => updateStatusMutation.mutate('active')}
                disabled={updateStatusMutation.isPending}
                className="btn btn-secondary text-sm py-1.5 px-3 flex items-center gap-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
              >
                <Lock className="h-3.5 w-3.5" />
                Close Registration
              </button>
            </div>
          </div>
        </div>
      ) : tournament.status === 'active' || tournament.status === 'in_progress' || tournament.status === 'brackets' ? (
        <div className="mb-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="text-sm text-yellow-800 dark:text-yellow-300 flex-1">
            Tournament is active. Mark as completed when all divisions are finished.
          </p>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={() => updateStatusMutation.mutate('registration')}
              disabled={updateStatusMutation.isPending}
              className="btn btn-secondary text-sm py-1.5 px-3 flex items-center gap-1"
            >
              <Globe className="h-3.5 w-3.5 mr-1" />
              Reopen Registration
            </button>
            <button
              onClick={() => updateStatusMutation.mutate('completed')}
              disabled={updateStatusMutation.isPending}
              className="btn btn-primary text-sm py-1.5 px-3 flex items-center gap-1"
            >
              <Flag className="h-3.5 w-3.5 mr-1" />
              Mark Completed
            </button>
          </div>
        </div>
      ) : tournament.status === 'completed' ? (
        <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="text-sm text-gray-600 dark:text-gray-400 flex-1">
            This tournament is completed.
          </p>
          <button
            onClick={() => updateStatusMutation.mutate('active')}
            disabled={updateStatusMutation.isPending}
            className="btn btn-secondary text-sm py-1.5 px-3 flex items-center gap-1 flex-shrink-0"
          >
            Reopen Tournament
          </button>
        </div>
      ) : (
        <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="text-sm text-gray-600 dark:text-gray-400 flex-1">
            Open this tournament for public self-registration to share a signup link with competitors.
          </p>
          <button
            onClick={() => updateStatusMutation.mutate('registration')}
            disabled={updateStatusMutation.isPending}
            className="btn btn-secondary text-sm py-1.5 px-3 flex items-center gap-1 flex-shrink-0"
          >
            <Globe className="h-3.5 w-3.5 mr-1" />
            Open for Registration
          </button>
        </div>
      )}

      {/* Registrations */}
      <div className="card">
        <div className="card-header">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <h2 className="text-lg font-medium text-gray-900 dark:text-white">
              Registered Competitors
              {registrations && (
                <span className="ml-2 text-sm font-normal text-gray-500">
                  ({registrations.length})
                </span>
              )}
            </h2>
            <div className="flex flex-col sm:flex-row gap-3">
              {registrations && registrations.length > 0 && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="form-input pl-9 py-1.5 w-full sm:w-48"
                  />
                </div>
              )}
              <button onClick={() => setShowAddModal(true)} className="btn btn-primary">
                <Plus className="h-4 w-4 mr-2" />
                Add Competitors
              </button>
            </div>
          </div>
        </div>
        <div className="card-body p-0">
          {regsLoading ? (
            <TableSkeleton rows={5} />
          ) : filteredRegistrations && filteredRegistrations.length > 0 ? (
            <>
              {/* Mobile View */}
              <div className="mobile-cards p-4 space-y-3">
                {filteredRegistrations.map((reg) => (
                  <div key={reg.id} className="mobile-card">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="font-semibold text-gray-900 dark:text-white">
                          {reg.competitor.firstName} {reg.competitor.lastName}
                        </div>
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-xs font-medium mt-1 ${getBeltColor(
                            reg.competitor.belt
                          )}`}
                        >
                          {reg.competitor.belt}
                          {reg.competitor.danRank && ` ${reg.competitor.danRank}D`}
                        </span>
                      </div>
                      <button
                        onClick={() => setDeleteTarget(reg)}
                        className="text-gray-400 hover:text-red-600 p-2 -mr-2"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="text-sm text-gray-500 space-y-1">
                      <div className="flex justify-between">
                        <span>Age</span>
                        <span className="text-gray-900 dark:text-white">{reg.ageAtTournament || '-'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Weight</span>
                        <span className="text-gray-900 dark:text-white">
                          {reg.competitor.weightLbs ? `${reg.competitor.weightLbs} lbs` : '-'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>School</span>
                        <span className="text-gray-900 dark:text-white truncate ml-4">
                          {reg.competitor.schoolDojang || '-'}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-4 mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
                      <button
                        onClick={() =>
                          updateRegistrationMutation.mutate({
                            regId: reg.id,
                            patterns: !reg.patterns,
                            sparring: reg.sparring,
                          })
                        }
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                          reg.patterns
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                        }`}
                      >
                        {reg.patterns ? '✓ ' : ''}Patterns
                      </button>
                      <button
                        onClick={() =>
                          updateRegistrationMutation.mutate({
                            regId: reg.id,
                            patterns: reg.patterns,
                            sparring: !reg.sparring,
                          })
                        }
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                          reg.sparring
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                        }`}
                      >
                        {reg.sparring ? '✓ ' : ''}Sparring
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Table */}
              <div className="desktop-table">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Age</th>
                      <th>Belt</th>
                      <th>Weight</th>
                      <th>School</th>
                      <th className="text-center">Patterns</th>
                      <th className="text-center">Sparring</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-800">
                    {filteredRegistrations.map((reg) => (
                      <tr key={reg.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="font-medium text-gray-900 dark:text-white">
                          {reg.competitor.firstName} {reg.competitor.lastName}
                        </td>
                        <td>{reg.ageAtTournament || '-'}</td>
                        <td>
                          <span
                            className={`inline-flex px-2 py-1 rounded text-xs font-medium ${getBeltColor(
                              reg.competitor.belt
                            )}`}
                          >
                            {reg.competitor.belt}
                            {reg.competitor.danRank && ` ${reg.competitor.danRank}D`}
                          </span>
                        </td>
                        <td>
                          {reg.competitor.weightLbs
                            ? `${reg.competitor.weightLbs} lbs`
                            : '-'}
                        </td>
                        <td className="max-w-[150px] truncate">{reg.competitor.schoolDojang || '-'}</td>
                        <td className="text-center">
                          <button
                            onClick={() =>
                              updateRegistrationMutation.mutate({
                                regId: reg.id,
                                patterns: !reg.patterns,
                                sparring: reg.sparring,
                              })
                            }
                            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                              reg.patterns
                                ? 'bg-green-500 text-white hover:bg-green-600'
                                : 'bg-gray-200 dark:bg-gray-600 text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-500'
                            }`}
                          >
                            {reg.patterns && <Check className="h-4 w-4" />}
                          </button>
                        </td>
                        <td className="text-center">
                          <button
                            onClick={() =>
                              updateRegistrationMutation.mutate({
                                regId: reg.id,
                                patterns: reg.patterns,
                                sparring: !reg.sparring,
                              })
                            }
                            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                              reg.sparring
                                ? 'bg-green-500 text-white hover:bg-green-600'
                                : 'bg-gray-200 dark:bg-gray-600 text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-500'
                            }`}
                          >
                            {reg.sparring && <Check className="h-4 w-4" />}
                          </button>
                        </td>
                        <td>
                          <button
                            onClick={() => setDeleteTarget(reg)}
                            className="text-gray-400 hover:text-red-600 p-1 rounded transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : registrations && registrations.length > 0 ? (
            <EmptyState
              icon={Search}
              title="No matches found"
              description={`No competitors match "${searchQuery}"`}
              action={{ label: 'Clear Search', onClick: () => setSearchQuery('') }}
            />
          ) : (
            <EmptyState
              icon={Users}
              title="No competitors registered"
              description="Add competitors to this tournament to get started."
              action={{ label: 'Add Competitors', onClick: () => setShowAddModal(true) }}
            />
          )}
        </div>
      </div>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            removeRegistrationMutation.mutate(deleteTarget.id);
            setDeleteTarget(null);
          }
        }}
        title="Remove Registration"
        message={`Remove ${deleteTarget?.competitor.firstName} ${deleteTarget?.competitor.lastName} from this tournament?`}
        confirmText="Remove"
        isLoading={removeRegistrationMutation.isPending}
      />

      {/* Add Competitors Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <div
              className="fixed inset-0 bg-black/50 transition-opacity"
              onClick={() => {
                setShowAddModal(false);
                setSelectedCompetitors([]);
                setModalSearch('');
              }}
            />
            <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden">
              <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Add Competitors</h2>
                  <button
                    onClick={() => {
                      setShowAddModal(false);
                      setSelectedCompetitors([]);
                      setModalSearch('');
                    }}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search competitors..."
                      value={modalSearch}
                      onChange={(e) => setModalSearch(e.target.value)}
                      className="form-input pl-9 w-full"
                      autoFocus
                    />
                  </div>
                  <div className="flex gap-4">
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={registerPatterns}
                        onChange={(e) => setRegisterPatterns(e.target.checked)}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">Patterns</span>
                    </label>
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={registerSparring}
                        onChange={(e) => setRegisterSparring(e.target.checked)}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">Sparring</span>
                    </label>
                  </div>
                </div>
              </div>
              <div className="p-4 overflow-y-auto max-h-96 bg-gray-50 dark:bg-gray-900/50">
                {filteredAvailable.length > 0 ? (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between mb-3">
                      <button
                        onClick={() =>
                          setSelectedCompetitors(
                            selectedCompetitors.length === filteredAvailable.length
                              ? []
                              : filteredAvailable.map((c: Competitor) => c.id)
                          )
                        }
                        className="text-sm text-primary-600 hover:text-primary-700 dark:text-primary-400"
                      >
                        {selectedCompetitors.length === filteredAvailable.length
                          ? 'Deselect All'
                          : `Select All (${filteredAvailable.length})`}
                      </button>
                      {modalSearch && (
                        <span className="text-xs text-gray-500">
                          Showing {filteredAvailable.length} of {availableCompetitors.length}
                        </span>
                      )}
                    </div>
                    {filteredAvailable.map((c: Competitor) => (
                      <label
                        key={c.id}
                        className={`flex items-center p-3 rounded-lg cursor-pointer transition-colors ${
                          selectedCompetitors.includes(c.id)
                            ? 'bg-primary-50 dark:bg-primary-900/30 border border-primary-200 dark:border-primary-800'
                            : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-primary-300 dark:hover:border-primary-600'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedCompetitors.includes(c.id)}
                          onChange={(e) =>
                            setSelectedCompetitors(
                              e.target.checked
                                ? [...selectedCompetitors, c.id]
                                : selectedCompetitors.filter((id) => id !== c.id)
                            )
                          }
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        <span className="ml-3 flex-1 font-medium text-gray-900 dark:text-white">
                          {c.firstName} {c.lastName}
                        </span>
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${getBeltColor(
                            c.belt
                          )}`}
                        >
                          {c.belt}
                        </span>
                        {c.schoolDojang && (
                          <span className="ml-2 text-sm text-gray-500 dark:text-gray-400 hidden sm:inline truncate max-w-[120px]">
                            {c.schoolDojang}
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                ) : availableCompetitors.length > 0 ? (
                  <EmptyState
                    icon={Search}
                    title="No matches"
                    description={`No competitors match "${modalSearch}"`}
                    action={{ label: 'Clear Search', onClick: () => setModalSearch('') }}
                  />
                ) : (
                  <EmptyState
                    icon={Users}
                    title="No available competitors"
                    description="Import competitors first, or all have been registered."
                  />
                )}
              </div>
              <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col sm:flex-row items-center justify-between gap-3">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  <span className="font-semibold text-gray-900 dark:text-white">{selectedCompetitors.length}</span> competitors selected
                </span>
                <div className="flex gap-3 w-full sm:w-auto">
                  <button
                    onClick={() => {
                      setShowAddModal(false);
                      setSelectedCompetitors([]);
                      setModalSearch('');
                    }}
                    className="btn btn-secondary flex-1 sm:flex-none"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() =>
                      bulkRegisterMutation.mutate({
                        competitorIds: selectedCompetitors,
                        patterns: registerPatterns,
                        sparring: registerSparring,
                      })
                    }
                    disabled={
                      bulkRegisterMutation.isPending ||
                      selectedCompetitors.length === 0
                    }
                    className="btn btn-primary flex-1 sm:flex-none"
                  >
                    {bulkRegisterMutation.isPending
                      ? 'Adding...'
                      : `Add ${selectedCompetitors.length} Competitors`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
