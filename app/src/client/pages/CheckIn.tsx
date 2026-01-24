import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  Search,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Scale,
  User,
  Users,
  Filter,
} from 'lucide-react';

interface Registration {
  id: string;
  patterns: boolean;
  sparring: boolean;
  weightAtRegistration: number | null;
  ageAtTournament: number | null;
  checkedIn: boolean;
  checkInTime: string | null;
  checkInWeight: number | null;
  competitor: {
    id: string;
    firstName: string;
    lastName: string;
    gender: string;
    belt: string;
    schoolDojang: string | null;
    weightLbs: number | null;
  };
}

interface Tournament {
  id: string;
  name: string;
  date: string;
}

export default function CheckIn() {
  const { tournamentId } = useParams();
  const queryClient = useQueryClient();

  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'checked' | 'unchecked'>('all');
  const [filterEvent, setFilterEvent] = useState<'all' | 'patterns' | 'sparring'>('all');
  const [selectedRegistration, setSelectedRegistration] = useState<Registration | null>(null);
  const [checkInWeight, setCheckInWeight] = useState('');

  // Fetch tournament
  const { data: tournament } = useQuery<Tournament>({
    queryKey: ['tournament', tournamentId],
    queryFn: async () => {
      const res = await fetch(`/api/tournaments/${tournamentId}`);
      return res.json();
    },
  });

  // Fetch registrations
  const { data: registrations, isLoading } = useQuery<Registration[]>({
    queryKey: ['checkin-registrations', tournamentId],
    queryFn: async () => {
      const res = await fetch(`/api/tournaments/${tournamentId}/registrations`);
      const data = await res.json();
      // Add checkedIn field if not present (simulated for now)
      return data.map((r: any) => ({
        ...r,
        checkedIn: r.checkedIn || false,
        checkInTime: r.checkInTime || null,
        checkInWeight: r.checkInWeight || null,
      }));
    },
    refetchInterval: 5000,
  });

  // Check-in mutation
  const checkInMutation = useMutation({
    mutationFn: async (data: { registrationId: string; weight?: number }) => {
      const res = await fetch(`/api/tournaments/${tournamentId}/registrations/${data.registrationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checkedIn: true,
          checkInTime: new Date().toISOString(),
          checkInWeight: data.weight || null,
        }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checkin-registrations'] });
      setSelectedRegistration(null);
      setCheckInWeight('');
    },
  });

  // Undo check-in mutation
  const undoCheckInMutation = useMutation({
    mutationFn: async (registrationId: string) => {
      const res = await fetch(`/api/tournaments/${tournamentId}/registrations/${registrationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checkedIn: false,
          checkInTime: null,
          checkInWeight: null,
        }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checkin-registrations'] });
    },
  });

  // Filter registrations
  const filteredRegistrations = registrations?.filter((r) => {
    const matchesSearch =
      searchTerm === '' ||
      `${r.competitor.firstName} ${r.competitor.lastName}`
        .toLowerCase()
        .includes(searchTerm.toLowerCase()) ||
      r.competitor.schoolDojang?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus =
      filterStatus === 'all' ||
      (filterStatus === 'checked' && r.checkedIn) ||
      (filterStatus === 'unchecked' && !r.checkedIn);

    const matchesEvent =
      filterEvent === 'all' ||
      (filterEvent === 'patterns' && r.patterns) ||
      (filterEvent === 'sparring' && r.sparring);

    return matchesSearch && matchesStatus && matchesEvent;
  });

  // Stats
  const stats = {
    total: registrations?.length || 0,
    checkedIn: registrations?.filter((r) => r.checkedIn).length || 0,
    sparring: registrations?.filter((r) => r.sparring).length || 0,
    patterns: registrations?.filter((r) => r.patterns).length || 0,
  };

  const handleQuickCheckIn = (registration: Registration) => {
    if (registration.sparring) {
      // Need weight for sparring - show modal
      setSelectedRegistration(registration);
      setCheckInWeight(registration.weightAtRegistration?.toString() || '');
    } else {
      // Patterns only - quick check in
      checkInMutation.mutate({ registrationId: registration.id });
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-white shadow">
        <div className="px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <Link
                to={`/tournaments/${tournamentId}`}
                className="mr-3 text-gray-400 hover:text-gray-600"
              >
                <ChevronLeft className="h-6 w-6" />
              </Link>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Check-In</h1>
                <p className="text-sm text-gray-500">{tournament?.name}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="px-4 pb-4 grid grid-cols-4 gap-2">
          <div className="bg-blue-50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-blue-600">{stats.total}</div>
            <div className="text-xs text-blue-600">Registered</div>
          </div>
          <div className="bg-green-50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-green-600">{stats.checkedIn}</div>
            <div className="text-xs text-green-600">Checked In</div>
          </div>
          <div className="bg-yellow-50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-yellow-600">
              {stats.total - stats.checkedIn}
            </div>
            <div className="text-xs text-yellow-600">Missing</div>
          </div>
          <div className="bg-purple-50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-purple-600">
              {Math.round((stats.checkedIn / stats.total) * 100) || 0}%
            </div>
            <div className="text-xs text-purple-600">Complete</div>
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="p-4 bg-white border-b sticky top-0 z-10">
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by name or school..."
            className="w-full pl-10 pr-4 py-3 border rounded-lg text-lg"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as any)}
            className="px-3 py-2 border rounded-lg text-sm bg-white"
          >
            <option value="all">All Status</option>
            <option value="unchecked">Not Checked In</option>
            <option value="checked">Checked In</option>
          </select>

          <select
            value={filterEvent}
            onChange={(e) => setFilterEvent(e.target.value as any)}
            className="px-3 py-2 border rounded-lg text-sm bg-white"
          >
            <option value="all">All Events</option>
            <option value="patterns">Patterns Only</option>
            <option value="sparring">Sparring Only</option>
          </select>
        </div>
      </div>

      {/* Registration List */}
      <div className="p-4">
        {isLoading ? (
          <div className="text-center py-12 text-gray-500">Loading registrations...</div>
        ) : filteredRegistrations?.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            No registrations found matching your filters.
          </div>
        ) : (
          <div className="space-y-2">
            {filteredRegistrations?.map((registration) => (
              <div
                key={registration.id}
                className={`bg-white rounded-lg shadow p-4 ${
                  registration.checkedIn ? 'border-l-4 border-green-500' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center">
                      <span className="font-semibold text-gray-900">
                        {registration.competitor.firstName} {registration.competitor.lastName}
                      </span>
                      {registration.checkedIn && (
                        <CheckCircle className="h-5 w-5 text-green-500 ml-2" />
                      )}
                    </div>
                    <div className="text-sm text-gray-500 mt-1">
                      {registration.competitor.schoolDojang || 'No School'} •{' '}
                      {registration.competitor.belt}
                      {registration.ageAtTournament && ` • Age ${registration.ageAtTournament}`}
                    </div>
                    <div className="flex gap-2 mt-2">
                      {registration.patterns && (
                        <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded">
                          Patterns
                        </span>
                      )}
                      {registration.sparring && (
                        <span className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded">
                          Sparring
                          {registration.weightAtRegistration &&
                            ` (${registration.weightAtRegistration} lbs)`}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="ml-4">
                    {registration.checkedIn ? (
                      <button
                        onClick={() => undoCheckInMutation.mutate(registration.id)}
                        className="px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg"
                      >
                        Undo
                      </button>
                    ) : (
                      <button
                        onClick={() => handleQuickCheckIn(registration)}
                        className="px-6 py-3 bg-green-600 hover:bg-green-500 text-white font-semibold rounded-lg"
                      >
                        Check In
                      </button>
                    )}
                  </div>
                </div>

                {registration.checkedIn && registration.checkInWeight && (
                  <div className="mt-2 text-sm text-gray-500 flex items-center">
                    <Scale className="h-4 w-4 mr-1" />
                    Weigh-in: {registration.checkInWeight} lbs
                    {registration.weightAtRegistration &&
                      registration.checkInWeight !== registration.weightAtRegistration && (
                        <span
                          className={`ml-2 ${
                            registration.checkInWeight > registration.weightAtRegistration
                              ? 'text-red-500'
                              : 'text-green-500'
                          }`}
                        >
                          (
                          {registration.checkInWeight > registration.weightAtRegistration
                            ? '+'
                            : ''}
                          {(
                            registration.checkInWeight - registration.weightAtRegistration
                          ).toFixed(1)}{' '}
                          lbs)
                        </span>
                      )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Weight Entry Modal */}
      {selectedRegistration && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full">
            <h3 className="text-xl font-bold text-gray-900 mb-4">
              Check In: {selectedRegistration.competitor.firstName}{' '}
              {selectedRegistration.competitor.lastName}
            </h3>

            <div className="mb-4 p-3 bg-gray-50 rounded-lg">
              <div className="text-sm text-gray-500">Registered Weight</div>
              <div className="text-lg font-semibold">
                {selectedRegistration.weightAtRegistration || 'Not recorded'} lbs
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <Scale className="h-4 w-4 inline mr-1" />
                Weigh-In Weight (lbs)
              </label>
              <input
                type="number"
                value={checkInWeight}
                onChange={(e) => setCheckInWeight(e.target.value)}
                className="w-full p-3 border rounded-lg text-lg"
                placeholder="Enter weight"
                autoFocus
              />
            </div>

            {checkInWeight &&
              selectedRegistration.weightAtRegistration &&
              Math.abs(parseFloat(checkInWeight) - selectedRegistration.weightAtRegistration) >
                2 && (
                <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg flex items-start">
                  <AlertTriangle className="h-5 w-5 text-yellow-600 mr-2 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-yellow-800">
                    Weight differs by more than 2 lbs from registration. Consider verifying weight
                    class eligibility.
                  </div>
                </div>
              )}

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setSelectedRegistration(null);
                  setCheckInWeight('');
                }}
                className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  checkInMutation.mutate({
                    registrationId: selectedRegistration.id,
                    weight: parseFloat(checkInWeight) || undefined,
                  })
                }
                disabled={checkInMutation.isPending}
                className="flex-1 py-3 bg-green-600 hover:bg-green-500 text-white rounded-lg font-semibold"
              >
                {checkInMutation.isPending ? 'Saving...' : 'Confirm Check-In'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
