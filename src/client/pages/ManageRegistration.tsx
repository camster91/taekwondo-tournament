// Parent-facing "Manage Registration" page. The parent enters their
// private high-entropy link, then sees
// their kid's full registration and can:
//   - fix a typo in the name or school
//   - change the belt rank
//   - toggle which events (patterns/sparring) they're entered in
//   - update weight / specialNeeds / competeWithOlder
//   - withdraw the registration entirely (kid is sick, etc.)
//
// This closes H1 from the UI audit — the #1 missing feature.
// Backend at /api/public/registrations/:code (GET/PATCH/DELETE).
import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Edit3,
  Trash2,
  Save,
  X,
  UserX,
  Calendar,
  MapPin,
  ShieldOff,
} from 'lucide-react';
import { Card, CardBody } from '../components/ui';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Label from '../components/ui/Label';
import Select from '../components/ui/Select';
import { classifyWithdrawalResponse } from '../utils/registration-withdrawal';
import { fetchJson, getApiFailure } from '../utils/api-status';
import {
  managedRegistrationMatchesUpdate,
  normalizeManagedRegistrationUpdate,
  parseManagedRegistrationResponse,
  type ManagedRegistration as ManageRegistration,
  type ManagedRegistrationUpdate,
} from '../utils/manage-registration-contract';

const TKD_BELT_OPTIONS = [
  'White', 'White / Single Yellow Stripe', 'White / Double Yellow Stripe',
  'Yellow', 'Yellow / Single Green Stripe', 'Yellow / Double Green Stripe',
  'Green', 'Green / Single Blue Stripe', 'Green / Double Blue Stripe',
  'Blue', 'Blue / Single Red Stripe', 'Blue / Double Red Stripe',
  'Red', 'Red / Single Black Stripe', 'Red / Double Black Stripe',
  'Brown', 'Brown / Single Black Stripe', 'Brown / Double Black Stripe',
  'Black',
];

export default function ManageRegistration() {
  const [searchParams] = useSearchParams();
  const managementToken = searchParams.get('token') || '';

  // Step 1: lookup form
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [registration, setRegistration] = useState<ManageRegistration | null>(null);

  // Step 2: edit form
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState<Partial<ManageRegistration>>({});
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [saveConfirmationPending, setSaveConfirmationPending] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<ManagedRegistrationUpdate | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawn, setWithdrawn] = useState(false);

  useEffect(() => {
    if (managementToken && !registration && !lookupLoading && !lookupError) {
      void lookupRegistration();
    }
  // Run once for the tokenized link; lookupRegistration updates these states.
  }, [managementToken]);

  const lookupRegistration = async () => {
    if (!managementToken) {
      setLookupError('This management link is missing its private token. Use the link from your confirmation screen or email.');
      return;
    }
    setLookupLoading(true);
    setLookupError(null);
    try {
      const data = parseManagedRegistrationResponse(await fetchJson<unknown>(fetch, `/api/public/registrations/${encodeURIComponent(managementToken)}`));
      setRegistration(data.registration);
      setForm(data.registration);
    } catch (err) {
      const failure = getApiFailure(err);
      if (failure?.kind === 'not_found') {
        setLookupError('This management link is invalid or has expired. Contact the tournament director for help.');
      } else if (failure?.kind === 'rate_limited') {
        setLookupError(failure.retryAfterSeconds ? `Too many attempts. Try again in ${failure.retryAfterSeconds} seconds.` : 'Too many attempts. Please try again shortly.');
      } else {
        setLookupError('Registration management is unavailable right now. Please try again.');
      }
    } finally {
      setLookupLoading(false);
    }
  };

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLookupError(null);
    setRegistration(null);
    setSavedAt(null);

    await lookupRegistration();
  };

  const handleSave = async () => {
    if (!registration) return;
    if (saveConfirmationPending) return;
    setGlobalError(null);
    setSavedAt(null);
    setSaving(true);
    let patchAcknowledged = false;
    const submitted = normalizeManagedRegistrationUpdate(form);
    try {
      const res = await fetch(
        `/api/public/registrations/${encodeURIComponent(managementToken)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(submitted),
        },
      );
      if (res.status === 404) {
        setGlobalError('Registration not found. The lookup data may be stale — start over.');
        setRegistration(null);
        return;
      }
      if (res.status === 409) {
        const body = await res.json().catch(() => ({ error: 'Conflict' }));
        setGlobalError(body.error || 'Cannot edit this registration.');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Save failed.' }));
        throw new Error(body.error || 'Save failed.');
      }
      patchAcknowledged = true;
      setSaveConfirmationPending(true);
      setPendingUpdate(submitted);
      // Re-fetch and validate the authoritative state before claiming save.
      const fresh = parseManagedRegistrationResponse(await fetchJson<unknown>(fetch,
        `/api/public/registrations/${encodeURIComponent(managementToken)}`,
      ));
      if (!managedRegistrationMatchesUpdate(fresh.registration, submitted)) {
        throw new Error('Registration changes are not confirmed yet');
      }
      setRegistration(fresh.registration);
      setForm(fresh.registration);
      setEditMode(false);
      setSavedAt(new Date());
      setSaveConfirmationPending(false);
      setPendingUpdate(null);
    } catch (err) {
      setGlobalError(patchAcknowledged
        ? err instanceof Error && err.message === 'Registration changes are not confirmed yet'
          ? 'Registration status loaded, but the submitted changes are not confirmed yet. Check status again before editing.'
          : 'Changes may have saved, but confirmation could not be loaded. Check status before editing or submitting again.'
        : err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const checkSavedRegistration = async () => {
    if (!pendingUpdate) return;
    setSaving(true);
    setGlobalError(null);
    try {
      const fresh = parseManagedRegistrationResponse(await fetchJson<unknown>(fetch,
        `/api/public/registrations/${encodeURIComponent(managementToken)}`,
      ));
      if (!managedRegistrationMatchesUpdate(fresh.registration, pendingUpdate)) {
        setGlobalError('Registration status loaded, but the submitted changes are not confirmed yet. Check status again before editing.');
        return;
      }
      setRegistration(fresh.registration);
      setForm(fresh.registration);
      setEditMode(false);
      setSaveConfirmationPending(false);
      setPendingUpdate(null);
      setSavedAt(new Date());
    } catch {
      setGlobalError('Changes may have saved, but confirmation could not be loaded. Check status again before editing or submitting.');
    } finally {
      setSaving(false);
    }
  };

  const handleWithdraw = async () => {
    if (!registration || saveConfirmationPending) return;
    if (!confirm(
      `Withdraw ${registration.firstName} from ${registration.tournamentName}? This permanently removes the registration. The director will need to regenerate brackets.`
    )) return;
    setGlobalError(null);
    setWithdrawing(true);
    try {
      const res = await fetch(
        `/api/public/registrations/${encodeURIComponent(managementToken)}`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
        },
      );
      const outcome = classifyWithdrawalResponse(res.status);
      if (outcome.outcome === 'unavailable') {
        setGlobalError(outcome.message);
        return;
      }
      if (outcome.outcome === 'conflict') {
        const body = await res.json().catch(() => ({ error: 'Conflict' }));
        setGlobalError(body.error || 'Cannot withdraw.');
        return;
      }
      if (outcome.outcome === 'failure') {
        const body = await res.json().catch(() => ({ error: 'Withdraw failed.' }));
        throw new Error(body.error || 'Withdraw failed.');
      }
      if (outcome.outcome === 'withdrawn') setWithdrawn(true);
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Withdraw failed.');
    } finally {
      setWithdrawing(false);
    }
  };

  const reset = () => {
    if (saveConfirmationPending) return;
    setRegistration(null);
    setEditMode(false);
    setForm({});
    setSavedAt(null);
    setGlobalError(null);
    setSaveConfirmationPending(false);
    setPendingUpdate(null);
    setLookupError(null);
    setWithdrawn(false);
  };

  // ── Render: withdrawn confirmation
  if (withdrawn) {
    return (
      <div className="min-h-screen bg-surface-50 dark:bg-surface-950 py-12 px-4">
        <div className="max-w-md mx-auto">
          <Card>
            <CardBody className="p-8 text-center">
              <ShieldOff className="h-16 w-16 text-warning mx-auto mb-4" aria-hidden="true" />
              <h1 className="text-2xl font-bold text-surface-900 dark:text-white mb-2">Registration withdrawn</h1>
              <p className="text-surface-600 dark:text-surface-400 mb-6">
                {registration?.firstName} has been removed from {registration?.tournamentName}. A confirmation email will follow.
              </p>
              <Button variant="primary" onClick={reset}>Look up another</Button>
            </CardBody>
          </Card>
        </div>
      </div>
    );
  }

  // ── Render: edit / view form (after lookup)
  if (registration) {
    const isLocked = registration.checkedIn || ['in_progress', 'completed'].includes(registration.tournamentStatus);
    return (
      <div className="min-h-screen bg-surface-50 dark:bg-surface-950 py-12 px-4">
        <div className="max-w-2xl mx-auto">
          <button
            type="button"
            onClick={reset}
            disabled={saveConfirmationPending}
            className="inline-flex items-center text-sm text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-white mb-4 disabled:opacity-50"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Look up another registration
          </button>

          {/* Tournament context */}
          <div className="mb-4 p-4 rounded-lg bg-primary-50 dark:bg-primary-900/30 border border-primary-200 dark:border-primary-700">
            <div className="flex items-center gap-2 text-primary-800 dark:text-primary-200">
              <Calendar className="h-4 w-4" />
              <span className="font-medium">{registration.tournamentName}</span>
              <span className="text-sm">·</span>
              <span className="text-sm">
                {new Date(registration.tournamentDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </span>
            </div>
            <div className="text-xs text-primary-700 dark:text-primary-300 mt-1">
              Confirmation code: <span className="font-mono font-bold">{registration.confirmationCode}</span>
              {registration.checkedIn && (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-success/10 text-success dark:bg-success/40 dark:text-success/30">
                  CHECKED IN
                </span>
              )}
            </div>
          </div>

          {isLocked && (
            <div
              role="alert"
              className="mb-4 p-3 rounded-md bg-warning/10 dark:bg-warning/20 border border-warning/30 dark:border-warning text-sm text-warning dark:text-warning/30 flex items-start gap-2"
            >
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <span>
                {registration.checkedIn
                  ? 'This registration is checked in — no edits can be made. Talk to the director at the venue if something needs to change.'
                  : 'The tournament has started. No edits or withdrawals are possible from here.'}
              </span>
            </div>
          )}

          {savedAt && (
            <div
              role="status"
              aria-live="polite"
              className="mb-4 p-3 rounded-md bg-success/10 dark:bg-success/20 border border-success/30 dark:border-success text-sm text-success dark:text-success/30 flex items-start gap-2"
            >
              <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <span>
                Saved at {savedAt.toLocaleTimeString()}. The director may need to regenerate brackets if you changed your belt or weight.
              </span>
            </div>
          )}

          {globalError && (
            <div
              role="alert"
              className="mb-4 p-3 rounded-md bg-danger/10 dark:bg-danger/20 border border-danger/30 dark:border-danger/50 text-sm text-danger dark:text-danger flex items-start gap-2"
            >
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <div>
                <span>{globalError}</span>
                {saveConfirmationPending && (
                  <Button type="button" variant="secondary" size="sm" className="mt-2" loading={saving} onClick={checkSavedRegistration}>
                    Check status
                  </Button>
                )}
              </div>
            </div>
          )}

          <Card>
            <CardBody className="p-6 space-y-4">
              <fieldset disabled={saveConfirmationPending} className="contents">
                <legend className="sr-only">Registration details</legend>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-surface-900 dark:text-white">
                  {registration.firstName} {registration.lastName}
                </h2>
                {!isLocked && (
                  <div className="flex gap-2">
                    {editMode ? (
                      <>
                        <Button variant="secondary" size="sm" onClick={() => { setEditMode(false); setForm(registration); }} disabled={saving}>
                          <X className="h-4 w-4 mr-1" /> Cancel
                        </Button>
                        <Button variant="primary" size="sm" onClick={handleSave} loading={saving} disabled={saveConfirmationPending}>
                          <Save className="h-4 w-4 mr-1" /> Save changes
                        </Button>
                      </>
                    ) : (
                      <Button variant="secondary" size="sm" onClick={() => setEditMode(true)}>
                        <Edit3 className="h-4 w-4 mr-1" /> Edit
                      </Button>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="m-firstName">First name</Label>
                  {editMode ? (
                    <Input id="m-firstName" value={form.firstName || ''} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
                  ) : (
                    <ReadonlyField value={registration.firstName} />
                  )}
                </div>
                <div>
                  <Label htmlFor="m-lastName">Last name</Label>
                  <ReadonlyField value={registration.lastName} />
                  <p className="text-xs text-surface-500 mt-1">Last name is locked for verification — can't be changed.</p>
                </div>
                <div>
                  <Label htmlFor="m-dob">Date of birth</Label>
                  <ReadonlyField value={new Date(registration.dateOfBirth).toLocaleDateString()} />
                  <p className="text-xs text-surface-500 mt-1">Locked for verification — can't be changed.</p>
                </div>
                <div>
                  <Label htmlFor="m-gender">Gender</Label>
                  {editMode ? (
                    <Select id="m-gender" value={form.gender || 'M'} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                      <option value="M">Male</option>
                      <option value="F">Female</option>
                      <option value="Other">Other</option>
                    </Select>
                  ) : (
                    <ReadonlyField value={registration.gender === 'M' ? 'Male' : registration.gender === 'F' ? 'Female' : registration.gender} />
                  )}
                </div>
                <div>
                  <Label htmlFor="m-belt">Belt rank</Label>
                  {editMode ? (
                    <Select id="m-belt" value={form.belt || ''} onChange={(e) => setForm({ ...form, belt: e.target.value })}>
                      {TKD_BELT_OPTIONS.map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </Select>
                  ) : (
                    <ReadonlyField value={registration.belt} />
                  )}
                </div>
                <div>
                  <Label htmlFor="m-weight">Weight (lbs)</Label>
                  {editMode ? (
                    <Input
                      id="m-weight"
                      type="number"
                      min={20}
                      max={400}
                      value={form.weight ?? ''}
                      onChange={(e) => setForm({ ...form, weight: e.target.value === '' ? null : parseFloat(e.target.value) })}
                    />
                  ) : (
                    <ReadonlyField value={registration.weight != null ? `${registration.weight} lbs` : 'Not recorded'} />
                  )}
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="m-school">School / Dojang</Label>
                  {editMode ? (
                    <Input id="m-school" value={form.school || ''} onChange={(e) => setForm({ ...form, school: e.target.value })} />
                  ) : (
                    <ReadonlyField value={registration.school || 'Independent'} />
                  )}
                </div>
                <div className="sm:col-span-2">
                  <Label className="mb-2">Events</Label>
                  <div className="flex gap-4">
                    {['patterns', 'sparring'].map((evt) => (
                      <label key={evt} className="flex items-center gap-2 text-sm text-surface-700 dark:text-surface-300">
                        <input
                          type="checkbox"
                          checked={!!form[evt as keyof ManageRegistration]}
                          disabled={!editMode}
                          onChange={(e) => setForm({ ...form, [evt]: e.target.checked })}
                          className="h-4 w-4 rounded border-surface-300 text-primary-600 focus:ring-primary-500"
                        />
                        <span className="capitalize">{evt}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <label className="flex items-start gap-2 text-sm text-surface-700 dark:text-surface-300 mt-2">
                    <input
                      type="checkbox"
                      checked={!!form.competeWithOlder}
                      disabled={!editMode}
                      onChange={(e) => setForm({ ...form, competeWithOlder: e.target.checked })}
                      className="mt-1 h-4 w-4 rounded border-surface-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span>
                      <span className="font-medium">Compete in older age band</span>
                      <span className="block text-xs text-surface-500">
                        Subject to the tournament's age-flex rules.
                      </span>
                    </span>
                  </label>
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="m-sn">Special considerations / accommodations</Label>
                  {editMode ? (
                    <textarea
                      id="m-sn"
                      value={form.specialNeeds || ''}
                      onChange={(e) => setForm({ ...form, specialNeeds: e.target.value })}
                      rows={3}
                      placeholder="Any accommodations or medical info the director should know."
                      className="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-950 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
                    />
                  ) : (
                    <ReadonlyField value={registration.specialNeeds || 'None'} />
                  )}
                </div>
              </div>
              </fieldset>
            </CardBody>
          </Card>

          {!isLocked && !editMode && (
            <div className="mt-4 p-4 rounded-lg border border-danger/30 dark:border-danger/50 bg-danger/10 dark:bg-danger/20">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-danger dark:text-danger/20">Withdraw registration</p>
                  <p className="text-sm text-danger dark:text-danger mt-0.5">
                    Use this if your kid is sick, has a schedule conflict, or you no longer want to compete. The director will be notified.
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleWithdraw}
                  loading={withdrawing}
                  className="text-danger hover:bg-danger/10 dark:text-danger dark:hover:bg-danger/40 border-danger/30 dark:border-danger flex-shrink-0"
                >
                  <UserX className="h-4 w-4 mr-1" /> Withdraw
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Render: lookup form (initial)
  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950 py-12 px-4">
      <div className="max-w-md mx-auto">
        <Link
          to="/register"
          className="inline-flex items-center text-sm text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-white mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to register
        </Link>
        <Card>
          <CardBody className="p-8">
            <div className="text-center mb-6">
              <Edit3 className="h-12 w-12 text-primary-500 mx-auto mb-3" aria-hidden="true" />
              <h1 className="text-2xl font-bold text-surface-900 dark:text-white mb-2">Manage registration</h1>
              <p className="text-sm text-surface-600 dark:text-surface-400">
                Update competitor details or withdraw using the private link from your confirmation screen or email.
              </p>
            </div>

            <form onSubmit={handleLookup} className="space-y-4" aria-describedby={lookupError ? 'lookup-error' : undefined}>
              {lookupError && (
                <div
                  role="alert"
                  className="p-3 rounded-md bg-danger/10 dark:bg-danger/20 border border-danger/30 dark:border-danger/50 text-sm text-danger dark:text-danger flex items-start gap-2"
                >
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
                  <span>{lookupError}</span>
                </div>
              )}

              <Button type="submit" variant="primary" loading={lookupLoading} className="w-full">
                Open private management link
              </Button>
            </form>

            <p className="text-xs text-surface-500 mt-6 text-center">
              For security, confirmation codes cannot reveal or change personal information. Contact the tournament director if you lost the private link.
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function ReadonlyField({ value }: { value: string | number | null | undefined }) {
  return (
    <div className="h-10 px-3 rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900/50 text-sm text-surface-900 dark:text-surface-100 flex items-center">
      {value ?? '—'}
    </div>
  );
}
