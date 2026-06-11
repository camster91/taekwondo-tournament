import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Trophy, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/ui/Spinner';
import Button from '../components/ui/Button';

export default function VerifyMagicLink() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const { verifyToken } = useAuth();

  const [error, setError] = useState('');
  const [isVerifying, setIsVerifying] = useState(true);

  useEffect(() => {
    if (!token) {
      setError('No verification token provided');
      setIsVerifying(false);
      return;
    }

    verifyToken(token).then((result) => {
      if (result.success) {
        navigate('/', { replace: true });
      } else {
        setError(result.error || 'Verification failed');
        setIsVerifying(false);
      }
    });
  }, [token]);

  if (isVerifying) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center">
        <div className="text-center">
          <Spinner size="lg" />
          <p className="mt-4 text-gray-600 dark:text-gray-400">Verifying your sign-in link...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-900 dark:to-gray-800 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="p-3 bg-red-100 dark:bg-red-900/30 rounded-2xl">
            <AlertCircle className="h-12 w-12 text-red-600 dark:text-red-400" />
          </div>
        </div>
        <h2 className="mt-6 text-center text-2xl font-bold text-gray-900 dark:text-white">
          Sign-in link expired
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">{error}</p>
        <div className="mt-6 text-center">
          <Button as={Link} to="/login" variant="primary" className="inline-block">
            Back to Login
          </Button>
        </div>
      </div>
    </div>
  );
}
