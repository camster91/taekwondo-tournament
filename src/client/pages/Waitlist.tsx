import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { Users, ChevronUp, Trash2 } from 'lucide-react';
import { getAuthHeaders } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import Spinner from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { useState } from 'react';

interface WaitlistedCompetitor {
  id: string;
  waitlistPosition: number | null;
  patterns: boolean;
  sparring: boolean;
  parentName: string | null;
  parentEmail: string | null;
  parentPhone: string | null;
  createdAt: string;
  competitor: {
    id: string;
    firstName: string;
    lastName: string;
    gender: string;
    belt: string;
    danRank: number | null;
    weightLbs: number | null;
    dateOfBirth: string;
    schoolDojang: string | null;
  };
}

function Waitlist() {
  const { tournamentId } = useParams<{ tournamentId: string }>();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [confirmPromote, setConfirmPromote] = useState<string | null>(null);

  const { data: waitlisted, isLoading } = useQuery<WaitlistedCompetitor[]>({
    queryKey: ['waitlist', tournamentId],
    queryFn: async () => {
      const res = await fetch(`/api/tournaments/${tournamentId}/registrations/waitlist`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to load waitlist');
      return res.json();
    },
  });

  const promoteMutation = useMutation({
    mutationFn: async (registrationId: string) => {
      const res = await fetch(`/api/tournaments/${tournamentId}/registrations/${registrationId}/promote`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to promote');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['waitlist', tournamentId] });
      queryClient.invalidateQueries({ queryKey: ['tournament', tournamentId] });
      showToast('Competitor promoted from waitlist', 'success');
      setConfirmPromote(null);
    },
    onError: (error: Error) => {
      showToast(error.message, 'error');
      setConfirmPromote(null);
    },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!waitlisted || waitlisted.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No waitlisted competitors"
        description="All registrations are active. When the tournament reaches capacity, new registrations will be waitlisted here."
      />
    );
  }

  const competitorToPromote = waitlisted.find((w) => w.id === confirmPromote);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-surface-900 dark:text-white">Waitlist</h2>
          <p className="mt-1 text-sm text-surface-600 dark:text-surface-300">
            {waitlisted.length} competitor{waitlisted.length !== 1 ? 's' : ''} waiting for spots to open
          </p>
        </div>
      </div>

      <div className="bg-white dark:bg-surface-900 rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-surface-200 dark:divide-surface-700">
          <thead className="bg-surface-50 dark:bg-surface-800">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-surface-500 dark:text-surface-300 uppercase tracking-wider">
                Position
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-surface-500 dark:text-surface-300 uppercase tracking-wider">
                Competitor
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-surface-500 dark:text-surface-300 uppercase tracking-wider">
                School
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-surface-500 dark:text-surface-300 uppercase tracking-wider">
                Events
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-surface-500 dark:text-surface-300 uppercase tracking-wider">
                Contact
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-surface-500 dark:text-surface-300 uppercase tracking-wider">
                Registered
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-surface-500 dark:text-surface-300 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-surface-900 divide-y divide-surface-200 dark:divide-surface-700">
            {waitlisted.map((item) => {
              const events = [
                item.patterns && 'Patterns',
                item.sparring && 'Sparring',
              ].filter(Boolean).join(', ');
              
              return (
                <tr key={item.id} className="hover:bg-surface-50 dark:hover:bg-surface-800">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-warning/10 dark:bg-warning text-warning dark:text-warning/20 font-semibold text-sm">
                      #{item.waitlistPosition}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-surface-900 dark:text-white">
                      {item.competitor.firstName} {item.competitor.lastName}
                    </div>
                    <div className="text-sm text-surface-500 dark:text-surface-400">
                      {item.competitor.belt} {item.competitor.danRank ? `${item.competitor.danRank}° Dan` : ''} • {item.competitor.gender === 'M' ? 'Male' : 'Female'}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-surface-900 dark:text-surface-200">
                    {item.competitor.schoolDojang || '—'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-surface-900 dark:text-surface-200">
                    {events}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {item.parentEmail ? (
                      <div className="text-sm text-surface-900 dark:text-surface-200">
                        <div>{item.parentName || '—'}</div>
                        <a href={`mailto:${item.parentEmail}`} className="text-info dark:text-info hover:underline">
                          {item.parentEmail}
                        </a>
                      </div>
                    ) : (
                      <span className="text-sm text-surface-500 dark:text-surface-400">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-surface-500 dark:text-surface-400">
                    {new Date(item.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                    <button
                      onClick={() => setConfirmPromote(item.id)}
                      className="inline-flex items-center gap-1 text-success dark:text-success hover:text-success dark:hover:text-success/30"
                      title="Promote to active registration"
                    >
                      <ChevronUp className="h-4 w-4" />
                      Promote
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {competitorToPromote && (
        <ConfirmDialog
          isOpen={!!confirmPromote}
          onClose={() => setConfirmPromote(null)}
          onConfirm={() => promoteMutation.mutate(confirmPromote!)}
          title="Promote from waitlist?"
          message={`Promote ${competitorToPromote.competitor.firstName} ${competitorToPromote.competitor.lastName} to an active registration? They will receive a confirmation email.`}
          confirmText="Promote"
          variant="info"
        />
      )}

      <div className="flex justify-between items-center pt-4 border-t dark:border-surface-700">
        <Link
          to={`/tournaments/${tournamentId}`}
          className="text-sm text-surface-600 dark:text-surface-300 hover:text-surface-900 dark:hover:text-white"
        >
          ← Back to Tournament
        </Link>
      </div>
    </div>
  );
}

export default Waitlist;
