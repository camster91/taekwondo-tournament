import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowLeft, CheckCircle2, CircleX, RefreshCcw, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getAuthHeaders, useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Card, CardBody, CardHeader, PageHeader, Select } from '../components/ui';

type SupportTicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
type SupportTicketPriority = 'low' | 'normal' | 'high';

interface SupportTicket {
  id: string;
  source: string;
  status: SupportTicketStatus;
  priority: SupportTicketPriority;
  subject: string;
  requestedByEmail: string | null;
  requestedByName: string | null;
  page: string | null;
  lastUserMessage: string;
  lastAssistantMessage: string | null;
  notes: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type TriageSeverity = 'low' | 'normal' | 'high';

interface TriageGroup {
  title: string;
  severity: TriageSeverity;
  category: string;
  summary: string;
  ticketIds: string[];
}

interface TriageResponse {
  groups: TriageGroup[];
  ungroupedTicketIds: string[];
  tickets: Array<{ id: string; subject: string; priority: SupportTicketPriority }>;
}

const CATEGORY_LABELS: Record<string, string> = {
  error: 'Error or crash',
  wrong_result: 'Wrong result or data',
  display: 'Looks wrong',
  slow: 'Slow',
  sign_in: 'Signing in',
  email: 'Email',
  payments: 'Payments',
  other: 'Other',
};

const SEVERITY_STYLES: Record<TriageSeverity, string> = {
  high: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  normal: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  low: 'bg-surface-100 text-surface-700 dark:bg-surface-800 dark:text-surface-300',
};

const SEVERITY_LABELS: Record<TriageSeverity, string> = { high: 'High', normal: 'Normal', low: 'Low' };

export default function SupportTickets() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [triage, setTriage] = useState<TriageResponse | null>(null);

  // The AI sorting button only appears when an AI key is configured (#18).
  const { data: supportConfig } = useQuery<{ hasOpenAiApiKey: boolean }>({
    queryKey: ['support-config'],
    queryFn: async () => {
      const res = await fetch('/api/support/config', { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to load support settings');
      return res.json();
    },
    enabled: isAdmin,
  });
  const canTriage = isAdmin && Boolean(supportConfig?.hasOpenAiApiKey);

  const runTriage = useMutation({
    mutationFn: async (): Promise<TriageResponse> => {
      const res = await fetch('/api/support/bug-reports/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || 'AI sorting failed. Try again.');
      return data as TriageResponse;
    },
    onSuccess: (data) => setTriage(data),
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'AI sorting failed. Try again.');
    },
  });

  const applyPriority = useMutation({
    mutationFn: async ({ ids, priority }: { ids: string[]; priority: SupportTicketPriority }) => {
      for (const ticketId of ids) {
        const res = await fetch(`/api/support/${ticketId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({ priority }),
        });
        if (!res.ok) throw new Error('Could not update every ticket. Refresh and try again.');
      }
      return { ids, priority };
    },
    onSuccess: ({ ids, priority }) => {
      setTriage((current) => current && {
        ...current,
        tickets: current.tickets.map((t) => (ids.includes(t.id) ? { ...t, priority } : t)),
      });
      queryClient.invalidateQueries({ queryKey: ['support-tickets'] });
      toast.success(`Priority set to ${SEVERITY_LABELS[priority]} for ${ids.length} ticket${ids.length === 1 ? '' : 's'}`);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Unable to update tickets');
    },
  });
  const [statusFilter, setStatusFilter] = useState<SupportTicketStatus | ''>('');
  const [typeFilter, setTypeFilter] = useState<'' | 'bug-report'>('');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(60);

  const { data: tickets = [], isLoading } = useQuery<SupportTicket[]>({
    queryKey: ['support-tickets', statusFilter, typeFilter, limit],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (typeFilter) params.set('source', typeFilter);
      params.set('limit', String(limit));
      const res = await fetch(`/api/support?${params.toString()}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to load support tickets');
      return res.json();
    },
  });

  const updateTicket = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Pick<SupportTicket, 'status' | 'priority' | 'notes'>> }) => {
      const res = await fetch(`/api/support/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update ticket');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['support-tickets'] });
      toast.success('Ticket updated');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Unable to update ticket');
    },
  });

  const filteredTickets = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return tickets;
    return tickets.filter((ticket) =>
      [ticket.id, ticket.subject, ticket.requestedByName, ticket.requestedByEmail, ticket.page, ticket.lastUserMessage]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(term)),
    );
  }, [search, tickets]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Support Tickets"
        description="Review AI escalations and support requests."
        actions={
          <Link to="/dashboard" className="text-sm text-surface-500 hover:text-surface-700">
            <span className="inline-flex items-center">
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to dashboard
            </span>
          </Link>
        }
      />

      <Card>
        <CardHeader
          title="Filters"
          action={
            <button
              type="button"
              onClick={() => void queryClient.invalidateQueries({ queryKey: ['support-tickets', statusFilter, typeFilter, limit] })}
              className="inline-flex items-center gap-2 text-xs text-primary-600 dark:text-primary-400 hover:text-primary-500"
            >
              <RefreshCcw className="h-3.5 w-3.5" /> Refresh
            </button>
          }
        />
        <CardBody className="grid gap-3 md:grid-cols-4">
          <label className="grid gap-1 text-sm">
            <span className="text-surface-600 dark:text-surface-300">Search</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Ticket id, email, page, or message"
              className="rounded-lg border border-surface-300/80 bg-white px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-surface-600 dark:text-surface-300">Status</span>
            <Select
              value={statusFilter}
              onChange={(event) => setStatusFilter((event.target.value as SupportTicketStatus) || '')}
            >
              <option value="">All</option>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </Select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-surface-600 dark:text-surface-300">Type</span>
            <Select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value === 'bug-report' ? 'bug-report' : '')}
            >
              <option value="">All</option>
              <option value="bug-report">Bug reports</option>
            </Select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-surface-600 dark:text-surface-300">Limit</span>
            <Select
              value={String(limit)}
              onChange={(event) => setLimit(Number(event.target.value))}
            >
              <option value="30">30</option>
              <option value="60">60</option>
              <option value="120">120</option>
            </Select>
          </label>
        </CardBody>
      </Card>

      {canTriage && (
        <Card>
          <CardHeader
            title="Sort new bug reports"
            action={
              <button
                type="button"
                onClick={() => runTriage.mutate()}
                disabled={runTriage.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-500 disabled:opacity-60"
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                {runTriage.isPending ? 'Sorting…' : 'Sort with AI'}
              </button>
            }
          />
          <CardBody className="space-y-3">
            <p className="text-sm text-surface-600 dark:text-surface-400">
              Groups open bug reports that look like the same problem and suggests how urgent each one is.
              These are suggestions only; nothing changes until you apply a priority.
            </p>
            {triage && (triage.groups.length === 0 && triage.ungroupedTicketIds.length === 0 ? (
              <p className="text-sm text-surface-600 dark:text-surface-400">There are no open bug reports to sort.</p>
            ) : (
              <ul className="space-y-3" aria-label="Suggested groups">
                {triage.groups.map((group, index) => {
                  const subjects = new Map(triage.tickets.map((t) => [t.id, t]));
                  const needsChange = group.ticketIds.filter((tid) => subjects.get(tid)?.priority !== group.severity);
                  return (
                    <li key={`${group.title}-${index}`} className="rounded-lg border border-surface-200 p-3 dark:border-surface-700">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${SEVERITY_STYLES[group.severity]}`}>
                          {SEVERITY_LABELS[group.severity]}
                        </span>
                        <span className="text-xs text-surface-500 dark:text-surface-400">{CATEGORY_LABELS[group.category] ?? 'Other'}</span>
                        <span className="text-xs text-surface-500 dark:text-surface-400">· {group.ticketIds.length} report{group.ticketIds.length === 1 ? '' : 's'}</span>
                      </div>
                      <p className="mt-1 text-sm font-medium text-surface-900 dark:text-white">{group.title}</p>
                      {group.summary && <p className="text-sm text-surface-700 dark:text-surface-300">{group.summary}</p>}
                      <ul className="mt-2 list-disc pl-5 text-xs text-surface-600 dark:text-surface-400">
                        {group.ticketIds.map((tid) => <li key={tid}>{subjects.get(tid)?.subject ?? tid}</li>)}
                      </ul>
                      {needsChange.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => applyPriority.mutate({ ids: needsChange, priority: group.severity })}
                          disabled={applyPriority.isPending}
                          className="mt-2 text-xs font-medium text-primary-600 hover:text-primary-500 dark:text-primary-400 disabled:opacity-60"
                        >
                          Set priority to {SEVERITY_LABELS[group.severity]} ({needsChange.length})
                        </button>
                      ) : (
                        <p className="mt-2 text-xs text-surface-500 dark:text-surface-400">Priority already matches.</p>
                      )}
                    </li>
                  );
                })}
                {triage.ungroupedTicketIds.length > 0 && (
                  <li className="text-xs text-surface-500 dark:text-surface-400">
                    {triage.ungroupedTicketIds.length} report{triage.ungroupedTicketIds.length === 1 ? ' was' : 's were'} not grouped. Review {triage.ungroupedTicketIds.length === 1 ? 'it' : 'them'} below.
                  </li>
                )}
              </ul>
            ))}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody className="p-0">
          {isLoading ? (
            <div className="px-4 py-12 text-center text-surface-500">Loading tickets...</div>
          ) : filteredTickets.length === 0 ? (
            <div className="px-4 py-12 text-center text-surface-500">
              <div className="mx-auto mb-3 grid place-items-center">
                <CircleX className="h-9 w-9 text-surface-400" />
              </div>
              <p>No tickets match your current filters.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-surface-200 dark:divide-surface-800">
                <thead className="bg-surface-50 dark:bg-surface-950/80">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-surface-500">Ticket</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-surface-500">Contact</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-surface-500">Status</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-surface-500">Priority</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-surface-500">Last message</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-surface-500">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
                  {filteredTickets.map((ticket) => (
                    <tr key={ticket.id}>
                      <td className="px-4 py-3 align-top">
                        <div className="font-mono text-xs text-surface-700 dark:text-surface-300">{ticket.id}</div>
                        <div className="mt-1 text-sm font-medium text-surface-900 dark:text-white">{ticket.subject}</div>
                        <div className="text-xs text-surface-500 dark:text-surface-400">{ticket.source === 'bug-report' ? 'Bug report' : ticket.source} {ticket.page ? `• ${ticket.page}` : ''}</div>
                        {ticket.notes ? (
                          <div className="mt-2 rounded-md bg-surface-50 px-2 py-1 text-xs text-surface-600 dark:bg-surface-900 dark:text-surface-300">
                            <span className="font-medium">Notes:</span> {ticket.notes}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-sm align-top">
                        <div className="font-medium text-surface-900 dark:text-white">{ticket.requestedByName || '—'}</div>
                        <div className="text-surface-500 dark:text-surface-400">{ticket.requestedByEmail || '—'}</div>
                        <button
                          type="button"
                          onClick={() => {
                            const notes = ticket.notes ? `${ticket.notes}\n` : '';
                            updateTicket.mutate({
                              id: ticket.id,
                              updates: { notes: `${notes}Follow-up requested on ${new Date().toLocaleString()}` },
                            });
                          }}
                          className="mt-2 inline-flex items-center gap-1 text-xs text-primary-600 dark:text-primary-400 hover:text-primary-700"
                        >
                          <AlertCircle className="h-3.5 w-3.5" /> Add note
                        </button>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <select
                          value={ticket.status}
                          onChange={(event) => updateTicket.mutate({
                            id: ticket.id,
                            updates: { status: event.target.value as SupportTicketStatus },
                          })}
                          className="rounded-md border border-surface-300 px-2 py-1 text-sm dark:border-surface-700 dark:bg-surface-950"
                        >
                          <option value="open">Open</option>
                          <option value="in_progress">In Progress</option>
                          <option value="resolved">Resolved</option>
                          <option value="closed">Closed</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <select
                          value={ticket.priority}
                          onChange={(event) => updateTicket.mutate({
                            id: ticket.id,
                            updates: { priority: event.target.value as SupportTicketPriority },
                          })}
                          className="rounded-md border border-surface-300 px-2 py-1 text-sm dark:border-surface-700 dark:bg-surface-950"
                        >
                          <option value="low">Low</option>
                          <option value="normal">Normal</option>
                          <option value="high">High</option>
                        </select>
                      </td>
                      <td className="max-w-sm px-4 py-3 text-sm text-surface-700 dark:text-surface-300 align-top">
                        <div>{ticket.lastUserMessage}</div>
                        {ticket.lastAssistantMessage ? (
                          <>
                            <div className="mt-2 text-xs text-surface-500">AI reply:</div>
                            <div className="rounded-md bg-success/10 p-2 text-xs text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200">
                              {ticket.lastAssistantMessage}
                            </div>
                          </>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-sm text-surface-500 align-top">
                        {new Date(ticket.updatedAt).toLocaleString()}
                        {ticket.status === 'resolved' || ticket.status === 'closed' ? (
                          <div className="mt-1 inline-flex items-center gap-1 text-emerald-500">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Completed
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
