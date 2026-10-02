// Deleted (soft-deleted) tournaments with a Restore button. Shown on
// /tournaments?trash=true. Deleting a tournament only hides it; this is
// where a director gets it back, with its registrations, divisions and
// brackets intact.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft, Calendar, MapPin, RotateCcw, Trash2 } from 'lucide-react';
import { getAuthHeaders } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { readAdminOperationError } from '../utils/admin-operation-error';
import { Button, Card, CardBody, EmptyState } from './ui';
import OperationStatus from './ui/OperationStatus';
import { CardSkeleton } from './ui/Skeleton';

interface DeletedTournament {
  id: string;
  name: string;
  date: string;
  location: string | null;
  deletedAt: string | null;
  _count?: { registrations: number; divisions: number };
}

function formatDate(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

export default function DeletedTournaments() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data, isLoading, isError, error, refetch } = useQuery<DeletedTournament[]>({
    queryKey: ['tournaments', 'trash'],
    queryFn: async () => {
      const res = await fetch('/api/tournaments?trash=true', { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Could not load deleted tournaments');
      return res.json();
    },
  });

  const restore = useMutation({
    mutationFn: async (tournament: DeletedTournament) => {
      const res = await fetch(`/api/tournaments/${tournament.id}/restore`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error(await readAdminOperationError(res, 'Restore failed'));
      return tournament;
    },
    onSuccess: (tournament) => {
      queryClient.invalidateQueries({ queryKey: ['tournaments'] });
      toast.success(`Restored "${tournament.name}"`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Restore failed'),
  });

  return (
    <div className="space-y-4">
      <Link
        to="/tournaments"
        className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:underline dark:text-primary-400"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to tournaments
      </Link>

      {isError && (
        <OperationStatus
          state="rejected"
          message={error instanceof Error ? error.message : 'Could not load deleted tournaments'}
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      )}

      {isLoading ? (
        <CardSkeleton />
      ) : data && data.length > 0 ? (
        <ul className="space-y-3">
          {data.map((t) => (
            <li key={t.id}>
              <Card>
                <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold text-surface-900 dark:text-white break-words">{t.name}</p>
                    <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-surface-600 dark:text-surface-400">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" aria-hidden="true" /> {formatDate(t.date)}
                      </span>
                      {t.location && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" aria-hidden="true" /> {t.location}
                        </span>
                      )}
                      {t._count && <span>{t._count.registrations} registered</span>}
                    </p>
                    {t.deletedAt && (
                      <p className="mt-1 text-xs text-surface-500 dark:text-surface-400">
                        Deleted {formatDate(t.deletedAt)}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => restore.mutate(t)}
                    loading={restore.isPending && restore.variables?.id === t.id}
                    disabled={restore.isPending}
                    aria-label={`Restore ${t.name}`}
                    className="w-full sm:w-auto"
                  >
                    <RotateCcw className="h-4 w-4 mr-2" aria-hidden="true" /> Restore
                  </Button>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      ) : !isError ? (
        <Card>
          <EmptyState
            icon={Trash2}
            title="No deleted tournaments"
            description="Tournaments you delete show up here, and you can restore them."
          />
        </Card>
      ) : null}
    </div>
  );
}
