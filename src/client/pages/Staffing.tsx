import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, Printer, UserCheck, UserMinus } from 'lucide-react';
import { getAuthHeaders } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  Button, Card, CardBody, CardHeader, ConfirmDialog, EmptyState, Input, Label, PageHeader, Select, Spinner,
} from '../components/ui';
import { downloadCSV } from '../utils/csv-export';
import { STAFF_DUTY_LABELS, staffDutyLabel } from '../../shared/constants/staff-duties';

interface StaffUser { id: string; firstName: string; lastName: string; email: string; role: string }

interface Assignment {
  id: string;
  userId: string;
  duty: string;
  ringNumber: number | null;
  startTime: string;
  endTime: string;
  note: string | null;
  status: 'active' | 'withdrawn';
  withdrawnAt: string | null;
  user: StaffUser;
}

interface StaffingBoard {
  tournament: { id: string; name: string; date: string };
  window: { startTime: string; endTime: string; ringCount: number };
  assignments: Assignment[];
  coverage: {
    gaps: Array<{ ringNumber: number; duty: string; startTime: string; endTime: string }>;
    conflicts: Array<{ userId: string; assignmentIds: [string, string]; startTime: string; endTime: string }>;
    staffedRings: number;
    ringCount: number;
  };
  eligibleStaff: StaffUser[];
  generatedAt: string;
}

const fullName = (user: Pick<StaffUser, 'firstName' | 'lastName'>) => `${user.firstName} ${user.lastName}`.trim();
const placeLabel = (ringNumber: number | null) => (ringNumber === null ? 'Venue' : `Ring ${ringNumber}`);

async function readError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({}));
  if (Array.isArray(body.details) && body.details.length) {
    return body.details.map((d: { message?: string }) => d.message).filter(Boolean).join('; ') || fallback;
  }
  return body.error || fallback;
}

export default function Staffing() {
  const { id: tournamentId } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [withdrawTarget, setWithdrawTarget] = useState<Assignment | null>(null);
  const [form, setForm] = useState({ userId: '', duty: 'scorekeeper', ring: '1', startTime: '', endTime: '', note: '' });

  const queryKey = ['staffing', tournamentId];
  const board = useQuery<StaffingBoard>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/staffing/tournament/${tournamentId}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(await readError(res, 'Could not load staffing'));
      return res.json();
    },
    refetchInterval: 30_000,
    enabled: Boolean(tournamentId),
  });

  const create = useMutation({
    mutationFn: async () => {
      const window = board.data!.window;
      const res = await fetch(`/api/staffing/tournament/${tournamentId}/assignments`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: form.userId,
          duty: form.duty,
          ringNumber: form.ring === 'venue' ? null : Number(form.ring),
          startTime: form.startTime || window.startTime,
          endTime: form.endTime || window.endTime,
          note: form.note.trim() || null,
        }),
      });
      if (!res.ok) throw new Error(await readError(res, 'Could not save the assignment'));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setForm((current) => ({ ...current, userId: '', note: '' }));
      showToast('Assignment added', 'success');
    },
    onError: (error: Error) => showToast(error.message, 'error'),
  });

  const withdraw = useMutation({
    mutationFn: async (assignment: Assignment) => {
      const res = await fetch(`/api/staffing/assignments/${assignment.id}/withdraw`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error(await readError(res, 'Could not withdraw the assignment'));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      showToast('Assignment withdrawn', 'success');
    },
    onError: (error: Error) => showToast(error.message, 'error'),
    onSettled: () => setWithdrawTarget(null),
  });

  const data = board.data;
  const active = useMemo(() => (data?.assignments ?? []).filter((a) => a.status === 'active'), [data]);
  const withdrawn = useMemo(() => (data?.assignments ?? []).filter((a) => a.status === 'withdrawn'), [data]);
  const conflictedIds = useMemo(
    () => new Set((data?.coverage.conflicts ?? []).flatMap((c) => c.assignmentIds)),
    [data],
  );
  const places = useMemo(() => {
    if (!data) return [] as Array<number | null>;
    return [...Array.from({ length: data.window.ringCount }, (_, i) => i + 1), null];
  }, [data]);

  if (board.isLoading) {
    return <div className="flex justify-center py-12"><Spinner size="lg" /></div>;
  }
  if (!data) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Staffing is unavailable"
        description={board.error instanceof Error ? board.error.message : 'Try again in a moment.'}
      />
    );
  }

  const nameOf = (userId: string) => {
    const user = data.assignments.find((a) => a.userId === userId)?.user;
    return user ? fullName(user) : 'Unknown';
  };

  const exportRoster = () => {
    const rows = [
      ['Place', 'Duty', 'Start', 'End', 'Name', 'Email', 'Note'],
      ...active.map((a) => [
        placeLabel(a.ringNumber), staffDutyLabel(a.duty), a.startTime, a.endTime, fullName(a.user), a.user.email, a.note ?? '',
      ]),
    ];
    downloadCSV(rows, `${data.tournament.name.replace(/[^\w-]+/g, '-')}-staffing.csv`);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.userId) {
      showToast('Choose a person to assign', 'error');
      return;
    }
    create.mutate();
  };

  const { gaps, conflicts, staffedRings, ringCount } = data.coverage;
  const stale = board.isError; // keep showing the last good board, but say so

  return (
    <div className="space-y-6 staffing-print-root">
      <PageHeader
        title="Staffing"
        description={`${data.tournament.name} · rings run ${data.window.startTime}–${data.window.endTime}`}
        actions={(
          <div className="flex flex-wrap gap-2 no-print">
            <Button variant="secondary" onClick={exportRoster} disabled={!active.length}>
              <Download className="h-4 w-4" aria-hidden="true" /> CSV
            </Button>
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer className="h-4 w-4" aria-hidden="true" /> Print roster
            </Button>
          </div>
        )}
      />

      {stale && (
        <div role="status" className="no-print rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-surface-900 dark:text-white">
          Could not refresh. Showing staffing as of {new Date(data.generatedAt).toLocaleTimeString()}.
        </div>
      )}

      <Card>
        <CardHeader as="h2" title="Coverage" icon={UserCheck} description="Every ring needs a scorekeeper for the whole schedule window." />
        <CardBody>
          <p className="text-sm text-surface-700 dark:text-surface-200" data-testid="coverage-summary">
            {staffedRings} of {ringCount} ring{ringCount === 1 ? '' : 's'} fully staffed
            {' · '}{gaps.length} gap{gaps.length === 1 ? '' : 's'}
            {' · '}{conflicts.length} double-booking{conflicts.length === 1 ? '' : 's'}
          </p>
          {gaps.length === 0 && conflicts.length === 0 ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Fully staffed, no double-bookings.
            </p>
          ) : (
            <ul className="mt-3 space-y-1 text-sm" aria-label="Coverage problems">
              {gaps.map((gap) => (
                <li key={`${gap.ringNumber}-${gap.startTime}`} className="flex items-start gap-2 text-surface-900 dark:text-white">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-warning" aria-hidden="true" />
                  Ring {gap.ringNumber}: no {staffDutyLabel(gap.duty).toLowerCase()} {gap.startTime}–{gap.endTime}
                </li>
              ))}
              {conflicts.map((conflict) => (
                <li key={conflict.assignmentIds.join('-')} className="flex items-start gap-2 text-surface-900 dark:text-white">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-danger" aria-hidden="true" />
                  {nameOf(conflict.userId)} is double-booked {conflict.startTime}–{conflict.endTime}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card className="no-print">
        <CardHeader as="h2" title="Assign staff" description="Only people who can open this tournament are listed. Invite someone first to add them." />
        <CardBody>
          {data.eligibleStaff.length === 0 ? (
            <p className="text-sm text-surface-700 dark:text-surface-200">
              Nobody else can open this tournament yet. <Link className="underline" to="/admin/users">Invite staff</Link> or grant access first.
            </p>
          ) : (
            <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Add assignment">
              <div>
                <Label htmlFor="staff-person" required>Person</Label>
                <Select id="staff-person" value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}>
                  <option value="">Choose…</option>
                  {data.eligibleStaff.map((user) => (
                    <option key={user.id} value={user.id}>{fullName(user)} ({user.email})</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="staff-duty">Duty</Label>
                <Select id="staff-duty" value={form.duty} onChange={(e) => setForm({ ...form, duty: e.target.value })}>
                  {Object.entries(STAFF_DUTY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="staff-place">Where</Label>
                <Select id="staff-place" value={form.ring} onChange={(e) => setForm({ ...form, ring: e.target.value })}>
                  {Array.from({ length: data.window.ringCount }, (_, i) => (
                    <option key={i + 1} value={String(i + 1)}>Ring {i + 1}</option>
                  ))}
                  <option value="venue">Whole venue</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="staff-start">Start</Label>
                <Input id="staff-start" type="time" value={form.startTime || data.window.startTime}
                  onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="staff-end">End</Label>
                <Input id="staff-end" type="time" value={form.endTime || data.window.endTime}
                  onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="staff-note">Note</Label>
                <Input id="staff-note" maxLength={200} value={form.note} placeholder="Optional"
                  onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <Button type="submit" loading={create.isPending}>Add assignment</Button>
              </div>
            </form>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader as="h2" title="Roster" description={`${data.tournament.name} · ${new Date(data.tournament.date).toLocaleDateString()}`} />
        <CardBody className="space-y-5">
          {active.length === 0 && <p className="text-sm text-surface-700 dark:text-surface-200">No one is assigned yet.</p>}
          {places.map((place) => {
            const rows = active.filter((a) => a.ringNumber === place);
            if (!rows.length) return null;
            return (
              <section key={String(place)} aria-labelledby={`place-${String(place)}`}>
                <h3 id={`place-${String(place)}`} className="mb-2 text-sm font-semibold text-surface-900 dark:text-white">
                  {place === null ? 'Whole venue' : `Ring ${place}`}
                </h3>
                <ul className="divide-y divide-surface-200 dark:divide-surface-700 rounded-lg border border-surface-200 dark:border-surface-700">
                  {rows.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="text-surface-900 dark:text-white">
                        <span className="font-medium">{a.startTime}–{a.endTime}</span>
                        {' · '}{staffDutyLabel(a.duty)}{' · '}{fullName(a.user)}
                        {a.note && <span className="text-surface-600 dark:text-surface-300"> · {a.note}</span>}
                        {conflictedIds.has(a.id) && (
                          <span className="ml-2 rounded bg-danger/10 px-1.5 py-0.5 text-xs font-medium text-danger">Double-booked</span>
                        )}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="no-print"
                        onClick={() => setWithdrawTarget(a)}
                        aria-label={`Withdraw ${fullName(a.user)} from ${placeLabel(a.ringNumber)} ${a.startTime}–${a.endTime}`}
                      >
                        <UserMinus className="h-4 w-4" aria-hidden="true" /> Withdraw
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </CardBody>
      </Card>

      {withdrawn.length > 0 && (
        <details className="no-print rounded-lg border border-surface-200 dark:border-surface-700 px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-surface-900 dark:text-white">
            Withdrawn ({withdrawn.length})
          </summary>
          <ul className="mt-2 space-y-1 text-sm text-surface-600 dark:text-surface-300">
            {withdrawn.map((a) => (
              <li key={a.id}>
                {placeLabel(a.ringNumber)} {a.startTime}–{a.endTime} · {staffDutyLabel(a.duty)} · {fullName(a.user)}
                {a.withdrawnAt && ` · withdrawn ${new Date(a.withdrawnAt).toLocaleString()}`}
              </li>
            ))}
          </ul>
        </details>
      )}

      <ConfirmDialog
        isOpen={withdrawTarget !== null}
        onClose={() => setWithdrawTarget(null)}
        onConfirm={() => withdrawTarget && withdraw.mutate(withdrawTarget)}
        title="Withdraw assignment?"
        message={withdrawTarget
          ? `${fullName(withdrawTarget.user)} will no longer be listed for ${placeLabel(withdrawTarget.ringNumber)} ${withdrawTarget.startTime}–${withdrawTarget.endTime}. It stays in the withdrawn list.`
          : ''}
        confirmText="Withdraw"
        variant="danger"
      />

      <div className="no-print">
        <Link to={`/tournaments/${tournamentId}/director`} className="text-sm text-surface-600 dark:text-surface-300 hover:underline">
          ← Director dashboard
        </Link>
      </div>
    </div>
  );
}
