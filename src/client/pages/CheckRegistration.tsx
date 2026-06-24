// Parent-facing lookup: "did my kid's registration go through?"
// The confirmation code is the first 8 chars of the registration UUID,
// given to the parent right after they register. If they lose it (or
// the email doesn't arrive), this page lets them look up their
// registration using the kid's name + DOB.
//
// Privacy: returns the same 200 + 404 response whether the lookup
// finds a match or not, to avoid leaking "this kid exists in the
// system" via timing or response-shape differences. We only show
// the confirmation code if all three fields match a real registration.
import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Search, AlertCircle, CheckCircle2, ArrowLeft } from 'lucide-react';
import { Card, CardBody } from '../components/ui';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Label from '../components/ui/Label';

interface LookupResult {
  registered: boolean;
  confirmationCode?: string;
}

export default function CheckRegistration() {
  const [tournamentId, setTournamentId] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [tournaments, setTournaments] = useState<{ id: string; name: string; date: string }[]>([]);
  const errorRef = useRef<HTMLDivElement>(null);

  // Load open tournaments so the parent doesn't have to paste a UUID
  useEffect(() => {
    fetch('/api/public/tournaments')
      .then(r => r.json())
      .then(setTournaments)
      .catch(() => setTournaments([]));
  }, []);

  // Focus the error region when an error appears (a11y)
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (!tournamentId || !firstName.trim() || !lastName.trim() || !dateOfBirth) {
      setError('Please fill in all fields.');
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams({
        tournamentId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        dateOfBirth,
      });
      const res = await fetch(`/api/public/check-registration?${params}`);
      const data = await res.json();
      setResult(data);
      if (!data.registered) {
        // Don't leak whether the kid exists — just say "not found, check spelling / DOB"
        // and point them at the /manage-registration path which uses 3-factor
        // auth (confirmation code + lastName + DOB) so they can recover
        // even when name spelling is uncertain.
        setError(
          `No registration found for those exact details. Common causes: a typo in the name (e.g. "Jon" vs "John"), or a different DOB format (the form uses YYYY-MM-DD). If you have your confirmation code, try ${window.location.origin}/manage-registration instead.`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4">
      <div className="max-w-md mx-auto">
        <Link
          to="/register"
          className="inline-flex items-center text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to register
        </Link>
        <Card>
          <CardBody className="p-8">
            <div className="text-center mb-6">
              <Search className="h-12 w-12 text-indigo-500 mx-auto mb-3" aria-hidden="true" />
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                Look up your registration
              </h1>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Enter the tournament and your kid's details to find your confirmation code.
              </p>
            </div>

            <form onSubmit={handleLookup} className="space-y-4" aria-describedby={error ? 'lookup-error' : undefined}>
              <div>
                <Label htmlFor="lookup-tournament">Tournament</Label>
                <select
                  id="lookup-tournament"
                  value={tournamentId}
                  onChange={(e) => setTournamentId(e.target.value)}
                  required
                  aria-required="true"
                  className="h-10 px-3 pr-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all appearance-none w-full"
                >
                  <option value="">-- Select a Tournament --</option>
                  {tournaments.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} - {new Date(t.date).toLocaleDateString()}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="lookup-first">First name</Label>
                  <Input
                    id="lookup-first"
                    name="firstName"
                    type="text"
                    autoComplete="given-name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                    aria-required="true"
                  />
                </div>
                <div>
                  <Label htmlFor="lookup-last">Last name</Label>
                  <Input
                    id="lookup-last"
                    name="lastName"
                    type="text"
                    autoComplete="family-name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                    aria-required="true"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="lookup-dob">Date of birth</Label>
                <Input
                  id="lookup-dob"
                  name="dateOfBirth"
                  type="date"
                  autoComplete="bday"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  required
                  aria-required="true"
                />
              </div>

              {error && (
                <div
                  ref={errorRef}
                  id="lookup-error"
                  role="alert"
                  tabIndex={-1}
                  className="flex items-start gap-2 p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300"
                >
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}

              <Button
                type="submit"
                variant="primary"
                loading={loading}
                disabled={loading}
                className="w-full"
              >
                <Search className="h-4 w-4 mr-2" />
                Look up registration
              </Button>
            </form>

            {result?.registered && result.confirmationCode && (
              <div className="mt-6 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-lg p-5">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" aria-hidden="true" />
                  <p className="font-medium text-green-800 dark:text-green-200">Registration found</p>
                </div>
                <p className="text-xs font-medium uppercase tracking-wider text-green-700 dark:text-green-300 mb-2">
                  Confirmation code
                </p>
                <code
                  data-testid="lookup-confirmation-code"
                  className="block text-2xl font-mono font-bold text-green-900 dark:text-green-100 tracking-widest text-center select-all"
                >
                  {result.confirmationCode}
                </code>
                <p className="text-xs text-green-700 dark:text-green-300 mt-3 text-center">
                  Bring this code to check-in on tournament day.
                </p>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
