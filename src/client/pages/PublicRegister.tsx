import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Trophy, CheckCircle, AlertCircle, User, Calendar, Award, CreditCard, Printer } from 'lucide-react';
import Spinner from '../components/ui/Spinner';
import { Card, CardBody } from '../components/ui';
import { PageHeader } from '../components/ui';
import { Button } from '../components/ui';
import { Input } from '../components/ui';
import { Label } from '../components/ui';
import { Select } from '../components/ui';
import { Textarea } from '../components/ui';
import { getSportProfile } from '../../shared/constants/sport-profiles';

interface Tournament {
  id: string;
  name: string;
  date: string;
  location: string | null;
  sportProfileSlug: string | null;
  _count: { registrations: number };
}

interface RegistrationResult {
  success: boolean;
  message: string;
  registration: {
    id: string;
    confirmationCode?: string;
    competitorName: string;
    tournamentName: string;
    tournamentDate: string;
    events: { patterns: boolean; sparring: boolean };
    ageGroup: string;
  };
}

// Taekwondo-specific detailed belt options (for stripe-level granularity in TKD tournaments)
const TKD_BELT_OPTIONS = [
  'White',
  'White / Single Yellow Stripe',
  'White / Double Yellow Stripe',
  'Yellow',
  'Yellow / Single Green Stripe',
  'Yellow / Double Green Stripe',
  'Green',
  'Green / Single Blue Stripe',
  'Green / Double Blue Stripe',
  'Blue',
  'Blue / Single Red Stripe',
  'Blue / Double Red Stripe',
  'Red',
  'Red / Single Black Stripe',
  'Red / Double Black Stripe',
  'Brown',
  'Brown / Single Black Stripe',
  'Brown / Double Black Stripe',
  'Black',
];

export default function PublicRegister() {
  const [searchParams] = useSearchParams();
  const preselectedTournamentId = searchParams.get('tournament');

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Refs for a11y: focus the error region on submit failure, focus the first
  // invalid field if we can identify one from the server response.
  const errorRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const tournamentRef = useRef<HTMLSelectElement | null>(null);
  const firstNameRef = useRef<HTMLInputElement | null>(null);
  const lastNameRef = useRef<HTMLInputElement | null>(null);
  const genderRef = useRef<HTMLSelectElement | null>(null);
  const dobRef = useRef<HTMLInputElement | null>(null);
  const beltRef = useRef<HTMLSelectElement | null>(null);
  const danRankRef = useRef<HTMLSelectElement | null>(null);
  const schoolRef = useRef<HTMLInputElement | null>(null);
  const heightRef = useRef<HTMLInputElement | null>(null);
  const weightRef = useRef<HTMLInputElement | null>(null);
  const specialNeedsRef = useRef<HTMLTextAreaElement | null>(null);
  const parentNameRef = useRef<HTMLInputElement | null>(null);
  const parentEmailRef = useRef<HTMLInputElement | null>(null);
  const parentPhoneRef = useRef<HTMLInputElement | null>(null);

  // 2-step form: step 1 = kid info, step 2 = parent + consent
  const [step, setStep] = useState<1 | 2 | 3>(1);
  // Track how many competitors this device has registered in this
  // session so the success screen can show "2 registered from this
  // device" — gives parents confidence when registering multiple
  // siblings and discourages accidental double-submits.
  const [registeredCount, setRegisteredCount] = useState(0);

  const [formData, setFormData] = useState({
    tournamentId: preselectedTournamentId || '',
    firstName: '',
    lastName: '',
    gender: '',
    dateOfBirth: '',
    belt: '',
    danRank: 1,
    heightInches: '',
    weightLbs: '',
    schoolDojang: '',
    specialNeeds: '',
    patterns: false,
    sparring: false,
    parentName: '',
    parentEmail: '',
    parentPhone: '',
    competeWithOlder: false,
  });

  const selectedTournament = useMemo(
    () => tournaments.find((t) => t.id === formData.tournamentId),
    [tournaments, formData.tournamentId]
  );

  // Real-time age-band preview. Mirrors the server's DEFAULT_AGE_GROUPS
  // / BB_AGE_GROUPS logic so the displayed band matches what
  // autoCategorize would assign on submit.
  const ageBandPreview = useMemo(() => {
    if (!formData.dateOfBirth) return null;
    const dob = new Date(formData.dateOfBirth);
    if (isNaN(dob.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    // Adjust if birthday hasn't occurred yet this year.
    const monthDiff = now.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
      age--;
    }
    if (age < 4 || age > 99) return null;

    // Pick CB vs BB grouping based on belt. "Black" or "Poom" → BB.
    // Mirrors src/shared/constants/belts.ts isBlackBelt().
    const beltLower = formData.belt.toLowerCase();
    const isBB = beltLower.includes('black') || beltLower.startsWith('poom');
    const groups = isBB
      ? [
          { min: 11, max: 11, label: '11 and Under' },
          { min: 12, max: 13, label: '12-13' },
          { min: 14, max: 15, label: '14-15' },
          { min: 16, max: 17, label: '16-17' },
          { min: 18, max: 35, label: '18-35' },
          { min: 36, max: 99, label: '36+' },
        ]
      : [
          { min: 4, max: 5, label: '4-5' },
          { min: 6, max: 7, label: '6-7' },
          { min: 8, max: 9, label: '8-9' },
          { min: 10, max: 11, label: '10-11' },
          { min: 12, max: 14, label: '12-14' },
          { min: 15, max: 17, label: '15-17' },
          { min: 18, max: 35, label: '18-35' },
          { min: 36, max: 99, label: '36+' },
        ];
    const current = groups.find((g) => age >= g.min && age <= g.max);
    if (!current) return null;

    // Next band up: if there's a group whose min is the next step,
    // surface it for the "compete with older" hint.
    const idx = groups.indexOf(current);
    const next = idx >= 0 && idx < groups.length - 1 ? groups[idx + 1] : null;
    const tier = isBB ? 'Black Belt (BB)' : 'Colored Belt (CB)';

    return {
      label: current.label,
      tier,
      nextBandLabel: next?.label ?? null,
    };
  }, [formData.dateOfBirth, formData.belt]);


  const sportProfile = useMemo(() => {
    const slug = selectedTournament?.sportProfileSlug || 'taekwondo';
    return getSportProfile(slug) ?? getSportProfile('taekwondo')!;
  }, [selectedTournament]);

  const beltOptions = useMemo(() => {
    const slug = selectedTournament?.sportProfileSlug || 'taekwondo';
    if (slug === 'taekwondo') return TKD_BELT_OPTIONS;
    return sportProfile.beltConfig.levels.map((l) => l.name);
  }, [sportProfile, selectedTournament]);

  const topLevelBeltName = sportProfile.beltConfig.topLevelName.split(' ')[0]; // e.g. "Black"

  const isMinor = useMemo(() => {
    if (!formData.dateOfBirth) return false;
    const dob = new Date(formData.dateOfBirth);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
      age--;
    }
    return age < 18;
  }, [formData.dateOfBirth]);

  // Map sport event types to the two boolean fields (patterns = first event, sparring = second)
  const eventType0 = sportProfile.eventTypes[0];
  const eventType1 = sportProfile.eventTypes[1];

  useEffect(() => {
    fetch('/api/public/tournaments')
      .then((res) => res.json())
      .then((data) => {
        setTournaments(data);
        if (data.length === 1 && !formData.tournamentId) {
          setFormData((prev) => ({ ...prev, tournamentId: data[0].id }));
        }
      })
      .catch(() => setError('Failed to load tournaments'))
      .finally(() => setLoading(false));
  }, []);

  // Map a field name from server validation errors to its DOM ref. We use a
  // regex match against the error string; if no match we fall back to focusing
  // the error region itself.
  const focusFieldByErrorMessage = (messages: string[]) => {
    const lc = messages.map((m) => m.toLowerCase()).join(' | ');
    if (lc.includes('tournament')) return tournamentRef.current;
    if (lc.includes('first name')) return firstNameRef.current;
    if (lc.includes('last name')) return lastNameRef.current;
    if (lc.includes('gender')) return genderRef.current;
    if (lc.includes('date of birth') || lc.includes('birth')) return dobRef.current;
    if (lc.includes('belt')) return beltRef.current;
    if (lc.includes('dan')) return danRankRef.current;
    if (lc.includes('school') || lc.includes('dojang')) return schoolRef.current;
    if (lc.includes('height')) return heightRef.current;
    if (lc.includes('weight')) return weightRef.current;
    if (lc.includes('special')) return specialNeedsRef.current;
    if (lc.includes('parent') && lc.includes('name')) return parentNameRef.current;
    if (lc.includes('parent') && lc.includes('email')) return parentEmailRef.current;
    if (lc.includes('parent') && lc.includes('phone')) return parentPhoneRef.current;
    if (lc.includes('event')) {
      // Events are checkboxes; focus the patterns checkbox (first in DOM order).
      const patternsEl = formRef.current?.querySelector<HTMLInputElement>('input[name="patterns"]');
      return patternsEl ?? null;
    }
    return null;
  };

  const focusErrorRegion = () => {
    // The error region is role="alert" + tabIndex={-1} so it can receive focus
    // and be announced by screen readers as the failure point.
    errorRef.current?.focus();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setValidationErrors([]);
    setSubmitting(true);

    // Client-side validation: parent contact required for minors
    if (isMinor) {
      const clientErrors: string[] = [];
      if (!formData.parentName.trim()) clientErrors.push('Parent/Guardian name is required for competitors under 18');
      if (!formData.parentEmail.trim()) clientErrors.push('Parent/Guardian email is required for competitors under 18');
      if (clientErrors.length > 0) {
        setValidationErrors(clientErrors);
        setSubmitting(false);
        // Focus the parent-name field if we can identify it, otherwise the
        // error region.
        queueMicrotask(() => {
          const target = focusFieldByErrorMessage(clientErrors) ?? errorRef.current;
          target?.focus();
        });
        return;
      }
    }

    try {
      const res = await fetch('/api/public/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          heightInches: formData.heightInches ? parseFloat(formData.heightInches) : null,
          weightLbs: formData.weightLbs ? parseFloat(formData.weightLbs) : null,
          danRank: formData.belt === topLevelBeltName && sportProfile.beltConfig.hasDanRank ? formData.danRank : null,
          // The public register endpoint creates a Registration with these fields
          competeWithOlder: formData.competeWithOlder,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.details) {
          setValidationErrors(data.details);
          queueMicrotask(() => {
            const target = focusFieldByErrorMessage(data.details as string[]) ?? errorRef.current;
            target?.focus();
          });
        } else {
          setError(data.error || 'Registration failed');
          queueMicrotask(() => focusErrorRegion());
        }
        return;
      }

      setResult(data);
      // Increment on success so the success screen can show the
      // running count and offer a fast re-entry path.
      setRegisteredCount((c) => c + 1);
    } catch {
      setError('Network error. Please try again.');
      queueMicrotask(() => focusErrorRegion());
    } finally {
      setSubmitting(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value, type } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="flex items-center text-gray-600 dark:text-gray-400">
          <Spinner className="mr-2" />
          Loading tournaments...
        </div>
      </div>
    );
  }

  if (result) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4">
        <div className="max-w-md mx-auto">
          <Card>
            <CardBody className="p-8 text-center">
              <CheckCircle className="h-16 w-16 text-green-500 dark:text-green-400 mx-auto mb-4" />
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Registration Complete!</h1>
              <p className="text-gray-600 dark:text-gray-400 mb-6">{result.message}</p>

              {result.registration.confirmationCode && (
                <div className="bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-700 rounded-lg p-5 mb-6">
                  <p className="text-xs font-medium uppercase tracking-wider text-indigo-700 dark:text-indigo-300 mb-2">
                    Your confirmation code
                  </p>
                  <div className="flex items-center justify-between gap-3">
                    <code
                      data-testid="confirmation-code"
                      className="text-2xl font-mono font-bold text-indigo-900 dark:text-indigo-100 tracking-widest select-all"
                    >
                      {result.registration.confirmationCode}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(result.registration.confirmationCode || '');
                      }}
                      aria-label="Copy confirmation code"
                      className="text-xs px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white font-medium"
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      onClick={() => window.print()}
                      aria-label="Print registration confirmation"
                      className="text-xs px-3 py-1.5 rounded-md border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 font-medium"
                    >
                      <Printer className="inline h-3 w-3 mr-1" aria-hidden="true" />
                      Print
                    </button>
                  </div>
                  <p className="text-xs text-indigo-700 dark:text-indigo-300 mt-3">
                    Save this — you'll need it at check-in. Lost it?{' '}
                    <a href="/check-registration" className="underline hover:no-underline">
                      Look up your registration
                    </a>
                    {' '}·{' '}
                    <a
                      href={`/manage-registration?code=${result.registration.confirmationCode || ''}`}
                      className="underline hover:no-underline"
                    >
                      Edit or withdraw
                    </a>
                  </p>
                </div>
              )}

              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 text-left mb-6">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Registration Details</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Competitor:</span>
                    <span className="font-medium text-gray-900 dark:text-white">{result.registration.competitorName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Tournament:</span>
                    <span className="font-medium text-gray-900 dark:text-white">{result.registration.tournamentName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Date:</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {new Date(result.registration.tournamentDate).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Age Group:</span>
                    <span className="font-medium text-gray-900 dark:text-white">{result.registration.ageGroup}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Events:</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {[
                        result.registration.events.patterns && (sportProfile.eventTypes[0]?.name || 'Patterns'),
                        result.registration.events.sparring && (sportProfile.eventTypes[1]?.name || 'Sparring'),
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    </span>
                  </div>
                </div>
              </div>

              {registeredCount > 1 && (
                <p className="text-sm text-indigo-700 dark:text-indigo-300 mb-4 font-medium">
                  {registeredCount} competitors registered from this device.
                </p>
              )}

              <div className="space-y-3">
                <Button
                  variant="primary"
                  className="w-full"
                  onClick={() => {
                    // Reset kid + event fields, KEEP parent + tournament.
                    // Most families register 2-3 kids and the parent/tournament
                    // info is identical across siblings.
                    setResult(null);
                    setStep(1);
                    setError(null);
                    setValidationErrors([]);
                    setFormData({
                      ...formData,
                      firstName: '',
                      lastName: '',
                      dateOfBirth: '',
                      danRank: 1,
                      heightInches: '',
                      weightLbs: '',
                      schoolDojang: '',
                      specialNeeds: '',
                      patterns: false,
                      sparring: false,
                      competeWithOlder: false,
                    });
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                    // Re-focus first field for fast re-entry.
                    queueMicrotask(() => {
                      const el = document.querySelector<HTMLInputElement>('input[name="firstName"]');
                      el?.focus();
                    });
                  }}
                >
                  Register Another Competitor
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setRegisteredCount(0);
                    setResult(null);
                    setStep(1);
                    setError(null);
                    setValidationErrors([]);
                    setFormData({
                      tournamentId: preselectedTournamentId || '',
                      firstName: '',
                      lastName: '',
                      gender: '',
                      dateOfBirth: '',
                      belt: '',
                      danRank: 1,
                      heightInches: '',
                      weightLbs: '',
                      schoolDojang: '',
                      specialNeeds: '',
                      patterns: false,
                      sparring: false,
                      parentName: '',
                      parentEmail: '',
                      parentPhone: '',
                      competeWithOlder: false,
                    });
                  }}
                >
                  Done — Exit Registration
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    );
  }

  if (tournaments.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4">
        <div className="max-w-md mx-auto text-center">
          <Trophy className="h-16 w-16 text-gray-600 dark:text-gray-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">No Open Tournaments</h1>
          <p className="text-gray-600 dark:text-gray-400">
            There are currently no tournaments open for registration. Please check back later.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <Trophy className="h-12 w-12 text-primary-500 dark:text-primary-400 mx-auto mb-3" />
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Tournament Registration</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2">
            Register for an upcoming tournament
          </p>
          {/* Fee note — pulled from tournament.settings.registrationFee.
              The director writes this in TournamentSettings; we surface
              it here so parents know what to expect cost-wise before
              they spend 5 minutes filling out the form. */}
          {(() => {
            try {
              const settings = selectedTournament?.settings
                ? JSON.parse(selectedTournament.settings)
                : null;
              const fee = settings?.registrationFee;
              if (!fee) return null;
              return (
                <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-800 dark:text-amber-200 text-sm font-medium">
                  <CreditCard className="h-4 w-4" aria-hidden="true" />
                  <span>Fee: {fee}</span>
                </div>
              );
            } catch {
              return null;
            }
          })()}
        </div>

        {/* Error Display */}
        {(error || validationErrors.length > 0) && (
          <div
            ref={errorRef}
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            tabIndex={-1}
            className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6"
          >
            <div className="flex items-start">
              <AlertCircle className="h-5 w-5 text-red-500 dark:text-red-400 mt-0.5 mr-2" aria-hidden="true" />
              <div>
                {error && <p className="text-red-700 dark:text-red-300 font-medium">{error}</p>}
                {validationErrors.length > 0 && (
                  <ul className="text-red-700 dark:text-red-300 text-sm list-disc list-inside">
                    {validationErrors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Registration Form */}
        <Card>
          <CardBody className="p-6">
            <form
              ref={formRef}
              onSubmit={handleSubmit}
              aria-label="Tournament registration form"
              className="space-y-6"
              noValidate
            >
              {/* Step Indicator */}
              <div className="flex items-center gap-2 mb-2 overflow-x-auto">
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold flex-shrink-0 ${step >= 1 ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' : 'bg-gray-100 text-gray-700'}`}>
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-white text-[10px]">1</span>
                  Athlete
                </div>
                <div className={`h-px flex-1 min-w-[1rem] ${step >= 2 ? 'bg-indigo-400' : 'bg-gray-200 dark:bg-gray-700'}`} />
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold flex-shrink-0 ${step >= 2 ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' : 'bg-gray-100 text-gray-700'}`}>
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${step >= 2 ? 'bg-indigo-600 text-white' : 'bg-gray-300 text-gray-600'}`}>2</span>
                  Parent & Consent
                </div>
              </div>

              {step === 1 && (<>
              {/* Tournament Selection */}
              <div>
                <Label htmlFor="tournamentId" required>
                  <Trophy className="h-4 w-4 inline mr-1" aria-hidden="true" />
                  Select Tournament
                </Label>
                <Select
                  id="tournamentId"
                  ref={tournamentRef}
                  name="tournamentId"
                  value={formData.tournamentId}
                  onChange={handleChange}
                  required
                  aria-required="true"
                >
                  <option value="">-- Select a Tournament --</option>
                  {tournaments.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} - {new Date(t.date).toLocaleDateString()}
                      {t.location && ` (${t.location})`}
                    </option>
                  ))}
                </Select>
              </div>

              {/* Competitor Information */}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                  <User className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" aria-hidden="true" />
                  Competitor Information
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="firstName" required>First Name</Label>
                    <Input
                      id="firstName"
                      ref={firstNameRef}
                      type="text"
                      name="firstName"
                      value={formData.firstName}
                      onChange={handleChange}
                      required
                      aria-required="true"
                      autoComplete="given-name"
                    />
                  </div>

                  <div>
                    <Label htmlFor="lastName" required>Last Name</Label>
                    <Input
                      id="lastName"
                      ref={lastNameRef}
                      type="text"
                      name="lastName"
                      value={formData.lastName}
                      onChange={handleChange}
                      required
                      aria-required="true"
                      autoComplete="family-name"
                    />
                  </div>

                  <div>
                    <Label htmlFor="gender" required>Gender</Label>
                    <Select
                      id="gender"
                      ref={genderRef}
                      name="gender"
                      value={formData.gender}
                      onChange={handleChange}
                      required
                      aria-required="true"
                    >
                      <option value="">-- Select --</option>
                      <option value="M">Male</option>
                      <option value="F">Female</option>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="dateOfBirth" required>
                      <Calendar className="h-4 w-4 inline mr-1" aria-hidden="true" />
                      Date of Birth
                    </Label>
                    <Input
                      id="dateOfBirth"
                      ref={dobRef}
                      type="date"
                      name="dateOfBirth"
                      value={formData.dateOfBirth}
                      onChange={handleChange}
                      // Closes #48 — some browsers (Chromium on Android in
                      // particular) fire `input` on date-picker interactions
                      // but the synthetic `change` event can be missed when
                      // the input is re-rendered mid-pick. Mirror to onInput
                      // so the state is always updated.
                      onInput={handleChange}
                      required
                      aria-required="true"
                      autoComplete="bday"
                    />
                    {/* Real-time age-band preview. Shows which age band the
                        competitor would land in based on DOB + belt (which
                        picks CB vs BB grouping). Computed client-side from
                        the same DEFAULT_AGE_GROUPS the server uses, so the
                        preview matches the eventual division exactly. */}
                    {formData.dateOfBirth && ageBandPreview && (
                      <p
                        className="text-xs text-indigo-700 dark:text-indigo-300 mt-1.5 font-medium"
                        role="status"
                        aria-live="polite"
                      >
                        Will compete in: <span className="font-semibold">{ageBandPreview.label}</span>
                        {ageBandPreview.tier && (
                          <> · {ageBandPreview.tier}</>
                        )}
                        {formData.competeWithOlder && (
                          <span className="text-amber-700 dark:text-amber-400">
                            {' '}· eligible to compete up to {ageBandPreview.nextBandLabel}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Belt Information */}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                  <Award className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" aria-hidden="true" />
                  Belt Rank
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="belt" required>Belt Level</Label>
                    <Select
                      id="belt"
                      ref={beltRef}
                      name="belt"
                      value={formData.belt}
                      onChange={handleChange}
                      required
                      aria-required="true"
                    >
                      <option value="">-- Select Belt --</option>
                      {beltOptions.map((belt) => (
                        <option key={belt} value={belt}>
                          {belt}
                        </option>
                      ))}
                    </Select>
                  </div>

                  {formData.belt === topLevelBeltName && sportProfile.beltConfig.hasDanRank && (
                    <div>
                      <Label htmlFor="danRank" required>Dan Rank</Label>
                      <Select
                        id="danRank"
                        ref={danRankRef}
                        name="danRank"
                        value={formData.danRank}
                        onChange={handleChange}
                        required
                        aria-required="true"
                      >
                        {[1, 2, 3, 4, 5, 6].map((dan) => (
                          <option key={dan} value={dan}>
                            {dan}
                            {dan === 1 ? 'st' : dan === 2 ? 'nd' : dan === 3 ? 'rd' : 'th'} Dan
                          </option>
                        ))}
                      </Select>
                    </div>
                  )}

                  <div>
                    <Label htmlFor="schoolDojang">School / Dojang</Label>
                    <Input
                      id="schoolDojang"
                      ref={schoolRef}
                      type="text"
                      name="schoolDojang"
                      value={formData.schoolDojang}
                      onChange={handleChange}
                      placeholder="e.g., Downtown Martial Arts Academy"
                      autoComplete="organization"
                    />
                  </div>
                </div>
              </div>

              {/* Physical Info */}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  Physical Information
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="heightInches">Height (inches)</Label>
                    <Input
                      id="heightInches"
                      ref={heightRef}
                      type="number"
                      name="heightInches"
                      value={formData.heightInches}
                      onChange={handleChange}
                      placeholder="e.g., 60"
                      min={30}
                      max={84}
                      inputMode="numeric"
                    />
                  </div>

                  <div>
                    <Label htmlFor="weightLbs" required={formData.sparring}>
                      Weight (lbs) {formData.sparring && '*'}
                    </Label>
                    <Input
                      id="weightLbs"
                      ref={weightRef}
                      type="number"
                      name="weightLbs"
                      value={formData.weightLbs}
                      onChange={handleChange}
                      placeholder="e.g., 100"
                      min={30}
                      max={400}
                      required={formData.sparring}
                      aria-required={formData.sparring}
                      aria-describedby="weightLbs-help"
                      inputMode="numeric"
                    />
                    {formData.sparring && (
                      <p id="weightLbs-help" className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                        Required for {eventType1?.name ?? 'combat'} events
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-4">
                  <Label htmlFor="specialNeeds">Special Needs / Medical Notes</Label>
                  <Textarea
                    id="specialNeeds"
                    ref={specialNeedsRef}
                    name="specialNeeds"
                    value={formData.specialNeeds}
                    onChange={handleChange}
                    rows={2}
                    placeholder="Any accommodations or medical information we should know"
                  />
                </div>

                {/* v2: Compete with older */}
                <div className="mt-4 flex items-start gap-2 p-2 -ml-2 rounded hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                  <input
                    type="checkbox"
                    name="competeWithOlder"
                    id="competeWithOlder"
                    checked={formData.competeWithOlder}
                    onChange={handleChange}
                    className="mt-1 h-5 w-5 min-w-[20px] min-h-[20px] rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <Label htmlFor="competeWithOlder" className="text-sm text-gray-700 dark:text-gray-300 mb-0">
                    <span className="font-medium">Compete in older age band</span>
                    <span id="competeWithOlder-desc" className="block text-xs text-gray-600">
                      Check this if your child is near the top of their age band and you'd like them considered for the next age group up (subject to the tournament's age-flex rules).
                    </span>
                  </Label>
                </div>
              </div>

              {/* Event Selection */}
              <fieldset className="border-t border-gray-200 dark:border-gray-700 pt-6">
                <legend className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                  Event Selection <span className="text-red-500" aria-hidden="true">*</span>
                </legend>
                <p id="event-selection-help" className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Select at least one event to compete in
                </p>

                <div
                  className="space-y-3"
                  role="group"
                  aria-describedby="event-selection-help"
                  aria-label="Event selection"
                >
                  {eventType0 && (
                    <label className="flex items-center p-4 border border-gray-200 dark:border-gray-700 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                      <input
                        type="checkbox"
                        name="patterns"
                        checked={formData.patterns}
                        onChange={handleChange}
                        className="h-5 w-5 text-primary-600 rounded"
                        aria-describedby="event-patterns-desc"
                      />
                      <div className="ml-3">
                        <span className="font-medium text-gray-900 dark:text-white">{eventType0.name}</span>
                        <p id="event-patterns-desc" className="text-sm text-gray-600 dark:text-gray-400">
                          {eventType0.description}
                        </p>
                      </div>
                    </label>
                  )}

                  {eventType1 && (
                    <label className="flex items-center p-4 border border-gray-200 dark:border-gray-700 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                      <input
                        type="checkbox"
                        name="sparring"
                        checked={formData.sparring}
                        onChange={handleChange}
                        className="h-5 w-5 text-primary-600 rounded"
                        aria-describedby="event-sparring-desc"
                      />
                      <div className="ml-3">
                        <span className="font-medium text-gray-900 dark:text-white">
                          {eventType1.name}
                          {eventType1.hasWeightClasses && ' (requires weight)'}
                        </span>
                        <p id="event-sparring-desc" className="text-sm text-gray-600 dark:text-gray-400">
                          {eventType1.description}
                        </p>
                      </div>
                    </label>
                  )}
                </div>
              </fieldset>

              {/* Step 1 → Step 2 navigation */}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-6 flex flex-col sm:flex-row justify-end gap-3">
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => {
                    // We use noValidate on the form, so the browser doesn't show
                    // its own error popups. We do the same job ourselves: find
                    // the first invalid field in Step 1, surface a friendly
                    // error in our role="alert" region, and focus the field.
                    if (!formRef.current) return;
                    const form = formRef.current;
                    const invalid = form.querySelector<HTMLElement>(':invalid');
                    if (invalid) {
                      setError('Please fill in all required fields before continuing.');
                      setValidationErrors([]);
                      invalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      // Cast to focusable element (input/select/textarea/button).
                      (invalid as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).focus();
                      queueMicrotask(() => focusErrorRegion());
                      return;
                    }
                    setStep(2);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="w-full sm:w-auto flex items-center justify-center"
                >
                  Next: Parent & Consent →
                </Button>
              </div>
              </>)}

              {step === 2 && (<>
              {/* Parent/Guardian Info */}
              <fieldset className="border-t border-gray-200 dark:border-gray-700 pt-6">
                <legend className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  {isMinor ? 'Parent/Guardian Contact (Required for minors)' : 'Parent/Guardian Contact (Optional)'}
                </legend>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="parentName" required={isMinor}>Parent/Guardian Name</Label>
                    <Input
                      id="parentName"
                      ref={parentNameRef}
                      type="text"
                      name="parentName"
                      value={formData.parentName}
                      onChange={handleChange}
                      required={isMinor}
                      aria-required={isMinor}
                      autoComplete="name"
                    />
                  </div>

                  <div>
                    <Label htmlFor="parentEmail" required={isMinor}>Email</Label>
                    <Input
                      id="parentEmail"
                      ref={parentEmailRef}
                      type="email"
                      name="parentEmail"
                      value={formData.parentEmail}
                      onChange={handleChange}
                      required={isMinor}
                      aria-required={isMinor}
                      autoComplete="email"
                    />
                  </div>

                  <div>
                    <Label htmlFor="parentPhone">Phone</Label>
                    <Input
                      id="parentPhone"
                      ref={parentPhoneRef}
                      type="tel"
                      name="parentPhone"
                      value={formData.parentPhone}
                      onChange={handleChange}
                      inputMode="tel"
                      autoComplete="tel"
                    />
                  </div>
                </div>
              </fieldset>

              {/* Submit Button */}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-6 flex flex-col sm:flex-row gap-3 sm:justify-between sm:items-center">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => { setStep(1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  className="w-full sm:w-auto flex items-center justify-center"
                >
                  ← Back to Athlete
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  loading={submitting}
                  className="text-lg w-full sm:w-auto flex items-center justify-center"
                >
                  {submitting ? 'Submitting...' : 'Complete Registration'}
                </Button>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 text-center mt-3">
                By registering, you agree to follow all tournament rules and regulations.
              </p>
              </>)}
            </form>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
