import { useState, useRef, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  Search,
  CheckCircle,
  AlertTriangle,
  Scale,
  Users,
} from 'lucide-react';
import { CardSkeleton } from '../components/ui/Skeleton';
import Spinner from '../components/ui/Spinner';
import { getAuthHeaders } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Card, CardBody } from '../components/ui';
import { PageHeader } from '../components/ui';
import { Button } from '../components/ui';
import { StatTile } from '../components/ui';
import { Select } from '../components/ui';

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
  const toast = useToast();
  const searchRef = useRef<HTMLInputElement>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'checked' | 'unchecked'>('all');
  const [filterEvent, setFilterEvent] = useState<'all' | 'patterns' | 'sparring'>('all');
  const [schoolFilter, setSchoolFilter] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'school' | 'status'>('name');
  const [selectedRegistration, setSelectedRegistration] = useState<Registration | null>(null);
  const [checkInWeight, setCheckInWeight] = useState('');
  const [isBulkCheckingIn, setIsBulkCheckingIn] = useState(false);

  // Keyboard shortcut: "/" to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'SELECT') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const { data: tournament } = useQuery<Tournament>({
    queryKey: ['tournament', tournamentId],
    queryFn: async () => {
      const res = await fetch(`/api/tournaments/${tournamentId}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch tournament');
      return res.json();
    },
  });

  const { data: registrations, isLoading } = useQuery<Registration[]>({
    queryKey: ['checkin-registrations', tournamentId],
    queryFn: async () => {
      const res = await fetch(`/api/tournaments/${tournamentId}/registrations`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch registrations');
      const data = await res.json();
      return data.map((r: any) => ({
        ...r,
        checkedIn: r.checkedIn || false,
        checkInTime: r.checkInTime || null,
        checkInWeight: r.checkInWeight || null,
      }));
    },
    refetchInterval: 5000,
  });

  const checkInMutation = useMutation({
    mutationFn: async (data: { registrationId: string; weight?: number }) => {
      const res = await fetch(`/api/tournaments/${tournamentId}/registrations/${data.registrationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          checkedIn: true,
          checkInTime: new Date().toISOString(),
          checkInWeight: data.weight || null,
        }),
      });
      if (!res.ok) throw new Error('Failed to check in');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checkin-registrations'] });
      setSelectedRegistration(null);
      setCheckInWeight('');
    },
  });

  const undoCheckInMutation = useMutation({
    mutationFn: async (registrationId: string) => {
      const res = await fetch(`/api/tournaments/${tournamentId}/registrations/${registrationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          checkedIn: false,
          checkInTime: null,
          checkInWeight: null,
        }),
      });
      if (!res.ok) throw new Error('Failed to undo check-in');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checkin-registrations'] });
    },
  });

  const uniqueSchools = registrations
    ? [...new Set(registrations.map((r) => r.competitor.schoolDojang).filter(Boolean))].sort() as string[]
    : [];

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

    const matchesSchool =
      schoolFilter === '' || r.competitor.schoolDojang === schoolFilter;

    return matchesSearch && matchesStatus && matchesEvent && matchesSchool;
  });

  const sortedRegistrations = filteredRegistrations
    ? [...filteredRegistrations].sort((a, b) => {
        if (sortBy === 'name')
          return (
            a.competitor.lastName.localeCompare(b.competitor.lastName) ||
            a.competitor.firstName.localeCompare(b.competitor.firstName)
          );
        if (sortBy === 'school')
          return (a.competitor.schoolDojang || '').localeCompare(b.competitor.schoolDojang || '');
        if (sortBy === 'status')
          return (a.checkedIn ? 1 : 0) - (b.checkedIn ? 1 : 0);
        return 0;
      })
    : [];

  const uncheckedFiltered = sortedRegistrations.filter((r) => !r.checkedIn);
  const hasActiveFilter = searchTerm !== '' || schoolFilter !== '';

  const stats = {
    total: registrations?.length || 0,
    checkedIn: registrations?.filter((r) => r.checkedIn).length || 0,
    sparring: registrations?.filter((r) => r.sparring).length || 0,
    patterns: registrations?.filter((r) => r.patterns).length || 0,
  };

  const handleQuickCheckIn = (registration: Registration) => {
    if (registration.sparring) {
      setSelectedRegistration(registration);
      setCheckInWeight(registration.weightAtRegistration?.toString() || '');
    } else {
      checkInMutation.mutate({ registrationId: registration.id });
    }
  };

  const handleBulkCheckIn = async () => {
    const eligibleForBulk = uncheckedFiltered.filter((r) => !r.sparring);
    if (eligibleForBulk.length === 0) {
      toast.warning('All filtered unchecked competitors require weigh-in (sparring). Check them in individually.');
      return;
    }
    setIsBulkCheckingIn(true);
    try {
      await Promise.all(
        eligibleForBulk.map((r) =>
          fetch(`/api/tournaments/${tournamentId}/registrations/${r.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify({
              checkedIn: true,
              checkInTime: new Date().toISOString(),
              checkInWeight: null,
            }),
          })
        )
      );
      queryClient.invalidateQueries({ queryKey: ['checkin-registrations'] });
      toast.success(`Checked in ${eligibleForBulk.length} competitor${eligibleForBulk.length === 1 ? '' : 's'}`);
    } catch {
      toast.error('Some check-ins failed. Please try again.');
    } finally {
      setIsBulkCheckingIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 shadow">
        <div className="px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <Link
                to={`/tournaments/${tournamentId}`}
                className="mr-3 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <ChevronLeft className="h-6 w-6" />
              </Link>
              <div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-white">Check-In</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">{tournament?.name}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="px-4 pb-2 grid grid-cols-4 gap-2">
          <StatTile label="Registered" value={stats.total} accent="blue" />
          <StatTile label="Checked In" value={stats.checkedIn} accent="green" />
          <StatTile label="Missing" value={stats.total - stats.checkedIn} accent="yellow" />
          <StatTile label="Complete" value={`${Math.round((stats.checkedIn / stats.total) * 100) || 0}%`} accent="purple" />
        </div>
        {/* Progress Bar */}
        <div className="px-4 pb-4">
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
            <div
              className="bg-green-500 dark:bg-green-400 h-2.5 rounded-full transition-all duration-500"
              style={{ width: `${stats.total > 0 ? Math.round((stats.checkedIn / stats.total) * 100) : 0}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-center">
            {stats.checkedIn} / {stats.total} checked in ({stats.total > 0 ? Math.round((stats.checkedIn / stats.total) * 100) : 0}%)
          </p>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="p-4 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400 dark:text-gray-500" />
          <input
            ref={searchRef}
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder='Search by name or school... (press "/" to focus)'
            className="form-input w-full pl-10 pr-4 py-3 text-lg"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 flex-wrap">
          <Select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as any)}
            className="text-sm"
          >
            <option value="all">All Status</option>
            <option value="unchecked">Not Checked In</option>
            <option value="checked">Checked In</option>
          </Select>

          <Select
            value={filterEvent}
            onChange={(e) => setFilterEvent(e.target.value as any)}
            className="text-sm"
          >
            <option value="all">All Events</option>
            <option value="patterns">Patterns Only</option>
            <option value="sparring">Sparring Only</option>
          </Select>

          <Select
            value={schoolFilter}
            onChange={(e) => setSchoolFilter(e.target.value)}
            className="text-sm"
          >
            <option value="">All Schools</option>
            {uniqueSchools.map((school) => (
              <option key={school} value={school}>
                {school}
              </option>
            ))}
          </Select>

          <Select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'name' | 'school' | 'status')}
            className="text-sm"
          >
            <option value="name">Name (A-Z)</option>
            <option value="school">School</option>
            <option value="status">Status</option>
          </Select>
        </div>

        {/* Bulk Check-In Button */}
        {hasActiveFilter && uncheckedFiltered.length > 0 && (
          <Button variant="success" className="w-full" loading={isBulkCheckingIn} onClick={handleBulkCheckIn}>
            <Users className="h-4 w-4 mr-2" />
            Check In All Filtered ({uncheckedFiltered.length})
          </Button>
        )}
      </div>

      {/* Registration List */}
      <div className="p-4">
        {isLoading ? (
          <div className="space-y-3">
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </div>
        ) : sortedRegistrations.length === 0 ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            No registrations found matching your filters.
          </div>
        ) : (
          <div className="space-y-2">
            {sortedRegistrations.map((registration) => (
              <div
                key={registration.id}
                className={`bg-white dark:bg-gray-800 rounded-lg shadow p-4 ${
                  registration.checkedIn ? 'border-l-4 border-green-500 dark:border-green-400' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center">
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {registration.competitor.firstName} {registration.competitor.lastName}
                      </span>
                      {registration.checkedIn && (
                        <CheckCircle className="h-5 w-5 text-green-500 dark:text-green-400 ml-2" />
                      )}
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      {registration.competitor.schoolDojang || 'No School'} •{' '}
                      {registration.competitor.belt}
                      {registration.ageAtTournament && ` • Age ${registration.ageAtTournament}`}
                    </div>
                    <div className="flex gap-2 mt-2">
                      {registration.patterns && (
                        <span className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded">
                          Patterns
                        </span>
                      )}
                      {registration.sparring && (
                        <span className="text-xs px-2 py-1 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded">
                          Sparring
                          {registration.weightAtRegistration && ` (${registration.weightAtRegistration} lbs)`}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="ml-4">
                    {registration.checkedIn ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => undoCheckInMutation.mutate(registration.id)}
                        loading={undoCheckInMutation.isPending}
                      >
                        Undo
                      </Button>
                    ) : (
                      <Button
                        variant="success"
                        size="md"
                        onClick={() => handleQuickCheckIn(registration)}
                        loading={checkInMutation.isPending}
                      >
                        Check In
                      </Button>
                    )}
                  </div>
                </div>

                {registration.checkedIn && registration.checkInWeight && (
                  <div className="mt-2 text-sm text-gray-500 dark:text-gray-400 flex items-center">
                    <Scale className="h-4 w-4 mr-1" />
                    Weigh-in: {registration.checkInWeight} lbs
                    {registration.weightAtRegistration &&
                      registration.checkInWeight !== registration.weightAtRegistration && (
                        <span
                          className={`ml-2 ${
                            registration.checkInWeight > registration.weightAtRegistration
                              ? 'text-red-500 dark:text-red-400'
                              : 'text-green-500 dark:text-green-400'
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
        <div className="modal-container flex items-center justify-center p-4">
          <div className="modal-backdrop" onClick={() => { setSelectedRegistration(null); setCheckInWeight(''); }} />
          <div className="modal-panel max-w-md">
            <div className="modal-header">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                Check In: {selectedRegistration.competitor.firstName}{' '}
                {selectedRegistration.competitor.lastName}
              </h3>
            </div>

            <div className="modal-body">
              <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <div className="text-sm text-gray-500 dark:text-gray-400">Registered Weight</div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white">
                  {selectedRegistration.weightAtRegistration || 'Not recorded'} lbs
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  <Scale className="h-4 w-4 inline mr-1" />
                  Weigh-In Weight (lbs)
                </label>
                <input
                  type="number"
                  value={checkInWeight}
                  onChange={(e) => setCheckInWeight(e.target.value)}
                  min={20}
                  max={400}
                  className="form-input w-full p-3 text-lg"
                  placeholder="Enter weight"
                  autoFocus
                />
                {checkInWeight && (parseFloat(checkInWeight) < 20 || parseFloat(checkInWeight) > 400) && (
                  <p className="text-red-500 text-sm mt-1">Weight must be between 20 and 400 lbs</p>
                )}
              </div>

              {checkInWeight &&
                selectedRegistration.weightAtRegistration &&
                Math.abs(parseFloat(checkInWeight) - selectedRegistration.weightAtRegistration) > 2 && (
                  <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg flex items-start">
                    <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mr-2 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-yellow-800 dark:text-yellow-200">
                      Weight differs by more than 2 lbs from registration. Consider verifying weight class eligibility.
                    </div>
                  </div>
                )}
            </div>

            <div className="modal-footer">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => {
                  setSelectedRegistration(null);
                  setCheckInWeight('');
                }}
              >
                Cancel
              </Button>
              <Button
                variant="success"
                className="flex-1"
                loading={checkInMutation.isPending}
                onClick={() =>
                  checkInMutation.mutate({
                    registrationId: selectedRegistration.id,
                    weight: parseFloat(checkInWeight) || undefined,
                  })
                }
              >
                {checkInMutation.isPending ? (
                  <><Spinner size="sm" className="mr-2" /> Saving...</>
                ) : (
                  'Confirm Check-In'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
