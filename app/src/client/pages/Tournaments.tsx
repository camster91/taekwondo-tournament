import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Trophy, Calendar, Users, LayoutGrid, X } from 'lucide-react';

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

export default function Tournaments() {
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    date: '',
    location: '',
  });

  const { data: tournaments, isLoading } = useQuery<Tournament[]>({
    queryKey: ['tournaments'],
    queryFn: async () => {
      const res = await fetch('/api/tournaments');
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await fetch('/api/tournaments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tournaments'] });
      setShowCreateModal(false);
      setFormData({ name: '', date: '', location: '' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/tournaments/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tournaments'] });
    },
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'badge-green';
      case 'in_progress':
        return 'badge-yellow';
      case 'brackets':
        return 'badge-blue';
      case 'registration':
        return 'badge-blue';
      default:
        return 'badge-gray';
    }
  };

  return (
    <div>
      {/* Page Header - responsive */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Tournaments</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage your tournaments
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="btn btn-primary"
        >
          <Plus className="h-4 w-4 mr-2" />
          New Tournament
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : tournaments && tournaments.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {tournaments.map((tournament) => (
            <div key={tournament.id} className="card hover:shadow-lg transition-shadow">
              <div className="card-body">
                <div className="flex items-start justify-between">
                  <div className="flex items-center min-w-0">
                    <Trophy className="h-6 w-6 sm:h-8 sm:w-8 text-primary-500 flex-shrink-0" />
                    <div className="ml-2 sm:ml-3 min-w-0">
                      <h3 className="font-semibold text-gray-900 truncate">
                        {tournament.name}
                      </h3>
                      <span className={`badge ${getStatusColor(tournament.status)}`}>
                        {tournament.status}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-3 sm:mt-4 space-y-1.5 sm:space-y-2 text-sm text-gray-600">
                  <div className="flex items-center">
                    <Calendar className="h-4 w-4 mr-2 flex-shrink-0" />
                    {new Date(tournament.date).toLocaleDateString()}
                  </div>
                  {tournament.location && (
                    <div className="flex items-center">
                      <span className="mr-2 flex-shrink-0">📍</span>
                      <span className="truncate">{tournament.location}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-4">
                    <div className="flex items-center">
                      <Users className="h-4 w-4 mr-1 flex-shrink-0" />
                      <span>{tournament._count.registrations}</span>
                    </div>
                    <div className="flex items-center">
                      <LayoutGrid className="h-4 w-4 mr-1 flex-shrink-0" />
                      <span>{tournament._count.divisions}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-gray-200 flex flex-col sm:flex-row gap-2">
                  <Link
                    to={`/tournaments/${tournament.id}`}
                    className="btn btn-primary flex-1 text-center"
                  >
                    Manage
                  </Link>
                  <button
                    onClick={() => {
                      if (confirm('Delete this tournament?')) {
                        deleteMutation.mutate(tournament.id);
                      }
                    }}
                    className="btn btn-secondary text-red-600 hover:text-red-700"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card">
          <div className="empty-state">
            <Trophy className="empty-state-icon" />
            <h3 className="empty-state-title">No tournaments</h3>
            <p className="empty-state-text">
              Get started by creating a new tournament.
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="mt-4 btn btn-primary"
            >
              <Plus className="h-4 w-4 mr-2" />
              New Tournament
            </button>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="modal-container flex items-center justify-center p-4">
          <div className="modal-backdrop" onClick={() => setShowCreateModal(false)} />
          <div className="modal-panel">
            <div className="modal-header">
              <h2 className="text-lg font-semibold">Create Tournament</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-gray-400 hover:text-gray-600 touch-target flex items-center justify-center"
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
                  <label className="form-label">Tournament Name</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    placeholder="e.g., Newton's Championship 2025"
                    className="form-input w-full"
                    required
                  />
                </div>
                <div>
                  <label className="form-label">Date</label>
                  <input
                    type="date"
                    value={formData.date}
                    onChange={(e) =>
                      setFormData({ ...formData, date: e.target.value })
                    }
                    className="form-input w-full"
                    required
                  />
                </div>
                <div>
                  <label className="form-label">Location (optional)</label>
                  <input
                    type="text"
                    value={formData.location}
                    onChange={(e) =>
                      setFormData({ ...formData, location: e.target.value })
                    }
                    placeholder="e.g., Newton's Taekwondo Center"
                    className="form-input w-full"
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="btn btn-secondary w-full sm:w-auto"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="btn btn-primary w-full sm:w-auto"
                >
                  {createMutation.isPending ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
