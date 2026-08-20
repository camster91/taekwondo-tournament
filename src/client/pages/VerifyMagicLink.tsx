import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/ui/Spinner';
import Button from '../components/ui/Button';
import { getSafeRedirectUrl } from '../utils/safe-redirect';

export default function VerifyMagicLink() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const returnTo = searchParams.get('returnTo') || searchParams.get('from');
  const email = searchParams.get('email');
  const { verifyToken } = useAuth();

  const [error, setError] = useState('');
  const [isVerifying, setIsVerifying] = useState(true);

  useEffect(() => {
    if (!token) {
      setError('Your sign-in link is invalid or has expired. Magic links expire in 15 minutes and can only be used once.');
      setIsVerifying(false);
      return;
    }

    let isMounted = true;
    verifyToken(token).then((result) => {
      if (!isMounted) return;
      if (result.success) {
        const dest = getSafeRedirectUrl(returnTo, '/');
        navigate(dest, { replace: true });
      } else {
        setError(result.error || 'Your sign-in link is invalid or has expired. Magic links expire in 15 minutes and can only be used once.');
        setIsVerifying(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [token, returnTo, verifyToken, navigate]);

  if (isVerifying) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
        <div className="text-center" role="status" aria-live="polite">
          <Spinner size="lg" />
          <p className="mt-4 text-sm font-medium text-gray-700 dark:text-gray-300">Verifying your sign-in link...</p>
        </div>
      </div>
    );
  }

  const newLinkParams = new URLSearchParams();
  if (email) newLinkParams.set('email', email);
  if (returnTo) newLinkParams.set('returnTo', returnTo);
  const newLinkQuery = newLinkParams.toString();
  const retryUrl = newLinkQuery ? `/login?${newLinkQuery}` : '/login';

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-900 dark:to-gray-800 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="p-3 bg-red-100 dark:bg-red-900/30 rounded-2xl">
            <AlertCircle className="h-12 w-12 text-red-600 dark:text-red-400" aria-hidden="true" />
          </div>
        </div>
        <h1 className="mt-6 text-center text-2xl font-bold text-gray-900 dark:text-white">
          Sign-in link expired or invalid
        </h1>
        <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">{error}</p>
        <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Button as={Link} to={retryUrl} variant="primary" className="w-full sm:w-auto min-h-[44px]">
            Request New Link
          </Button>
          <Button as={Link} to="/login" variant="secondary" className="w-full sm:w-auto min-h-[44px]">
            Back to Login
          </Button>
        </div>
      </div>
    </div>
  );
}
