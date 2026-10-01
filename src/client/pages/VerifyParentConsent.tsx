// P2-14: Parental consent verification page.
// Consent is recorded only when the parent clicks the confirm button (a
// POST). Opening the link does nothing by itself, so mail link scanners
// and previews cannot consent on the parent's behalf.
import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle, AlertCircle, ShieldCheck } from 'lucide-react';
import { Card, CardBody, Button } from '../components/ui';

export default function VerifyParentConsent() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; registration?: { competitorName: string; tournamentName: string } } | null>(null);
  const [error, setError] = useState<string | null>(token ? null : 'No verification token provided');

  const confirmConsent = async () => {
    if (!token || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/public/verify-parent-consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error || 'Verification failed');
        return;
      }

      setResult(data);
    } catch {
      setError('An error occurred during verification. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (error && !token) {
    return (
      <div className="min-h-screen bg-surface-50 dark:bg-surface-950 py-12 px-4">
        <div className="max-w-md mx-auto text-center">
          <Card>
            <CardBody className="p-8">
              <AlertCircle className="h-16 w-16 text-danger dark:text-danger mx-auto mb-4" />
              <h1 className="text-2xl font-bold text-surface-900 dark:text-white mb-2">Verification Failed</h1>
              <p className="text-surface-600 dark:text-surface-400 mb-6">{error}</p>
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
      <div className="min-h-screen bg-surface-50 dark:bg-surface-950 py-12 px-4">
        <div className="max-w-md mx-auto">
          <Card>
            <CardBody className="p-8 text-center">
              <CheckCircle className="h-16 w-16 text-success dark:text-success mx-auto mb-4" />
              <h1 className="text-2xl font-bold text-surface-900 dark:text-white mb-2">Consent Verified!</h1>
              <p className="text-surface-600 dark:text-surface-400 mb-6">{result.message}</p>

              {result.registration && (
                <div className="bg-surface-100 dark:bg-surface-800 rounded-lg p-4 text-left mb-6">
                  <h3 className="font-semibold text-surface-900 dark:text-white mb-2">Registration Confirmed</h3>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-surface-600 dark:text-surface-400">Competitor:</span>
                      <span className="font-medium text-surface-900 dark:text-white">{result.registration.competitorName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-surface-600 dark:text-surface-400">Tournament:</span>
                      <span className="font-medium text-surface-900 dark:text-white">{result.registration.tournamentName}</span>
                    </div>
                  </div>
                </div>
              )}

              <p className="text-sm text-surface-600 dark:text-surface-400 mb-4">
                Thank you. Use the "Manage Registration" link in the same email to view, pay for, edit or withdraw this registration.
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

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950 py-12 px-4">
      <div className="max-w-md mx-auto">
        <Card>
          <CardBody className="p-8 text-center">
            <ShieldCheck className="h-16 w-16 text-primary-600 dark:text-primary-400 mx-auto mb-4" aria-hidden="true" />
            <h1 className="text-2xl font-bold text-surface-900 dark:text-white mb-2">Confirm parental consent</h1>
            <p className="text-surface-600 dark:text-surface-400 mb-6">
              By confirming, you state that you are the parent or legal guardian of the competitor and authorize their registration for this tournament.
            </p>
            {error && (
              <div role="alert" className="mb-4 p-3 rounded-md bg-danger/10 border border-danger/30 text-sm text-danger text-left flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}
            <Button
              type="button"
              variant="primary"
              className="w-full"
              loading={submitting}
              onClick={() => void confirmConsent()}
              data-testid="confirm-parent-consent"
            >
              I am the parent/guardian — confirm consent
            </Button>
            <p className="text-xs text-surface-500 mt-4">
              If you did not register a child for this tournament, close this page; nothing is recorded unless you confirm.
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
