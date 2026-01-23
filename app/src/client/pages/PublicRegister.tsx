import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Trophy, CheckCircle, AlertCircle, User, Calendar, Award } from 'lucide-react';

interface Tournament {
  id: string;
  name: string;
  date: string;
  location: string | null;
  _count: { registrations: number };
}

interface RegistrationResult {
  success: boolean;
  message: string;
  registration: {
    competitorName: string;
    tournamentName: string;
    tournamentDate: string;
    events: { patterns: boolean; sparring: boolean };
    ageGroup: string;
  };
}

const BELT_OPTIONS = [
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
  });

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setValidationErrors([]);
    setSubmitting(true);

    try {
      const res = await fetch('/api/public/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          heightInches: formData.heightInches ? parseFloat(formData.heightInches) : null,
          weightLbs: formData.weightLbs ? parseFloat(formData.weightLbs) : null,
          danRank: formData.belt === 'Black' ? formData.danRank : null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.details) {
          setValidationErrors(data.details);
        } else {
          setError(data.error || 'Registration failed');
        }
        return;
      }

      setResult(data);
    } catch {
      setError('Network error. Please try again.');
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (result) {
    return (
      <div className="min-h-screen bg-gray-50 py-12 px-4">
        <div className="max-w-md mx-auto">
          <div className="bg-white rounded-lg shadow-lg p-8 text-center">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Registration Complete!</h1>
            <p className="text-gray-600 mb-6">{result.message}</p>

            <div className="bg-gray-50 rounded-lg p-4 text-left mb-6">
              <h3 className="font-semibold text-gray-900 mb-3">Registration Details</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Competitor:</span>
                  <span className="font-medium">{result.registration.competitorName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Tournament:</span>
                  <span className="font-medium">{result.registration.tournamentName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Date:</span>
                  <span className="font-medium">
                    {new Date(result.registration.tournamentDate).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Age Group:</span>
                  <span className="font-medium">{result.registration.ageGroup}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Events:</span>
                  <span className="font-medium">
                    {[
                      result.registration.events.patterns && 'Patterns',
                      result.registration.events.sparring && 'Sparring',
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                setResult(null);
                setFormData({
                  tournamentId: formData.tournamentId,
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
                });
              }}
              className="btn btn-primary w-full"
            >
              Register Another Competitor
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (tournaments.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 py-12 px-4">
        <div className="max-w-md mx-auto text-center">
          <Trophy className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">No Open Tournaments</h1>
          <p className="text-gray-600">
            There are currently no tournaments open for registration. Please check back later.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <Trophy className="h-12 w-12 text-primary-500 mx-auto mb-3" />
          <h1 className="text-3xl font-bold text-gray-900">Tournament Registration</h1>
          <p className="text-gray-600 mt-2">
            Register for an upcoming Taekwondo tournament
          </p>
        </div>

        {/* Error Display */}
        {(error || validationErrors.length > 0) && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="flex items-start">
              <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 mr-2" />
              <div>
                {error && <p className="text-red-700 font-medium">{error}</p>}
                {validationErrors.length > 0 && (
                  <ul className="text-red-700 text-sm list-disc list-inside">
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
        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-lg p-6 space-y-6">
          {/* Tournament Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <Trophy className="h-4 w-4 inline mr-1" />
              Select Tournament *
            </label>
            <select
              name="tournamentId"
              value={formData.tournamentId}
              onChange={handleChange}
              className="form-input w-full"
              required
            >
              <option value="">-- Select a Tournament --</option>
              {tournaments.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} - {new Date(t.date).toLocaleDateString()}
                  {t.location && ` (${t.location})`}
                </option>
              ))}
            </select>
          </div>

          {/* Competitor Information */}
          <div className="border-t pt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <User className="h-5 w-5 mr-2" />
              Competitor Information
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  First Name *
                </label>
                <input
                  type="text"
                  name="firstName"
                  value={formData.firstName}
                  onChange={handleChange}
                  className="form-input w-full"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Last Name *
                </label>
                <input
                  type="text"
                  name="lastName"
                  value={formData.lastName}
                  onChange={handleChange}
                  className="form-input w-full"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Gender *
                </label>
                <select
                  name="gender"
                  value={formData.gender}
                  onChange={handleChange}
                  className="form-input w-full"
                  required
                >
                  <option value="">-- Select --</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Calendar className="h-4 w-4 inline mr-1" />
                  Date of Birth *
                </label>
                <input
                  type="date"
                  name="dateOfBirth"
                  value={formData.dateOfBirth}
                  onChange={handleChange}
                  className="form-input w-full"
                  required
                />
              </div>
            </div>
          </div>

          {/* Belt Information */}
          <div className="border-t pt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <Award className="h-5 w-5 mr-2" />
              Belt Rank
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Belt Level *
                </label>
                <select
                  name="belt"
                  value={formData.belt}
                  onChange={handleChange}
                  className="form-input w-full"
                  required
                >
                  <option value="">-- Select Belt --</option>
                  {BELT_OPTIONS.map((belt) => (
                    <option key={belt} value={belt}>
                      {belt}
                    </option>
                  ))}
                </select>
              </div>

              {formData.belt === 'Black' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Dan Rank *
                  </label>
                  <select
                    name="danRank"
                    value={formData.danRank}
                    onChange={handleChange}
                    className="form-input w-full"
                    required
                  >
                    {[1, 2, 3, 4, 5, 6].map((dan) => (
                      <option key={dan} value={dan}>
                        {dan}
                        {dan === 1 ? 'st' : dan === 2 ? 'nd' : dan === 3 ? 'rd' : 'th'} Dan
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  School / Dojang
                </label>
                <input
                  type="text"
                  name="schoolDojang"
                  value={formData.schoolDojang}
                  onChange={handleChange}
                  placeholder="e.g., Newton's Taekwondo"
                  className="form-input w-full"
                />
              </div>
            </div>
          </div>

          {/* Physical Info */}
          <div className="border-t pt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Physical Information
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Height (inches)
                </label>
                <input
                  type="number"
                  name="heightInches"
                  value={formData.heightInches}
                  onChange={handleChange}
                  placeholder="e.g., 60"
                  className="form-input w-full"
                  min="30"
                  max="84"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Weight (lbs) {formData.sparring && '*'}
                </label>
                <input
                  type="number"
                  name="weightLbs"
                  value={formData.weightLbs}
                  onChange={handleChange}
                  placeholder="e.g., 100"
                  className="form-input w-full"
                  min="30"
                  max="400"
                  required={formData.sparring}
                />
                {formData.sparring && (
                  <p className="text-xs text-gray-500 mt-1">Required for sparring events</p>
                )}
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Special Needs / Medical Notes
              </label>
              <textarea
                name="specialNeeds"
                value={formData.specialNeeds}
                onChange={handleChange}
                rows={2}
                placeholder="Any accommodations or medical information we should know"
                className="form-input w-full"
              />
            </div>
          </div>

          {/* Event Selection */}
          <div className="border-t pt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Event Selection *
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Select at least one event to compete in
            </p>

            <div className="space-y-3">
              <label className="flex items-center p-4 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                <input
                  type="checkbox"
                  name="patterns"
                  checked={formData.patterns}
                  onChange={handleChange}
                  className="h-5 w-5 text-primary-600 rounded"
                />
                <div className="ml-3">
                  <span className="font-medium text-gray-900">Patterns (Forms/Poomsae)</span>
                  <p className="text-sm text-gray-500">
                    Demonstrate your forms in a choreographed sequence
                  </p>
                </div>
              </label>

              <label className="flex items-center p-4 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                <input
                  type="checkbox"
                  name="sparring"
                  checked={formData.sparring}
                  onChange={handleChange}
                  className="h-5 w-5 text-primary-600 rounded"
                />
                <div className="ml-3">
                  <span className="font-medium text-gray-900">Sparring</span>
                  <p className="text-sm text-gray-500">
                    Compete in controlled fighting matches (requires weight)
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Parent/Guardian Info */}
          <div className="border-t pt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Parent/Guardian Contact (Optional)
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Parent/Guardian Name
                </label>
                <input
                  type="text"
                  name="parentName"
                  value={formData.parentName}
                  onChange={handleChange}
                  className="form-input w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  name="parentEmail"
                  value={formData.parentEmail}
                  onChange={handleChange}
                  className="form-input w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Phone
                </label>
                <input
                  type="tel"
                  name="parentPhone"
                  value={formData.parentPhone}
                  onChange={handleChange}
                  className="form-input w-full"
                />
              </div>
            </div>
          </div>

          {/* Submit Button */}
          <div className="border-t pt-6">
            <button
              type="submit"
              disabled={submitting}
              className="btn btn-primary w-full py-3 text-lg"
            >
              {submitting ? 'Submitting...' : 'Complete Registration'}
            </button>
            <p className="text-xs text-gray-500 text-center mt-3">
              By registering, you agree to follow all tournament rules and regulations.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
