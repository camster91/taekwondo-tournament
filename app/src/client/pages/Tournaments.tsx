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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tournaments</h1>
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {tournaments.map((tournament) => (
            <div key={tournament.id} className="card hover:shadow-lg transition-shadow">
              <div className="card-body">
                <div className="flex items-start justify-between">
                  <div className="flex items-center">
                    <Trophy className="h-8 w-8 text-primary-500" />
                    <div className="ml-3">
                      <h3 className="font-semibold text-gray-900">
                        {tournament.name}
                      </h3>
                      <span className={`badge ${getStatusColor(tournament.status)}`}>
                        {tournament.status}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 space-y-2 text-sm text-gray-600">
                  <div className="flex items-center">
                    <Calendar className="h-4 w-4 mr-2" />
                    {new Date(tournament.date).toLocaleDateString()}
                  </div>
                  {tournament.location && (
                    <div className="flex items-center">
                      <span className="mr-2">📍</span>
                      {tournament.location}
                    </div>
                  )}
                  <div className="flex items-center">
                    <Users className="h-4 w-4 mr-2" />
                    {tournament._count.registrations} competitors
                  </div>
                  <div className="flex items-center">
                    <LayoutGrid className="h-4 w-4 mr-2" />
                    {tournament._count.divisions} divisions
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-gray-200 flex gap-2">
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
          <div className="card-body text-center py-12">
            <Trophy className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">
              No tournaments
            </h3>
            <p className="mt-1 text-sm text-gray-500">
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full m-4">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Create Tournament</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createMutation.mutate(formData);
              }}
              className="p-6 space-y-4"
            >
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
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="btn btn-primary"
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
