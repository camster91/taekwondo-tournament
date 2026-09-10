import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Trophy, Calendar, Users, LayoutGrid, MapPin, Search, FileText, AlertTriangle, RefreshCw } from 'lucide-react';
import { CardSkeleton } from '../components/ui/Skeleton';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState from '../components/ui/EmptyState';
import { StatusBadge } from '../components/ui/Badge';
import Badge from '../components/ui/Badge';
import Spinner from '../components/ui/Spinner';
import { getAuthHeaders, useAuth } from '../context/AuthContext';
import { SPORT_PROFILES } from '../../shared/constants/sport-profiles';
import { saveDraft, loadDraft, clearDraft, type DraftTournament } from '../utils/draft-storage';
import { Card, CardHeader, CardBody } from '../components/ui';
import { isTestData } from '../utils/test-data';
import {
  getRoleAwareTournamentDestination,
  getRoleAwareTournamentLabel,
  getRoleAwareTournamentAriaLabel,
  type UserRole,
} from '../utils/tournament-navigation';
import {
  parseTournamentListFilters,
  serializeTournamentListFilters,
  updateSearchParams,
} from '../utils/url-state';
import {
  getAsyncStateMessage,
  isOperationInProgress,
  canRetry,
  type AsyncOperationState,
} from '../utils/async-state';
import { PageHeader } from '../components/ui';
import { Button } from '../components/ui';
import { Input } from '../components/ui';
import { Label } from '../components/ui';
import { Modal } from '../components/ui';

interface Tournament {
  id: string;
  name: string;
  date: string;
  location: string | null;
  status: string;
  sportProfileSlug: string | null;
  _count: {
    registrations: number;
    divisions: number;
  };
}

export default function Tournaments() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  // Auto-open the create modal when ?create=1 is in the URL. Lets the
  // dashboard "New Tournament" button land here with the modal already
  // open, instead of making the user click "New Tournament" twice.
  const [showCreateModal, setShowCreateModal] = useState(
    searchParams.get('create') === '1'
  );
  // Closes the modal AND strips ?create=1 from the URL so a manual
  // close + reload doesn't re-open the modal.
  const closeCreateModal = () => {
    setShowCreateModal(false);
    if (searchParams.get('create') === '1') {
      const next = new URLSearchParams(searchParams);
      next.delete('create');
      setSearchParams(next, { replace: true });
    }
  };
  const [deleteTarget, setDeleteTarget] = useState<Tournament | null>(null);
  const [showDraftDialog, setShowDraftDialog] = useState(false);
  const [draftTournament, setDraftTournament] = useState<DraftTournament | null>(null);
  
  // Read filters from URL
  const urlFilters = parseTournamentListFilters(searchParams);
  const [searchQuery, setSearchQuery] = useState(urlFilters.search || '');
  const [statusFilter, setStatusFilter] = useState<typeof urlFilters.status>(urlFilters.status || 'all');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [formData, setFormData] = useState({
    name: '',
    date: '',
    location: '',
    sportProfileSlug: 'taekwondo',
  });

  // Load draft when modal opens
  useEffect(() => {
    if (showCreateModal) {
      const draft = loadDraft<DraftTournament>('tournament');
      if (draft) {
        setDraftTournament(draft);
        setShowDraftDialog(true);
      }
    }
  }, [showCreateModal]);

  // Save draft on meaningful changes (when modal is open)
  useEffect(() => {
    if (showCreateModal && (formData.name.trim().length >= 2 || formData.date || formData.location.trim())) {
      saveDraft<DraftTournament>('tournament', {
        name: formData.name.trim(),
        date: formData.date,
        location: formData.location.trim(),
        sportProfileSlug: formData.sportProfileSlug,
      });
    }
  }, [showCreateModal, formData]);

  // Sync filters to URL when they change
  useEffect(() => {
    const filters = serializeTournamentListFilters({
      search: searchQuery || undefined,
      status: statusFilter === 'all' ? undefined : statusFilter,
      trash: urlFilters.trash,
    });
    const newParams = updateSearchParams(searchParams, filters);
    if (newParams.toString() !== searchParams.toString()) {
      setSearchParams(newParams, { replace: true });
    }
  }, [searchQuery, statusFilter, urlFilters.trash, searchParams, setSearchParams]);

  const { data: templates } = useQuery<Array<{id: string; name: string; description: string | null}>>({
    queryKey: ['tournament-templates'],
    queryFn: async () => {
      const res = await fetch('/api/tournament-templates', { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: tournaments, isLoading, isError, error, refetch } = useQuery<Tournament[]>({
    queryKey: ['tournaments'],
    queryFn: async () => {
      const res = await fetch('/api/tournaments', { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch tournaments');
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData & { templateId?: string }) => {
      const url = data.templateId 
        ? `/api/tournaments/from-template/${data.templateId}`
        : '/api/tournaments';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || 'Failed to create tournament');
      }
      return res.json();
    },
    onSuccess: () => {
      clearDraft('tournament'); // Clear draft on successful create
      queryClient.invalidateQueries({ queryKey: ['tournaments'] });
      queryClient.invalidateQueries({ queryKey: ['onboarding'] });
      closeCreateModal();
      setFormData({ name: '', date: '', location: '', sportProfileSlug: 'taekwondo' });
      setSelectedTemplateId('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/tournaments/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || 'Failed to delete tournament');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tournaments'] });
      setDeleteTarget(null);
    },
  });

  const filteredTournaments = tournaments?.filter((t) => {
    // Search filter
    const matchesSearch = !searchQuery || 
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.location?.toLowerCase().includes(searchQuery.toLowerCase());
    
    // Status filter
    const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const upcomingTournaments = filteredTournaments?.filter(
    (t) => t.status !== 'completed'
  );
  const pastTournaments = filteredTournaments?.filter(
    (t) => t.status === 'completed'
  );

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Tournaments"
        description="Create and manage your tournaments"
        actions={
          <Button variant="primary" onClick={() => setShowCreateModal(true)}>
            <Plus className="h-4 w-4 mr-2" /> New Tournament
          </Button>
        }
      />

      {/* Error Banner */}
      {isError && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-900/20">
          <CardBody>
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-red-900 dark:text-red-100">
                  Failed to load tournaments
                </h3>
                <p className="mt-1 text-sm text-red-700 dark:text-red-300">
                  {error instanceof Error ? error.message : 'An error occurred'}
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => refetch()}
                  className="mt-3"
                >
                  <RefreshCw className="h-4 w-4 mr-2" /> Try Again
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Search Bar */}
      {tournaments && tournaments.length > 0 && (
        <Input
          type="text"
          placeholder="Search tournaments..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-md"
          leftIcon={<Search className="h-4 w-4" />}
        />
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : filteredTournaments && filteredTournaments.length > 0 ? (
        <div className="space-y-8">
          {/* Active/Upcoming Tournaments */}
          {upcomingTournaments && upcomingTournaments.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <span className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse" />
                Active & Upcoming
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                {upcomingTournaments.map((tournament) => (
                  <TournamentCard
                    key={tournament.id}
                    tournament={tournament}
                    userRole={(user?.role || 'viewer') as UserRole}
                    onDelete={() => setDeleteTarget(tournament)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Past Tournaments */}
          {pastTournaments && pastTournaments.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Past Tournaments
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                {pastTournaments.map((tournament) => (
                  <TournamentCard
                    key={tournament.id}
                    tournament={tournament}
                    userRole={(user?.role || 'viewer') as UserRole}
                    onDelete={() => setDeleteTarget(tournament)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      ) : tournaments && tournaments.length > 0 ? (
        <Card>
          <EmptyState
            icon={Search}
            title="No tournaments found"
            description={`No tournaments match "${searchQuery}"`}
            action={{ label: 'Clear Search', onClick: () => setSearchQuery('') }}
          />
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon={Trophy}
            title="No tournaments yet"
            description="Get started by creating your first tournament. You can add competitors and generate brackets."
            action={{ label: 'Create Tournament', onClick: () => setShowCreateModal(true) }}
          />
        </Card>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <Modal
          isOpen={showCreateModal}
          onClose={() => closeCreateModal()}
          title="Create Tournament"
          footer={
            <>
              <Button
                variant="secondary"
                type="button"
                onClick={() => closeCreateModal()}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                form="create-tournament-form"
                loading={createMutation.isPending}
                disabled={!formData.name || !formData.date}
                className="w-full sm:w-auto flex items-center justify-center"
              >
                {createMutation.isPending ? (
                  <><Spinner size="sm" className="mr-2" /> Creating...</>
                ) : (
                  'Create Tournament'
                )}
              </Button>
            </>
          }
        >
          <form
            id="create-tournament-form"
            onSubmit={(e) => {
              e.preventDefault();
              createMutation.mutate({ ...formData, templateId: selectedTemplateId || undefined });
            }}
            className="space-y-4"
          >
            {createMutation.isError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900/50 dark:bg-red-900/20">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700 dark:text-red-300">
                    {createMutation.error instanceof Error ? createMutation.error.message : 'Failed to create tournament'}
                  </p>
                </div>
              </div>
            )}
            {templates && templates.length > 0 && (
              <div>
                <Label>Use Template (Optional)</Label>
                <div className="flex items-center gap-2">
                  <select
                    value={selectedTemplateId}
                    onChange={(e) => setSelectedTemplateId(e.target.value)}
                    className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="">Start from scratch</option>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    as={Link}
                    to="/tournament-templates"
                    variant="secondary"
                    size="sm"
                    className="flex items-center gap-1 whitespace-nowrap"
                    onClick={closeCreateModal}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Manage
                  </Button>
                </div>
                {selectedTemplateId && templates.find(t => t.id === selectedTemplateId)?.description && (
                  <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400">
                    {templates.find(t => t.id === selectedTemplateId)?.description}
                  </p>
                )}
              </div>
            )}
            <div>
              <Label>Sport</Label>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {SPORT_PROFILES.map((sport) => (
                  <button
                    key={sport.slug}
                    type="button"
                    onClick={() => setFormData({ ...formData, sportProfileSlug: sport.slug })}
                    className={`flex flex-col items-center p-2 rounded-lg border-2 text-xs font-medium transition-colors ${
                      formData.sportProfileSlug === sport.slug
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                        : 'border-gray-200 dark:border-gray-700 hover:border-primary-300 text-gray-600 dark:text-gray-400'
                    }`}
                  >
                    <span className="text-2xl mb-1">{sport.icon}</span>
                    <span>{sport.name}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label>Tournament Name *</Label>
              <Input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Newton's Championship 2025"
                required
                autoFocus
              />
            </div>
            <div>
              <Label>Date *</Label>
              <Input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                required
              />
            </div>
            <div>
              <Label>Location</Label>
              <Input
                type="text"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                placeholder="e.g., Downtown Martial Arts Center"
              />
              <p className="mt-1 text-xs text-gray-600">Optional</p>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Delete Tournament"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This will also delete all registrations, divisions, and brackets. This action cannot be undone.`}
        confirmText="Delete Tournament"
        isLoading={deleteMutation.isPending}
      />

      {/* Draft Recovery Dialog */}
      <ConfirmDialog
        isOpen={showDraftDialog}
        onClose={() => setShowDraftDialog(false)}
        onConfirm={() => {
          if (draftTournament) {
            setFormData({
              name: draftTournament.name,
              date: draftTournament.date,
              location: draftTournament.location,
              sportProfileSlug: draftTournament.sportProfileSlug,
            });
          }
          setShowDraftDialog(false);
        }}
        onCancel={() => {
          clearDraft('tournament');
          setDraftTournament(null);
          setShowDraftDialog(false);
        }}
        title="Resume draft?"
        message={draftTournament ? `You have an unfinished tournament "${draftTournament.name}". Resume or start fresh?` : ''}
        confirmText="Resume"
        cancelText="Discard"
        variant="warning"
      />
    </div>
  );
}

function TournamentCard({
  tournament,
  userRole,
  onDelete,
}: {
  tournament: Tournament;
  userRole: UserRole;
  onDelete: () => void;
}) {
  const isCompleted = tournament.status === 'completed';
  const destination = getRoleAwareTournamentDestination(tournament, userRole);
  const actionLabel = getRoleAwareTournamentLabel(tournament, userRole);
  const actionAriaLabel = getRoleAwareTournamentAriaLabel(tournament, userRole);

  return (
    <Card interactive={!isCompleted} className={isCompleted ? 'opacity-75' : 'border-l-4 border-l-primary-500'}>
      <Link to={destination} className="block hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors">
        <CardBody>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center min-w-0">
              <div className={`p-2 rounded-lg ${isCompleted ? 'bg-gray-100 dark:bg-gray-700' : 'bg-primary-100 dark:bg-primary-900/30'}`}>
                <Trophy className={`h-6 w-6 ${isCompleted ? 'text-gray-700' : 'text-primary-600 dark:text-primary-400'}`} />
              </div>
              <div className="ml-3 min-w-0">
                <h3
                  className="font-semibold text-gray-900 dark:text-white truncate flex items-center gap-1.5"
                  title={tournament.name}
                >
                  <span className="truncate">{tournament.name}</span>
                  {isTestData(tournament) && (
                    <Badge variant="warning" size="sm" title="Tournament created by Playwright e2e test">
                      TEST
                    </Badge>
                  )}
                </h3>
                <StatusBadge status={tournament.status} />
                {tournament.sportProfileSlug && (
                  <span className="text-xs text-gray-600 mt-0.5">
                    {SPORT_PROFILES.find(p => p.slug === tournament.sportProfileSlug)?.icon}{' '}
                    {SPORT_PROFILES.find(p => p.slug === tournament.sportProfileSlug)?.name}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-2 text-sm">
            <div className="flex items-center text-gray-600 dark:text-gray-400">
              <Calendar className="h-4 w-4 mr-2 flex-shrink-0" />
              <span>{new Date(tournament.date).toLocaleDateString('en-US', {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}</span>
            </div>
            {tournament.location && (
              <div className="flex items-center text-gray-600 dark:text-gray-400">
                <MapPin className="h-4 w-4 mr-2 flex-shrink-0" />
                <span className="truncate">{tournament.location}</span>
              </div>
            )}
            <div className="flex items-center gap-4 pt-1">
              <div className="flex items-center text-gray-600 dark:text-gray-400">
                <Users className="h-4 w-4 mr-1.5" />
                <span className="font-medium">{tournament._count.registrations}</span>
                <span className="ml-1 text-gray-600">competitors</span>
              </div>
              <div className="flex items-center text-gray-600 dark:text-gray-400">
                <LayoutGrid className="h-4 w-4 mr-1.5" />
                <span className="font-medium">{tournament._count.divisions}</span>
                <span className="ml-1 text-gray-600">divisions</span>
              </div>
            </div>
          </div>
        </CardBody>
      </Link>
      <div className="px-4 pb-4 pt-0 border-t border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row gap-2">
        <Button
          as={Link}
          to={destination}
          variant="primary"
          className="flex-1"
          aria-label={actionAriaLabel}
        >
          {actionLabel}
        </Button>
        <Button
          onClick={onDelete}
          variant="secondary"
          className="flex-1 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
        >
          Delete
        </Button>
      </div>
    </Card>
  );
}
