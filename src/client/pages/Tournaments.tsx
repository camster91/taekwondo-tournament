import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Trophy, Calendar, Users, LayoutGrid, X, MapPin, Search } from 'lucide-react';
import { CardSkeleton } from '../components/ui/Skeleton';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState from '../components/ui/EmptyState';
import { StatusBadge } from '../components/ui/Badge';
import Spinner from '../components/ui/Spinner';
import { getAuthHeaders } from '../context/AuthContext';
import { SPORT_PROFILES } from '../../shared/constants/sport-profiles';
import { Card, CardHeader, CardBody } from '../components/ui';
import { PageHeader } from '../components/ui';
import { Button } from '../components/ui';
import { Input } from '../components/ui';
import { Label } from '../components/ui';

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
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Tournament | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    date: '',
    location: '',
    sportProfileSlug: 'taekwondo',
  });

  const { data: tournaments, isLoading } = useQuery<Tournament[]>({
    queryKey: ['tournaments'],
    queryFn: async () => {
      const res = await fetch('/api/tournaments', { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch tournaments');
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await fetch('/api/tournaments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(data),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tournaments'] });
      setShowCreateModal(false);
      setFormData({ name: '', date: '', location: '', sportProfileSlug: 'taekwondo' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/tournaments/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tournaments'] });
      setDeleteTarget(null);
    },
  });

  const filteredTournaments = tournaments?.filter((t) =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.location?.toLowerCase().includes(searchQuery.toLowerCase())
  );

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

      {/* Search Bar */}
      {tournaments && tournaments.length > 0 && (
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            type="text"
            placeholder="Search tournaments..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 w-full"
          />
        </div>
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
        <div className="modal-container flex items-center justify-center p-4">
          <div className="modal-backdrop" onClick={() => setShowCreateModal(false)} />
          <div className="modal-panel">
            <div className="modal-header">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Create Tournament</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 touch-target flex items-center justify-center"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createMutation.mutate(formData);
              }}
            >
              <div className="modal-body space-y-4">
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
                  <p className="mt-1 text-xs text-gray-500">Optional</p>
                </div>
              </div>
              <div className="modal-footer">
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="w-full sm:w-auto"
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  type="submit"
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
              </div>
            </form>
          </div>
        </div>
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
    </div>
  );
}

function TournamentCard({
  tournament,
  onDelete,
}: {
  tournament: Tournament;
  onDelete: () => void;
}) {
  const isCompleted = tournament.status === 'completed';

  return (
    <Card interactive={!isCompleted} className={isCompleted ? 'opacity-75' : 'border-l-4 border-l-primary-500'}>
      <Link to={`/tournaments/${tournament.id}`} className="block hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors">
        <CardBody>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center min-w-0">
              <div className={`p-2 rounded-lg ${isCompleted ? 'bg-gray-100 dark:bg-gray-700' : 'bg-primary-100 dark:bg-primary-900/30'}`}>
                <Trophy className={`h-6 w-6 ${isCompleted ? 'text-gray-500' : 'text-primary-600 dark:text-primary-400'}`} />
              </div>
              <div className="ml-3 min-w-0">
                <h3 className="font-semibold text-gray-900 dark:text-white truncate">
                  {tournament.name}
                </h3>
                <StatusBadge status={tournament.status} />
                {tournament.sportProfileSlug && (
                  <span className="text-xs text-gray-500 mt-0.5">
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
                <span className="ml-1 text-gray-400">competitors</span>
              </div>
              <div className="flex items-center text-gray-600 dark:text-gray-400">
                <LayoutGrid className="h-4 w-4 mr-1.5" />
                <span className="font-medium">{tournament._count.divisions}</span>
                <span className="ml-1 text-gray-400">divisions</span>
              </div>
            </div>
          </div>
        </CardBody>
      </Link>
      <div className="px-4 pb-4 pt-0 border-t border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row gap-2">
        <Link
          to={`/tournaments/${tournament.id}`}
          className="btn btn-primary flex-1 text-center"
        >
          {isCompleted ? 'View Results' : 'Manage'}
        </Link>
        <button
          onClick={onDelete}
          className="btn btn-secondary text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 flex-1"
        >
          Delete
        </button>
      </div>
    </Card>
  );
}
