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
  Loader2,
  Users,
  Calendar,
  Award,
  Zap,
  Shield,
  ChevronRight,
  Check,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/ui/Spinner';
import { Card, CardBody } from '../components/ui';
import { Button } from '../components/ui';
import { Input } from '../components/ui';
import { Label } from '../components/ui';

const TOKEN_KEY = 'tkd_auth_token';
const USER_KEY = 'tkd_auth_user';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { requestMagicLink, verifyCode, isAuthenticated } = useAuth();

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  // Dev mode magic link data
  const [devModeData, setDevModeData] = useState<{ magicUrl: string; code: string; email: string } | null>(null);

  // Setup state
  const [setupFirstName, setSetupFirstName] = useState('');
  const [setupLastName, setSetupLastName] = useState('');

  const { data: setupStatus } = useQuery<{ needsSetup: boolean }>({
    queryKey: ['setup-status'],
    queryFn: async () => {
      const res = await fetch('/api/auth/setup-status');
      if (!res.ok) throw new Error('Failed to fetch setup status');
      return res.json();
    },
    staleTime: 60000,
  });

  const needsSetup = setupStatus?.needsSetup === true;

  // Redirect if already logged in
  useEffect(() => {
    if (isAuthenticated) {
      const from = (location.state as any)?.from?.pathname || '/';
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
        body: JSON.stringify({ email, firstName: setupFirstName, lastName: setupLastName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Setup failed');
      } else {
        localStorage.setItem(TOKEN_KEY, data.token);
        if (data.user) {
          localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        }
        navigate('/', { replace: true });
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

    const result = await verifyCode(email, code);

    if (result.success) {
      const from = (location.state as any)?.from?.pathname || '/';
      navigate(from, { replace: true });
    } else {
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
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      window.location.href = '/';
    } catch (err: any) {
      setError(err.message || 'Demo login failed. Please try again.');
      setDemoLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#fafbfc] dark:bg-[#0a0e1a] text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Header — minimal brand bar */}
      <header className="border-b border-slate-200/60 dark:border-slate-800/60 bg-white/60 dark:bg-slate-950/60 backdrop-blur-xl sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/login" className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shadow-md">
              <Trophy className="h-4.5 w-4.5 text-white" strokeWidth={2.5} />
            </div>
            <span className="text-base font-semibold tracking-tight">Martial Arts TM</span>
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-slate-500 hidden sm:inline">Real tournament management, end-to-end.</span>
            {needsSetup ? null : (
              <Link
                to="/register"
                className="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
              >
                Public registration →
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 grid lg:grid-cols-[1.1fr_0.9fr]">
        {/* ─── Left: Hero ─── */}
        <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950 text-white hidden lg:block">
          {/* Decorative gradients */}
          <div className="absolute top-0 left-0 w-[600px] h-[600px] bg-indigo-500/20 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
          <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-violet-500/20 rounded-full blur-3xl translate-x-1/3 translate-y-1/3" />
          <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:24px_24px]" />

          <div className="relative max-w-xl mx-auto lg:mx-0 lg:ml-auto lg:mr-12 px-6 lg:px-0 py-16 lg:py-24 flex flex-col justify-center min-h-full">
            <div className="inline-flex items-center gap-2 self-start px-3 py-1.5 rounded-full bg-white/10 border border-white/10 text-xs font-medium text-white/80 backdrop-blur-sm mb-6 animate-fade-in">
              <Sparkles className="h-3.5 w-3.5 text-amber-300" />
              <span>Trusted by 30+ Ontario dojangs</span>
            </div>

            <h1 className="text-4xl lg:text-5xl font-bold tracking-tight leading-[1.1] animate-slide-up">
              Run a real tournament.{' '}
              <span className="bg-gradient-to-r from-indigo-300 via-violet-300 to-pink-300 bg-clip-text text-transparent">
                Not a spreadsheet.
              </span>
            </h1>

            <p className="mt-5 text-lg text-white/70 leading-relaxed animate-slide-up animate-in-1">
              Register kids, build divisions the way a real tournament director thinks, run round-robins and brackets, and print certificates — all from one app, in 20 minutes.
            </p>

            {/* Feature pills */}
            <div className="mt-8 space-y-3 animate-slide-up animate-in-2">
              {[
                { icon: Users, label: 'Smart auto-categorization', sub: 'Newton\'s 2025 rules, your rules' },
                { icon: Calendar, label: 'Round-robin & pool play', sub: 'Not just double-elim' },
                { icon: Award, label: 'Real-time scoreboard', sub: 'TV-ready, public link' },
                { icon: Zap, label: 'Excel import', sub: 'Drop your .xlsm, we handle the rest' },
              ].map((f) => (
                <div key={f.label} className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-indigo-500/30 to-violet-500/30 border border-white/10 flex items-center justify-center flex-shrink-0">
                    <f.icon className="h-4 w-4 text-indigo-200" />
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
                <div className="flex items-center gap-2">
                  <Users className="h-3.5 w-3.5" />
                  <span>1,248 kids / 33 schools on demo</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Right: Auth card ─── */}
        <section className="flex items-center justify-center px-6 py-12 lg:py-24 bg-[#fafbfc] dark:bg-[#0a0e1a]">
          <div className="w-full max-w-md">
            {needsSetup ? (
              <SetupForm
                email={email} setEmail={setEmail}
                firstName={setupFirstName} setFirstName={setSetupFirstName}
                lastName={setupLastName} setLastName={setSetupLastName}
                onSubmit={handleSetupSubmit} error={error} loading={isLoading}
              />
            ) : (
              <div className="animate-slide-up">
                {error && (
                  <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/60 rounded-xl p-3.5 flex items-start">
                    <AlertCircle className="h-4 w-4 text-red-500 mr-2 flex-shrink-0 mt-0.5" />
                    <span className="text-sm text-red-700 dark:text-red-300">{error}</span>
                  </div>
                )}

                {step === 'email' ? (
                  <EmailForm
                    email={email} setEmail={setEmail}
                    onSubmit={handleEmailSubmit} loading={isLoading}
                    onDemo={handleDemoLogin} demoLoading={demoLoading}
                  />
                ) : (
                  <CodeForm
                    email={email} code={code} setCode={setCode}
                    onSubmit={handleCodeSubmit} loading={isLoading}
                    onBack={() => { setStep('email'); setCode(''); setError(''); }}
                    codeInputRef={codeInputRef}
                  />
                )}

                {step === 'email' && (
                  <p className="mt-6 text-center text-xs text-slate-500">
                    By continuing you agree to the tournament's data handling policy.
                    Email addresses are only used to send sign-in links and never shared.
                  </p>
                )}
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200/60 dark:border-slate-800/60 py-4 px-6">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <div>Martial Arts Tournament Manager · v1.0</div>
          <div className="flex items-center gap-4">
            <a href="/register" className="hover:text-slate-900 dark:hover:text-white">Public Registration</a>
            <a href="/api/health" target="_blank" rel="noopener" className="hover:text-slate-900 dark:hover:text-white">Status</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────

function EmailForm({ email, setEmail, onSubmit, loading, onDemo, demoLoading }: any) {
  return (
    <div className="space-y-5">
      {/* Demo button — primary, gradient, prominent */}
      <button
        type="button"
        onClick={onDemo}
        disabled={demoLoading}
        className="group w-full relative overflow-hidden py-3.5 px-5 rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white font-medium text-sm shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 hover:shadow-xl transition-all duration-300 disabled:opacity-50"
      >
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
        {demoLoading ? (
          <span className="relative flex items-center justify-center">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Setting up demo...
          </span>
        ) : (
          <span className="relative flex items-center justify-center">
            <Sparkles className="h-4 w-4 mr-2" />
            Try the demo — no signup
            <ChevronRight className="h-4 w-4 ml-1 opacity-60 group-hover:translate-x-0.5 transition-transform" />
          </span>
        )}
      </button>

      <p className="text-center text-xs text-slate-500 -mt-2">
        Full access for 4 hours. Pre-loaded with 682 real competitors.
      </p>

      <div className="divider-text">
        <span>Or sign in with email</span>
      </div>

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

      <div className="relative">
        <Link
          to="/register"
          className="btn btn-secondary w-full py-2.5 text-sm"
        >
          <UserPlus className="h-4 w-4 mr-2" /> Register as Competitor
        </Link>
      </div>
    </div>
  );
}

function CodeForm({ email, code, setCode, onSubmit, loading, onBack, codeInputRef }: any) {
  return (
    <div className="space-y-5 animate-slide-up">
      <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/60 rounded-xl p-4 flex items-start">
        <CheckCircle className="h-5 w-5 text-emerald-500 mr-3 flex-shrink-0 mt-0.5" />
        <div className="text-sm">
          <div className="font-medium text-emerald-900 dark:text-emerald-200">Sign-in link sent</div>
          <p className="mt-1 text-emerald-700 dark:text-emerald-300/80">
            We sent a link to <strong>{email}</strong>. Or enter the 6-digit code below.
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <Label htmlFor="code">6-digit code</Label>
          <input
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
            className="form-input text-center text-2xl tracking-[0.5em] font-mono py-3"
            placeholder="000000"
          />
        </div>

        <Button type="submit" variant="primary" loading={loading} disabled={code.length !== 6} className="w-full">
          {loading ? <><Spinner size="sm" className="mr-2" /> Verifying...</> : 'Verify code'}
        </Button>
      </form>

      <button
        onClick={onBack}
        className="w-full flex items-center justify-center text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
      >
        <ArrowLeft className="h-4 w-4 mr-1.5" /> Use a different email
      </button>
    </div>
  );
}

function SetupForm({ email, setEmail, firstName, setFirstName, lastName, setLastName, onSubmit, error, loading }: any) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Set up your admin account</h2>
        <p className="mt-1 text-sm text-slate-500">No accounts exist yet. Create the first one to get started.</p>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/60 rounded-xl p-3.5 flex items-start">
          <AlertCircle className="h-4 w-4 text-red-500 mr-2 flex-shrink-0 mt-0.5" />
          <span className="text-sm text-red-700 dark:text-red-300">{error}</span>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>First name</Label>
            <Input type="text" required value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Jane" />
          </div>
          <div>
            <Label>Last name</Label>
            <Input type="text" required value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Smith" />
          </div>
        </div>
        <div>
          <Label>Email</Label>
          <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourschool.com" />
        </div>
        <Button type="submit" variant="primary" loading={loading} className="w-full">
          {loading ? <><Spinner size="sm" className="mr-2" /> Creating...</> : 'Create admin account'}
        </Button>
      </form>
    </div>
  );
}
