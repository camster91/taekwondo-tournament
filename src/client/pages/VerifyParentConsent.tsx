// P2-14: Parental consent verification page
import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle, AlertCircle, Trophy } from 'lucide-react';
import Spinner from '../components/ui/Spinner';
import { Card, CardBody, Button } from '../components/ui';

export default function VerifyParentConsent() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<{ success: boolean; message: string; registration?: { competitorName: string; tournamentName: string } } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError('No verification token provided');
      setLoading(false);
      return;
    }

    const verifyConsent = async () => {
      try {
        const response = await fetch(`/api/public/verify-parent-consent?token=${encodeURIComponent(token)}`);
        const data = await response.json();

        if (!response.ok) {
          setError(data.error || 'Verification failed');
          return;
        }

        setResult(data);
      } catch (err) {
        setError('An error occurred during verification. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    void verifyConsent();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="flex items-center text-gray-600 dark:text-gray-400">
          <Spinner className="mr-2" />
          Verifying parental consent...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4">
        <div className="max-w-md mx-auto text-center">
          <Card>
            <CardBody className="p-8">
              <AlertCircle className="h-16 w-16 text-red-500 dark:text-red-400 mx-auto mb-4" />
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Verification Failed</h1>
              <p className="text-gray-600 dark:text-gray-400 mb-6">{error}</p>
              <Button as={Link} to="/" variant="secondary">
                Return to home
              </Button>
            </CardBody>
          </Card>
        </div>
      </div>
    );
  }

  if (result?.success) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4">
        <div className="max-w-md mx-auto">
          <Card>
            <CardBody className="p-8 text-center">
              <CheckCircle className="h-16 w-16 text-green-500 dark:text-green-400 mx-auto mb-4" />
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Consent Verified!</h1>
              <p className="text-gray-600 dark:text-gray-400 mb-6">{result.message}</p>

              {result.registration && (
                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 text-left mb-6">
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Registration Confirmed</h3>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Competitor:</span>
                      <span className="font-medium text-gray-900 dark:text-white">{result.registration.competitorName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Tournament:</span>
                      <span className="font-medium text-gray-900 dark:text-white">{result.registration.tournamentName}</span>
                    </div>
                  </div>
                </div>
              )}

              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Your child's registration is now complete and confirmed. You should have received a confirmation email with all the details.
              </p>

              <Button as={Link} to="/" variant="primary" className="w-full">
                Done
              </Button>
            </CardBody>
          </Card>
        </div>
      </div>
    );
  }

  return null;
}
