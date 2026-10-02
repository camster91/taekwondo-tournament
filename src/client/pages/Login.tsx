import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Trophy,
  Mail,
  AlertCircle,
  UserPlus,
  ArrowLeft,
  CheckCircle,
  Sparkles,
  Users,
  Calendar,
  Award,
  Zap,
  Shield,
  Check,
  Copy,
  ExternalLink,
  Terminal,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { markDemoEntryPending } from '../utils/demo-progress';
import { fetchJson, getApiFailure } from '../utils/api-status';
import { parseSetupStatus, type SetupStatus } from '../utils/setup-status';
import Spinner from '../components/ui/Spinner';
import { Card, CardBody } from '../components/ui';
import { Button } from '../components/ui';
import { Input } from '../components/ui';
import { Label } from '../components/ui';
import { BowinLogo } from '../components/brand/BowinLogo';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { requestMagicLink, verifyCode, retrySessionHydration, isAuthenticated } = useAuth();

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [sessionVerified, setSessionVerified] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  // Dev mode magic link data
  const [devModeData, setDevModeData] = useState<{ magicUrl: string; code: string; email: string } | null>(null);

  // Setup state
  const [setupFirstName, setSetupFirstName] = useState('');
  const [setupLastName, setSetupLastName] = useState('');
  const [setupKey, setSetupKey] = useState('');

  const {
    data: setupStatus,
    isLoading: setupStatusLoading,
    isError: setupStatusError,
    error: setupStatusFailure,
    refetch: retrySetupStatus,
    isFetching: setupStatusFetching,
  } = useQuery<SetupStatus>({
    queryKey: ['setup-status'],
    queryFn: async () => {
      const payload = await fetchJson<unknown>(fetch, '/api/auth/setup-status');
      return parseSetupStatus(payload);
    },
    staleTime: 60000,
    retry: false,
  });

  const needsSetup = setupStatus?.needsSetup === true;
  const setupApiFailure = getApiFailure(setupStatusFailure);
  const setupFailureMessage = setupApiFailure?.kind === 'rate_limited'
    ? `System readiness is busy. Try again${setupApiFailure.retryAfterSeconds ? ` in ${setupApiFailure.retryAfterSeconds} seconds` : ' shortly'}.`
    : 'We could not confirm whether this system is ready for sign-in. Try again before continuing.';

  // Redirect if already logged in
  useEffect(() => {
    if (isAuthenticated) {
      // React Router's `location.state` is loosely typed — narrow via
      // a structural check before reaching into `from.pathname`.
      const state = location.state as { from?: { pathname?: string } } | null;
      // The marketing homepage is public. A sign-in without a preserved
      // protected destination must enter the authenticated workspace instead
      // of bouncing back to marketing and then to the login page.
      const from = state?.from?.pathname || '/dashboard';
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, location.state, navigate]);

  // Focus code input when switching to code step
  useEffect(() => {
    if (step === 'code') {
      codeInputRef.current?.focus();
    }
  }, [step]);

  const handleSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, firstName: setupFirstName, lastName: setupLastName, setupKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          res.status === 401
            ? "That setup key isn't right. Check it and try again."
            : res.status === 503
              ? 'This server has no setup key yet. Ask whoever runs the server to set ADMIN_SETUP_KEY, then try again.'
              : data.error || 'Setup failed',
        );
      } else {
        // Session cookie is set by the server. Hard nav so
        // AuthProvider re-mounts and hydrates user state from /me.
        window.location.href = '/dashboard';
      }
    } catch {
      setError('Setup failed. Please try again.');
    }

    setIsLoading(false);
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    const result = await requestMagicLink(email);

    if (result.success) {
      if (result.devMode && result.magicUrl && result.code) {
        // Dev mode: show the magic link directly in UI
        setDevModeData({ magicUrl: result.magicUrl, code: result.code, email });
        setStep('code');
      } else {
        setStep('code');
      }
    } else {
      setError(result.error || 'Failed to send sign-in link');
    }

    setIsLoading(false);
  };

  const handleCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    const result = sessionVerified
      ? await retrySessionHydration()
      : await verifyCode(email, code);

    if (result.success) {
      // Same structural narrowing as the auth-effect above — keeps the
      // post-verify redirect in sync with where the user was heading.
      const state = location.state as { from?: { pathname?: string } } | null;
      const from = state?.from?.pathname || '/dashboard';
      navigate(from, { replace: true });
    } else {
      setSessionVerified(result.sessionVerified === true);
      setError(result.error || 'Verification failed');
    }

    setIsLoading(false);
  };

  // Demo mode: one-click guest login. Hard navigation so AuthContext
  // re-reads localStorage on mount.
  const handleDemoLogin = async () => {
    setError('');
    setDemoLoading(true);
    try {
      const res = await fetch('/api/auth/demo', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Demo login failed');
      markDemoEntryPending();
      // Session cookie is set by the server. Hard nav so the
      // AuthProvider re-mounts and hydrates user state from /me.
      window.location.href = '/dashboard';
    } catch (err: unknown) {
      console.error('Login error:', err);
      setError(err instanceof Error ? err.message : 'Login failed');
      setDemoLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950 text-surface-900 dark:text-surface-100 flex flex-col">
      {/* Header — minimal brand bar */}
      <header className="border-b border-surface-200 dark:border-surface-700 bg-surface-0/60 dark:bg-surface-900/60 backdrop-blur-xl sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" aria-label="Bowin home">
            <BowinLogo />
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-surface-600 dark:text-surface-400 hidden sm:inline">Tournament organizer sign-in</span>
            {setupStatus?.needsSetup === false ? (
              <Link
                to="/register"
                className="text-surface-600 dark:text-surface-300 hover:text-surface-900 dark:hover:text-white"
              >
                Register a competitor →
              </Link>
            ) : null}
          </div>
        </div>
      </header>

      <main className="flex-1 grid lg:grid-cols-[1.1fr_0.9fr]">
        {/* ─── Left: Hero ─── */}
        <section className="relative overflow-hidden bg-gradient-to-br from-brand-ink via-brand-ink to-primary-800 text-white hidden lg:block">
          {/* Decorative gradients — bowin ink + red accent */}
          <div className="absolute top-0 left-0 w-[600px] h-[600px] bg-brand-red/15 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
          <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-brand-red/10 rounded-full blur-3xl translate-x-1/3 translate-y-1/3" />
          <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:24px_24px]" />

          <div className="relative max-w-xl mx-auto lg:mx-0 lg:ml-auto lg:mr-12 px-6 lg:px-0 py-16 lg:py-24 flex flex-col justify-center min-h-full">
            <div className="inline-flex items-center gap-2 self-start px-3 py-1.5 rounded-full bg-white/10 border border-white/10 text-xs font-medium text-white/80 backdrop-blur-sm mb-6 animate-fade-in">
              <Sparkles className="h-3.5 w-3.5 text-brand-red" />
              <span>Tournaments, run like a black belt.</span>
            </div>

            <h2 className="text-4xl lg:text-5xl font-bold tracking-tight leading-[1.1] animate-slide-up">
              Run a real tournament.{' '}
              <span className="text-brand-red">
                Not a spreadsheet.
              </span>
            </h2>

            <p className="mt-5 text-lg text-white/70 leading-relaxed animate-slide-up animate-in-1">
              Register kids, build divisions the way a real tournament director thinks, run round-robins and brackets, and print certificates — all from one app, in 20 minutes.
            </p>

            {/* Feature pills */}
            <div className="mt-8 space-y-3 animate-slide-up animate-in-2">
              {[
                { icon: Users, label: 'Smart auto-categorization', sub: 'Newton\'s 2025 rules, your rules' },
                { icon: Calendar, label: 'Round-robin & single elimination', sub: 'Not just double-elim' },
                { icon: Award, label: 'Real-time scoreboard', sub: 'TV-ready, public link' },
                { icon: Zap, label: 'Excel import', sub: 'Drop your .xlsm, we handle the rest' },
              ].map((f) => (
                <div key={f.label} className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-brand-red/15 border border-brand-red/30 flex items-center justify-center flex-shrink-0">
                    <f.icon className="h-4 w-4 text-brand-rose" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-white">{f.label}</div>
                    <div className="text-xs text-white/50">{f.sub}</div>
                  </div>
                  <Check className="h-4 w-4 text-emerald-400/70" />
                </div>
              ))}
            </div>

            {/* Social proof strip */}
            <div className="mt-10 pt-6 border-t border-white/10 animate-slide-up animate-in-3">
              <div className="flex items-center gap-6 text-white/50 text-xs">
                <div className="flex items-center gap-2">
                  <Shield className="h-3.5 w-3.5" />
                  <span>Self-hosted option</span>
                </div>
                {setupStatus?.demoLoginEnabled ? (
                  <div className="flex items-center gap-2">
                    <Users className="h-3.5 w-3.5" />
                    <span>Live demo data, fully featured</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        {/* ─── Right: Auth card ─── */}
        <section className="flex items-center justify-center px-6 pt-12 pb-28 lg:py-24 bg-surface-50 dark:bg-surface-950">
          <div className="w-full max-w-md">
            {setupStatusLoading ? (
              <div role="status" aria-live="polite" className="text-center py-10">
                <Spinner size="lg" />
                <h1 className="mt-4 text-xl font-semibold">Checking system readiness</h1>
                <p className="mt-2 text-sm text-surface-600">Sign-in will appear after this check completes.</p>
              </div>
            ) : setupStatusError ? (
              <div role="alert" className="rounded-xl border border-danger/20 bg-danger/10 p-5 dark:border-danger/30 dark:bg-danger/20">
                <h1 className="text-xl font-semibold text-danger dark:text-danger">Sign-in temporarily unavailable</h1>
                <p className="mt-2 text-sm text-danger/90 dark:text-danger/80">{setupFailureMessage}</p>
                <Button
                  type="button"
                  variant="primary"
                  className="mt-4"
                  loading={setupStatusFetching}
                  onClick={() => { void retrySetupStatus(); }}
                >
                  Retry readiness check
                </Button>
              </div>
            ) : needsSetup ? (
              <SetupForm
                email={email} setEmail={setEmail}
                firstName={setupFirstName} setFirstName={setSetupFirstName}
                lastName={setupLastName} setLastName={setSetupLastName}
                setupKey={setupKey} setSetupKey={setSetupKey}
                onSubmit={handleSetupSubmit} error={error} loading={isLoading}
              />
            ) : (
              <div className="animate-slide-up">
                {error && (
                  <div className="mb-4 bg-danger/10 border border-danger/20 dark:border-danger/30 rounded-xl p-3.5 flex items-start">
                    <AlertCircle className="h-4 w-4 text-danger mr-2 flex-shrink-0 mt-0.5" />
                    <span className="text-sm text-danger/90 dark:text-danger/80">{error}</span>
                  </div>
                )}

                <h1 className="text-2xl font-semibold tracking-tight text-surface-900 dark:text-white mb-2">
                  Organizer Sign In
                </h1>
                <p className="text-sm text-surface-600 dark:text-surface-400 mb-6">
                  For tournament organizers and their staff. We email you a sign-in link, so there is no password to remember.
                </p>

                {step === 'email' ? (
                  <EmailForm
                    email={email} setEmail={setEmail}
                    onSubmit={handleEmailSubmit} loading={isLoading}
                    onDemo={setupStatus?.demoLoginEnabled ? handleDemoLogin : undefined}
                    demoLoading={demoLoading}
                  />
                ) : (
                  <CodeForm
                    email={email} code={code} setCode={setCode}
                    onSubmit={handleCodeSubmit} loading={isLoading}
                    sessionVerified={sessionVerified}
                    onBack={() => { setStep('email'); setCode(''); setError(''); setSessionVerified(false); setDevModeData(null); }}
                    codeInputRef={codeInputRef}
                    devModeData={devModeData}
                  />
                )}

                {step === 'email' && (
                  <p className="mt-6 text-center text-xs text-surface-600">
                    By continuing, you acknowledge Bowin&apos;s{' '}
                    <Link className="underline hover:text-surface-900 dark:hover:text-white" to="/legal/privacy">Privacy Notice</Link>
                    {' '}and{' '}
                    <Link className="underline hover:text-surface-900 dark:hover:text-white" to="/legal/terms">Tournament Terms</Link>.
                    Email addresses are used to send sign-in links and provide account access.
                  </p>
                )}
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-surface-200 dark:border-surface-700 py-4 px-6">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-surface-600">
          <div>bowin &middot; tournament manager v1.0</div>
          <div className="flex items-center gap-4">
            <a href="/register" className="hover:text-surface-900 dark:hover:text-white">Register a competitor</a>
            <a href="/api/health" target="_blank" rel="noopener" className="hover:text-surface-900 dark:hover:text-white">Status</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────

function EmailForm({
  email,
  setEmail,
  onSubmit,
  loading,
  onDemo,
  demoLoading,
}: {
  email: string;
  setEmail: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  loading: boolean;
  onDemo?: () => void;
  demoLoading?: boolean;
}) {
  return (
    <div className="space-y-5">
      <h2 className="sr-only">Sign in</h2>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@yourschool.com"
          />
        </div>

        <Button type="submit" variant="primary" loading={loading} className="w-full">
          <Mail className="h-4 w-4 mr-2" /> Send sign-in link
        </Button>
      </form>

      {onDemo && (
        <>
          <div className="relative my-6 flex items-center">
            <div className="flex-1 border-t border-surface-200 dark:border-surface-700" />
            <span className="px-3 text-xs text-surface-600 dark:text-surface-500 uppercase tracking-wider">or</span>
            <div className="flex-1 border-t border-surface-200 dark:border-surface-700" />
          </div>

          <Button
            type="button"
            variant="ghost"
            onClick={onDemo}
            loading={demoLoading}
            className="w-full text-surface-600 dark:text-surface-300"
          >
            <Sparkles className="h-4 w-4 mr-2" /> Explore the live demo
          </Button>

          <p className="text-center text-xs text-surface-600">
            Fabricated tournament data. No signup. Demo activity may be reset.
          </p>
        </>
      )}

      <div className="rounded-xl border border-surface-200 bg-surface-0 p-4 text-sm text-surface-600 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-300">
        <p className="flex items-start gap-2">
          <UserPlus className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <span>
            <strong className="text-surface-900 dark:text-white">Registering a competitor?</strong> You don&apos;t need an account.
            Use the registration link from your tournament organizer, or{' '}
            <Link to="/register" className="font-medium text-primary-700 underline dark:text-primary-300">find an open tournament</Link>.
            Already registered? <Link to="/my-registrations" className="font-medium text-primary-700 underline dark:text-primary-300">See my registrations</Link>.
          </span>
        </p>
      </div>
    </div>
  );
}

function CodeForm({
  email,
  code,
  setCode,
  onSubmit,
  loading,
  sessionVerified,
  onBack,
  codeInputRef,
  devModeData,
}: {
  email: string;
  code: string;
  setCode: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  loading: boolean;
  sessionVerified: boolean;
  onBack: () => void;
  codeInputRef: React.RefObject<HTMLInputElement | null>;
  devModeData: { magicUrl: string; code: string; email: string } | null;
}) {
  const [copied, setCopied] = useState<'url' | 'code' | null>(null);

  const handleCopy = async (type: 'url' | 'code', value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-5 animate-slide-up">
      {/* Dev mode: show magic link directly */}
      {devModeData && (
        <div className="relative overflow-hidden rounded-xl border border-primary-200 dark:border-primary-800/60 bg-gradient-to-br from-primary-50 via-accent-50 to-fuchsia-50 dark:from-primary-950/40 dark:via-accent-950/40 dark:to-fuchsia-950/40 p-5">
          {/* Decorative glow */}
          <div className="absolute top-0 right-0 w-32 h-32 bg-primary-400/10 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2" />
          
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-primary-100 dark:bg-primary-900/50">
                <Terminal className="h-3.5 w-3.5 text-primary-600 dark:text-primary-400" />
              </div>
              <span className="text-xs font-semibold uppercase tracking-wider text-primary-600 dark:text-primary-400">Dev Mode — Email Not Configured</span>
            </div>

            <p className="text-sm text-surface-600 dark:text-surface-300 mb-4">
              Email is not set up in this environment. Copy the link below and open it to sign in.
            </p>

            {/* Magic URL row */}
            <div className="mb-3">
              <div className="text-xs font-medium text-surface-600 dark:text-surface-400 mb-1.5">Magic link</div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={devModeData.magicUrl}
                  className="flex-1 text-xs bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-lg px-3 py-2 text-surface-700 dark:text-surface-200 font-mono truncate"
                />
                <button
                  onClick={() => handleCopy('url', devModeData.magicUrl)}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-primary-600 hover:bg-primary-700 text-white transition-colors"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {copied === 'url' ? 'Copied!' : 'Copy link'}
                </button>
                <a
                  href={devModeData.magicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-surface-100 hover:bg-surface-200 dark:bg-surface-800 dark:hover:bg-surface-700 text-surface-700 dark:text-surface-200 transition-colors"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open
                </a>
              </div>
            </div>

            {/* 6-digit code row */}
            <div>
              <div className="text-xs font-medium text-surface-600 dark:text-surface-400 mb-1.5">6-digit code</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 text-center text-2xl font-mono font-bold tracking-[0.3em] text-primary-700 dark:text-primary-300 py-2">
                  {devModeData.code}
                </div>
                <button
                  onClick={() => handleCopy('code', devModeData.code)}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-surface-100 hover:bg-surface-200 dark:bg-surface-800 dark:hover:bg-surface-700 text-surface-700 dark:text-surface-200 transition-colors"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {copied === 'code' ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-success/10 dark:bg-success/20 border border-success/20 dark:border-success/30 rounded-xl p-4 flex items-start">
        <CheckCircle className="h-5 w-5 text-success mr-3 flex-shrink-0 mt-0.5" />
        <div className="text-sm">
          <div className="font-medium text-success dark:text-success">Check your email</div>
          <p className="mt-1 text-success/90 dark:text-success/80">
            If <strong>{email}</strong> has an organizer account, a sign-in link is on its way.{devModeData ? ' Or use the magic link above.' : ' You can also enter the 6-digit code from that email below.'}
          </p>
          <p className="mt-1 text-success/90 dark:text-success/80">
            Nothing after a few minutes? Check spam. New organizers need an invite from their organization&apos;s admin.
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <Label htmlFor="code">6-digit code</Label>
          <Input
            ref={codeInputRef}
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputClassName="text-center text-2xl tracking-[0.5em] font-mono py-3"
            placeholder="000000"
          />
        </div>

        <Button type="submit" variant="primary" loading={loading} disabled={!sessionVerified && code.length !== 6} className="w-full">
          {loading
            ? <><Spinner size="sm" className="mr-2" /> Loading session...</>
            : sessionVerified ? 'Retry session' : 'Verify code'}
        </Button>
      </form>

      <button
        onClick={onBack}
        className="w-full flex items-center justify-center text-sm text-slate-600 hover:text-slate-700 dark:hover:text-slate-300"
      >
        <ArrowLeft className="h-4 w-4 mr-1.5" /> Use a different email
      </button>
    </div>
  );
}

function SetupForm({
  email,
  setEmail,
  firstName,
  setFirstName,
  lastName,
  setLastName,
  setupKey,
  setSetupKey,
  onSubmit,
  error,
  loading,
}: {
  email: string;
  setEmail: (v: string) => void;
  firstName: string;
  setFirstName: (v: string) => void;
  lastName: string;
  setLastName: (v: string) => void;
  setupKey: string;
  setSetupKey: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  error: string;
  loading: boolean;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Set up your admin account</h2>
        <p className="mt-1 text-sm text-surface-600">No accounts exist yet. Create the first one to get started.</p>
      </div>

      {error && (
        <div className="bg-danger/10 dark:bg-danger/20 border border-danger/20 dark:border-danger/30 rounded-xl p-3.5 flex items-start">
          <AlertCircle className="h-4 w-4 text-danger mr-2 flex-shrink-0 mt-0.5" />
          <span className="text-sm text-danger/90 dark:text-danger/80">{error}</span>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="setup-first-name">First name</Label>
            <Input id="setup-first-name" type="text" required autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Jane" />
          </div>
          <div>
            <Label htmlFor="setup-last-name">Last name</Label>
            <Input id="setup-last-name" type="text" required autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Smith" />
          </div>
        </div>
        <div>
          <Label htmlFor="setup-email">Email</Label>
          <Input id="setup-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourschool.com" />
        </div>
        <div>
          <Label htmlFor="setup-key">Setup key</Label>
          <Input
            id="setup-key"
            type="password"
            required
            autoComplete="off"
            value={setupKey}
            onChange={(e) => setSetupKey(e.target.value)}
            aria-describedby="setup-key-help"
          />
          <p id="setup-key-help" className="mt-1 text-xs text-surface-600 dark:text-surface-400">
            The one-time key set on your server as ADMIN_SETUP_KEY. Ask whoever installed the app if you don&apos;t have it.
          </p>
        </div>
        <Button type="submit" variant="primary" loading={loading} className="w-full">
          {loading ? <><Spinner size="sm" className="mr-2" /> Creating...</> : 'Create admin account'}
        </Button>
      </form>
    </div>
  );
}
