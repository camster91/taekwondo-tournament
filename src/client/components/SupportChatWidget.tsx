import { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Activity, MessageCircle, Send, User, SendHorizontal, X, Bot, Shield } from 'lucide-react';
import { useAuth, getAuthHeaders } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Button } from './ui';
import { Input } from './ui';
import { Label } from './ui';

type ChatRole = 'user' | 'assistant';

interface MessageRow {
  id: number;
  role: ChatRole;
  text: string;
  ticketId?: string | null;
}

interface ChatResponse {
  answer: string;
  escalated: boolean;
  conversationId?: string | null;
  ticket?: {
    id: string;
    status: string;
    priority: string;
    subject: string;
  };
}

export default function SupportChatWidget() {
  const location = useLocation();
  const { user } = useAuth();
  const toast = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [forceTicket, setForceTicket] = useState(false);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [messages, setMessages] = useState<MessageRow[]>([
    {
      id: 1,
      role: 'assistant',
      text: 'Hi — I\'m the support bot. Tell me what\'s happening and I\'ll help you troubleshoot, then I can open a support ticket if needed.',
    },
  ]);
  const [isSending, setIsSending] = useState(false);

  const canOpenQueue = user?.role === 'admin' || user?.role === 'director';

  useEffect(() => {
    if (user?.firstName || user?.lastName) {
      setDisplayName(`${user.firstName} ${user.lastName}`.trim());
      setContactEmail(user.email);
    }
  }, [user?.firstName, user?.lastName, user?.email]);

  const addMessage = (next: Omit<MessageRow, 'id'>) => {
    setMessages((current) => [...current, { id: current.length + 1000, ...next }]);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const outgoing = draft.trim();
    if (!outgoing || isSending) return;

    setDraft('');
    setIsSending(true);

    addMessage({ role: 'user', text: outgoing });

    try {
      const response = await fetch('/api/support', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          message: outgoing,
          page: location.pathname,
          conversationId: null,
          contactName: user ? displayName.trim() : displayName.trim(),
          contactEmail: user ? undefined : contactEmail.trim(),
          createTicket: forceTicket,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Support request failed' }));
        throw new Error(data.error || 'Support request failed');
      }

      const payload = await response.json() as ChatResponse;
      const ticketText = payload.ticket
        ? `\n\nTicket created (${payload.ticket.id}). Status: ${payload.ticket.status} | Priority: ${payload.ticket.priority}.`
        : '';
      addMessage({ role: 'assistant', text: `${payload.answer}${ticketText}` });
      if (payload.ticket) {
        toast.success(`Support ticket created: ${payload.ticket.id}`);
      }
    } catch (error) {
      addMessage({ role: 'assistant', text: 'I had trouble submitting that request. If this is urgent, please email support@ashbi.ca directly or try again in a moment.' });
      toast.error(error instanceof Error ? error.message : 'Support request failed');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      {isOpen ? (
        <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md sm:right-6 sm:left-auto sm:inset-x-auto">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary-600" />
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">Support Assistant</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Ask for help anytime</p>
                </div>
              </div>
              <button type="button" onClick={() => setIsOpen(false)} className="rounded-md p-1 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close support chat">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="h-72 overflow-y-auto space-y-2 bg-slate-50 p-3 dark:bg-slate-950">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                    message.role === 'assistant'
                      ? 'ml-0 rounded-bl-none bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-100'
                      : 'ml-auto rounded-br-none bg-primary-600 text-white'
                  }`}
                >
                  <p>{message.text}</p>
                  {message.ticketId ? (
                    <p className="mt-2 text-xs opacity-80">
                      Ticket: {message.ticketId}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>

            {!user ? (
              <div className="grid gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800 sm:grid-cols-2">
                <Label htmlFor="supportName">Name</Label>
                <Label htmlFor="supportEmail">Email</Label>
                <div className="sm:col-span-2 flex flex-col gap-2">
                  <Input
                    id="supportName"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="Your name"
                  />
                  <Input
                    id="supportEmail"
                    type="email"
                    value={contactEmail}
                    onChange={(event) => setContactEmail(event.target.value)}
                    placeholder="you@school.com"
                  />
                </div>
              </div>
            ) : null}

            <div className="flex items-center justify-between px-4 py-2 border-t border-slate-200 dark:border-slate-800">
              <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={forceTicket}
                  onChange={(event) => setForceTicket(event.target.checked)}
                />
                Escalate to support
                </label>
              {canOpenQueue ? (
                <Button as={Link} to="/support/tickets" size="sm" variant="secondary">
                  <Shield className="h-3 w-3" />
                  <span>Support queue</span>
                </Button>
              ) : null}
            </div>

            {canOpenQueue && (
              <div className="px-4 pb-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={isDiagnosing || isSending}
                  onClick={async () => {
                    setIsDiagnosing(true);
                    addMessage({ role: 'user', text: 'Running support diagnostics on the live app APIs...' });
                    try {
                      const ready = await fetch('/api/health/ready', { headers: getAuthHeaders() });
                      if (!ready.ok) {
                        const text = await ready.text().catch(() => 'unavailable');
                        addMessage({
                          role: 'assistant',
                          text: `Health check failed (${ready.status} ${ready.statusText}). I can open this as a support ticket if this is blocking you.`,
                        });
                        if (!forceTicket) {
                          setForceTicket(true);
                          const response = await fetch('/api/support', {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              ...getAuthHeaders(),
                            },
                            body: JSON.stringify({
                              message: `Support diagnostic detected unhealthy /api/health/ready response: ${ready.status} ${ready.statusText}. Response: ${text.slice(0, 180)}`,
                              page: location.pathname,
                              conversationId: null,
                              createTicket: true,
                            }),
                          });
                          if (!response.ok) {
                            throw new Error('Unable to create support ticket from diagnostics');
                          }
                          const payload = await response.json() as ChatResponse;
                          if (payload.ticket) {
                            addMessage({
                              role: 'assistant',
                              text: `Ticket created: ${payload.ticket.id}. Priority: ${payload.ticket.priority}.`,
                            });
                          }
                        }
                      } else {
                        addMessage({
                          role: 'assistant',
                          text: 'All monitored endpoints are currently healthy. If the issue continues, share the exact steps you took and I can escalate.',
                        });
                      }
                    } catch (error) {
                      addMessage({
                        role: 'assistant',
                        text: 'I could not reach the diagnostics endpoint right now. Please retry, then use “Escalate to support” if you still need help.',
                      });
                      toast.error(error instanceof Error ? error.message : 'Diagnostic failed');
                    } finally {
                      setIsDiagnosing(false);
                    }
                  }}
                >
                  {isDiagnosing ? (
                    <>
                      <Activity className="h-3 w-3 animate-spin" />
                      <span>Running diagnostics</span>
                    </>
                  ) : (
                    <>
                      <Activity className="h-3 w-3" />
                      <span>Run API check</span>
                    </>
                  )}
                </Button>
              </div>
            )}

            <form onSubmit={handleSubmit} className="border-t border-slate-200 p-3 dark:border-slate-800">
              <div className="flex items-end gap-2">
                <Input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void handleSubmit(event);
                    }
                  }}
                  placeholder="Describe your issue..."
                  className="min-h-11"
                  disabled={isSending}
                />
                <Button
                  type="submit"
                  variant="primary"
                  disabled={isSending || !draft.trim()}
                  className="whitespace-nowrap"
                >
                  {isSending ? <><SendHorizontal className="h-4 w-4 animate-pulse" /> Sending</> : <><Send className="h-4 w-4" /> Send</>}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="fixed right-4 bottom-4 z-50 rounded-full bg-primary-600 text-white p-4 shadow-xl hover:bg-primary-700"
          aria-label="Open support chat"
        >
          <MessageCircle className="h-5 w-5" />
        </button>
      )}
    </>
  );
}
