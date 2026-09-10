import { useState, useRef, useEffect, useMemo } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
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
import EmptyState from '../components/ui/EmptyState';
import { getAuthHeaders, useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Card, CardBody, ConfirmDialog } from '../components/ui';
import { PageHeader } from '../components/ui';
import { Button } from '../components/ui';
import { Input } from '../components/ui';
import { Modal } from '../components/ui';
import { StatTile } from '../components/ui';
import { Select } from '../components/ui';
import { useOfflineOperations } from '../hooks/useOfflineOperations';
import { makeCheckInOperation } from '../utils/offline-operation-queue';
import { CHECK_IN_ACCESSIBLE_LABELS, formatCheckInWeight } from '../utils/check-in-display';
import OperationStatus from '../components/ui/OperationStatus';
import { buildDeliveryUncertainMessage, buildOfflineOperationStatuses, buildOfflineReviewMessage } from '../utils/offline-operation-status';
import { reconcileBulkCheckInResult, runBulkCheckInRequests } from '../utils/bulk-check-in';
import { browserVenueDataSnapshotStore, loadVenueData } from '../utils/venue-data-snapshot';
import { isCheckInRegistrationData } from '../utils/venue-data-contracts';
import { buildCheckInRequestPayload, shouldQueueOfflineMutation } from '../utils/offline-delivery';
import {
  parseCheckInFilters,
  serializeCheckInFilters,
  updateSearchParams,
} from '../utils/url-state';
import ConnectionStatusBanner from '../components/ui/ConnectionStatusBanner';
import DirectorOverrideDialog, { type DirectorOverrideParams } from '../components/DirectorOverrideDialog';

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
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user, isOfflineSession } = useAuth();
  const venueSnapshots = useMemo(browserVenueDataSnapshotStore, []);
  const [cachedSnapshotAt, setCachedSnapshotAt] = useState<string | null>(null);
  const offlineOperations = useOfflineOperations(tournamentId, 'check_in');
  const [discardOfflineId, setDiscardOfflineId] = useState<string | null>(null);
  const [discardOfflineError, setDiscardOfflineError] = useState('');
  const [unpersistedDeliveryWarning, setUnpersistedDeliveryWarning] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // Read filters from URL
  const urlFilters = parseCheckInFilters(searchParams);
  const [searchTerm, setSearchTerm] = useState(urlFilters.search || '');
  const [filterStatus, setFilterStatus] = useState<'all' | 'checked' | 'unchecked'>(
    urlFilters.showCheckedIn && !urlFilters.showUnchecked ? 'checked' :
    !urlFilters.showCheckedIn && urlFilters.showUnchecked ? 'unchecked' :
    'all'
  );
  const [filterEvent, setFilterEvent] = useState<'all' | 'patterns' | 'sparring'>(urlFilters.eventFilter || 'all');
  const [schoolFilter, setSchoolFilter] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'school' | 'status'>('name');
  const [selectedRegistration, setSelectedRegistration] = useState<Registration | null>(null);
  const [checkInWeight, setCheckInWeight] = useState('');
  const [isBulkCheckingIn, setIsBulkCheckingIn] = useState(false);
  const [failedBulkIds, setFailedBulkIds] = useState<string[]>([]);
  const [failedBulkErrors, setFailedBulkErrors] = useState<Record<string, string>>({});
  const [uncertainBulkIds, setUncertainBulkIds] = useState<string[]>([]);
  const [directorOverrideParams, setDirectorOverrideParams] = useState<DirectorOverrideParams | null>(null);
  const [directorOverrideLoading, setDirectorOverrideLoading] = useState(false);

  // Sync filters to URL when they change
  useEffect(() => {
    const filters = serializeCheckInFilters({
      search: searchTerm || undefined,
      showCheckedIn: filterStatus === 'all' || filterStatus === 'checked',
      showUnchecked: filterStatus === 'all' || filterStatus === 'unchecked',
      eventFilter: filterEvent === 'all' ? undefined : filterEvent,
    });
    const newParams = updateSearchParams(searchParams, filters);
    if (newParams.toString() !== searchParams.toString()) {
      setSearchParams(newParams, { replace: true });
    }
  }, [searchTerm, filterStatus, filterEvent, searchParams, setSearchParams]);

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

  const { data: registrations, isLoading, isError: registrationsError, refetch: retryRegistrations } = useQuery<Registration[]>({
    queryKey: ['checkin-registrations', tournamentId],
    queryFn: async () => {
      if (!user || !tournamentId) throw new Error('Authenticated tournament context is required');
      const result = await loadVenueData<Registration[]>({
        scope: { ownerId: user.id, tournamentId, kind: 'checkin' },
        store: venueSnapshots,
        validate: (value): value is Registration[] => isCheckInRegistrationData(value),
        request: () => fetch(`/api/tournaments/${tournamentId}/registrations`, { headers: getAuthHeaders() }),
      });
      setCachedSnapshotAt(result.source === 'snapshot' ? result.savedAt : null);
      return result.data;
    },
    enabled: Boolean(user && tournamentId),
    refetchInterval: 5000,
  refetchIntervalInBackground: false,
  });

  type CheckInSubmission = { registrationId: string; weight?: number };
  const stageCheckIn = (data: CheckInSubmission, deliveryUncertain = false) => {
    if (!tournamentId || !user) return;
    try {
      offlineOperations.enqueue(makeCheckInOperation(
        user.id,
        tournamentId,
        data.registrationId,
        buildCheckInRequestPayload(data.weight),
        deliveryUncertain ? 'delivery_uncertain' : 'pending',
      ));
    } catch {
      if (deliveryUncertain) {
        const registration = selectedRegistration?.id === data.registrationId ? selectedRegistration : undefined;
        const name = registration
          ? `${registration.competitor.firstName} ${registration.competitor.lastName}`
          : `Registration #${data.registrationId.slice(0, 8)}`;
        const attempted = data.weight ? `checked in at ${formatCheckInWeight(data.weight)}` : 'checked in without a weigh-in value';
        setSelectedRegistration(null);
        setCheckInWeight('');
        setUnpersistedDeliveryWarning(`${name} may already be checked in on the server (${attempted}, sent ${new Date().toLocaleTimeString()}). This device could not retain the safety record. Do not resubmit it. Review the refreshed registration first.`);
        void queryClient.invalidateQueries({ queryKey: ['checkin-registrations'] });
        return;
      }
      toast.error('Check-in was not saved on this device. Keep this form open, free device storage, and try again.');
      return;
    }
    setSelectedRegistration(null);
    setCheckInWeight('');
    if (deliveryUncertain) {
      void queryClient.invalidateQueries({ queryKey: ['checkin-registrations'] });
      toast.error('Check-in delivery is uncertain. The request may have reached the server; review the refreshed registration before taking action.');
    } else {
      toast.warning('Check-in saved on this device and will sync when the connection returns.');
    }
  };

  const checkInMutation = useMutation({
    mutationFn: async (data: CheckInSubmission) => {
      const res = await fetch(`/api/tournaments/${tournamentId}/registrations/${data.registrationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(buildCheckInRequestPayload(data.weight)),
      });
      if (!res.ok) throw new Error('Failed to check in');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checkin-registrations'] });
      setSelectedRegistration(null);
      setCheckInWeight('');
    },
    onError: (error, data) => {
      if (error instanceof TypeError) stageCheckIn(data, true);
      else toast.addToast('Check-in failed. Check the venue connection and try again.', 'error');
    },
  });

  const submitCheckIn = (data: CheckInSubmission) => {
    if (shouldQueueOfflineMutation({ isOfflineSession, navigatorOnline: navigator.onLine })) stageCheckIn(data);
    else checkInMutation.mutate(data);
  };

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
    onError: () => toast.addToast('Could not undo check-in. Check the venue connection and try again.', 'error'),
  });

  const uniqueSchools = registrations
    ? [...new Set(registrations.map((r) => r.competitor.schoolDojang).filter(Boolean))].sort() as string[]
    : [];
  const stagedCheckInIds = new Set(
    offlineOperations.pending
      .filter((operation) => operation.kind === 'check_in')
      .map((operation) => operation.targetId),
  );
  const isCheckedIn = (registration: Registration) => registration.checkedIn || stagedCheckInIds.has(registration.id);

  const filteredRegistrations = registrations?.filter((r) => {
    const matchesSearch =
      searchTerm === '' ||
      `${r.competitor.firstName} ${r.competitor.lastName}`
        .toLowerCase()
        .includes(searchTerm.toLowerCase()) ||
      r.competitor.schoolDojang?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus =
      filterStatus === 'all' ||
      (filterStatus === 'checked' && isCheckedIn(r)) ||
      (filterStatus === 'unchecked' && !isCheckedIn(r));

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
          return (isCheckedIn(a) ? 1 : 0) - (isCheckedIn(b) ? 1 : 0);
        return 0;
      })
    : [];

  const uncheckedFiltered = sortedRegistrations.filter((r) => !isCheckedIn(r));
  const hasActiveFilter = searchTerm !== '' || schoolFilter !== '';

  const stats = {
    total: registrations?.length || 0,
    checkedIn: registrations?.filter((r) => isCheckedIn(r)).length || 0,
    sparring: registrations?.filter((r) => r.sparring).length || 0,
    patterns: registrations?.filter((r) => r.patterns).length || 0,
  };

  const handleQuickCheckIn = (registration: Registration) => {
    if (registration.sparring) {
      // Sparring competitor without registered weight triggers director override (#139)
      if (!registration.weightAtRegistration) {
        setDirectorOverrideParams({
          type: 'check-in',
          competitorName: `${registration.competitor.firstName} ${registration.competitor.lastName}`,
          reason: 'No weight recorded at registration. Cannot assign to sparring division without weigh-in.',
          currentWeight: undefined,
          requireWeightOverride: true,
        });
        setSelectedRegistration(registration);
        return;
      }
      setSelectedRegistration(registration);
      setCheckInWeight(registration.weightAtRegistration?.toString() || '');
    } else {
      submitCheckIn({ registrationId: registration.id });
    }
  };

  const handleBulkCheckIn = async (retryIds?: string[]) => {
    const eligibleForBulk = retryIds
      ? (registrations || []).filter((r) => retryIds.includes(r.id) && !isCheckedIn(r) && !r.sparring)
      : uncheckedFiltered.filter((r) => !r.sparring);
    if (eligibleForBulk.length === 0) {
      if (retryIds) {
        setFailedBulkIds([]);
        setFailedBulkErrors({});
        toast.success('Server status now shows those competitors checked in. No retry was sent.');
        return;
      }
      toast.warning('All filtered unchecked competitors require weigh-in (sparring). Check them in individually.');
      return;
    }
    if (!navigator.onLine) {
      let staged = 0;
      for (const registration of eligibleForBulk) {
        if (!tournamentId || !user) return;
        try {
          offlineOperations.enqueue(makeCheckInOperation(user.id, tournamentId, registration.id, {
            checkedIn: true,
            checkInTime: new Date().toISOString(),
            checkInWeight: null,
          }));
          staged += 1;
        } catch {
          toast.error(`${staged} of ${eligibleForBulk.length} check-ins were saved on this device. Free device storage before retrying the rest.`);
          return;
        }
      }
      toast.warning(`${staged} check-ins saved on this device for later sync.`);
      return;
    }
    setIsBulkCheckingIn(true);
    setFailedBulkIds([]);
    setFailedBulkErrors({});
    try {
      const result = await runBulkCheckInRequests(
        eligibleForBulk.map((registration) => registration.id),
        async (registrationId) => fetch(`/api/tournaments/${tournamentId}/registrations/${registrationId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify({
              checkedIn: true,
              checkInTime: new Date().toISOString(),
              checkInWeight: null,
            }),
          }),
      );
      await queryClient.invalidateQueries({ queryKey: ['checkin-registrations'] });
      const refreshed = queryClient.getQueryData<Registration[]>(['checkin-registrations', tournamentId]) || [];
      const okCount = result.succeededIds.length;
      const resultWithPriorUncertainty = {
        ...result,
        deliveryUncertainIds: [...new Set([...uncertainBulkIds, ...result.deliveryUncertainIds])],
      };
      const { rejected, deliveryUncertainIds: unresolvedUncertain } = reconcileBulkCheckInResult(resultWithPriorUncertainty, refreshed);
      const failCount = rejected.length;
      setFailedBulkIds(rejected.map(({ id }) => id));
      setFailedBulkErrors(Object.fromEntries(rejected.map(({ id, error }) => [id, error])));
      setUncertainBulkIds(unresolvedUncertain);
      if (unresolvedUncertain.length > 0) {
        toast.warning(`${okCount} confirmed; ${failCount} rejected; ${unresolvedUncertain.length} need server-state verification.`);
      } else if (failCount === 0) {
        toast.success(`Checked in ${okCount} competitor${okCount === 1 ? '' : 's'}`);
      } else if (okCount === 0) {
        toast.error('Bulk check-in failed. Please try again.');
      } else {
        toast.warning(`Checked in ${okCount}; ${failCount} failed.`);
      }
    } finally {
      setIsBulkCheckingIn(false);
    }
  };

  const syncStagedCheckIns = async () => {
    const result = await offlineOperations.sync();
    if (!result) return;
    if (result.synced > 0) {
      await queryClient.invalidateQueries({ queryKey: ['checkin-registrations'] });
      toast.success(`${result.synced} staged check-in${result.synced === 1 ? '' : 's'} synced.`);
    }
    if (result.newlyRejected > 0) toast.error('A staged check-in was rejected and needs staff review.');
    if (result.persistenceFailuresBeforeSend > 0) {
      toast.error('Nothing was sent because this device could not safely prepare the sync. Free device storage and try again.');
    }
    if (result.persistenceFailuresAfterSend > 0) {
      toast.error('The server may have accepted a check-in, but this device could not clear its local copy. Refresh and review before syncing again.');
    }
    if (result.persistenceFailuresAfterRejection > 0) {
      toast.error('A check-in was rejected, but this device could not save the rejection details. It has been quarantined from retry; refresh and review it.');
    }
  };
  const failedBulkNames = failedBulkIds.map((id) => {
    const failed = registrations?.find((registration) => registration.id === id);
    const label = failed ? `${failed.competitor.firstName} ${failed.competitor.lastName}` : `Registration ${id.slice(0, 8)}`;
    return `${label} (${failedBulkErrors[id] || 'rejected by server'})`;
  });
  const uncertainBulkNames = uncertainBulkIds.map((id) => {
    const uncertain = registrations?.find((registration) => registration.id === id);
    return uncertain ? `${uncertain.competitor.firstName} ${uncertain.competitor.lastName}` : `Registration ${id.slice(0, 8)}`;
  });

  const retryStagedCheckIn = async (id: string) => {
    const result = await offlineOperations.retry(id);
    if (!result) return;
    if (result.outcome === 'synced') {
      await queryClient.invalidateQueries({ queryKey: ['checkin-registrations'] });
      toast.success('Staged check-in synced.');
    } else if (result.outcome === 'rejected') {
      toast.error('The staged check-in was rejected again. Review the server message before retrying.');
    } else if (result.outcome === 'offline') {
      toast.warning('Reconnect to retry this staged check-in.');
    } else if (result.outcome === 'superseded') {
      toast.warning('A newer local check-in replaced this retry. The newer change remains queued.');
    } else if (result.outcome === 'persistence_failed_after_send') {
      toast.error('The server may have accepted this check-in, but this device could not clear the local copy. Refresh and review the registration before retrying.');
    } else if (result.outcome === 'delivery_uncertain' || result.outcome === 'persistence_failed_after_rejection') {
      toast.error('Delivery is uncertain. Refresh and verify the server registration; retry is disabled for this local copy.');
    } else if (result.outcome === 'persistence_failed_before_send') {
      toast.error('This device could not safely prepare the retry, so nothing was sent. Free device storage and try again.');
    }
  };

  const handleDirectorOverrideConfirm = async (result: { overrideWeight?: number; overrideReason: string }) => {
    if (!selectedRegistration) return;
    
    setDirectorOverrideLoading(true);
    try {
      // For check-in overrides with weight, proceed with check-in using override weight
      if (directorOverrideParams?.type === 'check-in' && result.overrideWeight) {
        await checkInMutation.mutateAsync({
          registrationId: selectedRegistration.id,
          weight: result.overrideWeight,
        });
        toast.success(`Director override: ${selectedRegistration.competitor.firstName} ${selectedRegistration.competitor.lastName} checked in at ${result.overrideWeight} lbs`);
      }
      setDirectorOverrideParams(null);
      setSelectedRegistration(null);
      setCheckInWeight('');
    } catch (error) {
      toast.error('Director override failed. Check connection and try again.');
    } finally {
      setDirectorOverrideLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
      {/* Connection status banner (#138 offline resilience) */}
      <ConnectionStatusBanner pendingCount={offlineOperations.pending.length} />
      {cachedSnapshotAt && (
        <div role="status" className="border-b border-warning bg-warning/10 px-4 py-3 text-center text-sm text-warning dark:border-warning/30 dark:bg-warning/20 dark:text-warning">
          Cached check-in list from {new Date(cachedSnapshotAt).toLocaleTimeString()}. Server changes may be newer; offline actions remain queued until reconnection.
        </div>
      )}
      {/* Header */}
      <div className="bg-white dark:bg-surface-900 shadow">
        <div className="px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <Link
                to={`/tournaments/${tournamentId}`}
                aria-label={CHECK_IN_ACCESSIBLE_LABELS.back}
                className="mr-3 text-surface-600 dark:text-surface-400 hover:text-primary-600 dark:hover:text-primary-300"
              >
                <ChevronLeft className="h-6 w-6" />
              </Link>
              <div>
                <h1 className="text-xl font-bold text-surface-900 dark:text-white">Check-In</h1>
                <p className="text-sm text-surface-600 dark:text-surface-400">{tournament?.name}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="px-4 pb-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatTile label="Registered" value={stats.total} accent="blue" />
          <StatTile label="Checked In" value={stats.checkedIn} accent="green" />
          <StatTile label="Missing" value={stats.total - stats.checkedIn} accent="yellow" />
          <StatTile label="Complete" value={`${Math.round((stats.checkedIn / stats.total) * 100) || 0}%`} accent="purple" />
        </div>
        {/* Progress Bar */}
        <div className="px-4 pb-4">
          <div className="w-full bg-surface-200 dark:bg-surface-700 rounded-full h-2.5">
            <div
              className="bg-success h-2.5 rounded-full transition-all duration-500"
              style={{ width: `${stats.total > 0 ? Math.round((stats.checkedIn / stats.total) * 100) : 0}%` }}
            />
          </div>
          <p className="text-xs text-surface-600 dark:text-surface-400 mt-1 text-center">
            {stats.checkedIn} / {stats.total} checked in ({stats.total > 0 ? Math.round((stats.checkedIn / stats.total) * 100) : 0}%)
          </p>
        </div>
      </div>

      {(offlineOperations.operations.length > 0 || unpersistedDeliveryWarning) && (
        <div className="m-4 space-y-2">
          {unpersistedDeliveryWarning && <OperationStatus state="rejected" message={unpersistedDeliveryWarning} actionLabel="I verified server state" onAction={() => setUnpersistedDeliveryWarning('')} />}
          {buildOfflineOperationStatuses('check-in', offlineOperations.pending.length, offlineOperations.needsReview.length, offlineOperations.syncing)
            .map((status) => <OperationStatus key={status.state} {...status} />)}
          {offlineOperations.pending.length > 0 && (
            <Button size="sm" variant="secondary" onClick={() => void syncStagedCheckIns()} loading={offlineOperations.syncing} disabled={offlineOperations.queueBusy}>Sync pending check-ins</Button>
          )}
          {offlineOperations.needsReview.map((operation) => {
            const retrying = offlineOperations.retryingIds.has(operation.id);
            const retryable = operation.status === 'needs_review' && !retrying;
            const registration = registrations?.find((candidate) => candidate.id === operation.targetId);
            const label = registration
              ? `${registration.competitor.firstName} ${registration.competitor.lastName}`
              : `Check-in #${operation.targetId.slice(0, 8)}`;
            const weight = operation.payload.checkInWeight;
            const message = operation.status === 'delivery_uncertain'
              ? buildDeliveryUncertainMessage('check-in', label)
              : buildOfflineReviewMessage('check-in', operation.targetId, operation.lastError, {
                label,
                attempted: typeof weight === 'number' ? `Checked in at ${formatCheckInWeight(weight)} lbs` : 'Checked in',
                createdAt: operation.createdAt,
              });
            return (
            <OperationStatus
              key={operation.id}
              state={retrying ? 'retrying' : 'rejected'}
              message={message}
              actionLabel={retryable ? 'Retry' : undefined}
              onAction={retryable ? () => void retryStagedCheckIn(operation.id) : undefined}
            >
              <Button size="sm" variant="secondary" onClick={() => { setDiscardOfflineError(''); setDiscardOfflineId(operation.id); }} disabled={retrying}>
                Discard local change
              </Button>
            </OperationStatus>
            );
          })}
        </div>
      )}

      {/* Search and Filters */}
      <div className="p-4 bg-white dark:bg-surface-900 border-b border-surface-200 dark:border-surface-700 sticky top-0 z-10 space-y-3">
        <Input
          ref={searchRef}
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder='Search by name or school... (press "/" to focus)'
          inputClassName="pl-10 pr-4 py-3 text-lg"
          leftIcon={<Search className="h-5 w-5" />}
        />

        <div className="flex gap-2 overflow-x-auto pb-1 flex-wrap">
          <Select
            aria-label={CHECK_IN_ACCESSIBLE_LABELS.status}
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as 'all' | 'checked' | 'unchecked')}
            className="text-sm"
          >
            <option value="all">All Status</option>
            <option value="unchecked">Not Checked In</option>
            <option value="checked">Checked In</option>
          </Select>

          <Select
            aria-label={CHECK_IN_ACCESSIBLE_LABELS.event}
            value={filterEvent}
            onChange={(e) => setFilterEvent(e.target.value as 'all' | 'patterns' | 'sparring')}
            className="text-sm"
          >
            <option value="all">All Events</option>
            <option value="patterns">Patterns Only</option>
            <option value="sparring">Sparring Only</option>
          </Select>

          <Select
            aria-label={CHECK_IN_ACCESSIBLE_LABELS.school}
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
            aria-label={CHECK_IN_ACCESSIBLE_LABELS.sort}
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
          <Button variant="success" className="w-full" loading={isBulkCheckingIn} onClick={() => void handleBulkCheckIn()}>
            <Users className="h-4 w-4 mr-2" />
            Check In All Filtered ({uncheckedFiltered.length})
          </Button>
        )}
      </div>

      {/* Registration List */}
      <div className="p-4">
        {failedBulkIds.length > 0 && (
          <OperationStatus
            state="rejected"
            message={`${failedBulkIds.length} bulk check-in${failedBulkIds.length === 1 ? '' : 's'} failed after all requests finished: ${failedBulkNames.join(', ')}.`}
            actionLabel="Retry failed"
            onAction={() => void handleBulkCheckIn(failedBulkIds)}
          />
        )}
        {uncertainBulkIds.length > 0 && (
          <OperationStatus
            state="rejected"
            message={`${uncertainBulkIds.length} check-in acknowledgement${uncertainBulkIds.length === 1 ? ' was' : 's were'} lost for ${uncertainBulkNames.join(', ')}. The server may have accepted these check-ins. Refresh and verify server state; do not retry them from this notice.`}
            actionLabel={isBulkCheckingIn ? undefined : 'I verified server state'}
            onAction={isBulkCheckingIn ? undefined : () => setUncertainBulkIds([])}
          />
        )}
        {isLoading ? (
          <div className="space-y-3">
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </div>
        ) : registrationsError ? (
          <OperationStatus
            state="rejected"
            message="Could not load registrations. Check the venue connection and try again."
            actionLabel="Retry"
            onAction={() => void retryRegistrations()}
          />
        ) : sortedRegistrations.length === 0 ? (
          <EmptyState
            icon={<Users className="h-12 w-12 text-surface-400" />}
            title={
              filterStatus !== 'all' || filterEvent !== 'all' || schoolFilter || searchTerm
                ? 'No matches found'
                : 'No registrations yet'
            }
            description={
              filterStatus !== 'all' || filterEvent !== 'all' || schoolFilter || searchTerm
                ? 'No registrations match your current filters. Try adjusting your search criteria.'
                : 'Registrations will appear here once competitors are added to this tournament.'
            }
          />
        ) : (
          <div className="space-y-2">
            {sortedRegistrations.map((registration) => (
              <div
                key={registration.id}
                className={`bg-white dark:bg-surface-900 rounded-lg shadow p-4 ${
                  isCheckedIn(registration) ? 'border-l-4 border-success' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center">
                      <span className="font-semibold text-surface-900 dark:text-white">
                        {registration.competitor.firstName} {registration.competitor.lastName}
                      </span>
                      {isCheckedIn(registration) && (
                        <CheckCircle className="h-5 w-5 text-success ml-2" />
                      )}
                    </div>
                    <div className="text-sm text-surface-600 dark:text-surface-400 mt-1">
                      {registration.competitor.schoolDojang || 'No School'} •{' '}
                      {registration.competitor.belt}
                      {registration.ageAtTournament && ` • Age ${registration.ageAtTournament}`}
                    </div>
                    <div className="flex gap-2 mt-2">
                      {registration.patterns && (
                        <span className="text-xs px-2 py-1 bg-info/10 text-info rounded">
                          Patterns
                        </span>
                      )}
                      {registration.sparring && (
                        <span className="text-xs px-2 py-1 bg-danger/10 text-danger rounded">
                          Sparring
                          {registration.weightAtRegistration && ` (${registration.weightAtRegistration} lbs)`}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="ml-4">
                    {stagedCheckInIds.has(registration.id) ? (
                      <span className="text-sm font-medium text-warning">Pending sync</span>
                    ) : registration.checkedIn ? (
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
                  <div className="mt-2 text-sm text-surface-600 dark:text-surface-400 flex items-center">
                    <Scale className="h-4 w-4 mr-1" />
                    Weigh-in: {formatCheckInWeight(registration.checkInWeight)} lbs
                    {registration.weightAtRegistration &&
                      registration.checkInWeight !== registration.weightAtRegistration && (
                        <span
                          className={`ml-2 ${
                            registration.checkInWeight > registration.weightAtRegistration
                              ? 'text-danger'
                              : 'text-success'
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
        <Modal
          isOpen={!!selectedRegistration}
          onClose={() => {
            setSelectedRegistration(null);
            setCheckInWeight('');
          }}
          title={`Check In: ${selectedRegistration.competitor.firstName} ${selectedRegistration.competitor.lastName}`}
          footer={
            <>
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
                  submitCheckIn({
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
            </>
          }
        >
          <div className="mb-4 p-3 bg-surface-50 dark:bg-surface-800 rounded-lg">
            <div className="text-sm text-surface-600 dark:text-surface-400">Registered Weight</div>
            <div className="text-lg font-semibold text-surface-900 dark:text-white">
              {selectedRegistration.weightAtRegistration || 'Not recorded'} lbs
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
              <Scale className="h-4 w-4 inline mr-1" />
              Weigh-In Weight (lbs)
            </label>
            <Input
              type="number"
              value={checkInWeight}
              onChange={(e) => setCheckInWeight(e.target.value)}
              min={20}
              max={400}
              inputClassName="p-3 text-lg"
              placeholder="Enter weight"
              autoFocus
            />
            {checkInWeight && (parseFloat(checkInWeight) < 20 || parseFloat(checkInWeight) > 400) && (
              <p className="text-danger text-sm mt-1">Weight must be between 20 and 400 lbs</p>
            )}
          </div>

          {checkInWeight &&
            selectedRegistration.weightAtRegistration &&
            Math.abs(parseFloat(checkInWeight) - selectedRegistration.weightAtRegistration) > 2 && (
              <div className="mb-4 p-3 bg-warning/10 border border-warning/30 rounded-lg flex items-start">
                <AlertTriangle className="h-5 w-5 text-warning mr-2 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-warning dark:text-warning">
                  Weight differs by more than 2 lbs from registration. Consider verifying weight class eligibility.
                </div>
              </div>
            )}
        </Modal>
      )}
      <ConfirmDialog
        isOpen={discardOfflineId !== null}
        onClose={() => { setDiscardOfflineError(''); setDiscardOfflineId(null); }}
        onConfirm={() => {
          try {
            if (discardOfflineId) offlineOperations.remove(discardOfflineId);
            setDiscardOfflineError('');
            setDiscardOfflineId(null);
          } catch {
            setDiscardOfflineError('The local change could not be removed from this device. Free device storage and try again.');
          }
        }}
        title="Discard unsynced check-in?"
        message={<>
          <span className="block">This permanently removes the local check-in change. The server registration will remain unchanged.</span>
          {discardOfflineError && <span role="alert" className="mt-2 block text-danger">{discardOfflineError}</span>}
        </>}
        confirmText="Discard local change"
        variant="danger"
      />

      {/* Director Override Dialog (#139) */}
      <DirectorOverrideDialog
        isOpen={directorOverrideParams !== null}
        onClose={() => {
          setDirectorOverrideParams(null);
          setSelectedRegistration(null);
        }}
        onConfirm={handleDirectorOverrideConfirm}
        params={directorOverrideParams}
        isLoading={directorOverrideLoading}
      />
    </div>
  );
}
