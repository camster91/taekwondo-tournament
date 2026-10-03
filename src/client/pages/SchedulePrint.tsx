import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Calendar, Printer } from 'lucide-react';
import { CardSkeleton } from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';
import { Button, PageHeader } from '../components/ui';
import { getAuthHeaders } from '../context/AuthContext';
import { useTournamentEventLabels } from '../hooks/useTournamentEventLabels';
import { buildRingTimeGrid, type PrintableScheduledDivision } from '../utils/schedule-print';
import { classicFolderName } from '../../shared/utils/classic-paper';

interface TournamentSchedule {
  tournamentName: string;
  date: string;
  config: { ringCount: number; startTime: string; endTime: string };
  schedule: PrintableScheduledDivision[];
}

/**
 * Printable ring-by-time schedule. Division names match the paper
 * bracket sheets, and each entry names the folder its sheet is in
 * (e.g. "CB Females Sparring"), so the table can find the right sheet.
 */
export default function SchedulePrint() {
  const { id } = useParams<{ id: string }>();
  const { eventLabel } = useTournamentEventLabels(id);

  // Same query key as the Schedule page, so it is usually cached.
  const { data: schedule, isLoading, isError } = useQuery<TournamentSchedule>({
    queryKey: ['schedule', id],
    queryFn: async () => {
      const res = await fetch(`/api/tournaments/${id}/schedule`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch schedule');
      return res.json();
    },
    enabled: Boolean(id),
  });

  const grid = buildRingTimeGrid(schedule?.schedule ?? [], schedule?.config.ringCount ?? 0);
  const sheetFolder = (d: PrintableScheduledDivision) => classicFolderName(d.beltLevel, d.gender, eventLabel(d.eventType));
  const dateLabel = schedule ? new Date(schedule.date).toLocaleDateString() : '';

  return (
    <div className="space-y-4 schedule-print-root">
      <PageHeader
        title="Ring schedule"
        description={schedule ? `${schedule.tournamentName} · ${dateLabel}` : undefined}
        actions={(
          <div className="flex flex-wrap gap-2 no-print">
            <Button variant="primary" onClick={() => window.print()} disabled={!grid.rows.length}>
              <Printer className="h-4 w-4 mr-2" aria-hidden="true" />
              Print
            </Button>
          </div>
        )}
      >
        <Link
          to={`/tournaments/${id}/schedule`}
          className="no-print text-sm text-surface-600 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300 flex items-center mb-2"
        >
          <ArrowLeft className="h-4 w-4 mr-1" aria-hidden="true" />
          Back to Schedule
        </Link>
      </PageHeader>

      {isLoading && <CardSkeleton />}
      {isError && (
        <p role="alert" className="text-sm text-danger600 dark:text-danger400">
          Could not load the schedule. Check your connection and try again.
        </p>
      )}
      {!isLoading && !isError && grid.rows.length === 0 && (
        <EmptyState
          icon={Calendar}
          title="Nothing scheduled yet"
          description="Make the schedule on the Schedule page first, then come back to print it."
        />
      )}

      {grid.rows.length > 0 && (
        <>
          {/* Phones: one list per ring. */}
          <div className="sm:hidden print:hidden space-y-4">
            {grid.rings.map((ring) => {
              const items = grid.rows.flatMap((row) => row.cells[ring] ?? []);
              return (
                <section key={ring} aria-label={`Ring ${ring}`} className="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800">
                  <h2 className="px-4 py-2 font-semibold text-surface-900 dark:text-white border-b border-surface-200 dark:border-surface-700">Ring {ring}</h2>
                  {items.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-surface-600 dark:text-surface-400">Nothing on this ring.</p>
                  ) : (
                    <ul className="divide-y divide-surface-200 dark:divide-surface-700">
                      {items.map((d) => (
                        <li key={d.divisionId} className="px-4 py-3">
                          <p className="text-sm font-semibold text-surface-900 dark:text-white">{d.startTime}–{d.endTime}</p>
                          <p className="text-sm text-surface-900 dark:text-white">{d.divisionName}</p>
                          <p className="text-xs text-surface-600 dark:text-surface-400">{d.competitorCount} competitors · sheet in {sheetFolder(d)}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>

          {/* Wider screens and paper: rings across, times down. */}
          <div className="hidden sm:block print:block overflow-x-auto">
            <table className="w-full border-collapse text-sm" aria-label="Ring schedule by time">
              <thead>
                <tr>
                  <th scope="col" className="border border-surface-300 dark:border-surface-600 px-2 py-1 text-left text-surface-900 dark:text-white w-20">Time</th>
                  {grid.rings.map((ring) => (
                    <th key={ring} scope="col" className="border border-surface-300 dark:border-surface-600 px-2 py-1 text-left text-surface-900 dark:text-white">Ring {ring}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((row) => (
                  <tr key={row.startTime} className="align-top">
                    <th scope="row" className="border border-surface-300 dark:border-surface-600 px-2 py-1 text-left font-semibold text-surface-900 dark:text-white">{row.startTime}</th>
                    {grid.rings.map((ring) => (
                      <td key={ring} className="border border-surface-300 dark:border-surface-600 px-2 py-1">
                        {(row.cells[ring] ?? []).map((d) => (
                          <div key={d.divisionId} className="mb-1 last:mb-0">
                            <p className="font-medium text-surface-900 dark:text-white">{d.divisionName}</p>
                            <p className="text-xs text-surface-600 dark:text-surface-400">
                              until {d.endTime} · {d.competitorCount} competitors · sheet in {sheetFolder(d)}
                            </p>
                          </div>
                        ))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
