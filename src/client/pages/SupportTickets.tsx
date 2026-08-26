import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowLeft, CheckCircle2, CircleX, RefreshCcw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getAuthHeaders } from '../context/AuthContext';
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

export default function SupportTickets() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<SupportTicketStatus | ''>('');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(60);

  const { data: tickets = [], isLoading } = useQuery<SupportTicket[]>({
    queryKey: ['support-tickets', statusFilter, limit],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
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
          <Link to="/dashboard" className="text-sm text-slate-500 hover:text-slate-700">
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
              onClick={() => void queryClient.invalidateQueries({ queryKey: ['support-tickets', statusFilter, limit] })}
              className="inline-flex items-center gap-2 text-xs text-primary-600 dark:text-primary-400 hover:text-primary-500"
            >
              <RefreshCcw className="h-3.5 w-3.5" /> Refresh
            </button>
          }
        />
        <CardBody className="grid gap-3 md:grid-cols-3">
          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Search</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Ticket id, email, page, or message"
              className="rounded-lg border border-slate-300/80 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Status</span>
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
            <span className="text-slate-600 dark:text-slate-300">Limit</span>
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

      <Card>
        <CardBody className="p-0">
          {isLoading ? (
            <div className="px-4 py-12 text-center text-slate-500">Loading tickets...</div>
          ) : filteredTickets.length === 0 ? (
            <div className="px-4 py-12 text-center text-slate-500">
              <div className="mx-auto mb-3 grid place-items-center">
                <CircleX className="h-9 w-9 text-slate-400" />
              </div>
              <p>No tickets match your current filters.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
                <thead className="bg-slate-50 dark:bg-slate-900/80">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Ticket</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Contact</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Priority</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Last message</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredTickets.map((ticket) => (
                    <tr key={ticket.id}>
                      <td className="px-4 py-3 align-top">
                        <div className="font-mono text-xs text-slate-700 dark:text-slate-300">{ticket.id}</div>
                        <div className="mt-1 text-sm font-medium text-slate-900 dark:text-white">{ticket.subject}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">{ticket.source} {ticket.page ? `• ${ticket.page}` : ''}</div>
                        {ticket.notes ? (
                          <div className="mt-2 rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            <span className="font-medium">Notes:</span> {ticket.notes}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-sm align-top">
                        <div className="font-medium text-slate-900 dark:text-white">{ticket.requestedByName || '—'}</div>
                        <div className="text-slate-500 dark:text-slate-400">{ticket.requestedByEmail || '—'}</div>
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
                          className="rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
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
                          className="rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
                        >
                          <option value="low">Low</option>
                          <option value="normal">Normal</option>
                          <option value="high">High</option>
                        </select>
                      </td>
                      <td className="max-w-sm px-4 py-3 text-sm text-slate-700 dark:text-slate-300 align-top">
                        <div>{ticket.lastUserMessage}</div>
                        {ticket.lastAssistantMessage ? (
                          <>
                            <div className="mt-2 text-xs text-slate-500">AI reply:</div>
                            <div className="rounded-md bg-emerald-50 p-2 text-xs text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200">
                              {ticket.lastAssistantMessage}
                            </div>
                          </>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-500 align-top">
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
