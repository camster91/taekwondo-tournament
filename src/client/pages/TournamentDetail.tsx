import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
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
  Mail,
  CheckCircle2,
  Shield,
  Building2,
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
import { Modal } from '../components/ui';
import OperationStatus, { type OperationState } from '../components/ui/OperationStatus';
import { readAdminOperationError } from '../utils/admin-operation-error';

interface Tournament {
  id: string;
  name: string;
  date: string;
  location: string | null;
  status: string;
  publicSlug?: string | null;
  _count: {
    registrations: number;
    divisions: number;
  };
  organization?: {
    id: string;
    name: string;
    plan: string;
  } | null;
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
  // Optional — populated when the server enriches the
  // registration with the parent contact fields (used by the
  // Broadcast Email modal to count and address recipients).
  // The /api/tournaments/:id/registrations endpoint returns
  // these for director+; the public list views omit them.
  parentEmail?: string | null;
  parentName?: string | null;
  // P2-2: Payment tracking fields
  paymentStatus?: string | null;
  paymentAmountCents?: number | null;
  parentPhone?: string | null;
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

function getPlanLimits(plan: string): { competitors: number; name: string } {
  switch (plan) {
    case 'free':
      return { competitors: 30, name: 'Free' };
    case 'starter':
      return { competitors: 100, name: 'Starter' };
    case 'pro':
      return { competitors: 9999, name: 'Pro' };
    case 'pilot':
      return { competitors: 9999, name: 'Pilot' };
    default:
      return { competitors: 30, name: 'Free' };
  }
}

export default function TournamentDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [showAddModal, setShowAddModal] = useState(false);
  const [bulkRegisterError, setBulkRegisterError] = useState<string | null>(null);
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const [selectedCompetitors, setSelectedCompetitors] = useState<string[]>([]);
  const [registerPatterns, setRegisterPatterns] = useState(true);
  const [registerSparring, setRegisterSparring] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [modalSearch, setModalSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Registration | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedSchoolLink, setCopiedSchoolLink] = useState(false);
  const [showCloseRegistrationConfirm, setShowCloseRegistrationConfirm] = useState(false);
  const registrationLockRef = useRef(false);
  const statusLockRef = useRef(false);
  const addCompetitorsTriggerRef = useRef<HTMLElement | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [closeStatusError, setCloseStatusError] = useState<string | null>(null);
  const [registrationNotice, setRegistrationNotice] = useState<{
    state: OperationState;
    message: string;
    actionLabel?: string;
    onAction?: () => void;
  } | null>(null);
  const [statusNotice, setStatusNotice] = useState<{
    state: OperationState;
    message: string;
    actionLabel?: string;
    onAction?: () => void;
  } | null>(null);

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
      if (!res.ok) {
        // Read the body once; the server's message is what the operator needs.
        const body = await res.json().catch(() => ({})) as { code?: unknown; error?: unknown };
        if (res.status === 402 && body.code === 'COMPETITOR_LIMIT_REACHED') {
          throw Object.assign(new Error(String(body.error)), { isLimitError: true });
        }
        throw new Error(typeof body.error === 'string' && body.error.trim() ? body.error : 'Failed to register competitors');
      }
      return res.json();
    },
    onMutate: () => setBulkRegisterError(null),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['registrations', id] }),
        queryClient.invalidateQueries({ queryKey: ['tournament', id] }),
      ]);
      setShowAddModal(false);
      setSelectedCompetitors([]);
      setModalSearch('');
      window.requestAnimationFrame(() => addCompetitorsTriggerRef.current?.focus());
    },
    onError: (error) => setBulkRegisterError(error instanceof Error ? error.message : 'Failed to register competitors'),
  });

  const removeRegistrationMutation = useMutation({
    mutationFn: async ({ regId }: { regId: string; competitorName: string }) => {
      const res = await fetch(`/api/tournaments/${id}/registrations/${regId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error(await readAdminOperationError(res, 'Failed to remove registration'));
    },
    onMutate: ({ competitorName }) => {
      setRemoveError(null);
      setRegistrationNotice({ state: 'pending', message: `Removing ${competitorName} from this tournament.` });
    },
    onSuccess: async (_data, { competitorName }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['registrations', id] }),
        queryClient.invalidateQueries({ queryKey: ['tournament', id] }),
      ]);
      setDeleteTarget(null);
      setRegistrationNotice({ state: 'resolved', message: `${competitorName} was removed and the registration list is up to date.` });
    },
    onError: (error) => {
      setRemoveError(error instanceof Error ? error.message : 'Failed to remove registration');
      setRegistrationNotice(null);
    },
    onSettled: () => { registrationLockRef.current = false; },
  });

  type RegistrationUpdate = {
    regId: string;
    patterns: boolean;
    sparring: boolean;
    competitorName: string;
    actionLabel: string;
  };

  const updateRegistrationMutation = useMutation({
    mutationFn: async ({ regId, patterns, sparring }: RegistrationUpdate) => {
      const res = await fetch(`/api/tournaments/${id}/registrations/${regId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ patterns, sparring }),
      });
      if (!res.ok) throw new Error(await readAdminOperationError(res, 'Failed to update registration'));
      return res.json();
    },
    onMutate: ({ competitorName, actionLabel }) => setRegistrationNotice({
      state: 'pending',
      message: `${actionLabel} for ${competitorName}.`,
    }),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['registrations', id] });
      setRegistrationNotice({
        state: 'resolved',
        message: `${variables.actionLabel} for ${variables.competitorName}; the registration list is up to date.`,
      });
    },
    onError: (error, variables) => setRegistrationNotice({
      state: 'rejected',
      message: `${variables.competitorName}: ${error instanceof Error ? error.message : 'Failed to update registration'}`,
      actionLabel: 'Retry',
      onAction: () => {
        if (registrationLockRef.current) return;
        registrationLockRef.current = true;
        updateRegistrationMutation.mutate(variables);
      },
    }),
    onSettled: () => { registrationLockRef.current = false; },
  });

  const submitRegistrationUpdate = (variables: RegistrationUpdate) => {
    if (registrationLockRef.current) return;
    registrationLockRef.current = true;
    updateRegistrationMutation.mutate(variables);
  };

  const submitRegistrationRemoval = (registration: Registration) => {
    if (registrationLockRef.current) return;
    registrationLockRef.current = true;
    removeRegistrationMutation.mutate({
      regId: registration.id,
      competitorName: `${registration.competitor.firstName} ${registration.competitor.lastName}`,
    });
  };

  const openRegistrationRemoval = (registration: Registration) => {
    setRemoveError(null);
    setRegistrationNotice(null);
    setDeleteTarget(registration);
  };

  const updateStatusMutation = useMutation({
    mutationFn: async ({ status }: { status: string; actionLabel: string }) => {
      const res = await fetch(`/api/tournaments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(await readAdminOperationError(res, 'Failed to update tournament status'));
      return res.json();
    },
    onMutate: ({ actionLabel }) => {
      setCloseStatusError(null);
      setStatusNotice({ state: 'pending', message: `${actionLabel}.` });
    },
    onSuccess: async (_data, { actionLabel }) => {
      await queryClient.invalidateQueries({ queryKey: ['tournament', id] });
      setShowCloseRegistrationConfirm(false);
      setStatusNotice({ state: 'resolved', message: `${actionLabel} completed and the tournament is up to date.` });
    },
    onError: (error, variables) => {
      const message = error instanceof Error ? error.message : 'Failed to update tournament status';
      if (showCloseRegistrationConfirm) {
        setCloseStatusError(message);
        setStatusNotice(null);
      } else {
        setStatusNotice({
          state: 'rejected',
          message,
          actionLabel: 'Retry',
          onAction: () => {
            if (statusLockRef.current) return;
            statusLockRef.current = true;
            updateStatusMutation.mutate(variables);
          },
        });
      }
    },
    onSettled: () => { statusLockRef.current = false; },
  });

  const submitStatusUpdate = (status: string, actionLabel: string) => {
    if (statusLockRef.current) return;
    statusLockRef.current = true;
    updateStatusMutation.mutate({ status, actionLabel });
  };

  // Clone this tournament as a template for next year. Closes M2 from
  // the UI audit — director can roll last year's settings forward
  // instead of copy-pasting the rules JSON.
  const cloneMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/tournaments/${id}/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Clone failed.');
      return body;
    },
    onSuccess: (cloned: { id: string }) => {
      queryClient.invalidateQueries({ queryKey: ['tournaments'] });
      navigate(`/tournaments/${cloned.id}/settings`);
    },
    onError: (e: Error) => alert(e.message || 'Clone failed'),
  });
  const handleClone = () => {
    if (!tournament) return;
    if (confirm(`Clone "${tournament.name}" as a new draft tournament? Copies age groups, weight classes, fee note, and division settings. You'll be sent to its Settings page to pick a date.`)) {
      cloneMutation.mutate();
    }
  };

  const broadcastMutation = useMutation({
    mutationFn: async (vars: { subject: string; body: string; test: boolean }) => {
      const res = await fetch(`/api/tournaments/${id}/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(vars),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Broadcast failed (${res.status})`);
      }
      return data as { sent: number; failures: number; total: number; message: string };
    },
  });

  const registrationUrl = `${window.location.origin}/register?tournament=${id}`;

  const copyRegistrationLink = () => {
    navigator.clipboard.writeText(registrationUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const schoolPortalUrl = tournament?.publicSlug
    ? `${window.location.origin}/tournaments/${id}/school?slug=${encodeURIComponent(tournament.publicSlug)}`
    : null;

  const copySchoolPortalLink = () => {
    if (!schoolPortalUrl) return;
    navigator.clipboard.writeText(schoolPortalUrl);
    setCopiedSchoolLink(true);
    setTimeout(() => setCopiedSchoolLink(false), 2000);
  };

  const registeredIds = new Set(registrations?.map((r) => r.competitorId) || []);
  const availableCompetitors =
    allCompetitors?.competitors?.filter(
      (c: Competitor) => !registeredIds.has(c.id)
    ) || [];

  const getBeltColor = (belt: string) => {
    const lower = belt.toLowerCase();
    if (lower.includes('black')) return 'bg-surface-950 text-white';
    if (lower.includes('red')) return 'bg-danger text-white';
    if (lower.includes('blue')) return 'bg-info text-white';
    if (lower.includes('green')) return 'bg-success text-white';
    if (lower.includes('yellow')) return 'bg-warning text-surface-900';
    if (lower.includes('white')) return 'bg-white text-surface-900 border';
    return 'bg-surface-200';
  };

  // P2-2: Payment status badge
  const getPaymentBadge = (status: string | null | undefined) => {
    switch (status) {
      case 'paid':
        return { text: 'Paid', className: 'bg-success/10 text-success dark:bg-success/20 dark:text-success' };
      case 'pending':
        return { text: 'Pending', className: 'bg-warning/10 text-warning dark:bg-warning/30 dark:text-warning' };
      case 'waived':
        return { text: 'Waived', className: 'bg-info/10 text-info dark:bg-info/30 dark:text-info' };
      case 'failed':
        return { text: 'Failed', className: 'bg-danger/10 text-danger dark:bg-danger/20 dark:text-danger' };
      case 'not_required':
      default:
        return { text: '', className: '' }; // Don't show badge for not_required
    }
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
          className="inline-flex items-center text-sm text-surface-600 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-300"
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
              <span className="sr-only sm:not-sr-only">Settings</span>
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleClone()}
              loading={cloneMutation.isPending}
              aria-label="Clone this tournament as a template for next year"
            >
              <Copy className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Clone</span>
            </Button>
            <Button as={Link} to={`/tournaments/${id}/schedule`} variant="secondary">
              <Calendar className="h-4 w-4 sm:mr-2" />
              <span className="sr-only sm:not-sr-only">Schedule</span>
            </Button>
            <Button as={Link} to={`/tournaments/${id}/fairness`} variant="secondary">
              <Shield className="h-4 w-4 sm:mr-2" />
              <span className="sr-only sm:not-sr-only">Fairness Rules</span>
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
              <span className="sr-only sm:not-sr-only">View Public</span>
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
          className="group flex items-start gap-4 p-4 rounded-xl border-2 border-primary-200 dark:border-primary-800 bg-white dark:bg-surface-950 shadow-sm transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
        >
          <div className="flex-shrink-0 bg-primary-600 p-3 rounded-lg">
            <LayoutDashboard className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-surface-900 dark:text-surface-100">Director Dashboard</p>
            <p className="text-sm text-surface-600 dark:text-surface-400 mt-0.5">Tournament control center</p>
          </div>
          <ArrowRight className="h-5 w-5 text-surface-600 group-hover:text-primary-600 transition-colors flex-shrink-0" />
        </Link>

        <Link
          to={`/checkin/${id}`}
          className="group flex items-start gap-4 p-4 rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-950 shadow-sm transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
        >
          <div className="flex-shrink-0 bg-info p-3 rounded-lg">
            <ClipboardCheck className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-surface-900 dark:text-surface-100">Check-In</p>
            <p className="text-sm text-surface-600 dark:text-surface-400 mt-0.5">Verify competitor attendance</p>
          </div>
          <ArrowRight className="h-5 w-5 text-surface-600 group-hover:text-info transition-colors flex-shrink-0" />
        </Link>

        <Link
          to={`/scorekeeper/${id}`}
          className="group flex items-start gap-4 p-4 rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-950 shadow-sm transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
        >
          <div className="flex-shrink-0 bg-success p-3 rounded-lg">
            <Timer className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-surface-900 dark:text-surface-100">Scorekeeper</p>
            <p className="text-sm text-surface-600 dark:text-surface-400 mt-0.5">Record match results</p>
          </div>
          <ArrowRight className="h-5 w-5 text-surface-600 group-hover:text-success transition-colors flex-shrink-0" />
        </Link>

        <a
          href={`/api/brackets/tournament/${id}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-start gap-4 p-4 rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-950 shadow-sm transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
        >
          <div className="flex-shrink-0 bg-accent-500 p-3 rounded-lg">
            <FileDown className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-surface-900 dark:text-surface-100">Export Brackets</p>
            <p className="text-sm text-surface-600 dark:text-surface-400 mt-0.5">Download all bracket PDFs</p>
          </div>
          <ArrowRight className="h-5 w-5 text-surface-600 group-hover:text-accent-600 transition-colors flex-shrink-0" />
        </a>

        {tournament.publicSlug && (
          <a
            href={`/api/tournaments/${id}/qr-poster`}
            target="_blank"
            rel="noopener noreferrer"
            download
            className="group flex items-start gap-4 p-4 rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-950 shadow-sm transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
          >
            <div className="flex-shrink-0 bg-pink-500 p-3 rounded-lg">
              <FileDown className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-surface-900 dark:text-surface-100">QR Code Poster</p>
              <p className="text-sm text-surface-600 dark:text-surface-400 mt-0.5">Printable venue signage with QR codes</p>
            </div>
            <ArrowRight className="h-5 w-5 text-surface-600 group-hover:text-pink-600 transition-colors flex-shrink-0" />
          </a>
        )}

        <Link
          to={`/display/${id}`}
          target="_blank"
          className="group flex items-start gap-4 p-4 rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-950 shadow-sm transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
        >
          <div className="flex-shrink-0 bg-warning p-3 rounded-lg">
            <Monitor className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-surface-900 dark:text-surface-100">Live Scoreboard</p>
            <p className="text-sm text-surface-600 dark:text-surface-400 mt-0.5">Public display for spectators</p>
          </div>
          <ArrowRight className="h-5 w-5 text-surface-600 group-hover:text-warning transition-colors flex-shrink-0" />
        </Link>

        <Link
          to={`/tournaments/${id}/results`}
          className="group flex items-start gap-4 p-4 rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-950 shadow-sm transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
        >
          <div className="flex-shrink-0 bg-danger p-3 rounded-lg">
            <Medal className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-surface-900 dark:text-surface-100">Results</p>
            <p className="text-sm text-surface-600 dark:text-surface-400 mt-0.5">View standings and medals</p>
          </div>
          <ArrowRight className="h-5 w-5 text-surface-600 group-hover:text-danger transition-colors flex-shrink-0" />
        </Link>
      </div>

      {/* Share School Portal — requires a public scoreboard slug so the
          share link cannot be used with UUID alone. */}
      <div className="mb-6 p-4 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-lg">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2 text-primary-700 dark:text-primary-300 flex-1 min-w-0">
            <Building2 className="h-5 w-5 flex-shrink-0" />
            <span className="font-medium">School / Coach Portal</span>
            {schoolPortalUrl ? (
              <span className="text-sm truncate hidden sm:block text-primary-500 dark:text-primary-400">{schoolPortalUrl}</span>
            ) : (
              <span className="text-sm text-primary-500 dark:text-primary-400">
                Generate a share link in Settings first
              </span>
            )}
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={copySchoolPortalLink}
              disabled={!schoolPortalUrl}
              className="btn btn-secondary text-sm py-1.5 px-3 flex items-center gap-1 disabled:opacity-50"
            >
              <Copy className="h-3.5 w-3.5" />
              {copiedSchoolLink ? 'Copied!' : 'Copy Link'}
            </button>
            {schoolPortalUrl && (
              <Link
                to={`/tournaments/${id}/school?slug=${encodeURIComponent(tournament.publicSlug!)}`}
                target="_blank"
                className="btn btn-secondary text-sm py-1.5 px-3 flex items-center gap-1"
              >
                <ArrowRight className="h-3.5 w-3.5" />
                Open Portal
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Usage Banner - show for free/starter plans when approaching limit */}
      {tournament.organization && ['free', 'starter'].includes(tournament.organization.plan) && (
        (() => {
          const plan = tournament.organization.plan;
          const limits = getPlanLimits(plan);
          const current = registrations?.length || 0;
          const percentUsed = (current / limits.competitors) * 100;
          
          // Show banner when 70% or more of limit is used
          if (percentUsed >= 70) {
            const isAtLimit = current >= limits.competitors;
            return (
              <div className={`p-4 rounded-lg border ${
                isAtLimit 
                  ? 'bg-danger/10 dark:bg-danger/20 border-danger/30 dark:border-danger/50' 
                  : 'bg-warning/10 dark:bg-warning/20 border-warning/30 dark:border-warning'
              }`}>
                <div className="flex items-start gap-3">
                  <AlertTriangle className={`h-5 w-5 flex-shrink-0 mt-0.5 ${
                    isAtLimit ? 'text-danger dark:text-danger' : 'text-warning dark:text-warning'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <h4 className={`font-medium mb-1 ${
                      isAtLimit ? 'text-danger dark:text-danger/10' : 'text-warning dark:text-warning/10'
                    }`}>
                      {isAtLimit ? 'Competitor Limit Reached' : 'Approaching Competitor Limit'}
                    </h4>
                    <p className={`text-sm ${
                      isAtLimit ? 'text-danger dark:text-danger' : 'text-warning dark:text-warning/30'
                    }`}>
                      Your {limits.name} plan allows {limits.competitors} competitors per tournament. 
                      You have {current} registered{isAtLimit ? ' and cannot add more until you upgrade' : ''}.
                    </p>
                  </div>
                  {plan === 'free' && (
                    <Button
                      variant="primary"
                      size="sm"
                      className="flex-shrink-0"
                      onClick={() => navigate('/settings/billing')}
                    >
                      Upgrade Plan
                    </Button>
                  )}
                </div>
              </div>
            );
          }
          return null;
        })()
      )}

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

      {statusNotice && (
        <OperationStatus
          state={statusNotice.state}
          message={statusNotice.message}
          actionLabel={statusNotice.actionLabel ?? (statusNotice.state === 'pending' ? undefined : 'Dismiss')}
          onAction={statusNotice.onAction ?? (statusNotice.state === 'pending' ? undefined : () => setStatusNotice(null))}
        />
      )}

      {/* Tournament Status Controls */}
      {tournament.status === 'registration' ? (
        <div className="p-4 bg-success/10 dark:bg-success/20 border border-success/30 dark:border-success rounded-lg">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2 text-success dark:text-success/30 flex-1 min-w-0">
              <Globe className="h-5 w-5 flex-shrink-0" />
              <span className="font-medium whitespace-nowrap">Open for Registration</span>
              <a
                href={registrationUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={registrationUrl}
                className="hidden sm:inline-flex text-sm font-mono text-success/80 dark:text-success/30/80 hover:text-success dark:hover:text-success/10 hover:underline truncate min-w-0"
              >
                {registrationUrl}
              </a>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Button variant="secondary" size="sm" onClick={copyRegistrationLink}>
                <Copy className="h-3.5 w-3.5" />
                {copiedLink ? 'Copied!' : 'Copy Link'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setCloseStatusError(null);
                  setShowCloseRegistrationConfirm(true);
                }}
                loading={updateStatusMutation.isPending}
                className="text-danger hover:bg-danger/10 dark:hover:bg-danger/20"
              >
                <Lock className="h-3.5 w-3.5" />
                Close Registration
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  if (confirm('Mark this tournament as completed? Parents will no longer be able to register and the public scoreboard will show final results.')) {
                    submitStatusUpdate('completed', 'Marking tournament completed');
                  }
                }}
                loading={updateStatusMutation.isPending}
              >
                <Flag className="h-3.5 w-3.5 mr-1" /> Mark Completed
              </Button>
            </div>
          </div>
        </div>
      ) : tournament.status === 'active' || tournament.status === 'in_progress' || tournament.status === 'brackets' ? (
        <div className="p-4 bg-warning/10 dark:bg-warning/20 border border-warning/30 dark:border-warning rounded-lg flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="text-sm text-warning dark:text-warning/30 flex-1">
            Tournament is active. Mark as completed when all divisions are finished.
          </p>
          <div className="flex gap-2 flex-shrink-0">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => submitStatusUpdate('registration', 'Opening public registration')}
              loading={updateStatusMutation.isPending}
            >
              <Globe className="h-3.5 w-3.5 mr-1" />
              Reopen Registration
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => submitStatusUpdate('completed', 'Marking tournament completed')}
              loading={updateStatusMutation.isPending}
            >
              <Flag className="h-3.5 w-3.5 mr-1" />
              Mark Completed
            </Button>
          </div>
        </div>
      ) : tournament.status === 'completed' ? (
        <div className="p-4 bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-lg flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="text-sm text-surface-600 dark:text-surface-400 flex-1">
            This tournament is completed.
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => submitStatusUpdate('active', 'Reopening tournament')}
            loading={updateStatusMutation.isPending}
          >
            Reopen Tournament
          </Button>
        </div>
      ) : (
        <div className="p-4 bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-lg flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="text-sm text-surface-600 dark:text-surface-400 flex-1">
            Open this tournament for public self-registration to share a signup link with competitors.
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => submitStatusUpdate('registration', 'Opening public registration')}
            loading={updateStatusMutation.isPending}
          >
            <Globe className="h-3.5 w-3.5 mr-1" />
            Open for Registration
          </Button>
        </div>
      )}

      {registrationNotice && (
        <OperationStatus
          state={registrationNotice.state}
          message={registrationNotice.message}
          actionLabel={registrationNotice.actionLabel ?? (registrationNotice.state === 'pending' ? undefined : 'Dismiss')}
          onAction={registrationNotice.onAction ?? (registrationNotice.state === 'pending' ? undefined : () => setRegistrationNotice(null))}
        />
      )}

      {/* Registrations */}
      <Card>
        <CardHeader
          title="Registered Competitors"
          action={
            <div className="flex flex-col sm:flex-row gap-3">
              {registrations && registrations.length > 0 && (
                <div>
                  <label htmlFor="tournament-search-registrations" className="sr-only">
                    Search registered competitors
                  </label>
                  <Input
                    id="tournament-search-registrations"
                    type="text"
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full sm:w-48"
                    inputClassName="h-8 py-1.5"
                    leftIcon={<Search className="h-4 w-4" />}
                  />
                </div>
              )}
              {registrations && registrations.length > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowBroadcastModal(true)}
                  aria-label="Send broadcast email to all registered parents"
                >
                  <Mail className="h-4 w-4 mr-2" />
                  Email Parents
                </Button>
              )}
              <Button ref={addCompetitorsTriggerRef} variant="primary" size="sm" onClick={() => { setBulkRegisterError(null); setShowAddModal(true); }}>
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
              <div className="md:hidden p-4 space-y-3">
                {filteredRegistrations.map((reg) => (
                  <div key={reg.id}>
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="font-semibold text-surface-900 dark:text-white">
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
                        disabled={updateRegistrationMutation.isPending || removeRegistrationMutation.isPending}
                        onClick={() => openRegistrationRemoval(reg)}
                      />
                    </div>
                    <div className="text-sm text-surface-600 space-y-1">
                      <div className="flex justify-between">
                        <span>Age</span>
                        <span className="text-surface-900 dark:text-white">{reg.ageAtTournament || '-'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Weight</span>
                        <span className="text-surface-900 dark:text-white">
                          {reg.competitor.weightLbs ? `${reg.competitor.weightLbs} lbs` : '-'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>School</span>
                        <span className="text-surface-900 dark:text-white truncate ml-4">
                          {reg.competitor.schoolDojang || '-'}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-4 mt-3 pt-3 border-t border-surface-100 dark:border-surface-700">
                      <button
                        disabled={updateRegistrationMutation.isPending || removeRegistrationMutation.isPending}
                        onClick={() =>
                          submitRegistrationUpdate({
                            regId: reg.id,
                            patterns: !reg.patterns,
                            sparring: reg.sparring,
                            competitorName: `${reg.competitor.firstName} ${reg.competitor.lastName}`,
                            actionLabel: reg.patterns ? 'Removing Patterns' : 'Adding Patterns',
                          })
                        }
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                          reg.patterns
                            ? 'bg-success/10 text-success dark:bg-success/20 dark:text-success'
                            : 'bg-surface-100 text-surface-700 dark:bg-surface-800 dark:text-surface-400'
                        }`}
                      >
                        {reg.patterns ? '✓ ' : ''}Patterns
                      </button>
                      <button
                        disabled={updateRegistrationMutation.isPending || removeRegistrationMutation.isPending}
                        onClick={() =>
                          submitRegistrationUpdate({
                            regId: reg.id,
                            patterns: reg.patterns,
                            sparring: !reg.sparring,
                            competitorName: `${reg.competitor.firstName} ${reg.competitor.lastName}`,
                            actionLabel: reg.sparring ? 'Removing Sparring' : 'Adding Sparring',
                          })
                        }
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                          reg.sparring
                            ? 'bg-success/10 text-success dark:bg-success/20 dark:text-success'
                            : 'bg-surface-100 text-surface-700 dark:bg-surface-800 dark:text-surface-400'
                        }`}
                      >
                        {reg.sparring ? '✓ ' : ''}Sparring
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Table */}
              <div className="hidden md:block">
                <DataTable>
                  <TableHead>
                    <tr>
                      <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-surface-600 dark:text-surface-400 text-left">Name</th>
                      <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-surface-600 dark:text-surface-400 text-left">Age</th>
                      <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-surface-600 dark:text-surface-400 text-left">Belt</th>
                      <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-surface-600 dark:text-surface-400 text-left">Weight</th>
                      <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-surface-600 dark:text-surface-400 text-left">School</th>
                      <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-surface-600 dark:text-surface-400 text-center">Payment</th>
                      <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-surface-600 dark:text-surface-400 text-center">Patterns</th>
                      <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-surface-600 dark:text-surface-400 text-center">Sparring</th>
                      <th className="px-4 py-2.5 w-10"></th>
                    </tr>
                  </TableHead>
                  <TableBody className="bg-white dark:bg-surface-900">
                    {filteredRegistrations.map((reg) => (
                      <TableRow key={reg.id}>
                        <TableCell className="font-medium text-surface-900 dark:text-white">
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
                          {(() => {
                            const badge = getPaymentBadge(reg.paymentStatus);
                            return badge.text ? (
                              <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${badge.className}`}>
                                {badge.text}
                              </span>
                            ) : (
                              <span className="text-surface-400 text-xs">—</span>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="text-center">
                          <IconButton
                            icon={reg.patterns ? <Check className="h-4 w-4" /> : <span aria-hidden="true">—</span>}
                            label={`${reg.competitor.firstName} ${reg.competitor.lastName} — Patterns ${reg.patterns ? 'enrolled' : 'not enrolled'}`}
                            variant={reg.patterns ? 'success' : 'default'}
                            size="sm"
                            pressed={reg.patterns}
                            disabled={updateRegistrationMutation.isPending || removeRegistrationMutation.isPending}
                            onClick={() =>
                              submitRegistrationUpdate({
                                regId: reg.id,
                                patterns: !reg.patterns,
                                sparring: reg.sparring,
                                competitorName: `${reg.competitor.firstName} ${reg.competitor.lastName}`,
                                actionLabel: reg.patterns ? 'Removing Patterns' : 'Adding Patterns',
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
                            disabled={updateRegistrationMutation.isPending || removeRegistrationMutation.isPending}
                            onClick={() =>
                              submitRegistrationUpdate({
                                regId: reg.id,
                                patterns: reg.patterns,
                                sparring: !reg.sparring,
                                competitorName: `${reg.competitor.firstName} ${reg.competitor.lastName}`,
                                actionLabel: reg.sparring ? 'Removing Sparring' : 'Adding Sparring',
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
                            disabled={updateRegistrationMutation.isPending || removeRegistrationMutation.isPending}
                            onClick={() => openRegistrationRemoval(reg)}
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
              action={{ label: 'Add Competitors', onClick: () => { setBulkRegisterError(null); setShowAddModal(true); } }}
            />
          )}
        </CardBody>
      </Card>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => { if (!removeRegistrationMutation.isPending) setDeleteTarget(null); }}
        onConfirm={() => {
          if (deleteTarget) submitRegistrationRemoval(deleteTarget);
        }}
        title="Remove Registration"
        message={
          <>
            <span className="block">Remove {deleteTarget?.competitor.firstName} {deleteTarget?.competitor.lastName} from this tournament?</span>
            {removeError && (
              <span role="alert" aria-live="assertive" className="mt-3 block rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger dark:border-danger/50 dark:bg-danger/20 dark:text-danger">
                {removeError} You can try again or cancel.
              </span>
            )}
          </>
        }
        confirmText="Remove"
        isLoading={removeRegistrationMutation.isPending}
      />

      {/* Close Registration Confirmation */}
      <ConfirmDialog
        isOpen={showCloseRegistrationConfirm}
        onClose={() => { if (!updateStatusMutation.isPending) setShowCloseRegistrationConfirm(false); }}
        onConfirm={() => submitStatusUpdate('active', 'Closing public registration')}
        title="Close Registration"
        message={
          <>
            <span className="block">Are you sure you want to close registration? No new public signups will be accepted.</span>
            {closeStatusError && (
              <span role="alert" aria-live="assertive" className="mt-3 block rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger dark:border-danger/50 dark:bg-danger/20 dark:text-danger">
                {closeStatusError} You can try again or cancel.
              </span>
            )}
          </>
        }
        confirmText="Close Registration"
        variant="warning"
        isLoading={updateStatusMutation.isPending}
      />

      {/* Add Competitors Modal */}
      {showAddModal && (
        <Modal
          isOpen={showAddModal}
          onClose={() => {
            if (bulkRegisterMutation.isPending) return;
            setShowAddModal(false);
            setSelectedCompetitors([]);
            setModalSearch('');
          }}
          closeDisabled={bulkRegisterMutation.isPending}
          title="Add Competitors"
          size="full"
          panelClassName="max-h-[90vh]"
          noBodyPadding
        >
              <div className="p-6 border-b border-surface-200 dark:border-surface-700">
                <div className="flex flex-col sm:flex-row gap-4">
                  <div>
                    <label htmlFor="tournament-search-add-competitors" className="sr-only">
                      Search competitors to add
                    </label>
                    <Input
                      id="tournament-search-add-competitors"
                      type="text"
                      placeholder="Search competitors..."
                      value={modalSearch}
                      onChange={(e) => setModalSearch(e.target.value)}
                      leftIcon={<Search className="h-4 w-4" />}
                      autoFocus
                      disabled={bulkRegisterMutation.isPending}
                    />
                  </div>
                  <div className="flex gap-4">
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={registerPatterns}
                        disabled={bulkRegisterMutation.isPending}
                        onChange={(e) => setRegisterPatterns(e.target.checked)}
                        className="rounded border-surface-300 text-primary-600 focus:ring-primary-500"
                      />
                      <span className="ml-2 text-sm text-surface-700 dark:text-surface-300">Patterns</span>
                    </label>
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={registerSparring}
                        disabled={bulkRegisterMutation.isPending}
                        onChange={(e) => setRegisterSparring(e.target.checked)}
                        className="rounded border-surface-300 text-primary-600 focus:ring-primary-500"
                      />
                      <span className="ml-2 text-sm text-surface-700 dark:text-surface-300">Sparring</span>
                    </label>
                  </div>
                </div>
              </div>
              <div className="p-4 overflow-y-auto max-h-96 bg-surface-50 dark:bg-surface-950/50">
                {filteredAvailable.length > 0 ? (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between mb-3">
                      <button
                        disabled={bulkRegisterMutation.isPending}
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
                        <span className="text-xs text-surface-600">
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
                            : 'bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 hover:border-primary-300 dark:hover:border-primary-600'
                        }`}
                      >
                        <input
                          type="checkbox"
                          disabled={bulkRegisterMutation.isPending}
                          checked={selectedCompetitors.includes(c.id)}
                          onChange={(e) =>
                            setSelectedCompetitors(
                              e.target.checked
                                ? [...selectedCompetitors, c.id]
                                : selectedCompetitors.filter((id) => id !== c.id)
                            )
                          }
                          className="rounded border-surface-300 text-primary-600 focus:ring-primary-500"
                        />
                        <span className="ml-3 flex-1 font-medium text-surface-900 dark:text-white">
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
                          <span className="ml-2 text-sm text-surface-600 dark:text-surface-400 hidden sm:inline truncate max-w-[120px]">
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
              <div className="p-4 border-t border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 space-y-3">
                {bulkRegisterError && (
                  <div role="alert" aria-live="assertive" className="w-full rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger dark:border-danger/50 dark:bg-danger/20 dark:text-danger">
                    <div className="flex items-start gap-2">
                      <div className="flex-1">
                        {bulkRegisterError} Your selections are preserved; you can try again or cancel.
                      </div>
                      {tournament.organization?.plan === 'free' && bulkRegisterError.includes('limit') && (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => {
                            setShowAddModal(false);
                            navigate('/settings/billing');
                          }}
                          className="flex-shrink-0"
                        >
                          Upgrade Plan
                        </Button>
                      )}
                    </div>
                  </div>
                )}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                  <span className="text-sm text-surface-600 dark:text-surface-400">
                    <span className="font-semibold text-surface-900 dark:text-white">{selectedCompetitors.length}</span> competitors selected
                  </span>
                  <div className="flex gap-3 w-full sm:w-auto">
                  <Button
                    variant="secondary"
                    className="flex-1 sm:flex-none"
                    onClick={() => {
                      if (bulkRegisterMutation.isPending) return;
                      setShowAddModal(false);
                      setSelectedCompetitors([]);
                      setModalSearch('');
                    }}
                    disabled={bulkRegisterMutation.isPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    className="flex-1 sm:flex-none"
                    loading={bulkRegisterMutation.isPending}
                    disabled={bulkRegisterMutation.isPending || selectedCompetitors.length === 0}
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
        </Modal>
      )}

      {/* Broadcast Email Modal — closes M1 from the UI audit. Director
          can send "Tournament starts at 9am Saturday" to every
          registered parent without copy-pasting. Merges {{competitor_*}}
          and {{tournament_*}} fields per-recipient. */}
      <BroadcastModal
        open={showBroadcastModal}
        onClose={() => setShowBroadcastModal(false)}
        mutation={broadcastMutation}
        recipientCount={registrations?.filter((r) => r.parentEmail).length ?? 0}
      />
    </div>
  );
}

function BroadcastModal({
  open,
  onClose,
  mutation,
  recipientCount,
}: {
  open: boolean;
  onClose: () => void;
  mutation: ReturnType<typeof useMutation<{ sent: number; failures: number; total: number; message: string }, Error, { subject: string; body: string; test: boolean }>>;
  recipientCount: number;
}) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [testMode, setTestMode] = useState(true);
  const [result, setResult] = useState<{ sent: number; failures: number; total: number; message: string } | null>(null);

  useEffect(() => {
    if (!open) {
      setSubject('');
      setBody('');
      setTestMode(true);
      setResult(null);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" aria-label="Email registered parents">
      <div className="fixed inset-0 bg-black/50 transition-opacity" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white dark:bg-surface-900 rounded-lg shadow-xl max-w-2xl w-full">
          <div className="p-6 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-white flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary-500" />
              Email registered parents
            </h2>
            <CloseButton onClose={onClose} label="Close broadcast composer" />
          </div>
          <div className="p-6 space-y-4">
            <div className="rounded-md bg-primary-50 dark:bg-primary-900/30 border border-primary-200 dark:border-primary-700 p-3 text-sm text-primary-900 dark:text-primary-200">
              <strong>{recipientCount}</strong> parent{recipientCount === 1 ? '' : 's'} have an email on file.
              {testMode && <span className="ml-1 text-warning dark:text-warning/30">Test mode: no one will receive this until you uncheck "Send as test".</span>}
            </div>
            <div>
              <label htmlFor="bc-subject" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Subject</label>
              <input
                id="bc-subject"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Reminder: Tournament starts Saturday at 9am"
                className="w-full h-10 px-3 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-950 text-sm text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
              />
            </div>
            <div>
              <label htmlFor="bc-body" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Message</label>
              <textarea
                id="bc-body"
                rows={8}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={'Hi {{parent_first_name}},\n\n{{competitor_first_name}} is registered for {{tournament_name}} on {{tournament_date}} at {{tournament_location}}.\n\nPlease arrive 30 minutes early.'}
                className="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-950 text-sm text-surface-900 dark:text-surface-100 font-mono placeholder:text-surface-400 placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
              />
              <details className="text-xs text-surface-500 mt-1">
                <summary className="cursor-pointer font-medium">Available merge fields</summary>
                <div className="mt-1 font-mono">
                  {`{{tournament_name}}  {{tournament_date}}  {{tournament_location}}`}<br/>
                  {`{{competitor_first_name}}  {{competitor_last_name}}`}<br/>
                  {`{{parent_first_name}}`}
                </div>
              </details>
            </div>
            <label className="flex items-start gap-2 text-sm text-surface-700 dark:text-surface-300">
              <input
                type="checkbox"
                checked={testMode}
                onChange={(e) => setTestMode(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-surface-300 text-primary-600 focus:ring-primary-500"
              />
              <span>
                <span className="font-medium">Send as test (no emails go out)</span>
                <span className="block text-xs text-surface-500">Recommended: preview the merge before blasting {recipientCount} parents.</span>
              </span>
            </label>

            {result && (
              <div
                role="status"
                aria-live="polite"
                className={`rounded-md p-3 text-sm flex items-start gap-2 ${
                  result.failures > 0
                    ? 'bg-warning/10 dark:bg-warning/20 border border-warning/30 dark:border-warning text-warning dark:text-warning/30'
                    : 'bg-success/10 dark:bg-success/20 border border-success/30 dark:border-success text-success dark:text-success/30'
                }`}
              >
                <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
                <span>
                  {result.message}
                  {result.failures > 0 && ` (${result.failures} of ${result.total} failed — check server logs.)`}
                </span>
              </div>
            )}
            {mutation.error && (
              <div role="alert" className="rounded-md p-3 text-sm bg-danger/10 dark:bg-danger/20 border border-danger/30 dark:border-danger text-danger dark:text-danger">
                {mutation.error.message}
              </div>
            )}
          </div>
          <div className="p-6 border-t border-surface-200 dark:border-surface-700 flex flex-col sm:flex-row gap-3">
            <Button variant="secondary" className="flex-1 sm:flex-none" onClick={onClose}>Close</Button>
            <Button
              variant="primary"
              className="flex-1"
              loading={mutation.isPending}
              disabled={!subject.trim() || !body.trim() || recipientCount === 0}
              onClick={() => {
                setResult(null);
                mutation.mutate(
                  { subject, body, test: testMode },
                  { onSuccess: (data) => setResult(data) },
                );
              }}
            >
              <Mail className="h-4 w-4 mr-2" />
              {testMode ? 'Send test' : `Send to ${recipientCount} parent${recipientCount === 1 ? '' : 's'}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Day-Of Operations Panel ───────────────────────────────────────────────
// Real-time operational view: who's checked in, what rings are running,
// what's coming up, weight-mismatch alerts. Auto-refreshes every 10s.
//
// Minimal types for the day-of payload — only the fields the panel
// actually consumes. The full /api/tournaments/:id/day-of response
// includes match history, ring assignment maps, and audit-log rollups;
// declaring just the consumed slice here keeps the panel immune to
// those other surface changes.
interface UpNextRing {
  ring: string;
  division: string;
  matchNumber: number;
}

interface WeightMismatchDetail {
  registrationId: string;
  name: string;
  school?: string | null;
  weightAtRegistration: number;
  checkInWeight: number;
  delta: number;
}

interface DayOfData {
  checkIn: {
    total: number;
    checkedIn: number;
    notCheckedIn: number;
    percent: number;
    weightMismatches: number;
    weightMismatchDetails?: WeightMismatchDetail[];
  };
  matches: {
    total: number;
    completed: number;
    inProgress: number;
    ready: number;
    pending: number;
  };
  upNext?: UpNextRing[];
}

function DayOfPanel({ tournamentId }: { tournamentId: string }) {
  const { data, isLoading } = useQuery<DayOfData | null>({
    queryKey: ['day-of', tournamentId],
    queryFn: async () => {
      const res = await fetch(`/api/tournaments/${tournamentId}/day-of`, { headers: getAuthHeaders() });
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 10_000,
  refetchIntervalInBackground: false,
  });

  if (isLoading || !data) return null;

  const checkInPct = data.checkIn.percent;

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Tournament day"
        description="Live operational view · auto-refreshes every 10s"
        action={
          <span className="flex items-center gap-1.5 text-xs text-surface-600">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live
          </span>
        }
      />
      <CardBody className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {/* Check-in card with progress bar */}
        <div className="lg:col-span-2 p-4 rounded-xl bg-gradient-to-br from-surface-50 to-white dark:from-surface-900/40 dark:to-surface-900/20 border border-surface-200/60 dark:border-surface-800">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-surface-600">Check-in</div>
              <div className="text-2xl font-bold tabular-nums mt-0.5">
                <span className="text-surface-900 dark:text-white">{data.checkIn.checkedIn}</span>
                <span className="text-surface-600"> / {data.checkIn.total}</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold tabular-nums text-success dark:text-emerald-400">
                {checkInPct}%
              </div>
              <div className="text-[10px] text-surface-600 uppercase tracking-wider">complete</div>
            </div>
          </div>
          <div className="h-2 bg-surface-200 dark:bg-surface-900 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-700"
              style={{ width: `${checkInPct}%` }}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-surface-600">
            <span><strong className="text-surface-900 dark:text-white tabular-nums">{data.checkIn.checkedIn}</strong> checked in</span>
            <span className="text-surface-300">·</span>
            <span><strong className="text-warning dark:text-warning tabular-nums">{data.checkIn.notCheckedIn}</strong> not yet</span>
            {data.checkIn.weightMismatches > 0 && (
              <>
                <span className="text-surface-300">·</span>
                <span className="text-danger dark:text-danger font-medium">
                  <AlertTriangle className="inline h-3 w-3 mr-0.5" />
                  {data.checkIn.weightMismatches} weight {data.checkIn.weightMismatches === 1 ? 'mismatch' : 'mismatches'}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Matches stat */}
        <div className="p-4 rounded-xl bg-gradient-to-br from-primary-50 to-white dark:from-primary-950/30 dark:to-surface-900/20 border border-primary-200/60 dark:border-primary-900/40">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-primary-600 dark:text-primary-400">Matches</div>
          <div className="text-2xl font-bold tabular-nums mt-0.5">
            <span className="text-surface-900 dark:text-white">{data.matches.completed}</span>
            <span className="text-surface-600"> / {data.matches.total}</span>
          </div>
          <div className="mt-2 h-1.5 bg-primary-100 dark:bg-primary-950 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-primary-500 to-accent-500 transition-all duration-700"
              style={{ width: `${data.matches.total > 0 ? (data.matches.completed / data.matches.total) * 100 : 0}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-surface-600">
            {data.matches.inProgress > 0 && (
              <span className="text-warning dark:text-warning font-medium">
                {data.matches.inProgress} live
              </span>
            )}
            <span>{data.matches.ready} ready</span>
            <span className="text-surface-600">{data.matches.pending} pending</span>
          </div>
        </div>
      </CardBody>

      {/* By ring + Up next */}
      {data.upNext && data.upNext.length > 0 && (
        <div className="border-t border-surface-200 dark:border-surface-800 px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-surface-900 dark:text-white">Up next by ring</h3>
            <Link
              to={`/display/${tournamentId}`}
              target="_blank"
              className="text-xs text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1"
            >
              Open public scoreboard <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {data.upNext.map((u) => (
              <div key={u.ring} className="p-3 rounded-lg bg-surface-50 dark:bg-surface-900/40 border border-surface-200/60 dark:border-surface-800">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-surface-600">Ring {u.ring}</span>
                </div>
                <div className="text-xs text-surface-600 dark:text-surface-300 truncate">{u.division}</div>
                <div className="text-[11px] text-surface-600 mt-0.5">Match #{u.matchNumber}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Weight mismatch alert list */}
      {data.checkIn.weightMismatchDetails && data.checkIn.weightMismatchDetails.length > 0 && (
        <div className="border-t border-surface-200 dark:border-surface-800 px-5 py-4 bg-danger/10/30 dark:bg-danger/10">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 text-danger" />
            <h3 className="text-sm font-semibold text-danger dark:text-danger">Weight mismatches to review</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {data.checkIn.weightMismatchDetails.map((m) => (
              <div key={m.registrationId} className="flex items-center justify-between px-3 py-2 rounded-md bg-white dark:bg-surface-950 border border-danger/30/60 dark:border-danger/40">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-surface-900 dark:text-white truncate">{m.name}</div>
                  <div className="text-surface-600 truncate">{m.school || '—'}</div>
                </div>
                <div className="text-right tabular-nums ml-2">
                  <div className="text-[11px] text-surface-600 dark:text-surface-400">
                    {/* Strikethrough alone marks the superseded weight; dimming it
                        further dropped it below 4.5:1. */}
                    <span className="line-through">{m.weightAtRegistration}</span>
                    {' → '}
                    <span className="text-surface-900 dark:text-white">{m.checkInWeight}</span>
                  </div>
                  <div className={`text-[11px] font-semibold ${m.delta > 0 ? 'text-warning dark:text-warning' : 'text-info dark:text-info'}`}>
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
