import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Calendar,
  Clock,
  Download,
  RefreshCw,
  AlertTriangle,
  Monitor,
  AlertCircle,
} from 'lucide-react';
import { CardSkeleton } from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';
import Spinner from '../components/ui/Spinner';
import { getAuthHeaders } from '../context/AuthContext';
import { Card, CardHeader, CardBody, Modal, ConfirmDialog, Select } from '../components/ui';
import OperationStatus from '../components/ui/OperationStatus';
import { PageHeader } from '../components/ui';
import { Button } from '../components/ui';
import { Input } from '../components/ui';
import { Label } from '../components/ui';
import { DataTable, TableHead, TableBody } from '../components/ui';
import ScheduleOptimizationReview from '../components/schedule/ScheduleOptimizationReview';
import { isScheduleConditionBufferDirty, type ScheduleRecommendationRecord } from '../utils/schedule-recommendation';

interface ScheduledDivision {
  divisionId: string;
  divisionName: string;
  eventType: string;
  beltLevel: string;
  gender: string;
  competitorCount: number;
  ring: number;
  startTime: string;
  endTime: string;
  estimatedDurationMinutes: number;
  locked?: boolean;
  // Optional list of competitor names, populated when the
  // /api/tournaments/:id/schedule endpoint enriches the response
  // with division contents (used by the bracket preview to show
  // who's actually in each division). Server may omit it for
  // performance on large tournaments.
  competitorNames?: string[];
}

interface ScheduleConfig {
  startTime: string;
  endTime: string;
  ringCount: number;
  matchDurationMinutes: {
    patterns: number;
    sparring: number;
  };
  breakBetweenDivisions: number;
}

interface TournamentSchedule {
  tournamentId: string;
  tournamentName: string;
  date: string;
  config: ScheduleConfig;
  schedule: ScheduledDivision[];
  warnings: string[];
}

interface ScheduleImpact {
  affectedDivisionIds: string[];
  affectedLabels: string[];
  ringChanges: number;
  timeChanges: number;
  addedWarnings: string[];
  removedWarnings: string[];
}

interface SchedulePreview {
  before: TournamentSchedule;
  after: TournamentSchedule;
  impact: ScheduleImpact;
  expectedUpdatedAt: string;
  expectedInputVersion: string;
  operationKey: string;
  proposedConfig: ScheduleConfig;
}

interface ScheduleConditions {
  restWindowMinutes: number;
  liveDelaySources: Array<{ ring: number; delayMinutes: number; source: string; observedAt: string }>;
  incidentSources: Array<{ incidentId: string; ring: number; label: string; observedAt: string }>;
}

interface TournamentIncident { id: string; type: string; severity: string; actionTaken: string | null; deletedAt: string | null }

interface ScheduleDelayPreview {
  before: unknown;
  after: unknown;
  impact: {
    affectedDivisionIds: string[];
    affectedDivisionNames: string[];
    divisionMoves: Array<{
      divisionId: string;
      divisionName: string;
      oldStartTime: string;
      newStartTime: string;
      oldEndTime: string;
      newEndTime: string;
      ring: number;
    }>;
    warnings: string[];
    endTimeOverruns: string[];
    conflicts: Array<{
      type: string;
      description: string;
      divisionIds: string[];
    }>;
  };
  expectedUpdatedAt: string;
  expectedInputVersion: string;
  operationKey: string;
}

export default function Schedule() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<Partial<ScheduleConfig>>({
    startTime: '09:00',
    endTime: '17:00',
    ringCount: 4,
    matchDurationMinutes: {
      patterns: 3,
      sparring: 5,
    },
    breakBetweenDivisions: 5,
  });

  const { data: schedule, isLoading, refetch } = useQuery<TournamentSchedule>({
    queryKey: ['schedule', id],
    queryFn: async () => {
      const res = await fetch(`/api/tournaments/${id}/schedule`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch schedule');
      return res.json();
    },
  });

  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [lastAuditId, setLastAuditId] = useState<string | null>(null);
  const [lastOperationKey, setLastOperationKey] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [uncertainOperation, setUncertainOperation] = useState<{ phase: 'apply' | 'undo'; operationKey: string; auditId?: string } | null>(null);
  const [optimizationOpen, setOptimizationOpen] = useState(false);
  const [optimizationApplyConfirm, setOptimizationApplyConfirm] = useState(false);
  const [optimizationStatus, setOptimizationStatus] = useState<{ state: 'pending' | 'rejected' | 'resolved'; message: string } | null>(null);
  const [optimizationUncertain, setOptimizationUncertain] = useState(false);
  const [optimizationUndoConfirm, setOptimizationUndoConfirm] = useState<{ recommendation: ScheduleRecommendationRecord; returnToReview: boolean } | null>(null);
  const [restWindowMinutes, setRestWindowMinutes] = useState(10);
  const [ringDelays, setRingDelays] = useState<Record<number, string>>({});
  const [incidentRings, setIncidentRings] = useState<Record<string, string>>({});
  const [conditionsHydratedForId, setConditionsHydratedForId] = useState<string | null>(null);
  const [delayModalOpen, setDelayModalOpen] = useState(false);
  const [delayType, setDelayType] = useState<'ring' | 'division'>('ring');
  const [delayRing, setDelayRing] = useState<number>(1);
  const [delayDivisionId, setDelayDivisionId] = useState<string>('');
  const [delayMinutes, setDelayMinutes] = useState<number>(15);
  const [delayReason, setDelayReason] = useState<string>('');
  const [delayPreview, setDelayPreview] = useState<ScheduleDelayPreview | null>(null);
  const [delayConfirmOpen, setDelayConfirmOpen] = useState(false);

  const { data: scheduleConditions, isLoading: conditionsLoading, isError: scheduleConditionsError, refetch: refetchConditions } = useQuery<ScheduleConditions>({
    queryKey: ['schedule-conditions', id], enabled: Boolean(id), retry: false,
    queryFn: async () => {
      const res = await fetch(`/api/recommendations/tournament/${id}/schedule/conditions`, { headers: getAuthHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Live conditions could not be loaded');
      return body as ScheduleConditions;
    },
  });
  const { data: unresolvedIncidents = [], isLoading: incidentsLoading, isError: incidentsError, refetch: refetchIncidents } = useQuery<TournamentIncident[]>({
    queryKey: ['schedule-incidents', id], enabled: Boolean(id),
    queryFn: async () => {
      const res = await fetch(`/api/incidents/tournament/${id}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Incidents could not be loaded');
      return (await res.json() as TournamentIncident[]).filter((incident) => !incident.actionTaken && !incident.deletedAt);
    },
  });

  const {
    data: optimizationRecommendations,
    isLoading: optimizationLoading,
    isError: optimizationLoadError,
    refetch: refetchOptimization,
  } = useQuery<ScheduleRecommendationRecord[]>({
    queryKey: ['schedule-recommendations', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const res = await fetch(`/api/recommendations/tournament/${id}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Current schedule recommendations could not be loaded');
      return (await res.json() as ScheduleRecommendationRecord[])
        .filter((item) => item.recommendationType === 'schedule_optimization_v1');
    },
  });
  const latestOptimization = optimizationRecommendations?.[0];
  const latestReversibleOptimization = optimizationRecommendations?.find((item) => item.status === 'applied' && item.operationAudit?.canUndo);
  const conditionsHydrated = Boolean(id && conditionsHydratedForId === id && scheduleConditions);
  const conditionsDirty = conditionsHydrated && isScheduleConditionBufferDirty(
    { restWindowMinutes, ringDelays, incidentRings },
    scheduleConditions,
  );
  const optimizationInputsUnavailable = !conditionsHydrated || conditionsDirty || scheduleConditionsError || incidentsLoading || incidentsError;

  const optimizationMutation = useMutation({
    mutationFn: async ({ action, recommendationId }: { action: 'propose' | 'approve' | 'reject' | 'apply' | 'undo'; recommendationId?: string; returnToReview?: boolean }) => {
      if (optimizationInputsUnavailable && (action === 'propose' || action === 'approve' || action === 'apply')) {
        throw new Error('Save live-condition edits and load unresolved incidents before this action');
      }
      const path = action === 'propose'
        ? `/api/recommendations/tournament/${id}/schedule/propose`
        : `/api/recommendations/tournament/${id}/${recommendationId}/${action}`;
      const res = await fetch(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: action === 'reject' ? JSON.stringify({ reason: 'Rejected during director schedule review' }) : undefined,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : `Could not ${action} schedule recommendation`);
      return { action };
    },
    onMutate: ({ action }) => setOptimizationStatus({ state: 'pending', message: `${action === 'propose' ? 'Generating' : `${action[0].toUpperCase()}${action.slice(1)}ing`} the deterministic schedule recommendation…` }),
    onError: (error, variables) => {
      const uncertain = error instanceof TypeError && (variables.action === 'apply' || variables.action === 'undo');
      if (uncertain) {
        setOptimizationUncertain(true);
        setOptimizationApplyConfirm(false);
        setOptimizationOpen(false);
      } else if (variables.action === 'apply' || variables.action === 'undo') {
        setOptimizationApplyConfirm(false);
        setOptimizationUndoConfirm(null);
        if (variables.action === 'apply' || variables.returnToReview) setOptimizationOpen(true);
      }
      setOptimizationStatus({
        state: 'rejected',
        message: uncertain
        ? 'The request was sent but its acknowledgement was not received. It may have changed the schedule. Do not submit again; check current server state.'
        : error instanceof Error ? error.message : 'Schedule recommendation operation failed',
      });
    },
    onSuccess: async ({ action }) => {
      await queryClient.invalidateQueries({ queryKey: ['schedule-recommendations', id] });
      if (action === 'apply' || action === 'undo') await refetch();
      setOptimizationApplyConfirm(false);
      setOptimizationUndoConfirm(null);
      setOptimizationUncertain(false);
      setOptimizationStatus({ state: 'resolved', message: action === 'propose'
        ? 'Proposal ready for review. The schedule has not changed.'
        : action === 'approve' ? 'Proposal approved. The schedule is still unchanged.'
          : action === 'apply' ? 'Approved optimization applied and reconciled with the current schedule.'
            : action === 'undo' ? 'Optimization undone after verifying no later schedule edit.'
              : 'Proposal rejected without changing the schedule.' });
    },
  });

  const scheduleLockMutation = useMutation({
    mutationFn: async ({ divisionId, locked }: { divisionId: string; locked: boolean }) => {
      const res = await fetch(`/api/recommendations/tournament/${id}/schedule/divisions/${divisionId}/lock`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify({ locked }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Schedule lock could not be saved');
      return { divisionId, locked };
    },
    onMutate: ({ locked }) => setOptimizationStatus({ state: 'pending', message: `${locked ? 'Locking' : 'Unlocking'} the reviewed schedule position…` }),
    onError: (error) => setOptimizationStatus({ state: 'rejected', message: error instanceof Error ? error.message : 'Schedule lock could not be saved' }),
    onSuccess: async ({ locked }) => {
      await Promise.all([refetch(), queryClient.invalidateQueries({ queryKey: ['schedule-recommendations', id] })]);
      setOptimizationStatus({ state: 'resolved', message: `Schedule position ${locked ? 'locked' : 'unlocked'} and current proposals invalidated for review.` });
    },
  });

  const conditionsMutation = useMutation({
    mutationFn: async () => {
      const body = {
        restWindowMinutes,
        ringDelays: Object.entries(ringDelays).flatMap(([ring, value]) => value === '' ? [] : [{ ring: Number(ring), delayMinutes: Number(value) }]),
        incidentBlocks: Object.entries(incidentRings).flatMap(([incidentId, ring]) => ring === '' ? [] : [{ incidentId, ring: Number(ring) }]),
      };
      const res = await fetch(`/api/recommendations/tournament/${id}/schedule/conditions`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify(body),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Live conditions could not be saved');
    },
    onMutate: () => setOptimizationStatus({ state: 'pending', message: 'Saving bounded live conditions with server-confirmed provenance…' }),
    onError: (error) => setOptimizationStatus({ state: 'rejected', message: error instanceof Error ? error.message : 'Live conditions could not be saved' }),
    onSuccess: async () => {
      await Promise.all([refetchConditions(), queryClient.invalidateQueries({ queryKey: ['schedule-recommendations', id] })]);
      setOptimizationStatus({ state: 'resolved', message: 'Live conditions saved with server time. Existing proposals were marked stale; generate a fresh proposal.' });
    },
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/tournaments/${id}/schedule/preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ config }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to preview schedule');
      return res.json() as Promise<SchedulePreview>;
    },
    onMutate: () => setOperationError(null),
    onSuccess: setPreview,
    onError: (error) => setOperationError(error instanceof Error ? error.message : 'Failed to preview schedule'),
  });

  const regenerateMutation = useMutation({
    mutationFn: async (confirmed: SchedulePreview) => {
      const res = await fetch(`/api/tournaments/${id}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          config: confirmed.proposedConfig,
          expectedUpdatedAt: confirmed.expectedUpdatedAt,
          expectedInputVersion: confirmed.expectedInputVersion,
          operationKey: confirmed.operationKey,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to regenerate schedule');
      return res.json() as Promise<TournamentSchedule & { auditId: string }>;
    },
    onMutate: () => setOperationError(null),
    onSuccess: async (result, confirmed) => {
      await refetch();
      setLastAuditId(result.auditId);
      setLastOperationKey(confirmed.operationKey);
      setPreview(null);
    },
    onError: (error, confirmed) => {
      if (error instanceof TypeError) {
        setUncertainOperation({ phase: 'apply', operationKey: confirmed.operationKey });
        setPreview(null);
        return;
      }
      setOperationError(error instanceof Error ? error.message : 'Failed to regenerate schedule');
    },
  });

  const undoMutation = useMutation({
    mutationFn: async ({ auditId }: { auditId: string; operationKey: string }) => {
      const res = await fetch(`/api/tournaments/${id}/schedule/undo/${auditId}`, { method: 'POST', headers: getAuthHeaders() });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to undo schedule change');
    },
    onMutate: () => setOperationError(null),
    onSuccess: async () => { await refetch(); setLastAuditId(null); setLastOperationKey(null); },
    onError: (error, operation) => {
      if (error instanceof TypeError) {
        setUncertainOperation({ phase: 'undo', operationKey: operation.operationKey, auditId: operation.auditId });
        return;
      }
      setOperationError(error instanceof Error ? error.message : 'Failed to undo schedule change');
    },
  });

  const statusMutation = useMutation({
    mutationFn: async (operation: NonNullable<typeof uncertainOperation>) => {
      const res = await fetch(`/api/tournaments/${id}/schedule/operations/${operation.operationKey}`, { headers: getAuthHeaders() });
      if (res.status === 404) return { found: false as const };
      if (!res.ok) throw new Error('Could not check schedule operation status');
      return { found: true as const, ...(await res.json() as { auditId: string; applied: boolean; undone: boolean }) };
    },
    onSuccess: async (status, operation) => {
      if (!status.found) {
        setUncertainOperation(null);
        setOperationError('The server has no record of that schedule change. Review the latest schedule before trying again.');
        await refetch();
        return;
      }
      await refetch();
      if (operation.phase === 'apply' && !status.undone) {
        setLastAuditId(status.auditId);
        setLastOperationKey(operation.operationKey);
      } else if (operation.phase === 'undo' && status.undone) {
        setLastAuditId(null);
        setLastOperationKey(null);
      }
      setUncertainOperation(null);
    },
    onError: (error) => setOperationError(error instanceof Error ? error.message : 'Could not check schedule operation status'),
  });

  const delayPreviewMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/tournaments/${id}/schedule/delay/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          delayType,
          ringNumber: delayType === 'ring' ? delayRing : undefined,
          divisionId: delayType === 'division' ? delayDivisionId : undefined,
          delayMinutes,
          reason: delayReason,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to preview delay');
      }
      return res.json() as Promise<ScheduleDelayPreview>;
    },
    onSuccess: (preview) => {
      setDelayPreview(preview);
      setDelayModalOpen(false);
      setDelayConfirmOpen(true);
    },
    onError: (error) => setOperationError(error instanceof Error ? error.message : 'Failed to preview delay'),
  });

  const delayApplyMutation = useMutation({
    mutationFn: async (preview: ScheduleDelayPreview) => {
      const res = await fetch(`/api/tournaments/${id}/schedule/delay/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          delayInput: {
            delayType,
            ringNumber: delayType === 'ring' ? delayRing : undefined,
            divisionId: delayType === 'division' ? delayDivisionId : undefined,
            delayMinutes,
            reason: delayReason,
          },
          expectedUpdatedAt: preview.expectedUpdatedAt,
          expectedInputVersion: preview.expectedInputVersion,
          operationKey: preview.operationKey,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to apply delay');
      }
      return res.json();
    },
    onSuccess: async (result) => {
      await refetch();
      setDelayPreview(null);
      setDelayConfirmOpen(false);
      setLastAuditId(result.auditId);
      setOperationError(null);
    },
    onError: (error) => setOperationError(error instanceof Error ? error.message : 'Failed to apply delay'),
  });

  useEffect(() => {
    if (schedule?.config && !preview) setConfig(schedule.config);
  }, [preview, schedule?.config]);

  useEffect(() => {
    setConditionsHydratedForId(null);
  }, [id]);

  useEffect(() => {
    if (!scheduleConditions || !id) return;
    setRestWindowMinutes(scheduleConditions.restWindowMinutes);
    setRingDelays(Object.fromEntries(scheduleConditions.liveDelaySources.map((entry) => [entry.ring, String(entry.delayMinutes)])));
    setIncidentRings(Object.fromEntries(scheduleConditions.incidentSources.map((entry) => [entry.incidentId, String(entry.ring)])));
    setConditionsHydratedForId(id);
  }, [id, scheduleConditions]);

  const scheduleBusy = previewMutation.isPending || regenerateMutation.isPending || undoMutation.isPending || statusMutation.isPending || optimizationMutation.isPending || scheduleLockMutation.isPending || conditionsMutation.isPending || optimizationUncertain || Boolean(uncertainOperation);

  const exportPDF = async () => {
    if (!schedule) return;

    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF('portrait', 'pt', 'letter');
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFontSize(18);
    doc.text(schedule.tournamentName, pageWidth / 2, 40, { align: 'center' });

    doc.setFontSize(12);
    doc.text('Tournament Schedule', pageWidth / 2, 60, { align: 'center' });

    doc.setFontSize(10);
    doc.text(
      `Date: ${new Date(schedule.date).toLocaleDateString()}`,
      pageWidth / 2,
      75,
      { align: 'center' }
    );

    const byRing: Record<number, ScheduledDivision[]> = {};
    schedule.schedule.forEach((div) => {
      if (!byRing[div.ring]) byRing[div.ring] = [];
      byRing[div.ring].push(div);
    });

    let y = 100;
    const leftMargin = 50;
    const colWidths = [60, 200, 80, 60, 60];

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Time', leftMargin, y);
    doc.text('Division', leftMargin + colWidths[0], y);
    doc.text('Event', leftMargin + colWidths[0] + colWidths[1], y);
    doc.text('Count', leftMargin + colWidths[0] + colWidths[1] + colWidths[2], y);
    doc.text(
      'Duration',
      leftMargin + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3],
      y
    );
    y += 15;

    doc.setFont('helvetica', 'normal');

    Object.keys(byRing)
      .sort((a, b) => Number(a) - Number(b))
      .forEach((ring) => {
        doc.setFont('helvetica', 'bold');
        doc.setFillColor(240, 240, 240);
        doc.rect(leftMargin - 5, y - 10, pageWidth - 2 * leftMargin + 10, 15, 'F');
        doc.text(`Ring ${ring}`, leftMargin, y);
        y += 20;

        doc.setFont('helvetica', 'normal');

        byRing[Number(ring)].forEach((div) => {
          if (y > 700) {
            doc.addPage();
            y = 50;
          }

          doc.text(`${div.startTime}-${div.endTime}`, leftMargin, y);
          doc.text(div.divisionName.substring(0, 35), leftMargin + colWidths[0], y);
          doc.text(
            div.eventType === 'patterns' ? 'Patterns' : 'Sparring',
            leftMargin + colWidths[0] + colWidths[1],
            y
          );
          doc.text(
            String(div.competitorCount),
            leftMargin + colWidths[0] + colWidths[1] + colWidths[2],
            y
          );
          doc.text(
            `${div.estimatedDurationMinutes}m`,
            leftMargin + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3],
            y
          );
          y += 12;
        });

        y += 10;
      });

    if (schedule.warnings.length > 0) {
      y += 10;
      doc.setFont('helvetica', 'bold');
      doc.text('Notes:', leftMargin, y);
      y += 12;
      doc.setFont('helvetica', 'normal');
      schedule.warnings.forEach((warning) => {
        doc.text(`- ${warning}`, leftMargin, y);
        y += 12;
      });
    }

    const fileName = `${schedule.tournamentName.replace(/[^a-zA-Z0-9]/g, '_')}_Schedule.pdf`;
    doc.save(fileName);
  };

  const getRingColor = (ring: number) => {
    const colors = [
      { light: 'bg-info/100 border-info300', dark: 'dark:bg-info/900/30 dark:border-info700', text: 'text-info900 dark:text-info200' },
      { light: 'bg-success/100 border-success300', dark: 'dark:bg-success/900/30 dark:border-success700', text: 'text-success900 dark:text-success200' },
      { light: 'bg-warning/100 border-warning300', dark: 'dark:bg-warning/900/30 dark:border-warning700', text: 'text-warning900 dark:text-warning200' },
      { light: 'bg-primary-100 border-primary-300', dark: 'dark:bg-primary-900/30 dark:border-primary-700', text: 'text-primary-900 dark:text-primary-200' },
      { light: 'bg-pink-100 border-pink-300', dark: 'dark:bg-pink-900/30 dark:border-pink-700', text: 'text-pink-900 dark:text-pink-200' },
      { light: 'bg-orange-100 border-orange-300', dark: 'dark:bg-orange-900/30 dark:border-orange-700', text: 'text-orange-900 dark:text-orange-200' },
    ];
    return colors[(ring - 1) % colors.length];
  };

  // Group schedule by ring for display
  const scheduleByRing: Record<number, ScheduledDivision[]> = {};
  schedule?.schedule.forEach((div) => {
    if (!scheduleByRing[div.ring]) scheduleByRing[div.ring] = [];
    scheduleByRing[div.ring].push(div);
  });

  return (
    <div>
      {/* Page Header */}
      <PageHeader
        title={`Schedule - ${schedule?.tournamentName || ''}`}
        description={`${schedule?.schedule.length || 0} divisions scheduled`}
        actions={
          <div className="flex gap-2 sm:gap-3">
            <Button
              as={Link}
              to={`/display/${id}`}
              target="_blank"
              variant="secondary"
              aria-label="Open public display in new tab"
            >
              <Monitor className="h-4 w-4 mr-2" aria-hidden="true" />
              <span className="hidden sm:inline">Public Display</span>
            </Button>
            <Button
              variant="secondary"
              onClick={() => previewMutation.mutate()}
              disabled={scheduleBusy}
              aria-label="Regenerate schedule"
            >
              {previewMutation.isPending ? <Spinner size="sm" className="mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />}
              <span className="hidden sm:inline">{previewMutation.isPending ? 'Preparing preview...' : 'Regenerate'}</span>
            </Button>
            <Button
              variant="secondary"
              onClick={() => setOptimizationOpen(true)}
              disabled={scheduleBusy || !schedule?.schedule.length || optimizationInputsUnavailable}
              aria-label="Optimize live schedule"
            >
              <Clock className="h-4 w-4 mr-2" aria-hidden="true" />
              <span className="hidden sm:inline">Optimize live</span>
            </Button>
            <Button
              variant="secondary"
              onClick={() => setDelayModalOpen(true)}
              disabled={scheduleBusy || !schedule?.schedule.length}
              aria-label="Record schedule delay"
            >
              <AlertCircle className="h-4 w-4 mr-2" aria-hidden="true" />
              <span className="hidden sm:inline">Record Delay</span>
            </Button>
            <Button
              variant="primary"
              onClick={exportPDF}
              disabled={!schedule?.schedule.length}
              aria-label="Export schedule as PDF"
            >
              <Download className="h-4 w-4 mr-2" aria-hidden="true" />
              <span className="hidden sm:inline">Export PDF</span>
            </Button>
          </div>
        }
      >
        <Link
          to={`/tournaments/${id}`}
          className="text-sm text-surface-600 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300 flex items-center mb-2"
          aria-label="Back to Tournament"
        >
          <ArrowLeft className="h-4 w-4 mr-1" aria-hidden="true" />
          Back to Tournament
        </Link>
      </PageHeader>

      {operationError && !preview && <OperationStatus state="rejected" message={operationError} className="mb-6" />}
      {uncertainOperation && (
        <OperationStatus
          state="rejected"
          message={uncertainOperation.phase === 'apply'
            ? 'The schedule request was sent, but its acknowledgement was not received. It may have applied. Do not submit again until server status is checked.'
            : 'The undo request was sent, but its acknowledgement was not received. The previous schedule may already be restored.'}
          actionLabel={statusMutation.isPending ? undefined : 'Check server status'}
          onAction={statusMutation.isPending ? undefined : () => statusMutation.mutate(uncertainOperation)}
          className="mb-6"
        />
      )}
      {regenerateMutation.isPending && <OperationStatus state="pending" message="Applying the confirmed schedule and recording its audit history." className="mb-6" />}
      {undoMutation.isPending && <OperationStatus state="pending" message="Restoring the previous schedule after verifying no later change conflicts." className="mb-6" />}
      {lastAuditId && !undoMutation.isPending && !uncertainOperation && (
        <OperationStatus
          state="resolved"
          message="Schedule applied and reconciled. This change can be undone while no later schedule edit has replaced it."
          actionLabel="Undo schedule change"
          onAction={lastOperationKey ? () => undoMutation.mutate({ auditId: lastAuditId, operationKey: lastOperationKey }) : undefined}
          className="mb-6"
        />
      )}

      <Card className="mb-6">
        <CardHeader title="Live conditions" description="Director-confirmed delays and unresolved incidents expire automatically and are revalidated before application." />
        <CardBody className="space-y-4">
          {conditionsLoading && <div role="status" className="flex items-center gap-2 text-sm"><Spinner size="sm" /> Loading saved live conditionsâ€¦</div>}
          {scheduleConditionsError && <OperationStatus state="rejected" message="Stored live conditions could not be loaded. Editing and optimization are disabled until the authoritative snapshot is available." actionLabel="Try again" onAction={() => void refetchConditions()} />}
          {conditionsDirty && <div role="status" className="rounded-lg border border-warning300 bg-warning/50 p-3 text-sm text-warning900 dark:border-warning800 dark:bg-warning/950/30 dark:text-warning100"><p className="font-semibold">Unsaved changes</p><p>These live-condition edits are not used by the optimizer. Save or restore them before generating, approving, or applying a proposal.</p></div>}
          {incidentsLoading && <div role="status" className="flex items-center gap-2 text-sm"><Spinner size="sm" /> Loading unresolved incidents…</div>}
          {incidentsError && <OperationStatus state="rejected" message="Unresolved incidents could not be loaded. Saving and optimization are disabled so missing incident evidence is not treated as zero." actionLabel="Try again" onAction={() => void refetchIncidents()} />}
          <fieldset disabled={scheduleBusy || !conditionsHydrated || scheduleConditionsError || incidentsLoading || incidentsError} aria-busy={conditionsMutation.isPending || conditionsLoading} className="space-y-4">
            <div className="max-w-xs"><Label htmlFor="optimizer-rest-window">Athlete rest window (minutes)</Label><Input id="optimizer-rest-window" type="number" min={0} max={240} value={restWindowMinutes} onChange={(event) => setRestWindowMinutes(Number(event.target.value))} /></div>
            <div><h3 className="text-sm font-semibold text-surface-900 dark:text-white">Director-confirmed ring delays</h3><div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: schedule?.config.ringCount ?? 0 }, (_, index) => index + 1).map((ring) => <div key={ring}><Label htmlFor={`optimizer-ring-delay-${ring}`}>Ring {ring} delay (minutes)</Label><Input id={`optimizer-ring-delay-${ring}`} type="number" min={0} max={240} placeholder="No delay" value={ringDelays[ring] ?? ''} onChange={(event) => setRingDelays((current) => ({ ...current, [ring]: event.target.value }))} /></div>)}
            </div></div>
            {unresolvedIncidents.length > 0 && <div><h3 className="text-sm font-semibold text-surface-900 dark:text-white">Unresolved incident ring blocks</h3><div className="mt-2 grid gap-3 sm:grid-cols-2">
              {unresolvedIncidents.map((incident) => <div key={incident.id}><Label htmlFor={`optimizer-incident-${incident.id}`}>{incident.type} ({incident.severity})</Label><Select id={`optimizer-incident-${incident.id}`} value={incidentRings[incident.id] ?? ''} onChange={(event) => setIncidentRings((current) => ({ ...current, [incident.id]: event.target.value }))}><option value="">Does not block a ring</option>{Array.from({ length: schedule?.config.ringCount ?? 0 }, (_, index) => index + 1).map((ring) => <option key={ring} value={ring}>Blocks Ring {ring}</option>)}</Select></div>)}
            </div></div>}
            <Button variant="secondary" loading={conditionsMutation.isPending} disabled={!conditionsHydrated || Boolean(scheduleConditionsError) || incidentsLoading || incidentsError} onClick={() => conditionsMutation.mutate()}>Save live conditions</Button>
          </fieldset>
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardHeader title="Live schedule optimization" description="Deterministic, server-validated proposals. Approval does not change the schedule; application is a separate confirmed action." />
        <CardBody className="space-y-3">
          {optimizationStatus && <OperationStatus state={optimizationStatus.state} message={optimizationStatus.message}
            actionLabel={optimizationStatus.state === 'rejected' ? 'Check current server state' : undefined}
            onAction={optimizationStatus.state === 'rejected' ? () => void (async () => {
              const result = await refetchOptimization();
              await refetch();
              if (!result.error) {
                setOptimizationUncertain(false);
                setOptimizationStatus({ state: 'resolved', message: 'Current recommendation and schedule state reloaded from the server. Review them before another action.' });
              }
            })() : undefined} />}
          {optimizationLoading ? <div role="status" className="flex items-center gap-2 text-sm"><Spinner size="sm" /> Loading current optimization state…</div>
            : optimizationLoadError ? <OperationStatus state="rejected" message="Current optimization state is unavailable. Proposal actions are disabled until the server state is known." actionLabel="Try again" onAction={() => void refetchOptimization()} />
              : <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-surface-600 dark:text-surface-300">{latestOptimization ? `Latest proposal: ${latestOptimization.status}. Review its evidence before acting.` : 'No optimization proposal exists for the current schedule.'}</p>
                <div className="flex gap-2">
                  {latestOptimization && <Button variant="secondary" onClick={() => setOptimizationOpen(true)}>Review proposal</Button>}
                  {(!latestOptimization || latestOptimization.status === 'rejected' || latestOptimization.status === 'applied') && (
                    <Button variant="secondary" loading={optimizationMutation.isPending} disabled={optimizationInputsUnavailable} onClick={() => optimizationMutation.mutate({ action: 'propose' })}>Generate proposal</Button>
                  )}
                </div>
              </div>}
          {latestReversibleOptimization && latestReversibleOptimization.id !== latestOptimization?.id && (
            <OperationStatus state="resolved" message={`A previously applied optimization remains reversible (${latestReversibleOptimization.proposedDiff.moved.length} moves).`}
              actionLabel="Review undo" onAction={() => setOptimizationUndoConfirm({ recommendation: latestReversibleOptimization, returnToReview: false })} />
          )}
        </CardBody>
      </Card>

      {/* Configuration */}
      <Card className="mb-6">
        <CardHeader title="Schedule Configuration" as="h2" />
        <CardBody>
          <fieldset disabled={scheduleBusy} aria-busy={scheduleBusy} className="contents">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <Label htmlFor="schedule-start-time">Start Time</Label>
              <Input
                id="schedule-start-time"
                type="time"
                value={config.startTime}
                onChange={(e) =>
                  setConfig({ ...config, startTime: e.target.value })
                }
              />
            </div>
            <div>
              <Label htmlFor="schedule-end-time">End Time</Label>
              <Input
                id="schedule-end-time"
                type="time"
                value={config.endTime}
                onChange={(e) =>
                  setConfig({ ...config, endTime: e.target.value })
                }
              />
            </div>
            <div>
              <Label htmlFor="schedule-ring-count">Number of Rings</Label>
              <Input
                id="schedule-ring-count"
                type="number"
                inputMode="numeric"
                min={1}
                max={10}
                value={config.ringCount}
                onChange={(e) =>
                  setConfig({ ...config, ringCount: parseInt(e.target.value) || 4 })
                }
              />
            </div>
            <div>
              <Label htmlFor="schedule-break">Break Between (min)</Label>
              <Input
                id="schedule-break"
                type="number"
                inputMode="numeric"
                min={0}
                max={30}
                value={config.breakBetweenDivisions}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    breakBetweenDivisions: parseInt(e.target.value) || 5,
                  })
                }
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div>
              <Label htmlFor="schedule-patterns-duration">Patterns Match Duration (min)</Label>
              <Input
                id="schedule-patterns-duration"
                type="number"
                inputMode="numeric"
                min={1}
                max={15}
                value={config.matchDurationMinutes?.patterns}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    matchDurationMinutes: {
                      ...config.matchDurationMinutes!,
                      patterns: parseInt(e.target.value) || 3,
                    },
                  })
                }
              />
            </div>
            <div>
              <Label htmlFor="schedule-sparring-duration">Sparring Match Duration (min)</Label>
              <Input
                id="schedule-sparring-duration"
                type="number"
                inputMode="numeric"
                min={1}
                max={15}
                value={config.matchDurationMinutes?.sparring}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    matchDurationMinutes: {
                      ...config.matchDurationMinutes!,
                      sparring: parseInt(e.target.value) || 5,
                    },
                  })
                }
              />
            </div>
          </div>
          </fieldset>
        </CardBody>
      </Card>

      {/* Warnings — time conflicts and end-time overruns. role="alert" so SR
          users hear about the conflict without having to spot the yellow box. */}
      {schedule?.warnings && schedule.warnings.length > 0 && (
        <div
          role="alert"
          className="bg-warning/50 dark:bg-warning/900/20 border border-warning200 dark:border-warning800 rounded-lg p-4 mb-6"
        >
          <div className="flex items-start">
            <AlertTriangle className="h-5 w-5 text-warning600 dark:text-warning400 mr-2 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h3 className="font-medium text-warning800 dark:text-warning200">Schedule Warnings</h3>
              <ul className="mt-1 text-sm text-warning700 dark:text-warning300 list-disc list-inside">
                {schedule.warnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Display */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : schedule?.schedule && schedule.schedule.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.keys(scheduleByRing)
            .sort((a, b) => Number(a) - Number(b))
            .map((ring) => {
              const color = getRingColor(Number(ring));
              return (
                <Card key={ring} className="overflow-hidden">
                  <div className={`card-header ${color.light} ${color.dark} ${color.text} border-b-2`}>
                    <h3 className="font-semibold">Ring {ring}</h3>
                    <p className="text-sm opacity-75">
                      {scheduleByRing[Number(ring)].length} divisions
                    </p>
                  </div>
                  <div className="divide-y divide-surface-100 dark:divide-surface-700">
                    {scheduleByRing[Number(ring)].map((div) => (
                      <div key={div.divisionId} className="p-3 hover:bg-surface-50 dark:hover:bg-surface-700/50">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-surface-600 dark:text-surface-400">
                            {div.startTime} - {div.endTime}
                          </span>
                          <span
                            className={`text-xs px-2 py-0.5 rounded ${
                              div.eventType === 'patterns'
                                ? 'bg-info/100 dark:bg-info/900/30 text-info800 dark:text-info300'
                                : 'bg-danger/100 dark:bg-danger/900/30 text-danger800 dark:text-danger300'
                            }`}
                          >
                            {div.eventType === 'patterns' ? 'Patterns' : 'Sparring'}
                          </span>
                        </div>
                        <p className="font-medium text-surface-900 dark:text-white text-sm">
                          {div.divisionName}
                        </p>
                        <p className="text-xs text-surface-600 dark:text-surface-400 mt-1">
                          {div.competitorCount} competitors •{' '}
                          {div.estimatedDurationMinutes} min
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-2 w-full"
                          aria-pressed={Boolean(div.locked)}
                          aria-label={`${div.locked ? 'Unlock' : 'Lock'} ${div.divisionName} at Ring ${div.ring}, ${div.startTime}`}
                          disabled={scheduleBusy}
                          onClick={() => scheduleLockMutation.mutate({ divisionId: div.divisionId, locked: !div.locked })}
                        >{div.locked ? 'Locked — unlock position' : 'Lock ring and time'}</Button>
                      </div>
                    ))}
                  </div>
                </Card>
              );
            })}
        </div>
      ) : (
        <Card>
          <CardBody className="p-0">
            <EmptyState
              icon={Calendar}
              title="No schedule generated"
              description="Generate divisions first, then create a schedule."
              action={{
                label: 'Generate Schedule',
                onClick: () => previewMutation.mutate(),
              }}
              secondaryAction={{
                label: 'Manage Divisions',
                onClick: () => navigate(`/tournaments/${id}/divisions`),
              }}
            />
          </CardBody>
        </Card>
      )}

      {/* Timeline View */}
      {schedule?.schedule && schedule.schedule.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Timeline View" as="h2" />
          <CardBody className="p-0 overflow-x-auto">
            <DataTable>
              <TableHead>
                <th scope="col">Time</th>
                <th scope="col">Ring</th>
                <th scope="col">Division</th>
                <th scope="col">Event</th>
                <th scope="col">Competitors</th>
                <th scope="col">Duration</th>
              </TableHead>
              <TableBody>
                {schedule.schedule.map((div) => (
                  <tr key={div.divisionId} className="hover:bg-surface-50 dark:hover:bg-surface-700/50">
                    <td className="font-medium text-surface-900 dark:text-white">
                      {div.startTime} - {div.endTime}
                    </td>
                    <td>
                      <span className={`inline-flex px-2 py-1 rounded text-sm font-medium ${getRingColor(div.ring)}`}>
                        Ring {div.ring}
                      </span>
                    </td>
                    <td>
                      <Link
                        to={`/tournaments/${id}/divisions/${div.divisionId}/bracket`}
                        className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                        aria-label={`Open ${div.divisionName} bracket`}
                      >
                        {div.divisionName}
                      </Link>
                    </td>
                    <td>
                      <span
                        className={`text-xs px-2 py-1 rounded ${
                          div.eventType === 'patterns'
                            ? 'bg-info/100 dark:bg-info/900/30 text-info800 dark:text-info300'
                            : 'bg-danger/100 dark:bg-danger/900/30 text-danger800 dark:text-danger300'
                        }`}
                      >
                        {div.eventType === 'patterns' ? 'Patterns' : 'Sparring'}
                      </span>
                    </td>
                    <td className="text-surface-600 dark:text-surface-400">
                      {(() => {
                        const names = div.competitorNames ?? [];
                        if (names.length === 0) return '—';
                        const fullTitle = names.join(', ');
                        const display =
                          names.length <= 3
                            ? names.join(', ')
                            : `${names.slice(0, 3).join(', ')}, +${names.length - 3} more`;
                        return (
                          <span title={fullTitle} aria-label={fullTitle}>
                            {display}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="text-surface-600 dark:text-surface-400">{div.estimatedDurationMinutes} min</td>
                  </tr>
                ))}
              </TableBody>
            </DataTable>
          </CardBody>
        </Card>
      )}

      <Modal
        isOpen={optimizationOpen}
        onClose={() => { if (!optimizationMutation.isPending) setOptimizationOpen(false); }}
        closeDisabled={optimizationMutation.isPending}
        title="Review schedule optimization"
        subtitle="A deterministic proposal from server-owned schedule and live-condition evidence. Nothing changes until approval and application."
        size="xl"
      >
        {optimizationLoading ? <div role="status" className="flex items-center gap-2"><Spinner size="sm" /> Loading proposal…</div>
          : optimizationLoadError ? <OperationStatus state="rejected" message="The current proposal cannot be loaded safely." actionLabel="Try again" onAction={() => void refetchOptimization()} />
            : latestOptimization ? <div className="space-y-4">
              {optimizationInputsUnavailable && <OperationStatus state="rejected" message="Save live-condition edits and resolve incident loading before approving or applying this proposal." />}
              {optimizationStatus?.state === 'rejected' && <OperationStatus state="rejected" message={optimizationStatus.message} />}
              <ScheduleOptimizationReview
              recommendation={latestOptimization}
              busy={optimizationMutation.isPending || optimizationUncertain || optimizationInputsUnavailable}
              onApprove={() => optimizationMutation.mutate({ action: 'approve', recommendationId: latestOptimization.id })}
              onReject={() => optimizationMutation.mutate({ action: 'reject', recommendationId: latestOptimization.id })}
              onApply={() => { setOptimizationOpen(false); setOptimizationApplyConfirm(true); }}
              onUndo={() => { setOptimizationOpen(false); setOptimizationUndoConfirm({ recommendation: latestOptimization, returnToReview: true }); }}
            /></div> : <div className="space-y-3"><p>No proposal exists for the current schedule.</p><Button variant="primary" loading={optimizationMutation.isPending} disabled={optimizationInputsUnavailable} onClick={() => optimizationMutation.mutate({ action: 'propose' })}>Generate deterministic proposal</Button></div>}
      </Modal>

      <ConfirmDialog
        isOpen={optimizationApplyConfirm}
        onClose={() => { if (!optimizationMutation.isPending) { setOptimizationApplyConfirm(false); setOptimizationOpen(true); } }}
        closeDisabled={optimizationMutation.isPending}
        isLoading={optimizationMutation.isPending}
        title="Apply approved schedule optimization?"
        confirmText={`Apply ${latestOptimization?.proposedDiff.moved.length ?? 0} schedule moves`}
        variant="warning"
        message={latestOptimization ? `This applies ${latestOptimization.proposedDiff.moved.length} reviewed moves while preserving ${latestOptimization.inputSnapshot.optimizerInput.divisions.filter((division) => division.locked).length} locks. The server will revalidate the live snapshot first. Undo remains available only while no later schedule edit exists.` : ''}
        onConfirm={() => latestOptimization && !optimizationUncertain && optimizationMutation.mutate({ action: 'apply', recommendationId: latestOptimization.id })}
      />

      <ConfirmDialog
        isOpen={Boolean(optimizationUndoConfirm)}
        onClose={() => { if (!optimizationMutation.isPending) { const returnToReview = optimizationUndoConfirm?.returnToReview; setOptimizationUndoConfirm(null); if (returnToReview) setOptimizationOpen(true); } }}
        closeDisabled={optimizationMutation.isPending}
        isLoading={optimizationMutation.isPending}
        title="Undo applied schedule optimization?"
        confirmText="Restore audited schedule"
        variant="warning"
        message={optimizationUndoConfirm ? `This restores the exact schedule from before ${optimizationUndoConfirm.recommendation.proposedDiff.moved.length} optimization moves. The server will refuse if any later schedule edit made restoration unsafe.` : ''}
        onConfirm={() => optimizationUndoConfirm && !optimizationUncertain && optimizationMutation.mutate({ action: 'undo', recommendationId: optimizationUndoConfirm.recommendation.id, returnToReview: optimizationUndoConfirm.returnToReview })}
      />

      <Modal
        isOpen={Boolean(preview)}
        onClose={() => { if (!regenerateMutation.isPending) setPreview(null); }}
        closeDisabled={regenerateMutation.isPending}
        title="Review schedule impact"
        subtitle="Nothing changes until you confirm."
        size="lg"
        footer={preview ? (
          <div className="flex w-full justify-end gap-3">
            <Button variant="secondary" onClick={() => setPreview(null)} disabled={regenerateMutation.isPending}>Cancel</Button>
            <Button
              variant="primary"
              loading={regenerateMutation.isPending}
              onClick={() => regenerateMutation.mutate(preview)}
            >
              Apply schedule
            </Button>
          </div>
        ) : undefined}
      >
        {preview && (
          <div className="space-y-5">
            {operationError && <OperationStatus state="rejected" message={operationError} />}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg bg-surface-50 p-3 dark:bg-surface-800"><p className="text-xs text-surface-600 dark:text-surface-400">Affected divisions</p><p className="text-xl font-semibold">{preview.impact.affectedDivisionIds.length}</p></div>
              <div className="rounded-lg bg-surface-50 p-3 dark:bg-surface-800"><p className="text-xs text-surface-600 dark:text-surface-400">Ring changes</p><p className="text-xl font-semibold">{preview.impact.ringChanges}</p></div>
              <div className="rounded-lg bg-surface-50 p-3 dark:bg-surface-800"><p className="text-xs text-surface-600 dark:text-surface-400">Time changes</p><p className="text-xl font-semibold">{preview.impact.timeChanges}</p></div>
              <div className="rounded-lg bg-surface-50 p-3 dark:bg-surface-800"><p className="text-xs text-surface-600 dark:text-surface-400">New warnings</p><p className="text-xl font-semibold">{preview.impact.addedWarnings.length}</p></div>
            </div>
            <div>
              <h3 className="font-semibold text-surface-900 dark:text-white">Affected divisions</h3>
              {preview.impact.affectedLabels.length ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-surface-700 dark:text-surface-300">
                  {preview.impact.affectedLabels.map((label) => <li key={label}>{label}</li>)}
                </ul>
              ) : <p className="mt-2 text-sm text-surface-600 dark:text-surface-400">The proposed configuration produces the same division timing and rings.</p>}
            </div>
            {preview.impact.addedWarnings.length > 0 && (
              <div role="alert" className="rounded-lg border border-warning300 bg-warning/50 p-3 text-sm text-warning900 dark:border-warning800 dark:bg-warning/950/30 dark:text-warning100">
                <p className="font-semibold">Review new warnings before applying</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">{preview.impact.addedWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
              </div>
            )}
            <p className="text-sm text-surface-700 dark:text-surface-300">Applying records who approved the change and preserves the previous schedule for one-click undo. Undo is blocked if another schedule edit occurs first.</p>
          </div>
        )}
      </Modal>

      {/* Delay Recording Modal */}
      <Modal
        isOpen={delayModalOpen}
        onClose={() => { if (!delayPreviewMutation.isPending) setDelayModalOpen(false); }}
        closeDisabled={delayPreviewMutation.isPending}
        title="Record Schedule Delay"
        subtitle="Preview the impact before confirming propagation"
        size="md"
        footer={
          <div className="flex w-full justify-end gap-3">
            <Button variant="secondary" onClick={() => setDelayModalOpen(false)} disabled={delayPreviewMutation.isPending}>Cancel</Button>
            <Button
              variant="primary"
              loading={delayPreviewMutation.isPending}
              onClick={() => delayPreviewMutation.mutate()}
              disabled={!delayReason.trim() || (delayType === 'division' && !delayDivisionId)}
            >
              Preview Impact
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="delay-type">Delay Type</Label>
            <Select
              id="delay-type"
              value={delayType}
              onChange={(e) => setDelayType(e.target.value as 'ring' | 'division')}
            >
              <option value="ring">Ring Delay</option>
              <option value="division">Division-Specific Delay</option>
            </Select>
            <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">
              {delayType === 'ring'
                ? 'Delays all pending divisions in the selected ring'
                : 'Delays a specific division and downstream divisions'}
            </p>
          </div>

          {delayType === 'ring' ? (
            <div>
              <Label htmlFor="delay-ring">Ring Number</Label>
              <Input
                id="delay-ring"
                type="number"
                min={1}
                max={schedule?.config.ringCount || 10}
                value={delayRing}
                onChange={(e) => setDelayRing(Number(e.target.value))}
              />
            </div>
          ) : (
            <div>
              <Label htmlFor="delay-division">Division</Label>
              <Select
                id="delay-division"
                value={delayDivisionId}
                onChange={(e) => setDelayDivisionId(e.target.value)}
              >
                <option value="">Select a division...</option>
                {schedule?.schedule.map((div) => (
                  <option key={div.divisionId} value={div.divisionId}>
                    {div.divisionName} - Ring {div.ring} @ {div.startTime}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div>
            <Label htmlFor="delay-minutes">Delay (minutes)</Label>
            <Input
              id="delay-minutes"
              type="number"
              min={1}
              max={480}
              value={delayMinutes}
              onChange={(e) => setDelayMinutes(Number(e.target.value))}
            />
          </div>

          <div>
            <Label htmlFor="delay-reason">Reason</Label>
            <Input
              id="delay-reason"
              type="text"
              placeholder="e.g., Equipment issue, longer matches than expected"
              value={delayReason}
              onChange={(e) => setDelayReason(e.target.value)}
              maxLength={500}
            />
            <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">
              Provide a brief explanation for the delay (for audit trail)
            </p>
          </div>
        </div>
      </Modal>

      {/* Delay Confirmation Modal */}
      <ConfirmDialog
        isOpen={delayConfirmOpen}
        onClose={() => { if (!delayApplyMutation.isPending) { setDelayConfirmOpen(false); setDelayPreview(null); } }}
        closeDisabled={delayApplyMutation.isPending}
        isLoading={delayApplyMutation.isPending}
        title="Confirm Schedule Delay"
        confirmText={`Apply ${delayMinutes}-minute delay`}
        variant="warning"
        message={
          delayPreview ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-surface-50 p-3 dark:bg-surface-800">
                  <p className="text-xs text-surface-600 dark:text-surface-400">Affected Divisions</p>
                  <p className="text-xl font-semibold">{delayPreview.impact.affectedDivisionIds.length}</p>
                </div>
                <div className="rounded-lg bg-surface-50 p-3 dark:bg-surface-800">
                  <p className="text-xs text-surface-600 dark:text-surface-400">Delay</p>
                  <p className="text-xl font-semibold">{delayMinutes} min</p>
                </div>
              </div>

              {delayPreview.impact.divisionMoves.length > 0 && (
                <div>
                  <h4 className="font-semibold text-sm text-surface-900 dark:text-white mb-2">
                    Time Changes
                  </h4>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {delayPreview.impact.divisionMoves.map((move) => (
                      <div
                        key={move.divisionId}
                        className="text-sm text-surface-700 dark:text-surface-300 bg-surface-50 dark:bg-surface-800 rounded px-2 py-1"
                      >
                        <span className="font-medium">{move.divisionName}</span> (Ring {move.ring})
                        <br />
                        <span className="text-surface-600 dark:text-surface-400">
                          {move.oldStartTime}-{move.oldEndTime} → {move.newStartTime}-{move.newEndTime}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {delayPreview.impact.warnings.length > 0 && (
                <div role="alert" className="rounded-lg border border-warning300 bg-warning/50 p-3 text-sm text-warning900 dark:border-warning800 dark:bg-warning/950/30 dark:text-warning100">
                  <p className="font-semibold mb-2">Warnings</p>
                  <ul className="list-disc space-y-1 pl-5">
                    {delayPreview.impact.warnings.map((warning, i) => (
                      <li key={i}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}

              {delayPreview.impact.conflicts.length > 0 && (
                <div role="alert" className="rounded-lg border border-danger300 bg-danger/50 p-3 text-sm text-danger900 dark:border-danger800 dark:bg-danger/950/30 dark:text-danger100">
                  <p className="font-semibold mb-2">Conflicts Detected</p>
                  <ul className="list-disc space-y-1 pl-5">
                    {delayPreview.impact.conflicts.map((conflict, i) => (
                      <li key={i}>{conflict.description}</li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="text-sm text-surface-700 dark:text-surface-300">
                This delay will be recorded in the audit trail and can be undone if no further schedule changes occur.
              </p>
            </div>
          ) : (
            ''
          )
        }
        onConfirm={() => delayPreview && delayApplyMutation.mutate(delayPreview)}
      />
    </div>
  );
}
