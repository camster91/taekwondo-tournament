import { useQuery } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import { getAuthHeaders } from '../context/AuthContext';
import { Card, CardBody, CardHeader, EmptyState, PageHeader, Spinner } from '../components/ui';
import { staffDutyLabel } from '../../shared/constants/staff-duties';

interface MyAssignment {
  id: string;
  duty: string;
  ringNumber: number | null;
  startTime: string;
  endTime: string;
  note: string | null;
  tournament: { id: string; name: string; date: string; location: string | null };
}

interface MyAssignmentsResponse {
  assignments: MyAssignment[];
  generatedAt: string;
}

/**
 * Staff run sheet: only the viewer's own ring/time/duty lines, grouped by
 * tournament. No competitor data, so it is safe on a phone at the venue.
 */
export default function MyAssignments() {
  const query = useQuery<MyAssignmentsResponse>({
    queryKey: ['my-assignments'],
    queryFn: async () => {
      const res = await fetch('/api/staffing/mine', { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Could not load your assignments');
      return res.json();
    },
    refetchInterval: 60_000,
  });

  if (query.isLoading) {
    return <div className="flex justify-center py-12"><Spinner size="lg" /></div>;
  }

  const data = query.data;
  if (!data) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="Assignments are unavailable"
        description={query.error instanceof Error ? query.error.message : 'Try again in a moment.'}
      />
    );
  }

  const byTournament = new Map<string, MyAssignment[]>();
  for (const assignment of data.assignments) {
    const list = byTournament.get(assignment.tournament.id) ?? [];
    list.push(assignment);
    byTournament.set(assignment.tournament.id, list);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="My assignments" description="Where and when you are working at upcoming events." />

      {query.isError && (
        <div role="status" className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-surface-900 dark:text-white">
          Could not refresh. Showing your assignments as of {new Date(data.generatedAt).toLocaleTimeString()}.
        </div>
      )}

      {byTournament.size === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No assignments"
          description="When a director assigns you to a ring or duty, it appears here."
        />
      ) : (
        [...byTournament.values()].map((list) => {
          const { tournament } = list[0];
          return (
            <Card key={tournament.id}>
              <CardHeader
                as="h2"
                title={tournament.name}
                description={[new Date(tournament.date).toLocaleDateString(), tournament.location].filter(Boolean).join(' · ')}
              />
              <CardBody>
                <ul className="divide-y divide-surface-200 dark:divide-surface-700">
                  {list.map((a) => (
                    <li key={a.id} className="py-3 text-sm text-surface-900 dark:text-white">
                      <div className="text-base font-semibold">{a.startTime}–{a.endTime}</div>
                      <div>
                        {staffDutyLabel(a.duty)} · {a.ringNumber === null ? 'Whole venue' : `Ring ${a.ringNumber}`}
                      </div>
                      {a.note && <div className="text-surface-600 dark:text-surface-300">{a.note}</div>}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          );
        })
      )}
    </div>
  );
}
