import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Trophy, Lock, AlertCircle, CheckCircle } from 'lucide-react';
import Spinner from '../components/ui/Spinner';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Reset failed');
      } else {
        setSuccess(true);
        setTimeout(() => navigate('/login'), 2000);
      }
    } catch (err) {
      setError('Failed to connect to server');
    }

    setIsLoading(false);
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-900 dark:to-gray-800 flex flex-col justify-center py-12 px-4">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white dark:bg-gray-800 py-8 px-4 shadow-xl rounded-xl sm:px-10 text-center border border-gray-200 dark:border-gray-700">
            <AlertCircle className="h-12 w-12 text-red-500 dark:text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Invalid Reset Link</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-4">This password reset link is invalid or has expired.</p>
            <Link to="/forgot-password" className="btn btn-primary">
              Request New Link
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-900 dark:to-gray-800 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="p-3 bg-primary-100 dark:bg-primary-900/30 rounded-2xl">
            <Trophy className="h-12 w-12 text-primary-600 dark:text-primary-400" />
          </div>
        </div>
        <h2 className="mt-6 text-center text-3xl font-bold text-gray-900 dark:text-white">
          Set New Password
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
          Enter your new password below
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

          {success ? (
            <div className="text-center">
              <div className="mb-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 flex items-center justify-center">
                <CheckCircle className="h-6 w-6 text-green-500 dark:text-green-400 mr-2" />
                <span className="text-green-700 dark:text-green-300">Password reset successfully!</span>
              </div>
              <div className="flex items-center justify-center text-sm text-gray-600 dark:text-gray-400">
                <Spinner size="sm" className="mr-2" />
                Redirecting to login...
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  New Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="form-input w-full pl-10"
                    placeholder="At least 8 characters"
                  />
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                </div>
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Confirm Password
                </label>
                <div className="relative">
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="form-input w-full pl-10"
                    placeholder="Confirm your new password"
                  />
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full btn btn-primary py-3 flex items-center justify-center text-base font-medium"
              >
                {isLoading ? (
                  <>
                    <Spinner size="sm" className="mr-2" />
                    Resetting...
                  </>
                ) : (
                  'Reset Password'
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
