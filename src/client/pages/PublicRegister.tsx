import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
import { fetchJson, getApiFailure } from '../utils/api-status';
import {
  parseRegistrationLegalConfig,
  parseRegistrationResult,
  RegistrationConfirmationError,
  type RegistrationLegalConfig,
  type RegistrationResult,
} from '../utils/registration-contract';

interface Tournament {
  id: string;
  name: string;
  date: string;
  location: string | null;
  sportProfileSlug: string | null;
  // JSON-stringified settings blob from the Tournament model. The public
  // route returns the raw `settings` column; we only read the fee fields
  // (F9) and ignore the rest (most are director-only).
  settings?: string | null;
  // Organizer branding
  brandName?: string | null;
  brandPrimaryColor?: string | null;
  brandLogoUrl?: string | null;
  _count: { registrations: number };
  // Capacity status (#191)
  capacityStatus?: {
    maxCapacity: number | null;
    waitlistEnabled: boolean;
    activeCount: number;
    waitlistCount: number;
    spotsRemaining: number | null;
    isFull: boolean;
  } | null;
}

interface TournamentSettings {
  tournamentFeeCents?: number;
  feeNotes?: string;
  [key: string]: unknown;
}

function parseTournamentSettings(raw: string | null | undefined): TournamentSettings {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as TournamentSettings) : {};
  } catch {
    return {};
  }
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
  const portalPath = searchParams.get('portal'); // Format: "orgSlug/eventSlug"
  
  // P2-2: Handle payment success/cancel redirects
  const paymentStatus = searchParams.get('payment');
  const registrationIdFromPayment = searchParams.get('registration');

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [legalConfig, setLegalConfig] = useState<RegistrationLegalConfig | null>(null);
  const [confirmationUncertain, setConfirmationUncertain] = useState(false);
  
  // Portal context: when coming from /events/:orgSlug/:eventSlug, we have the portal path
  const [portalOrgSlug, portalEventSlug] = portalPath ? portalPath.split('/') : [null, null];

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
    privacyAccepted: false,
    rulesAccepted: false,
    guardianAttested: false,
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

  // F9: fee info for the currently-selected tournament. We reuse the
  // existing `selectedTournament` (declared at line ~138) and just
  // parse its settings blob for the structured fee fields.
  const selectedTournamentSettings = useMemo(
    () => parseTournamentSettings(selectedTournament?.settings),
    [selectedTournament]
  );
  const selectedTournamentFeeCents = selectedTournamentSettings.tournamentFeeCents ?? 0;
  const selectedTournamentFeeNotes = selectedTournamentSettings.feeNotes ?? '';

  const loadRegistrationConfig = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    
    // Portal mode: fetch event from portal API
    if (portalOrgSlug && portalEventSlug) {
      const [eventResult, legalResult] = await Promise.allSettled([
        fetchJson<{ event: { id: string; name: string; date: string; location: string | null; status: string; registrationFee: string | null; tournamentFeeCents?: number | null; brandName?: string; brandPrimaryColor?: string; brandLogoUrl?: string | null; sportProfileSlug?: string | null; } }>(
          fetch,
          `/api/public/portal/${portalOrgSlug}/${portalEventSlug}`
        ).then((data) => {
          if (!data.event) throw new Error('Invalid event response');
          // Convert portal event to Tournament format
          return [{
            id: data.event.id,
            name: data.event.name,
            date: data.event.date,
            location: data.event.location,
            sportProfileSlug: data.event.sportProfileSlug || 'taekwondo',
            settings: JSON.stringify({
              registrationFee: data.event.registrationFee || undefined,
              tournamentFeeCents: data.event.tournamentFeeCents || undefined,
            }),
            brandName: data.event.brandName,
            brandPrimaryColor: data.event.brandPrimaryColor,
            brandLogoUrl: data.event.brandLogoUrl,
            _count: { registrations: 0 },
          }] as Tournament[];
        }),
        fetchJson<unknown>(fetch, '/api/public/legal-config').then(parseRegistrationLegalConfig),
      ]);

      if (eventResult.status === 'rejected') {
        const failure = getApiFailure(eventResult.reason);
        setLoadError(failure?.kind === 'rate_limited' && failure.retryAfterSeconds
          ? `Event details are temporarily unavailable. Try again in ${failure.retryAfterSeconds} seconds.`
          : 'Event not found or unavailable. Please check your link and try again.');
        setLoading(false);
        return;
      }
      if (legalResult.status === 'rejected') {
        const failure = getApiFailure(legalResult.reason);
        setLoadError(failure?.kind === 'rate_limited' && failure.retryAfterSeconds
          ? `Required registration terms are temporarily unavailable. Try again in ${failure.retryAfterSeconds} seconds.`
          : 'Required registration terms are temporarily unavailable. Please try again.');
        setLoading(false);
        return;
      }

      const data = eventResult.value;
      setTournaments(data);
      setLegalConfig(legalResult.value);
      // Auto-select the portal event
      setFormData((prev) => ({ ...prev, tournamentId: data[0].id }));
      setLoading(false);
      return;
    }

    // Legacy mode: fetch all open tournaments
    const [tournamentResult, legalResult] = await Promise.allSettled([
      fetchJson<Tournament[]>(fetch, '/api/public/tournaments').then((data) => {
        if (!Array.isArray(data)) throw new Error('Invalid tournament response');
        return data;
      }),
      fetchJson<unknown>(fetch, '/api/public/legal-config').then(parseRegistrationLegalConfig),
    ]);

    if (tournamentResult.status === 'rejected') {
      const failure = getApiFailure(tournamentResult.reason);
      setLoadError(failure?.kind === 'rate_limited' && failure.retryAfterSeconds
        ? `Tournament list is temporarily unavailable. Try again in ${failure.retryAfterSeconds} seconds.`
        : 'Tournament list is temporarily unavailable. Please try again.');
      setLoading(false);
      return;
    }
    if (legalResult.status === 'rejected') {
      const failure = getApiFailure(legalResult.reason);
      setLoadError(failure?.kind === 'rate_limited' && failure.retryAfterSeconds
        ? `Required registration terms are temporarily unavailable. Try again in ${failure.retryAfterSeconds} seconds.`
        : 'Required registration terms are temporarily unavailable. Please try again.');
      setLoading(false);
      return;
    }

    const data = tournamentResult.value;
    setTournaments(data);
    setLegalConfig(legalResult.value);
    if (data.length === 1) {
      setFormData((prev) => prev.tournamentId ? prev : { ...prev, tournamentId: data[0].id });
    }
    setLoading(false);
  }, [portalOrgSlug, portalEventSlug]);

  useEffect(() => {
    void loadRegistrationConfig();
  }, [loadRegistrationConfig]);

  // P2-2: Handle payment return flow
  useEffect(() => {
    if (paymentStatus === 'success' && registrationIdFromPayment) {
      // Payment succeeded; show success message
      // We can't fetch the full registration details without the management
      // token, so show a generic success screen
      setResult({
        success: true,
        message: 'Payment complete! Your registration is confirmed.',
        registration: {
          id: registrationIdFromPayment,
          confirmationCode: registrationIdFromPayment.slice(0, 8),
          managementToken: '',
          competitorName: '',
          tournamentName: '',
          tournamentDate: new Date().toISOString(),
          events: { patterns: false, sparring: false },
          ageGroup: '',
          paymentStatus: 'paid',
        },
      });
      setRegisteredCount((c) => c + 1);
      
      // Clear query params so back button doesn't re-trigger
      window.history.replaceState({}, '', '/register');
    } else if (paymentStatus === 'cancelled' && registrationIdFromPayment) {
      // Payment cancelled; show error
      setError('Payment was cancelled. Your registration is pending payment. Please contact the tournament organizer if you need assistance.');
      
      // Clear query params
      window.history.replaceState({}, '', '/register');
    }
  }, [paymentStatus, registrationIdFromPayment]);

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
    if (confirmationUncertain) {
      queueMicrotask(() => focusErrorRegion());
      return;
    }
    setError(null);
    setValidationErrors([]);
    setSubmitting(true);

    if (!legalConfig) {
      setError('Registration legal documents are unavailable. Please contact the tournament organizer.');
      setSubmitting(false);
      queueMicrotask(() => focusErrorRegion());
      return;
    }

    // Client-side validation: parent contact required for minors
    if (isMinor) {
      const clientErrors: string[] = [];
      if (!formData.parentName.trim()) clientErrors.push('Parent/Guardian name is required for competitors under 18');
      if (!formData.parentEmail.trim()) clientErrors.push('Parent/Guardian email is required for competitors under 18');
      if (!formData.guardianAttested) clientErrors.push('A parent or guardian must confirm their authority to register this minor');
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

    if (!formData.privacyAccepted || !formData.rulesAccepted) {
      setValidationErrors(['You must accept the privacy notice and tournament terms to register.']);
      setSubmitting(false);
      queueMicrotask(() => focusErrorRegion());
      return;
    }

    try {
      // Portal mode: use portal-scoped registration API
      const apiUrl = (portalOrgSlug && portalEventSlug)
        ? `/api/public/portal/${portalOrgSlug}/${portalEventSlug}/register`
        : '/api/public/register';
      
      const data = await fetchJson<unknown>(fetch, apiUrl, {
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

      const parsedResult = parseRegistrationResult(data);
      
      // P2-2: If checkoutUrl is present, redirect to Stripe immediately
      if (parsedResult.checkoutUrl) {
        window.location.href = parsedResult.checkoutUrl;
        return;
      }

      setResult(parsedResult);
      // Increment on success so the success screen can show the
      // running count and offer a fast re-entry path.
      setRegisteredCount((c) => c + 1);
    } catch (caught) {
      const failure = getApiFailure(caught);
      if (caught instanceof RegistrationConfirmationError) {
        setConfirmationUncertain(true);
        setError('Registration confirmation could not be verified. The registration may have succeeded. Do not submit again; check registration status first.');
        queueMicrotask(() => focusErrorRegion());
      } else if (failure?.kind === 'validation' && failure.details?.length) {
        setValidationErrors(failure.details);
        queueMicrotask(() => {
          const target = focusFieldByErrorMessage(failure.details ?? []) ?? errorRef.current;
          target?.focus();
        });
      } else {
        const message = failure?.kind === 'rate_limited'
          ? `Registration is temporarily busy. Try again${failure.retryAfterSeconds ? ` in ${failure.retryAfterSeconds} seconds` : ' shortly'}.`
          : failure?.kind === 'conflict'
            ? 'A registration may already exist for this competitor. Check the existing registration before submitting again.'
            : failure?.kind === 'unavailable'
              ? 'Registration service is temporarily unavailable. Your information is still here; please try again.'
              : caught instanceof Error
                ? caught.message
                : 'Registration failed. Please try again.';
        setError(message);
        queueMicrotask(() => focusErrorRegion());
      }
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
      <div className="min-h-screen bg-surface-50 dark:bg-surface-900 flex items-center justify-center">
        <div className="flex items-center text-surface-600 dark:text-surface-400">
          <Spinner className="mr-2" />
          Loading tournaments...
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-surface-50 dark:bg-surface-900 py-12 px-4">
        <div className="max-w-md mx-auto text-center">
          <div role="alert" className="bg-danger/50 dark:bg-danger/900/20 border border-danger200 dark:border-danger800 rounded-lg p-5 mb-4 text-danger700 dark:text-danger300">
            {loadError}
          </div>
          <Button variant="primary" onClick={() => void loadRegistrationConfig()}>Retry</Button>
        </div>
      </div>
    );
  }

  if (result) {
    return (
      <div className="min-h-screen bg-surface-50 dark:bg-surface-900 py-12 px-4">
        <div className="max-w-md mx-auto">
          <Card>
            <CardBody className="p-8 text-center">
              <CheckCircle className="h-16 w-16 text-success500 dark:text-success400 mx-auto mb-4" />
              <h1 className="text-2xl font-bold text-surface-900 dark:text-white mb-2">Registration Complete!</h1>
              <p className="text-surface-600 dark:text-surface-400 mb-6">{result.message}</p>

              {result.registration.confirmationCode && (
                <div className="bg-primary-50 dark:bg-primary-900/30 border border-primary-200 dark:border-primary-700 rounded-lg p-5 mb-6">
                  <p className="text-xs font-medium uppercase tracking-wider text-primary-700 dark:text-primary-300 mb-2">
                    Your confirmation code
                  </p>
                  <div className="flex items-center justify-between gap-3">
                    <code
                      data-testid="confirmation-code"
                      className="text-2xl font-mono font-bold text-primary-900 dark:text-primary-100 tracking-widest select-all"
                    >
                      {result.registration.confirmationCode}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(result.registration.confirmationCode || '');
                      }}
                      aria-label="Copy confirmation code"
                      className="text-xs px-3 py-1.5 rounded-md bg-primary-600 hover:bg-primary-700 text-white font-medium"
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      onClick={() => window.print()}
                      aria-label="Print registration confirmation"
                      className="text-xs px-3 py-1.5 rounded-md border border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/30 font-medium"
                    >
                      <Printer className="inline h-3 w-3 mr-1" aria-hidden="true" />
                      Print
                    </button>
                  </div>
                  <p className="text-xs text-primary-700 dark:text-primary-300 mt-3">
                    Save this — you'll need it at check-in. Lost it?{' '}
                    <a href="/check-registration" className="underline hover:no-underline">
                      Look up your registration
                    </a>
                    {' '}·{' '}
                    <a
                      href={`/manage-registration?token=${encodeURIComponent(result.registration.managementToken || '')}`}
                      className="underline hover:no-underline"
                    >
                      Edit or withdraw
                    </a>
                  </p>
                </div>
              )}

              <div className="bg-surface-50 dark:bg-surface-700/50 rounded-lg p-4 text-left mb-6">
                <h3 className="font-semibold text-surface-900 dark:text-white mb-3">Registration Details</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-surface-600 dark:text-surface-400">Competitor:</span>
                    <span className="font-medium text-surface-900 dark:text-white">{result.registration.competitorName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-surface-600 dark:text-surface-400">Tournament:</span>
                    <span className="font-medium text-surface-900 dark:text-white">{result.registration.tournamentName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-surface-600 dark:text-surface-400">Date:</span>
                    <span className="font-medium text-surface-900 dark:text-white">
                      {new Date(result.registration.tournamentDate).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-surface-600 dark:text-surface-400">Age Group:</span>
                    <span className="font-medium text-surface-900 dark:text-white">{result.registration.ageGroup}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-surface-600 dark:text-surface-400">Events:</span>
                    <span className="font-medium text-surface-900 dark:text-white">
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
                <p className="text-sm text-primary-700 dark:text-primary-300 mb-4 font-medium">
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
                      belt: '',
                      danRank: 1,
                      heightInches: '',
                      weightLbs: '',
                      schoolDojang: '',
                      specialNeeds: '',
                      patterns: false,
                      sparring: false,
                      competeWithOlder: false,
                      privacyAccepted: false,
                      rulesAccepted: false,
                      guardianAttested: false,
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
                      privacyAccepted: false,
                      rulesAccepted: false,
                      guardianAttested: false,
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
      <main className="min-h-screen bg-surface-50 dark:bg-surface-900 py-12 px-4">
        <div className="max-w-md mx-auto text-center">
          <Trophy aria-hidden="true" className="h-16 w-16 text-surface-600 dark:text-surface-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white mb-2">No Open Tournaments</h1>
          <p className="text-surface-600 dark:text-surface-400">
            There are currently no tournaments open for registration. Please check back later.
          </p>
          <Button as={Link} to="/" variant="secondary" className="mt-6">
            Return to home
          </Button>
        </div>
      </main>
    );
  }

  // Compute effective branding from selected tournament (already defined via useMemo above)
  const brandColor = selectedTournament?.brandPrimaryColor || '#DC2626';
  const brandName = selectedTournament?.brandName || selectedTournament?.name || 'Tournament Registration';
  const brandLogoUrl = selectedTournament?.brandLogoUrl;

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-900 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          {brandLogoUrl ? (
            <img src={brandLogoUrl} alt={`${brandName} logo`} className="h-16 w-auto mx-auto mb-3" />
          ) : (
            <Trophy className="h-12 w-12 mx-auto mb-3" style={{ color: brandColor }} />
          )}
          <h1 className="text-3xl font-bold text-surface-900 dark:text-white">{brandName}</h1>
          <p className="text-surface-600 dark:text-surface-400 mt-2">
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
                <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-warning/50 dark:bg-warning/900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-warning800 dark:text-warning200 text-sm font-medium">
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
            className="bg-danger/50 dark:bg-danger/900/20 border border-danger200 dark:border-danger800 rounded-lg p-4 mb-6"
          >
            <div className="flex items-start">
              <AlertCircle className="h-5 w-5 text-danger500 dark:text-danger400 mt-0.5 mr-2" aria-hidden="true" />
              <div>
                {error && <p className="text-danger700 dark:text-danger300 font-medium">{error}</p>}
                {confirmationUncertain && (
                  <a href="/check-registration" className="mt-2 inline-block font-medium text-danger800 underline dark:text-danger200">
                    Check registration status
                  </a>
                )}
                {validationErrors.length > 0 && (
                  <ul className="text-danger700 dark:text-danger300 text-sm list-disc list-inside">
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
              <div className="flex items-center gap-2 mb-2">
                <div className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-semibold flex-shrink-0 ${step >= 1 ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300' : 'bg-surface-100 text-surface-700'}`}>
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-600 text-white text-[10px]">1</span>
                  <span>Athlete</span>
                </div>
                <div className={`h-px flex-1 min-w-[1rem] ${step >= 2 ? 'bg-primary-400' : 'bg-surface-200 dark:bg-surface-700'}`} />
                <div className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-semibold flex-shrink-0 ${step >= 2 ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300' : 'bg-surface-100 text-surface-700'}`}>
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${step >= 2 ? 'bg-primary-600 text-white' : 'bg-surface-300 text-surface-600'}`}>2</span>
                  {/* Show "Parent" on small screens, "Parent & Consent" on
                      sm+ — both labels fit in the pill without truncating. */}
                  <span>
                    <span className="sm:hidden">Parent</span>
                    <span className="hidden sm:inline">Parent &amp; Consent</span>
                  </span>
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
                  {tournaments.map((t) => {
                    const tSettings = parseTournamentSettings(t.settings);
                    const feeCents = tSettings.tournamentFeeCents ?? 0;
                    return (
                      <option key={t.id} value={t.id}>
                        {t.name} - {new Date(t.date).toLocaleDateString()}
                        {t.location && ` (${t.location})`}
                        {feeCents > 0 ? ` — $${(feeCents / 100).toFixed(2)}` : ''}
                      </option>
                    );
                  })}
                </Select>
                {/* F9: fee notice for the selected tournament. Hidden until a
                    tournament is picked so we don't display a "0" placeholder
                    before the parent has chosen. The notes line is only
                    rendered if the director actually wrote a note. */}
                {selectedTournament && selectedTournamentFeeCents > 0 && (
                  <div
                    data-testid="tournament-fee-notice"
                    className="mt-2 flex items-start gap-2 rounded-md border border-amber-200 bg-warning/50 dark:border-amber-700 dark:bg-warning/900/30 p-3 text-sm text-warning900 dark:text-warning200"
                    role="note"
                  >
                    <CreditCard className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
                    <div>
                      <div className="font-semibold">
                        Tournament fee: ${(selectedTournamentFeeCents / 100).toFixed(2)}
                      </div>
                      {selectedTournamentFeeNotes && (
                        <div className="mt-0.5 text-xs">{selectedTournamentFeeNotes}</div>
                      )}
                    </div>
                  </div>
                )}
                {/* #191: Capacity status messaging (spots left / waitlist / closed) */}
                {selectedTournament?.capacityStatus && selectedTournament.capacityStatus.maxCapacity && (
                  <div
                    data-testid="capacity-status"
                    className={`mt-2 flex items-start gap-2 rounded-md border p-3 text-sm ${
                      selectedTournament.capacityStatus.isFull
                        ? selectedTournament.capacityStatus.waitlistEnabled
                          ? 'border-warning-200 bg-warning/50 dark:border-warning-700 dark:bg-warning/900/30 text-warning-900 dark:text-warning-200'
                          : 'border-danger-200 bg-danger/50 dark:border-danger-700 dark:bg-danger/900/30 text-danger-900 dark:text-danger-200'
                        : selectedTournament.capacityStatus.spotsRemaining !== null && selectedTournament.capacityStatus.spotsRemaining <= 10
                        ? 'border-warning-200 bg-warning/50 dark:border-warning-700 dark:bg-warning/900/30 text-warning-900 dark:text-warning-200'
                        : 'border-info-200 bg-info/50 dark:border-info-700 dark:bg-info/900/30 text-info-900 dark:text-info-200'
                    }`}
                    role="status"
                  >
                    <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
                    <div>
                      {selectedTournament.capacityStatus.isFull ? (
                        selectedTournament.capacityStatus.waitlistEnabled ? (
                          <>
                            <div className="font-semibold">Tournament at capacity</div>
                            <div className="mt-0.5 text-xs">
                              New registrations will be added to the waitlist ({selectedTournament.capacityStatus.waitlistCount} currently waitlisted).
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="font-semibold">Registration closed</div>
                            <div className="mt-0.5 text-xs">
                              This tournament has reached its maximum capacity ({selectedTournament.capacityStatus.maxCapacity} competitors).
                            </div>
                          </>
                        )
                      ) : selectedTournament.capacityStatus.spotsRemaining !== null && selectedTournament.capacityStatus.spotsRemaining <= 10 ? (
                        <>
                          <div className="font-semibold">
                            {selectedTournament.capacityStatus.spotsRemaining} {selectedTournament.capacityStatus.spotsRemaining === 1 ? 'spot' : 'spots'} remaining
                          </div>
                          <div className="mt-0.5 text-xs">
                            Register soon — capacity: {selectedTournament.capacityStatus.activeCount}/{selectedTournament.capacityStatus.maxCapacity}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="font-semibold">Spots available</div>
                          <div className="mt-0.5 text-xs">
                            {selectedTournament.capacityStatus.activeCount}/{selectedTournament.capacityStatus.maxCapacity} registered
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Competitor Information */}
              <div className="border-t border-surface-200 dark:border-surface-700 pt-6">
                <h3 className="text-lg font-semibold text-surface-900 dark:text-white mb-4 flex items-center">
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
                      // so the state is always updated. Cast to InputEvent
                      // handler because the underlying DOM event is the same
                      // shape (target.value) and React's strict event-type
                      // discrimination rejects the cross-type assignment.
                      onInput={handleChange as unknown as React.FormEventHandler<HTMLInputElement>}
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
                        className="text-xs text-primary-700 dark:text-primary-300 mt-1.5 font-medium"
                        role="status"
                        aria-live="polite"
                      >
                        Will compete in: <span className="font-semibold">{ageBandPreview.label}</span>
                        {ageBandPreview.tier && (
                          <> · {ageBandPreview.tier}</>
                        )}
                        {formData.competeWithOlder && (
                          <span className="text-warning700 dark:text-warning400">
                            {' '}· eligible to compete up to {ageBandPreview.nextBandLabel}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Belt Information */}
              <div className="border-t border-surface-200 dark:border-surface-700 pt-6">
                <h3 className="text-lg font-semibold text-surface-900 dark:text-white mb-4 flex items-center">
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
              <div className="border-t border-surface-200 dark:border-surface-700 pt-6">
                <h3 className="text-lg font-semibold text-surface-900 dark:text-white mb-4">
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
                      <p id="weightLbs-help" className="text-xs text-surface-600 dark:text-surface-400 mt-1">
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
                <div className="mt-4 flex items-start gap-2 p-2 -ml-2 rounded hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors">
                  <input
                    type="checkbox"
                    name="competeWithOlder"
                    id="competeWithOlder"
                    checked={formData.competeWithOlder}
                    onChange={handleChange}
                    className="mt-1 h-5 w-5 min-w-[20px] min-h-[20px] rounded border-surface-300 text-info600 focus:ring-blue-500"
                  />
                  <Label htmlFor="competeWithOlder" className="text-sm text-surface-700 dark:text-surface-300 mb-0">
                    <span className="font-medium">Compete in older age band</span>
                    <span id="competeWithOlder-desc" className="block text-xs text-surface-600">
                      Check this if your child is near the top of their age band and you'd like them considered for the next age group up (subject to the tournament's age-flex rules).
                    </span>
                  </Label>
                </div>
              </div>

              {/* Event Selection */}
              <fieldset className="border-t border-surface-200 dark:border-surface-700 pt-6">
                <legend className="text-lg font-semibold text-surface-900 dark:text-white mb-1">
                  Event Selection <span className="text-danger500" aria-hidden="true">*</span>
                </legend>
                <p id="event-selection-help" className="text-sm text-surface-600 dark:text-surface-400 mb-4">
                  Select at least one event to compete in
                </p>

                <div
                  className="space-y-3"
                  role="group"
                  aria-describedby="event-selection-help"
                  aria-label="Event selection"
                >
                  {eventType0 && (
                    <label className="flex items-center p-4 border border-surface-200 dark:border-surface-700 rounded-lg cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-700/50 transition-colors">
                      <input
                        type="checkbox"
                        name="patterns"
                        checked={formData.patterns}
                        onChange={handleChange}
                        className="h-5 w-5 text-primary-600 rounded"
                        aria-describedby="event-patterns-desc"
                      />
                      <div className="ml-3">
                        <span className="font-medium text-surface-900 dark:text-white">{eventType0.name}</span>
                        <p id="event-patterns-desc" className="text-sm text-surface-600 dark:text-surface-400">
                          {eventType0.description}
                        </p>
                      </div>
                    </label>
                  )}

                  {eventType1 && (
                    <label className="flex items-center p-4 border border-surface-200 dark:border-surface-700 rounded-lg cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-700/50 transition-colors">
                      <input
                        type="checkbox"
                        name="sparring"
                        checked={formData.sparring}
                        onChange={handleChange}
                        className="h-5 w-5 text-primary-600 rounded"
                        aria-describedby="event-sparring-desc"
                      />
                      <div className="ml-3">
                        <span className="font-medium text-surface-900 dark:text-white">
                          {eventType1.name}
                          {eventType1.hasWeightClasses && ' (requires weight)'}
                        </span>
                        <p id="event-sparring-desc" className="text-sm text-surface-600 dark:text-surface-400">
                          {eventType1.description}
                        </p>
                      </div>
                    </label>
                  )}
                </div>
              </fieldset>

              {/* Step 1 → Step 2 navigation */}
              <div className="border-t border-surface-200 dark:border-surface-700 pt-6 flex flex-col sm:flex-row justify-end gap-3">
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
              <fieldset className="border-t border-surface-200 dark:border-surface-700 pt-6">
                <legend className="text-lg font-semibold text-surface-900 dark:text-white mb-4">
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

              <fieldset className="border-t border-surface-200 dark:border-surface-700 pt-6 space-y-4">
                <legend className="text-lg font-semibold text-surface-900 dark:text-white mb-2">
                  Notices and authorization
                </legend>
                <label className="flex items-start gap-3 text-sm text-surface-700 dark:text-surface-300">
                  <input
                    type="checkbox"
                    name="privacyAccepted"
                    checked={formData.privacyAccepted}
                    onChange={handleChange}
                    required
                    className="mt-0.5 h-5 w-5 min-w-[20px] rounded border-surface-300 text-info600 focus:ring-blue-500"
                  />
                  <span>
                    I have read and accept the{' '}
                    <a className="font-medium text-info700 underline dark:text-info300" href={legalConfig?.privacyNoticeUrl} target="_blank" rel="noopener noreferrer">
                      privacy notice
                    </a>.
                  </span>
                </label>
                <label className="flex items-start gap-3 text-sm text-surface-700 dark:text-surface-300">
                  <input
                    type="checkbox"
                    name="rulesAccepted"
                    checked={formData.rulesAccepted}
                    onChange={handleChange}
                    required
                    className="mt-0.5 h-5 w-5 min-w-[20px] rounded border-surface-300 text-info600 focus:ring-blue-500"
                  />
                  <span>
                    I accept the{' '}
                    <a className="font-medium text-info700 underline dark:text-info300" href={legalConfig?.tournamentTermsUrl} target="_blank" rel="noopener noreferrer">
                      tournament terms and rules
                    </a>.
                  </span>
                </label>
                {isMinor && (
                  <label className="flex items-start gap-3 text-sm text-surface-700 dark:text-surface-300">
                    <input
                      type="checkbox"
                      name="guardianAttested"
                      checked={formData.guardianAttested}
                      onChange={handleChange}
                      required
                      className="mt-0.5 h-5 w-5 min-w-[20px] rounded border-surface-300 text-info600 focus:ring-blue-500"
                    />
                    <span>I confirm that I am the competitor's parent/legal guardian or am otherwise authorized to register this minor.</span>
                  </label>
                )}
                <p className="text-xs text-surface-500 dark:text-surface-400">
                  Document version: {legalConfig?.consentVersion ?? 'unavailable'}
                </p>
              </fieldset>

              {/* Submit Button */}
              <div className="border-t border-surface-200 dark:border-surface-700 pt-6 flex flex-col sm:flex-row gap-3 sm:justify-between sm:items-center">
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
                  disabled={confirmationUncertain}
                  className="text-lg w-full sm:w-auto flex items-center justify-center"
                >
                  {submitting ? 'Submitting...' : 'Complete Registration'}
                </Button>
              </div>
              </>)}
            </form>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
