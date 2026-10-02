// Family portal: parents enter the email they registered with, get a
// 2-hour link, and see every registration made with it — tournament
// details, events, divisions, next match, results — with a button into the
// existing change/withdraw page. No account or password.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Calendar, Mail, MapPin, Medal, Users } from 'lucide-react';
import { Card, CardBody } from '../components/ui';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Label from '../components/ui/Label';
import OperationStatus from '../components/ui/OperationStatus';
import { formatDateOnly } from '../utils/date-only';

const TOKEN_KEY = 'bowin_family_link';

interface FamilyDivision {
  name: string;
  event: string;
  place: number | null;
  nextMatch: { ringNumber: number | null; scheduledTime: string | null } | null;
}

interface FamilyRegistration {
  id: string;
  confirmationCode: string;
  competitorName: string;
  status: 'registered' | 'waitlisted' | 'withdrawn' | 'checked_in';
  waitlistPosition: number | null;
  paymentStatus: string | null;
  checkedIn: boolean;
  canManage: boolean;
  events: string[];
  tournament: {
    name: string;
    date: string;
    location: string | null;
    status: string;
    organizer: string | null;
    liveResultsUrl: string | null;
  };
  divisions: FamilyDivision[];
}

const STATUS_LABEL: Record<FamilyRegistration['status'], string> = {
  registered: 'Registered',
  waitlisted: 'On the waitlist',
  withdrawn: 'Withdrawn',
  checked_in: 'Checked in',
};

const PAYMENT_LABEL: Record<string, string> = {
  pending: 'Payment due',
  paid: 'Paid',
  waived: 'Fee waived',
  failed: 'Payment failed',
};

function ordinal(n: number): string {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

function readStoredToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function storeToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage unavailable: the page still works until reload
  }
}

export default function MyRegistrations() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [token, setToken] = useState(() => searchParams.get('token') || readStoredToken());
  const [registrations, setRegistrations] = useState<FamilyRegistration[] | null>(null);
  const [email, setEmail] = useState('');
  const [listEmail, setListEmail] = useState('');
  const [loading, setLoading] = useState(Boolean(token));
  const [linkError, setLinkError] = useState<string | null>(null);
  const [requestState, setRequestState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [requestError, setRequestError] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [manageError, setManageError] = useState<string | null>(null);

  // Keep the private link out of the address bar (and browser history).
  useEffect(() => {
    if (searchParams.get('token')) {
      storeToken(searchParams.get('token'));
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const load = useCallback(async (t: string) => {
    setLoading(true);
    setLinkError(null);
    try {
      const res = await fetch('/api/public/family/registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: t }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        storeToken(null);
        setToken('');
        setLinkError(body.error || 'This link has expired. Ask for a new one below.');
        return;
      }
      setRegistrations(body.registrations);
      setListEmail(body.email);
    } catch {
      setLinkError('Could not load your registrations. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) void load(token);
  }, [token, load]);

  const requestLink = async (e: FormEvent) => {
    e.preventDefault();
    setRequestState('sending');
    setRequestError(null);
    try {
      const res = await fetch('/api/public/family/request-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRequestState('error');
        setRequestError(body.error || 'Could not send the link. Please try again.');
        return;
      }
      setDevLink(typeof body.devAccessUrl === 'string' ? body.devAccessUrl : null);
      setRequestState('sent');
    } catch {
      setRequestState('error');
      setRequestError('Could not send the link. Check your connection and try again.');
    }
  };

  const openManage = async (id: string) => {
    setOpeningId(id);
    setManageError(null);
    try {
      const res = await fetch(`/api/public/family/registrations/${encodeURIComponent(id)}/manage-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || typeof body.url !== 'string') {
        setManageError(body.error || 'Could not open that registration. Please try again.');
        return;
      }
      navigate(body.url);
    } catch {
      setManageError('Could not open that registration. Check your connection and try again.');
    } finally {
      setOpeningId(null);
    }
  };

  const signOut = () => {
    storeToken(null);
    setToken('');
    setRegistrations(null);
    setRequestState('idle');
  };

  const showList = Boolean(token) && registrations !== null;

  return (
    <div className="min-h-screen bg-surface-50 px-4 py-10 pb-28 dark:bg-surface-950">
      <div className="mx-auto max-w-2xl">
        <Link
          to="/register"
          className="mb-4 inline-flex items-center text-sm text-surface-600 hover:text-surface-900 dark:text-surface-400 dark:hover:text-white"
        >
          <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
          Register a competitor
        </Link>

        <h1 className="text-2xl font-bold text-surface-900 dark:text-white">My registrations</h1>

        {loading && <p className="mt-6 text-sm text-surface-600 dark:text-surface-300">Loading your registrations…</p>}

        {!loading && showList && (
          <div className="mt-2 space-y-4">
            <p className="text-sm text-surface-600 dark:text-surface-300 [overflow-wrap:anywhere]">
              Registrations made with <strong>{listEmail}</strong>.{' '}
              <button type="button" onClick={signOut} className="underline hover:no-underline">Not you?</button>
            </p>
            {manageError && <OperationStatus state="rejected" message={manageError} />}
            {registrations!.length === 0 && (
              <Card>
                <CardBody>
                  <p className="text-sm">No registrations are open under this email any more.</p>
                </CardBody>
              </Card>
            )}
            {registrations!.map((reg) => (
              <Card key={reg.id}>
                <CardBody className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="text-lg font-semibold text-surface-900 dark:text-white [overflow-wrap:anywhere]">{reg.competitorName}</h2>
                      <p className="text-sm font-medium text-surface-700 dark:text-surface-200 [overflow-wrap:anywhere]">{reg.tournament.name}</p>
                      {reg.tournament.organizer && (
                        <p className="text-xs text-surface-600 dark:text-surface-400">Hosted by {reg.tournament.organizer}</p>
                      )}
                    </div>
                    <span className="rounded-full bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-700 dark:bg-primary-950 dark:text-primary-300">
                      {STATUS_LABEL[reg.status]}
                      {reg.status === 'waitlisted' && reg.waitlistPosition ? ` (#${reg.waitlistPosition})` : ''}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-surface-700 dark:text-surface-300">
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="h-4 w-4" aria-hidden="true" />
                      {formatDateOnly(reg.tournament.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                    {reg.tournament.location && (
                      <span className="inline-flex items-center gap-1 [overflow-wrap:anywhere]">
                        <MapPin className="h-4 w-4" aria-hidden="true" />
                        {reg.tournament.location}
                      </span>
                    )}
                  </div>

                  <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-surface-500 dark:text-surface-400">Events</dt>
                      <dd>{reg.events.length ? reg.events.join(', ') : '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-surface-500 dark:text-surface-400">Confirmation code</dt>
                      <dd className="font-mono">{reg.confirmationCode}</dd>
                    </div>
                    {reg.paymentStatus && PAYMENT_LABEL[reg.paymentStatus] && (
                      <div>
                        <dt className="text-xs text-surface-500 dark:text-surface-400">Entry fee</dt>
                        <dd>{PAYMENT_LABEL[reg.paymentStatus]}</dd>
                      </div>
                    )}
                  </dl>

                  {reg.divisions.length > 0 ? (
                    <ul className="space-y-2" aria-label={`Divisions for ${reg.competitorName}`}>
                      {reg.divisions.map((d) => (
                        <li key={`${d.name}-${d.event}`} className="rounded-lg border border-surface-200 p-3 text-sm dark:border-surface-700">
                          <p className="font-medium [overflow-wrap:anywhere]">{d.name}</p>
                          <p className="text-xs text-surface-600 dark:text-surface-400">{d.event}</p>
                          {d.place !== null ? (
                            <p className="mt-1 inline-flex items-center gap-1 font-semibold text-success">
                              <Medal className="h-4 w-4" aria-hidden="true" /> Finished {ordinal(d.place)}
                            </p>
                          ) : d.nextMatch ? (
                            <p className="mt-1">
                              Next match
                              {d.nextMatch.ringNumber ? `: Ring ${d.nextMatch.ringNumber}` : ''}
                              {d.nextMatch.scheduledTime
                                ? `, about ${new Date(d.nextMatch.scheduledTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                                : ''}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-surface-600 dark:text-surface-400">
                      Divisions haven't been set yet. The organizer places competitors closer to the event.
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2 pt-1">
                    {reg.canManage && reg.status !== 'withdrawn' && (
                      <Button
                        variant="secondary"
                        onClick={() => void openManage(reg.id)}
                        loading={openingId === reg.id}
                        disabled={openingId !== null}
                      >
                        Change or withdraw
                      </Button>
                    )}
                    {reg.tournament.liveResultsUrl && (
                      <a
                        href={reg.tournament.liveResultsUrl}
                        className="inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-medium text-primary-700 underline hover:no-underline dark:text-primary-300"
                      >
                        Live brackets and results
                      </a>
                    )}
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )}

        {!loading && !showList && (
          <Card className="mt-4">
            <CardBody className="space-y-4">
              {linkError && <OperationStatus state="rejected" message={linkError} />}
              {requestState === 'sent' ? (
                <div role="status" className="space-y-2">
                  <Mail className="h-8 w-8 text-primary-500" aria-hidden="true" />
                  <p className="font-semibold">Check your email</p>
                  <p className="text-sm text-surface-600 dark:text-surface-300 [overflow-wrap:anywhere]">
                    If we have registrations for {email}, a link to them is on its way. It works for 2 hours.
                    Nothing after a few minutes? Check spam, or make sure you used the email from your registration.
                  </p>
                  {devLink && (
                    <a href={devLink} className="text-sm underline" data-testid="family-dev-link">Open link (test mode)</a>
                  )}
                  <Button variant="ghost" onClick={() => setRequestState('idle')}>Use a different email</Button>
                </div>
              ) : (
                <form onSubmit={requestLink} className="space-y-4">
                  <div className="flex items-start gap-2">
                    <Users className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary-500" aria-hidden="true" />
                    <p className="text-sm text-surface-700 dark:text-surface-300">
                      See every competitor you've registered, their divisions, match times and results, and make
                      changes. Enter the email you used when registering and we'll send you a link. No account needed.
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="family-email">Your email</Label>
                    <Input
                      id="family-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  {requestError && <p role="alert" className="text-sm text-danger">{requestError}</p>}
                  <Button type="submit" variant="primary" className="w-full" loading={requestState === 'sending'} disabled={requestState === 'sending'}>
                    Email me a link
                  </Button>
                </form>
              )}
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
