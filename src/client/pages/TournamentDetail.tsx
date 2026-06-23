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
  ChevronLeft,
  Globe,
  Lock,
  Copy,
  Flag,
  Activity,
  AlertTriangle,
  ExternalLink,
  Trophy,
} from 'lucide-react';
import { getAuthHeaders } from '../context/AuthContext';
import CloseButton from '../components/ui/CloseButton';
import { StatsSkeleton, TableSkeleton } from '../components/ui/Skeleton';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState from '../components/ui/EmptyState';
import { StatusBadge } from '../components/ui/Badge';
import { DataTable, TableHead, TableBody, TableRow, TableCell, IconButton } from '../components/ui';
import { PageLoader } from '../components/ui/Spinner';
import { Card, CardHeader, CardBody } from '../components/ui';
import { PageHeader } from '../components/ui';
import { Button } from '../components/ui';
import { Input } from '../components/ui';
import { StatTile } from '../components/ui';

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
  checkedIn: boolean;
  ageAtTournament: number | null;
  competitor: Competitor;
}

function formatStatus(status: string): string {
  switch (status) {
    case 'in_progress':
      return 'In Progress';
    case 'registration':
      return 'Registration';
    case 'draft':
      return 'Draft';
    case 'completed':
      return 'Completed';
    case 'brackets':
      return 'Brackets Ready';
    case 'active':
      return 'Active';
    default:
      return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
  }
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
  const [showCloseRegistrationConfirm, setShowCloseRegistrationConfirm] = useState(false);

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
      <Card>
        <EmptyState
          icon={Trophy}
          title="Tournament not found"
          description="This tournament may have been deleted."
          action={{ label: 'Back to Tournaments', onClick: () => window.history.back() }}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div>
        <Link
          to="/tournaments"
          className="inline-flex items-center text-sm text-gray-600 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Back to Tournaments
        </Link>
      </div>

      {/* Page Header */}
      <PageHeader
        title={tournament.name}
        description={tournament.location
          ? `${new Date(tournament.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} · ${tournament.location}`
          : new Date(tournament.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        actions={
          <div data-tour="tournament-detail-actions" className="flex flex-wrap gap-2">
            <Button as={Link} to={`/tournaments/${id}/settings`} variant="secondary">
              <Settings className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Settings</span>
            </Button>
            <Button as={Link} to={`/tournaments/${id}/schedule`} variant="secondary">
              <Calendar className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Schedule</span>
            </Button>
            {/* Preview public display — opens the read-only scoreboard in a new
                tab so the director can check what spectators will see without
                having to log out or copy-paste a URL. */}
            <Button
              data-tour="public-display"
              as="a"
              href={`/display/${id}`}
              target="_blank"
              rel="noopener noreferrer"
              variant="secondary"
            >
              <Monitor className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">View Public</span>
              <ExternalLink className="h-3 w-3 ml-1 opacity-50" />
            </Button>
            <Button as={Link} to={`/tournaments/${id}/divisions`} variant="primary">
              <LayoutGrid className="h-4 w-4 mr-2" />
              Manage Divisions
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        }
      />

      {/* Tournament Day Actions — 3-col grid with vertical icon-above-text cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Link
          to={`/tournaments/${id}/director`}
          className="group flex items-start gap-4 p-4 rounded-xl border-2 border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-900 shadow-sm transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
        >
          <div className="flex-shrink-0 bg-indigo-600 p-3 rounded-lg">
            <LayoutDashboard className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-slate-900 dark:text-slate-100">Director Dashboard</p>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">Tournament control center</p>
          </div>
          <ArrowRight className="h-5 w-5 text-slate-600 group-hover:text-indigo-600 transition-colors flex-shrink-0" />
        </Link>

        <Link
          to={`/checkin/${id}`}
          className="group flex items-start gap-4 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
        >
          <div className="flex-shrink-0 bg-blue-500 p-3 rounded-lg">
            <ClipboardCheck className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-slate-900 dark:text-slate-100">Check-In</p>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">Verify competitor attendance</p>
          </div>
          <ArrowRight className="h-5 w-5 text-slate-600 group-hover:text-blue-600 transition-colors flex-shrink-0" />
        </Link>

        <Link
          to={`/scorekeeper/${id}`}
          className="group flex items-start gap-4 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
        >
          <div className="flex-shrink-0 bg-green-500 p-3 rounded-lg">
            <Timer className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-slate-900 dark:text-slate-100">Scorekeeper</p>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">Record match results</p>
          </div>
          <ArrowRight className="h-5 w-5 text-slate-600 group-hover:text-green-600 transition-colors flex-shrink-0" />
        </Link>

        <a
          href={`/api/brackets/tournament/${id}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-start gap-4 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
        >
          <div className="flex-shrink-0 bg-purple-500 p-3 rounded-lg">
            <FileDown className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-slate-900 dark:text-slate-100">Export Brackets</p>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">Download all bracket PDFs</p>
          </div>
          <ArrowRight className="h-5 w-5 text-slate-600 group-hover:text-purple-600 transition-colors flex-shrink-0" />
        </a>

        <Link
          to={`/display/${id}`}
          target="_blank"
          className="group flex items-start gap-4 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
        >
          <div className="flex-shrink-0 bg-yellow-500 p-3 rounded-lg">
            <Monitor className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-slate-900 dark:text-slate-100">Live Scoreboard</p>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">Public display for spectators</p>
          </div>
          <ArrowRight className="h-5 w-5 text-slate-600 group-hover:text-yellow-600 transition-colors flex-shrink-0" />
        </Link>

        <Link
          to={`/tournaments/${id}/results`}
          className="group flex items-start gap-4 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
        >
          <div className="flex-shrink-0 bg-red-500 p-3 rounded-lg">
            <Medal className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-slate-900 dark:text-slate-100">Results</p>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">View standings and medals</p>
          </div>
          <ArrowRight className="h-5 w-5 text-slate-600 group-hover:text-red-600 transition-colors flex-shrink-0" />
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatTile label="Registered" value={registrations?.length || 0} icon={Users} />
        <StatTile
          label="Checked In"
          value={`${registrations?.filter((r) => r.checkedIn).length || 0} / ${registrations?.length || 0}`}
          icon={ClipboardCheck}
        />
        <StatTile label="Divisions" value={tournament._count.divisions} icon={LayoutGrid} />
        <StatTile label="Status" value={formatStatus(tournament.status)} icon={Settings} />
      </div>

      {/* Day-Of Operations Panel — live stats for the running tournament */}
      {tournament.status !== 'draft' && (
        <DayOfPanel tournamentId={tournament.id} />
      )}

      {/* Tournament Status Controls */}
      {tournament.status === 'registration' ? (
        <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-300 flex-1 min-w-0">
              <Globe className="h-5 w-5 flex-shrink-0" />
              <span className="font-medium">Open for Registration</span>
              <span className="text-sm truncate hidden sm:block">{registrationUrl}</span>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Button variant="secondary" size="sm" onClick={copyRegistrationLink}>
                <Copy className="h-3.5 w-3.5" />
                {copiedLink ? 'Copied!' : 'Copy Link'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowCloseRegistrationConfirm(true)}
                loading={updateStatusMutation.isPending}
                className="text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
              >
                <Lock className="h-3.5 w-3.5" />
                Close Registration
              </Button>
            </div>
          </div>
        </div>
      ) : tournament.status === 'active' || tournament.status === 'in_progress' || tournament.status === 'brackets' ? (
        <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="text-sm text-yellow-800 dark:text-yellow-300 flex-1">
            Tournament is active. Mark as completed when all divisions are finished.
          </p>
          <div className="flex gap-2 flex-shrink-0">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => updateStatusMutation.mutate('registration')}
              loading={updateStatusMutation.isPending}
            >
              <Globe className="h-3.5 w-3.5 mr-1" />
              Reopen Registration
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => updateStatusMutation.mutate('completed')}
              loading={updateStatusMutation.isPending}
            >
              <Flag className="h-3.5 w-3.5 mr-1" />
              Mark Completed
            </Button>
          </div>
        </div>
      ) : tournament.status === 'completed' ? (
        <div className="p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="text-sm text-gray-600 dark:text-gray-400 flex-1">
            This tournament is completed.
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => updateStatusMutation.mutate('active')}
            loading={updateStatusMutation.isPending}
          >
            Reopen Tournament
          </Button>
        </div>
      ) : (
        <div className="p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="text-sm text-gray-600 dark:text-gray-400 flex-1">
            Open this tournament for public self-registration to share a signup link with competitors.
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => updateStatusMutation.mutate('registration')}
            loading={updateStatusMutation.isPending}
          >
            <Globe className="h-3.5 w-3.5 mr-1" />
            Open for Registration
          </Button>
        </div>
      )}

      {/* Registrations */}
      <Card>
        <CardHeader
          title="Registered Competitors"
          action={
            <div className="flex flex-col sm:flex-row gap-3">
              {registrations && registrations.length > 0 && (
                <Input
                  type="text"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full sm:w-48"
                  inputClassName="h-8 py-1.5"
                  leftIcon={<Search className="h-4 w-4" />}
                />
              )}
              <Button variant="primary" size="sm" onClick={() => setShowAddModal(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Competitors
              </Button>
            </div>
          }
        />
        <CardBody className="p-0">
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
                      <IconButton
                        icon={<Trash2 className="h-4 w-4" />}
                        label={`Remove ${reg.competitor.firstName} ${reg.competitor.lastName} from this tournament`}
                        variant="danger"
                        size="sm"
                        onClick={() => setDeleteTarget(reg)}
                      />
                    </div>
                    <div className="text-sm text-gray-600 space-y-1">
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
                            : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-400'
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
                            : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-400'
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
                <DataTable>
                  <TableHead>
                    <tr>
                      <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 text-left">Name</th>
                      <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 text-left">Age</th>
                      <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 text-left">Belt</th>
                      <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 text-left">Weight</th>
                      <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 text-left">School</th>
                      <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 text-center">Patterns</th>
                      <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 text-center">Sparring</th>
                      <th className="px-4 py-2.5 w-10"></th>
                    </tr>
                  </TableHead>
                  <TableBody className="bg-white dark:bg-slate-800">
                    {filteredRegistrations.map((reg) => (
                      <TableRow key={reg.id}>
                        <TableCell className="font-medium text-slate-900 dark:text-white">
                          {reg.competitor.firstName} {reg.competitor.lastName}
                        </TableCell>
                        <TableCell>{reg.ageAtTournament || '-'}</TableCell>
                        <TableCell>
                          <span
                            className={`inline-flex px-2 py-1 rounded text-xs font-medium ${getBeltColor(
                              reg.competitor.belt
                            )}`}
                          >
                            {reg.competitor.belt}
                            {reg.competitor.danRank && ` ${reg.competitor.danRank}D`}
                          </span>
                        </TableCell>
                        <TableCell>
                          {reg.competitor.weightLbs
                            ? `${reg.competitor.weightLbs} lbs`
                            : '-'}
                        </TableCell>
                        <TableCell className="max-w-[150px] truncate">{reg.competitor.schoolDojang || '-'}</TableCell>
                        <TableCell className="text-center">
                          <IconButton
                            icon={reg.patterns ? <Check className="h-4 w-4" /> : <span aria-hidden="true">—</span>}
                            label={`${reg.competitor.firstName} ${reg.competitor.lastName} — Patterns ${reg.patterns ? 'enrolled' : 'not enrolled'}`}
                            variant={reg.patterns ? 'success' : 'default'}
                            size="sm"
                            pressed={reg.patterns}
                            onClick={() =>
                              updateRegistrationMutation.mutate({
                                regId: reg.id,
                                patterns: !reg.patterns,
                                sparring: reg.sparring,
                              })
                            }
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <IconButton
                            icon={reg.sparring ? <Check className="h-4 w-4" /> : <span aria-hidden="true">—</span>}
                            label={`${reg.competitor.firstName} ${reg.competitor.lastName} — Sparring ${reg.sparring ? 'enrolled' : 'not enrolled'}`}
                            variant={reg.sparring ? 'success' : 'default'}
                            size="sm"
                            pressed={reg.sparring}
                            onClick={() =>
                              updateRegistrationMutation.mutate({
                                regId: reg.id,
                                patterns: reg.patterns,
                                sparring: !reg.sparring,
                              })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <IconButton
                            icon={<Trash2 className="h-4 w-4" />}
                            label={`Remove ${reg.competitor.firstName} ${reg.competitor.lastName} from this tournament`}
                            variant="danger"
                            size="sm"
                            onClick={() => setDeleteTarget(reg)}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </DataTable>
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
        </CardBody>
      </Card>

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

      {/* Close Registration Confirmation */}
      <ConfirmDialog
        isOpen={showCloseRegistrationConfirm}
        onClose={() => setShowCloseRegistrationConfirm(false)}
        onConfirm={() => {
          updateStatusMutation.mutate('active');
          setShowCloseRegistrationConfirm(false);
        }}
        title="Close Registration"
        message="Are you sure you want to close registration? No new public signups will be accepted."
        confirmText="Close Registration"
        variant="warning"
        isLoading={updateStatusMutation.isPending}
      />

      {/* Add Competitors Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div
            className="fixed inset-0 bg-black/50 transition-opacity"
            onClick={() => {
              setShowAddModal(false);
              setSelectedCompetitors([]);
              setModalSearch('');
            }}
          />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden">
              <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Add Competitors</h2>
                  <CloseButton
                    onClose={() => {
                      setShowAddModal(false);
                      setSelectedCompetitors([]);
                      setModalSearch('');
                    }}
                    label="Close add competitors"
                  />
                </div>
                <div className="flex flex-col sm:flex-row gap-4">
                  <Input
                    type="text"
                    placeholder="Search competitors..."
                    value={modalSearch}
                    onChange={(e) => setModalSearch(e.target.value)}
                    leftIcon={<Search className="h-4 w-4" />}
                    autoFocus
                  />
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
                        <span className="text-xs text-gray-600">
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
                          <span className="ml-2 text-sm text-gray-600 dark:text-gray-400 hidden sm:inline truncate max-w-[120px]">
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
                  <Button
                    variant="secondary"
                    className="flex-1 sm:flex-none"
                    onClick={() => {
                      setShowAddModal(false);
                      setSelectedCompetitors([]);
                      setModalSearch('');
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    className="flex-1 sm:flex-none"
                    loading={bulkRegisterMutation.isPending}
                    disabled={selectedCompetitors.length === 0}
                    onClick={() =>
                      bulkRegisterMutation.mutate({
                        competitorIds: selectedCompetitors,
                        patterns: registerPatterns,
                        sparring: registerSparring,
                      })
                    }
                  >
                    {bulkRegisterMutation.isPending
                      ? 'Adding...'
                      : `Add ${selectedCompetitors.length} Competitors`}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Day-Of Operations Panel ───────────────────────────────────────────────
// Real-time operational view: who's checked in, what rings are running,
// what's coming up, weight-mismatch alerts. Auto-refreshes every 10s.
function DayOfPanel({ tournamentId }: { tournamentId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['day-of', tournamentId],
    queryFn: async () => {
      const res = await fetch(`/api/tournaments/${tournamentId}/day-of`, { headers: getAuthHeaders() });
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 10_000,
  });

  if (isLoading || !data) return null;

  const checkInPct = data.checkIn.percent;

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Tournament day"
        description="Live operational view · auto-refreshes every 10s"
        action={
          <span className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live
          </span>
        }
      />
      <CardBody className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {/* Check-in card with progress bar */}
        <div className="lg:col-span-2 p-4 rounded-xl bg-gradient-to-br from-slate-50 to-white dark:from-slate-900/40 dark:to-slate-900/20 border border-slate-200/60 dark:border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">Check-in</div>
              <div className="text-2xl font-bold tabular-nums mt-0.5">
                <span className="text-slate-900 dark:text-white">{data.checkIn.checkedIn}</span>
                <span className="text-slate-600"> / {data.checkIn.total}</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                {checkInPct}%
              </div>
              <div className="text-[10px] text-slate-600 uppercase tracking-wider">complete</div>
            </div>
          </div>
          <div className="h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-700"
              style={{ width: `${checkInPct}%` }}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-600">
            <span><strong className="text-slate-900 dark:text-white tabular-nums">{data.checkIn.checkedIn}</strong> checked in</span>
            <span className="text-slate-300">·</span>
            <span><strong className="text-amber-600 dark:text-amber-400 tabular-nums">{data.checkIn.notCheckedIn}</strong> not yet</span>
            {data.checkIn.weightMismatches > 0 && (
              <>
                <span className="text-slate-300">·</span>
                <span className="text-red-600 dark:text-red-400 font-medium">
                  <AlertTriangle className="inline h-3 w-3 mr-0.5" />
                  {data.checkIn.weightMismatches} weight {data.checkIn.weightMismatches === 1 ? 'mismatch' : 'mismatches'}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Matches stat */}
        <div className="p-4 rounded-xl bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-950/30 dark:to-slate-900/20 border border-indigo-200/60 dark:border-indigo-900/40">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">Matches</div>
          <div className="text-2xl font-bold tabular-nums mt-0.5">
            <span className="text-slate-900 dark:text-white">{data.matches.completed}</span>
            <span className="text-slate-600"> / {data.matches.total}</span>
          </div>
          <div className="mt-2 h-1.5 bg-indigo-100 dark:bg-indigo-950 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-700"
              style={{ width: `${data.matches.total > 0 ? (data.matches.completed / data.matches.total) * 100 : 0}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
            {data.matches.inProgress > 0 && (
              <span className="text-amber-600 dark:text-amber-400 font-medium">
                {data.matches.inProgress} live
              </span>
            )}
            <span>{data.matches.ready} ready</span>
            <span className="text-slate-600">{data.matches.pending} pending</span>
          </div>
        </div>
      </CardBody>

      {/* By ring + Up next */}
      {data.upNext && data.upNext.length > 0 && (
        <div className="border-t border-slate-200 dark:border-slate-800 px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Up next by ring</h3>
            <Link
              to={`/display/${tournamentId}`}
              target="_blank"
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
            >
              Open public scoreboard <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {data.upNext.map((u: any) => (
              <div key={u.ring} className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">Ring {u.ring}</span>
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-300 truncate">{u.division}</div>
                <div className="text-[11px] text-slate-600 mt-0.5">Match #{u.matchNumber}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Weight mismatch alert list */}
      {data.checkIn.weightMismatchDetails && data.checkIn.weightMismatchDetails.length > 0 && (
        <div className="border-t border-slate-200 dark:border-slate-800 px-5 py-4 bg-red-50/30 dark:bg-red-950/10">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            <h3 className="text-sm font-semibold text-red-700 dark:text-red-300">Weight mismatches to review</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {data.checkIn.weightMismatchDetails.map((m: any) => (
              <div key={m.registrationId} className="flex items-center justify-between px-3 py-2 rounded-md bg-white dark:bg-slate-900 border border-red-200/60 dark:border-red-900/40">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-900 dark:text-white truncate">{m.name}</div>
                  <div className="text-slate-600 truncate">{m.school || '—'}</div>
                </div>
                <div className="text-right tabular-nums ml-2">
                  <div className="text-[11px] text-slate-600">
                    <span className="line-through opacity-60">{m.weightAtRegistration}</span>
                    {' → '}
                    <span className="text-slate-900 dark:text-white">{m.checkInWeight}</span>
                  </div>
                  <div className={`text-[11px] font-semibold ${m.delta > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'}`}>
                    {m.delta > 0 ? '+' : ''}{m.delta.toFixed(1)} lbs
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
