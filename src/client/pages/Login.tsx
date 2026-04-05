import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Trophy, Mail, AlertCircle, UserPlus, ArrowLeft, CheckCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/ui/Spinner';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { requestMagicLink, verifyCode, isAuthenticated } = useAuth();

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  // Setup state
  const [setupFirstName, setSetupFirstName] = useState('');
  const [setupLastName, setSetupLastName] = useState('');

  const { data: setupStatus } = useQuery<{ needsSetup: boolean }>({
    queryKey: ['setup-status'],
    queryFn: async () => {
      const res = await fetch('/api/auth/setup-status');
      return res.json();
    },
    staleTime: 60000,
  });

  const needsSetup = setupStatus?.needsSetup === true;

  // Redirect if already logged in
  if (isAuthenticated) {
    const from = (location.state as any)?.from?.pathname || '/';
    navigate(from, { replace: true });
  }

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
        // Store token and redirect
        localStorage.setItem('auth_token', data.token);
        window.location.href = '/';
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
      setStep('code');
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-900 dark:to-gray-800 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="p-3 bg-primary-100 dark:bg-primary-900/30 rounded-2xl">
            <Trophy className="h-12 w-12 text-primary-600 dark:text-primary-400" />
          </div>
        </div>
        <h2 className="mt-6 text-center text-3xl font-bold text-gray-900 dark:text-white">
          Martial Arts Tournament Manager
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
          {needsSetup
            ? 'Create your admin account to get started'
            : step === 'email'
              ? 'Sign in to manage tournaments'
              : 'Check your email'}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white dark:bg-gray-800 py-8 px-4 shadow-xl rounded-xl sm:px-10 border border-gray-200 dark:border-gray-700">
          {error && (
            <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start">
              <AlertCircle className="h-5 w-5 text-red-500 dark:text-red-400 mr-3 flex-shrink-0 mt-0.5" />
              <span className="text-sm text-red-700 dark:text-red-300">{error}</span>
            </div>
          )}

          {needsSetup ? (
            // First-run setup form
            <form onSubmit={handleSetupSubmit} className="space-y-5">
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 text-sm text-blue-800 dark:text-blue-300">
                No accounts exist yet. Create your admin account to get started.
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">First Name</label>
                  <input
                    type="text"
                    required
                    value={setupFirstName}
                    onChange={(e) => setSetupFirstName(e.target.value)}
                    className="form-input w-full"
                    placeholder="Jane"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Last Name</label>
                  <input
                    type="text"
                    required
                    value={setupLastName}
                    onChange={(e) => setSetupLastName(e.target.value)}
                    className="form-input w-full"
                    placeholder="Smith"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="form-input w-full"
                  placeholder="you@example.com"
                />
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full btn btn-primary py-3 flex items-center justify-center text-base font-medium"
              >
                {isLoading ? <Spinner size="sm" className="mr-2" /> : null}
                Create Admin Account
              </button>
            </form>
          ) : step === 'email' ? (
            <form onSubmit={handleEmailSubmit} className="space-y-5">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Email address
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="form-input w-full"
                  placeholder="you@example.com"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full btn btn-primary py-3 flex items-center justify-center text-base font-medium"
              >
                {isLoading ? (
                  <>
                    <Spinner size="sm" className="mr-2" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Mail className="h-5 w-5 mr-2" />
                    Send sign-in link
                  </>
                )}
              </button>
            </form>
          ) : (
            <>
              <div className="mb-6 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 flex items-start">
                <CheckCircle className="h-5 w-5 text-green-500 dark:text-green-400 mr-3 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-green-700 dark:text-green-300">
                  <p className="font-medium">Sign-in link sent!</p>
                  <p className="mt-1">
                    We sent a link and a 6-digit code to <strong>{email}</strong>. Click the link or enter the code below.
                  </p>
                </div>
              </div>

              <form onSubmit={handleCodeSubmit} className="space-y-5">
                <div>
                  <label htmlFor="code" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    6-digit code
                  </label>
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
                    className="form-input w-full text-center text-2xl tracking-[0.5em] font-mono"
                    placeholder="000000"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoading || code.length !== 6}
                  className="w-full btn btn-primary py-3 flex items-center justify-center text-base font-medium"
                >
                  {isLoading ? (
                    <>
                      <Spinner size="sm" className="mr-2" />
                      Verifying...
                    </>
                  ) : (
                    'Verify code'
                  )}
                </button>
              </form>

              <button
                onClick={() => {
                  setStep('email');
                  setCode('');
                  setError('');
                }}
                className="mt-4 w-full flex items-center justify-center text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                Use a different email
              </button>
            </>
          )}

          {!needsSetup && (
            <div className="mt-6">
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200 dark:border-gray-700" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-4 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400">Or continue with</span>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                <Link
                  to="/register"
                  className="w-full btn btn-secondary py-2.5 flex items-center justify-center"
                >
                  <UserPlus className="h-4 w-4 mr-2" />
                  Register as Competitor
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
