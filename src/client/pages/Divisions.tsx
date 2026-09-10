import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Wand2,
  FileDown,
  LayoutGrid,
  Users,
  ChevronRight,
  Trash2,
  PlayCircle,
  ArrowLeft,
  Scissors,
  Download,
  AlertTriangle,
  Eye,
  Check,
  X,
  UserPlus,
  Search,
  Undo2,
  GripVertical,
  ArrowRight,
  Plus,
  Merge,
} from 'lucide-react';
import { CardSkeleton } from '../components/ui/Skeleton';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import Spinner from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';
import { getAuthHeaders } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getSportProfile } from '../../shared/constants/sport-profiles';
import { Card, CardHeader, CardBody } from '../components/ui';
import { PageHeader } from '../components/ui';
import { Button } from '../components/ui';
import { Input } from '../components/ui';
import { Label } from '../components/ui';
import { Modal } from '../components/ui';
import { Select } from '../components/ui';
import { StatTile } from '../components/ui';
import OperationStatus, { type OperationState } from '../components/ui/OperationStatus';
import { downloadBlob, fetchAuthenticatedBlob } from '../utils/authenticated-export';
import DivisionMoveCompetitorModal from './DivisionMoveCompetitor';
import DivisionExceptionDialog, {
  type DivisionExceptionParams,
  type DivisionCreateParams,
  type DivisionMergeParams,
} from '../components/DivisionExceptionDialog';
import {
  parseDivisionFilters,
  serializeDivisionFilters,
  updateSearchParams,
} from '../utils/url-state';

interface Division {
  id: string;
  name: string;
  beltLevel: string;
  gender: string;
  eventType: string;
  ageMin: number;
  ageMax: number;
  weightClass: string | null;
  divisionNumber: number;
  _count: {
    assignments: number;
  };
  bracket: { id: string } | null;
}

interface Tournament {
  id: string;
  name: string;
  sportProfileSlug: string | null;
}

interface PreviewDivision {
  name: string;
  beltLevel: string;
  gender: string;
  eventType: string;
  ageMin: number;
  ageMax: number;
  weightClass: string | null;
  competitorCount: number;
  competitors: { name: string; school: string }[];
}

interface PreviewResult {
  divisions: PreviewDivision[];
  totalCompetitors: number;
  warnings: string[];
}

interface DivisionRecommendationRecord {
  id: string;
  recommendationType: string;
  explanation: string;
  constraintsConsidered: string[];
  confidence: number;
  warnings: string[];
  status: 'proposed' | 'approved' | 'rejected' | 'applied';
  proposedDiff: {
    divisions: Array<{
      name: string;
      competitorCount: number;
      eventType: string;
      ageMin: number;
      ageMax: number;
      weightClass: string | null;
      registrations: Array<{ registrationId: string; competitorName: string; school: string }>;
    }>;
    preservedPinned: Array<{ registrationId: string; competitorName: string; divisionId: string }>;
    excluded: Array<{ registrationId: string; competitorName: string; reasons: string[] }>;
  };
  inputSnapshot: {
    registrations: Array<{
      id: string;
      competitor: { firstName: string; lastName: string; schoolDojang?: string | null };
    }>;
    existingDivisions: Array<{
      id: string;
      name: string;
      eventType: string;
      ageMin: number;
      ageMax: number;
      weightClass: string | null;
      assignments: Array<{ registrationId: string; manualOverride: boolean }>;
    }>;
    config: {
      divisionThreshold: number;
      enableSmartSplitting?: boolean;
      enableSmartMerging?: boolean;
      ageBoundaryTolerance?: number;
      useBlackBeltAgeGroups?: boolean;
      customWeightClasses?: Array<{ name: string }>;
    };
  };
  approvedBy?: string | null;
  appliedBy?: string | null;
}

/**
 * Shapes used only inside the assignment modal. Minimal — the modal
 * doesn't need every field on these entities, just the ones the UI
 * reads. Keeping them local avoids rippling server-side schema
 * changes into this view.
 */
interface AssignmentRow {
  id: string;
  registrationId: string;
  registration: {
    competitor: {
      firstName: string;
      lastName: string;
      belt?: string | null;
      schoolDojang?: string | null;
    };
  };
}

interface AssignmentDivision {
  assignments: AssignmentRow[];
}

interface RegistrationRow {
  id: string;
  // The server returns `patterns` and `sparring` as optional booleans
  // based on what the registration opted into. Indexed by eventType
  // (which is a string at this layer; the modal narrows via the
  // index signature below).
  patterns?: boolean;
  sparring?: boolean;
  competitor: {
    firstName: string;
    lastName: string;
    belt?: string | null;
    schoolDojang?: string | null;
    weightLbs?: number | null;
  };
}

/**
 * Narrower view used by the eligibility check — only the event-type
 * booleans matter here. We declare an index signature so the modal
 * can do `row[assignTarget.eventType]` without re-narrowing at every
 * call site.
 */
type EventFlagRow = RegistrationRow & Record<string, boolean | undefined>;

export default function Divisions() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  
  // Read filters from URL
  const urlFilters = parseDivisionFilters(searchParams);
  const [filter, setFilter] = useState({
    beltLevel: urlFilters.beltLevel || '',
    gender: urlFilters.gender === 'all' ? '' : (urlFilters.gender || ''),
    eventType: urlFilters.eventType === 'all' ? '' : (urlFilters.eventType || ''),
  });
  const [exportingAll, setExportingAll] = useState(false);
  const exportLockRef = useRef(false);
  const [exportStatus, setExportStatus] = useState<{ state: OperationState; message: string } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Division | null>(null);
  const [splitTarget, setSplitTarget] = useState<Division | null>(null);
  const [assignTarget, setAssignTarget] = useState<Division | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ assignment: any; division: Division } | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [regenerateConfirm, setRegenerateConfirm] = useState(false);
  const [resultMessage, setResultMessage] = useState<{ title: string; message: string } | null>(null);
  const [recommendationStatus, setRecommendationStatus] = useState<{ state: OperationState; message: string } | null>(null);
  const [applyRecommendationConfirm, setApplyRecommendationConfirm] = useState(false);
  const [divisionExceptionParams, setDivisionExceptionParams] = useState<DivisionExceptionParams | null>(null);
  const [selectedDivisionsForMerge, setSelectedDivisionsForMerge] = useState<Set<string>>(new Set());
  const { addToast } = useToast();

  // Sync filters to URL when they change
  useEffect(() => {
    const filters = serializeDivisionFilters({
      eventType: (filter.eventType || undefined) as 'patterns' | 'sparring' | 'all' | undefined,
      gender: (filter.gender || undefined) as 'male' | 'female' | 'all' | undefined,
      beltLevel: filter.beltLevel || undefined,
      search: urlFilters.search,
    });
    const newParams = updateSearchParams(searchParams, filters);
    if (newParams.toString() !== searchParams.toString()) {
      setSearchParams(newParams, { replace: true });
    }
  }, [filter, urlFilters.search, searchParams, setSearchParams]);

  const { data: tournament } = useQuery<Tournament>({
    queryKey: ['tournament', id],
    queryFn: async () => {
      const res = await fetch(`/api/tournaments/${id}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch tournament');
      return res.json();
    },
  });

  const sportProfile = useMemo(() => {
    const slug = tournament?.sportProfileSlug || 'taekwondo';
    return getSportProfile(slug) ?? getSportProfile('taekwondo')!;
  }, [tournament]);

  const getEventLabel = (eventType: string) => {
    const idx = eventType === 'patterns' ? 0 : 1;
    return sportProfile.eventTypes[idx]?.name ?? eventType;
  };

  const { data: divisions, isLoading, isError: divisionsError, refetch: retryDivisions } = useQuery<Division[]>({
    queryKey: ['divisions', id],
    queryFn: async () => {
      const res = await fetch(`/api/divisions/tournament/${id}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch divisions');
      return res.json();
    },
  });

  const {
    data: recommendations,
    isLoading: recommendationsLoading,
    isError: recommendationsError,
    isFetching: recommendationsFetching,
    refetch: refetchRecommendations,
  } = useQuery<DivisionRecommendationRecord[]>({
    queryKey: ['division-recommendations', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const res = await fetch(`/api/recommendations/tournament/${id}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to load division recommendations');
      return (await res.json() as DivisionRecommendationRecord[])
        .filter((recommendation) => recommendation.recommendationType === 'division_categorization_v1');
    },
  });
  const latestRecommendation = recommendations?.[0];
  const recommendationImpact = useMemo(() => {
    if (!latestRecommendation) return null;
    const retainedIds = new Set(latestRecommendation.proposedDiff.preservedPinned.map((entry) => entry.divisionId));
    const existingDivisions = latestRecommendation.inputSnapshot.existingDivisions ?? [];
    const retainedDivisions = existingDivisions.filter((division) => retainedIds.has(division.id));
    const replacedDivisions = existingDivisions.filter((division) => !retainedIds.has(division.id));
    const proposedAssignments = latestRecommendation.proposedDiff.divisions.reduce((sum, division) => sum + division.registrations.length, 0);
    const retainedAssignments = retainedDivisions.reduce((sum, division) => sum + division.assignments.length, 0);
    const replacedAssignments = replacedDivisions.reduce((sum, division) => sum + division.assignments.length, 0);
    const names = new Map(latestRecommendation.inputSnapshot.registrations.map((registration) => [
      registration.id,
      `${registration.competitor.firstName} ${registration.competitor.lastName}`.trim(),
    ]));
    return {
      retainedDivisions, replacedDivisions, retainedAssignments, replacedAssignments, proposedAssignments, names,
      finalDivisionCount: retainedDivisions.length + latestRecommendation.proposedDiff.divisions.length,
      finalAssignmentCount: retainedAssignments + proposedAssignments,
    };
  }, [latestRecommendation]);

  const recommendationMutation = useMutation({
    mutationFn: async ({ action, recommendationId }: { action: 'propose' | 'approve' | 'apply' | 'reject'; recommendationId?: string }) => {
      const path = action === 'propose'
        ? `/api/recommendations/tournament/${id}/divisions/propose`
        : `/api/recommendations/tournament/${id}/${recommendationId}/${action}`;
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: action === 'reject' ? JSON.stringify({ reason: 'Rejected during director division review' }) : undefined,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : `Could not ${action} recommendation`);
      return { action, body };
    },
    onMutate: ({ action }) => {
      const label = action === 'propose' ? 'Generating deterministic recommendation' : `${action[0].toUpperCase()}${action.slice(1)}ing recommendation`;
      setRecommendationStatus({ state: 'pending', message: `${label}…` });
    },
    onError: (error) => setRecommendationStatus({ state: 'rejected', message: error instanceof Error ? error.message : 'Recommendation operation failed' }),
    onSuccess: async ({ action }) => {
      await queryClient.invalidateQueries({ queryKey: ['division-recommendations', id] });
      if (action === 'apply') {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['divisions', id] }),
          queryClient.invalidateQueries({ queryKey: ['tournament-backup', id] }),
        ]);
        setApplyRecommendationConfirm(false);
      }
      setRecommendationStatus({
        state: 'resolved',
        message: action === 'propose'
          ? 'Recommendation ready for director review. No divisions changed.'
          : action === 'approve'
            ? 'Recommendation approved. Divisions have not changed; Apply is still required.'
            : action === 'apply'
              ? 'Approved recommendation applied. The latest recovery backup was replaced with the pre-change divisions.'
              : 'Recommendation rejected without changing divisions.',
      });
    },
  });

  const autoGenerateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/divisions/tournament/${id}/auto-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ config: { divisionThreshold: 8 } }),
      });
      if (!res.ok) throw new Error('Failed to auto-generate divisions');
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['divisions', id] });
      queryClient.invalidateQueries({ queryKey: ['tournament', id] });
      setResultMessage({
        title: 'Auto-generation Complete',
        message: `Created ${result.divisions} divisions with ${result.assignments} assignments.${
          result.warnings?.length ? `\n\nWarnings:\n${result.warnings.join('\n')}` : ''
        }`,
      });
    },
  });

  const generateAllBracketsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/brackets/tournament/${id}/generate-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ seedingStrategy: 'school_spread' }),
      });
      if (!res.ok) throw new Error('Failed to generate brackets');
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['divisions', id] });
      queryClient.invalidateQueries({ queryKey: ['director-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['scorekeeper-divisions'] });
      setResultMessage({
        title: 'Brackets Generated',
        message: `Generated ${result.generated} brackets (${result.skipped} skipped)`,
      });
    },
  });

  const clearDivisionsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/divisions/tournament/${id}/all`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || 'Failed to clear divisions');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['divisions', id] });
      queryClient.invalidateQueries({ queryKey: ['tournament', id] });
      setClearConfirm(false);
    },
  });

  const deleteDivisionMutation = useMutation({
    mutationFn: async (divisionId: string) => {
      const res = await fetch(`/api/divisions/${divisionId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || 'Failed to delete division');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['divisions', id] });
      queryClient.invalidateQueries({ queryKey: ['tournament', id] });
      setDeleteTarget(null);
    },
  });

  const splitDivisionMutation = useMutation({
    mutationFn: async (divisionId: string) => {
      const res = await fetch(`/api/divisions/${divisionId}/split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ splitCount: 2 }),
      });
      if (!res.ok) throw new Error('Failed to split division');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['divisions', id] });
      setSplitTarget(null);
      setResultMessage({
        title: 'Division Split',
        message: 'Division has been split into 2 parts.',
      });
    },
  });

  const createDivisionMutation = useMutation({
    mutationFn: async (divisionData: {
      name: string;
      beltLevel: string;
      gender: string;
      eventType: string;
      ageMin: number;
      ageMax: number;
      weightClass?: string | null;
      tournamentId: string;
    }) => {
      const res = await fetch(`/api/divisions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(divisionData),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to create division');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['divisions', id] });
      setDivisionExceptionParams(null);
      addToast(`Created division: ${data.name}`, 'success');
    },
    onError: (error: Error) => {
      addToast(error.message, 'error');
    },
  });

  const mergeDivisionsMutation = useMutation({
    mutationFn: async ({
      sourceDivisionIds,
      targetDivisionId,
      auditReason,
    }: {
      sourceDivisionIds: string[];
      targetDivisionId: string;
      auditReason: string;
    }) => {
      const res = await fetch(`/api/divisions/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ sourceDivisionIds, targetDivisionId, auditReason }),
      });
      if (!res.ok) {
        const error = await res.json();
        if (error.code === 'ACTIVE_BRACKETS') {
          throw new Error(
            `Cannot merge: ${error.warning}. ${error.suggestion || 'Clear brackets before merging.'}`
          );
        }
        throw new Error(error.error || 'Failed to merge divisions');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['divisions', id] });
      setDivisionExceptionParams(null);
      setSelectedDivisionsForMerge(new Set());
      addToast(data.message || 'Divisions merged successfully', 'success');
    },
    onError: (error: Error) => {
      addToast(error.message, 'error');
    },
  });

  const handleDivisionExceptionConfirm = (result: {
    type: 'move' | 'create' | 'merge';
    auditReason: string;
    toDivisionId?: string;
    assignmentId?: string;
    divisionData?: {
      name: string;
      beltLevel: string;
      gender: string;
      eventType: string;
      ageMin: number;
      ageMax: number;
      weightClass?: string | null;
      tournamentId: string;
    };
    sourceDivisionIds?: string[];
    targetDivisionId?: string;
  }) => {
    if (result.type === 'create' && result.divisionData) {
      createDivisionMutation.mutate(result.divisionData);
    } else if (result.type === 'merge' && result.sourceDivisionIds && result.targetDivisionId) {
      mergeDivisionsMutation.mutate({
        sourceDivisionIds: result.sourceDivisionIds,
        targetDivisionId: result.targetDivisionId,
        auditReason: result.auditReason,
      });
    }
    // Note: 'move' is handled by DivisionMoveCompetitorModal
  };

  const handleMergeSelected = () => {
    if (!divisions || selectedDivisionsForMerge.size < 2) {
      addToast('Select at least 2 divisions to merge', 'error');
      return;
    }

    const sourceDivs = divisions.filter((d) => selectedDivisionsForMerge.has(d.id));
    const availableTargets = divisions.filter((d) => !selectedDivisionsForMerge.has(d.id));

    const mergeParams: DivisionMergeParams = {
      type: 'merge',
      sourceDivisions: sourceDivs.map((d) => ({
        id: d.id,
        name: d.name,
        competitorCount: d._count.assignments,
        hasActiveBracket: Boolean(d.bracket),
      })),
      availableTargets: availableTargets.map((d) => ({
        id: d.id,
        name: d.name,
        hasActiveBracket: Boolean(d.bracket),
      })),
    };

    setDivisionExceptionParams(mergeParams);
  };

  // Manual assignment UI for #50 — backend endpoints exist
  // (POST /api/divisions/:id/assign, DELETE /api/divisions/:id/assign/:id),
  // the page just never had a UI to call them. This is a minimal
  // picker: open the modal, search the global competitor list, check
  // boxes, save. Pre-existing assignments can be unassigned with the
  // trash button next to each row.
  const [assignmentSearch, setAssignmentSearch] = useState('');
  const [selectedCompetitorIds, setSelectedCompetitorIds] = useState<Set<string>>(new Set());

  // Full division (with assignments) — fetched fresh when modal opens
  const { data: assignDivision, isLoading: assignDivisionLoading, refetch: refetchAssignDivision } = useQuery<AssignmentDivision>({
    queryKey: ['division', assignTarget?.id],
    queryFn: async () => {
      const res = await fetch(`/api/divisions/${assignTarget?.id}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch division');
      return res.json();
    },
    enabled: !!assignTarget,
  });

  // All tournament registrations (for the unassigned list)
  const { data: allRegistrations } = useQuery<RegistrationRow[]>({
    queryKey: ['tournament-registrations', id],
    queryFn: async () => {
      const res = await fetch(`/api/tournaments/${id}/registrations`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch registrations');
      return res.json();
    },
    enabled: !!assignTarget,
  });

  // Currently-assigned registration IDs for the open division
  const assignedRegistrationIds = useMemo(
    () => new Set((assignDivision?.assignments ?? []).map((a) => a.registrationId)),
    [assignDivision]
  );

  // Registrations that match the division's event type (so we don't
  // show a patterns-only competitor in a sparring-only division).
  // The cast through `EventFlagRow` lets the index signature handle
  // `r[eventType]` without an `as any`.
  const eligibleRegistrations = useMemo(() => {
    if (!allRegistrations || !assignTarget) return [];
    const eventType = assignTarget.eventType;
    return allRegistrations.filter((r) => (r as EventFlagRow)[eventType] === true);
  }, [allRegistrations, assignTarget]);

  // Eligible + unassigned + search filter
  const availableRegistrations = useMemo(() => {
    const q = assignmentSearch.trim().toLowerCase();
    return eligibleRegistrations
      .filter((r) => !assignedRegistrationIds.has(r.id))
      .filter((r) => {
        if (!q) return true;
        const c = r.competitor;
        return (
          c.firstName.toLowerCase().includes(q) ||
          c.lastName.toLowerCase().includes(q) ||
          (c.schoolDojang || '').toLowerCase().includes(q)
        );
      });
  }, [eligibleRegistrations, assignedRegistrationIds, assignmentSearch]);

  const assignCompetitorsMutation = useMutation({
    mutationFn: async (registrationIds: string[]) => {
      if (!assignTarget) return;
      const results = await Promise.all(
        registrationIds.map((regId) =>
          fetch(`/api/divisions/${assignTarget.id}/assign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify({ registrationId: regId, manualOverride: true }),
          }).then((r) => {
            if (!r.ok) throw new Error(`Failed to assign ${regId}`);
            return r.json();
          })
        )
      );
      return results;
    },
    onSuccess: (results) => {
      queryClient.invalidateQueries({ queryKey: ['divisions', id] });
      refetchAssignDivision();
      setSelectedCompetitorIds(new Set());
      setResultMessage({
        title: 'Competitors Assigned',
        message: `Added ${results?.length ?? 0} competitor(s) to the division.`,
      });
    },
  });

  const unassignMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      if (!assignTarget) return;
      const res = await fetch(`/api/divisions/${assignTarget.id}/assign/${assignmentId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to unassign');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['divisions', id] });
      refetchAssignDivision();
    },
  });

  // Drag-and-drop reorder — was previously called as `reorderMutation.mutate(...)`
  // without ever being declared, so the click handler would throw at runtime
  // ("reorderMutation is not defined"). Now wired up to
  // POST /api/divisions/tournament/:id/reorder with the full ordered
  // id list so the server can persist displayOrder globally.
  const reorderMutation = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      const res = await fetch(`/api/divisions/tournament/${id}/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ orderedIds }),
      });
      if (!res.ok) throw new Error('Failed to reorder divisions');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['divisions', id] });
    },
  });

  const closeAssignModal = () => {
    setAssignTarget(null);
    setSelectedCompetitorIds(new Set());
    setAssignmentSearch('');
  };

  const fetchPreview = async () => {
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/divisions/tournament/${id}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ config: { divisionThreshold: 8 } }),
      });
      const data = await res.json();
      setPreviewData(data);
      setShowPreview(true);
    } catch (error) {
      console.error('Preview error:', error);
      addToast('Failed to generate preview', 'error');
    }
    setPreviewLoading(false);
  };

  const confirmGenerate = () => {
    setShowPreview(false);
    autoGenerateMutation.mutate();
  };

  const filteredDivisions = divisions?.filter((d) => {
    if (filter.beltLevel && d.beltLevel !== filter.beltLevel) return false;
    if (filter.gender && d.gender !== filter.gender) return false;
    if (filter.eventType && d.eventType !== filter.eventType) return false;
    return true;
  });

  const stats = {
    total: divisions?.length || 0,
    withBrackets: divisions?.filter((d) => d.bracket).length || 0,
    smallDivisions: divisions?.filter((d) => d._count.assignments < 3 && d._count.assignments > 0).length || 0,
    largeDivisions: divisions?.filter((d) => d._count.assignments > 8).length || 0,
    emptyDivisions: divisions?.filter((d) => d._count.assignments === 0).length || 0,
  };

  const groupedDivisions = filteredDivisions?.reduce(
    (acc, div) => {
      const key = `${div.beltLevel} ${div.gender === 'M' ? 'Males' : 'Females'} ${getEventLabel(div.eventType)}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(div);
      return acc;
    },
    {} as Record<string, Division[]>
  );

  // DnD-kit sensor setup. PointerSensor activates on drag; KeyboardSensor
  // lets keyboard-only users reorder via Space + arrow keys.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Drag-end handler. Each category (belt+gender+event) gets its own
  // SortableContext, so the drag stays within the category. After a
  // successful reorder, persist via POST /api/divisions/tournament/:id/reorder.
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const category = Object.entries(groupedDivisions || {}).find(
      ([, divs]) => divs.some((d) => d.id === active.id) && divs.some((d) => d.id === over.id),
    )?.[0];
    if (!category) return;
    const divs = groupedDivisions![category];
    const oldIndex = divs.findIndex((d) => d.id === active.id);
    const newIndex = divs.findIndex((d) => d.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(divs, oldIndex, newIndex).map((d) => d.id);
    // Send the FULL tournament ordering so displayOrder is globally consistent.
    // Build it: take all divisions in original order, then swap the moved block.
    const orderedIds: string[] = [];
    for (const [cat, ds] of Object.entries(groupedDivisions || {})) {
      if (cat === category) {
        orderedIds.push(...reordered);
      } else {
        orderedIds.push(...ds.map((d) => d.id));
      }
    }
    reorderMutation.mutate(orderedIds);
  };

  const exportAllPDFs = async () => {
    if (exportLockRef.current || !divisions || divisions.length === 0) return;
    exportLockRef.current = true;

    setExportingAll(true);
    setExportStatus({ state: 'pending', message: 'Preparing all generated brackets as a PDF.' });

    try {
      const divisionsWithBrackets = divisions.filter((d) => d.bracket);

      if (divisionsWithBrackets.length === 0) {
        addToast('No brackets to export. Generate brackets first.', 'warning');
        setExportStatus({ state: 'rejected', message: 'No brackets are available. Generate brackets before exporting.' });
        setExportingAll(false);
        exportLockRef.current = false;
        return;
      }

      const blob = await fetchAuthenticatedBlob(fetch, `/api/brackets/tournament/${id}/pdf`, 'application/pdf', getAuthHeaders());
      downloadBlob(blob, `${tournament?.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'Tournament'}_All_Brackets.pdf`);
      setExportStatus({ state: 'resolved', message: 'All bracket PDFs download started.' });
    } catch (error) {
      console.error('Export error:', error);
      const message = error instanceof Error ? error.message : 'Error exporting PDFs. Please try again.';
      addToast(message, 'error');
      setExportStatus({ state: 'rejected', message });
    }

    setExportingAll(false);
    exportLockRef.current = false;
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
    <div>
      {/* Page Header */}
      <PageHeader
        title={`Divisions - ${tournament?.name || ''}`}
        description={`${divisions?.length || 0} divisions total`}
        actions={
          <div className="flex flex-wrap gap-2 sm:gap-3">
            <Button
              variant="secondary"
              onClick={fetchPreview}
              disabled={previewLoading || autoGenerateMutation.isPending}
            >
              {previewLoading ? <Spinner size="sm" className="mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
              <span className="hidden sm:inline">{previewLoading ? 'Loading...' : 'Preview'}</span>
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                if (divisions?.length) {
                  setRegenerateConfirm(true);
                } else {
                  autoGenerateMutation.mutate();
                }
              }}
              disabled={autoGenerateMutation.isPending}
            >
              {autoGenerateMutation.isPending ? <Spinner size="sm" className="mr-2" /> : <Wand2 className="h-4 w-4 mr-2" />}
              <span className="hidden sm:inline">{autoGenerateMutation.isPending ? 'Generating...' : 'Auto-Generate'}</span>
            </Button>
            <Button
              data-tour="nav-scorekeeper"
              variant="secondary"
              onClick={() => generateAllBracketsMutation.mutate()}
              disabled={generateAllBracketsMutation.isPending || !divisions?.length}
            >
              {generateAllBracketsMutation.isPending ? <Spinner size="sm" className="mr-2" /> : <PlayCircle className="h-4 w-4 mr-2" />}
              <span className="hidden sm:inline">{generateAllBracketsMutation.isPending ? 'Generating...' : 'Brackets'}</span>
            </Button>
            <Button
              variant="primary"
              onClick={exportAllPDFs}
              disabled={exportingAll || !divisions?.some((d) => d.bracket)}
            >
              {exportingAll ? <Spinner size="sm" className="mr-2" /> : <Download className="h-4 w-4 mr-2" />}
              <span className="hidden sm:inline">{exportingAll ? 'Exporting...' : 'Export PDFs'}</span>
            </Button>
          </div>
        }
      >
        <Link
          to={`/tournaments/${id}`}
          className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 flex items-center mb-2"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Tournament
        </Link>
      </PageHeader>

      {exportStatus && (
        <OperationStatus
          className="mb-4"
          state={exportStatus.state}
          message={exportStatus.message}
          actionLabel={exportStatus.state === 'rejected' ? 'Dismiss' : undefined}
          onAction={exportStatus.state === 'rejected' ? () => setExportStatus(null) : undefined}
        />
      )}

      <Card className="mb-6">
        <CardHeader
          title="Division recommendation assistant"
          description="Deterministic suggestions only. A director must approve and then apply; nothing changes automatically."
        />
        <CardBody className="space-y-4">
          {recommendationStatus && (
            <OperationStatus
              state={recommendationStatus.state}
              message={recommendationStatus.message}
              actionLabel={recommendationStatus.state === 'rejected' ? 'Dismiss' : undefined}
              onAction={recommendationStatus.state === 'rejected' ? () => setRecommendationStatus(null) : undefined}
            />
          )}
          {recommendationsLoading || recommendationsFetching && !recommendations ? (
            <div role="status" className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <Spinner size="sm" /> Loading current recommendation state…
            </div>
          ) : recommendationsError ? (
            <OperationStatus
              state="rejected"
              message="Current recommendations could not be loaded. No proposal or approval action is available until the server state is known."
              actionLabel="Try again"
              onAction={() => void refetchRecommendations()}
            />
          ) : !latestRecommendation ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Review sparse categories, incomplete registrations, and manual placements before changing divisions.
              </p>
              <Button
                variant="secondary"
                loading={recommendationMutation.isPending}
                onClick={() => recommendationMutation.mutate({ action: 'propose' })}
              >
                <Wand2 className="mr-2 h-4 w-4" aria-hidden="true" />
                Generate recommendation
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="font-medium text-gray-900 dark:text-white">{latestRecommendation.explanation}</p>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                  {latestRecommendation.proposedDiff.divisions.length} proposed divisions · {recommendationImpact?.retainedDivisions.length ?? 0} pinned divisions retained · {recommendationImpact?.retainedAssignments ?? 0} placements retained · {latestRecommendation.proposedDiff.excluded.length} registrations require review
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Input completeness: {Math.round(latestRecommendation.confidence * 100)}% · Status: {latestRecommendation.status}
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Deterministic means reproducible, not automatically correct. Review every proposed placement before approval.
                </p>
              </div>
              
              {/* Merge Conflicts UI - show conflicts between auto-categorization and manual overrides */}
              {recommendationImpact && (recommendationImpact.replacedDivisions.length > 0 || latestRecommendation.proposedDiff.excluded.length > 0) && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border-l-4 border-amber-500 p-4 rounded">
                  <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-300 mb-2 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    Conflicts & Manual Review Required
                  </h4>
                  <div className="space-y-2 text-xs text-amber-800 dark:text-amber-200">
                    {recommendationImpact.replacedDivisions.length > 0 && (
                      <div>
                        <p className="font-medium">
                          {recommendationImpact.replacedDivisions.length} non-pinned division{recommendationImpact.replacedDivisions.length === 1 ? '' : 's'} will be replaced:
                        </p>
                        <ul className="list-disc pl-5 mt-1">
                          {recommendationImpact.replacedDivisions.map((division) => (
                            <li key={division.id}>{division.name} ({division.assignments.length} competitor{division.assignments.length === 1 ? '' : 's'})</li>
                          ))}
                        </ul>
                        <p className="mt-1 italic">
                          To preserve a division, manually pin competitors before applying.
                        </p>
                      </div>
                    )}
                    {latestRecommendation.proposedDiff.excluded.length > 0 && (
                      <div>
                        <p className="font-medium">
                          {latestRecommendation.proposedDiff.excluded.length} registration{latestRecommendation.proposedDiff.excluded.length === 1 ? '' : 's'} cannot be auto-assigned:
                        </p>
                        <ul className="list-disc pl-5 mt-1">
                          {latestRecommendation.proposedDiff.excluded.map((excluded) => (
                            <li key={excluded.registrationId}>
                              {excluded.competitorName} — {excluded.reasons.join(', ')}
                            </li>
                          ))}
                        </ul>
                        <p className="mt-1 italic">
                          Review these competitors after applying and assign manually.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Proposed divisions and placements</h3>
                <div className="mt-2 max-h-72 space-y-2 overflow-y-auto rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                  {latestRecommendation.proposedDiff.divisions.map((division) => (
                    <div key={`${division.name}-${division.eventType}`} className="border-b border-gray-100 pb-2 last:border-0 dark:border-gray-800">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {division.name} — {division.competitorCount} competitor{division.competitorCount === 1 ? '' : 's'}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {division.eventType}; ages {division.ageMin}–{division.ageMax}{division.weightClass ? `; ${division.weightClass}` : ''}
                      </p>
                      <ul className="mt-1 list-disc pl-5 text-xs text-gray-600 dark:text-gray-300">
                        {division.registrations.map((entry) => (
                          <li key={entry.registrationId}>{entry.competitorName}{entry.school ? ` — ${entry.school}` : ''}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Pinned divisions retained in the final state</h3>
                  {recommendationImpact?.retainedDivisions.length ? (
                    <div className="mt-1 space-y-2 text-sm text-gray-600 dark:text-gray-300">
                      {recommendationImpact.retainedDivisions.map((division) => (
                        <div key={division.id}>
                          <p className="font-medium text-gray-800 dark:text-gray-100">{division.name}</p>
                          <p className="text-xs">{division.eventType}; ages {division.ageMin}–{division.ageMax}{division.weightClass ? `; ${division.weightClass}` : ''}</p>
                          <ul className="list-disc pl-5 text-xs">
                            {division.assignments.map((assignment) => (
                              <li key={assignment.registrationId}>
                                {recommendationImpact.names.get(assignment.registrationId) ?? `Registration ${assignment.registrationId.slice(0, 8)}`}
                                {assignment.manualOverride ? ' — manually pinned' : ' — retained with pinned division'}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ) : <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">No manual placements are present.</p>}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Requires manual review</h3>
                  {latestRecommendation.proposedDiff.excluded.length ? (
                    <ul className="mt-1 list-disc pl-5 text-sm text-amber-700 dark:text-amber-300">
                      {latestRecommendation.proposedDiff.excluded.map((entry) => (
                        <li key={entry.registrationId}>{entry.competitorName}: {entry.reasons.join(', ')}</li>
                      ))}
                    </ul>
                  ) : <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Every unpinned registration has the required facts.</p>}
                </div>
              </div>
              <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                <p className="font-medium">Concrete configuration</p>
                <p>
                  Maximum size {latestRecommendation.inputSnapshot.config.divisionThreshold}; smart split {latestRecommendation.inputSnapshot.config.enableSmartSplitting ? 'on' : 'off'}; smart merge {latestRecommendation.inputSnapshot.config.enableSmartMerging ? 'on' : 'off'}; age flexibility {latestRecommendation.inputSnapshot.config.ageBoundaryTolerance ?? 0} months; age bands {latestRecommendation.inputSnapshot.config.useBlackBeltAgeGroups ? 'black-belt preset' : 'standard/custom rules'}; custom weight classes {latestRecommendation.inputSnapshot.config.customWeightClasses?.map((weightClass) => weightClass.name).join(', ') || 'none'}.
                </p>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Constraints honored</h3>
                  <ul className="mt-1 list-disc pl-5 text-sm text-gray-600 dark:text-gray-300">
                    {latestRecommendation.constraintsConsidered.map((constraint) => <li key={constraint}>{constraint}</li>)}
                  </ul>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Warnings and exceptions</h3>
                  {latestRecommendation.warnings.length ? (
                    <ul className="mt-1 list-disc pl-5 text-sm text-amber-700 dark:text-amber-300">
                      {latestRecommendation.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
                    </ul>
                  ) : <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">No incomplete registration warnings.</p>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {latestRecommendation.status === 'proposed' && (
                  <>
                    <Button
                      variant="primary"
                      loading={recommendationMutation.isPending}
                      onClick={() => recommendationMutation.mutate({ action: 'approve', recommendationId: latestRecommendation.id })}
                    >Approve recommendation</Button>
                    <Button
                      variant="secondary"
                      disabled={recommendationMutation.isPending}
                      onClick={() => recommendationMutation.mutate({ action: 'reject', recommendationId: latestRecommendation.id })}
                    >Reject</Button>
                  </>
                )}
                {latestRecommendation.status === 'approved' && (
                  <Button
                    variant="primary"
                    disabled={recommendationMutation.isPending}
                    onClick={() => setApplyRecommendationConfirm(true)}
                  >Apply approved recommendation</Button>
                )}
                {(latestRecommendation.status === 'rejected' || latestRecommendation.status === 'applied') && (
                  <Button
                    variant="secondary"
                    loading={recommendationMutation.isPending}
                    onClick={() => recommendationMutation.mutate({ action: 'propose' })}
                  >Generate a new recommendation</Button>
                )}
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <ConfirmDialog
        isOpen={applyRecommendationConfirm}
        onClose={() => { if (!recommendationMutation.isPending) setApplyRecommendationConfirm(false); }}
        title="Apply approved division recommendation?"
        confirmText="Apply recommendation"
        isLoading={recommendationMutation.isPending}
        closeDisabled={recommendationMutation.isPending}
        variant="danger"
        message={latestRecommendation ? (
          <span className="space-y-2 text-left">
            <span className="block">
              This replaces {recommendationImpact?.replacedDivisions.length ?? 0} non-pinned division{recommendationImpact?.replacedDivisions.length === 1 ? '' : 's'} and {recommendationImpact?.replacedAssignments ?? 0} assignments. It retains {recommendationImpact?.retainedDivisions.length ?? 0} pinned division{recommendationImpact?.retainedDivisions.length === 1 ? '' : 's'} with {recommendationImpact?.retainedAssignments ?? 0} existing placements, then adds {latestRecommendation.proposedDiff.divisions.length} proposed divisions with {recommendationImpact?.proposedAssignments ?? 0} assignments.
            </span>
            <span className="block">
              Expected final state: {recommendationImpact?.finalDivisionCount ?? 0} divisions and {recommendationImpact?.finalAssignmentCount ?? 0} assignments. {latestRecommendation.proposedDiff.excluded.length} incomplete registrations remain unassigned. Existing brackets block application. The latest recovery backup will be replaced with the pre-change divisions; this audit does not promise a permanent undo.
            </span>
          </span>
        ) : ''}
        onConfirm={() => latestRecommendation && recommendationMutation.mutate({ action: 'apply', recommendationId: latestRecommendation.id })}
      />

      {/* Filters */}
      <Card className="mb-6">
        <CardBody>
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <Label htmlFor="filter-belt">Belt Level</Label>
              <Select
                id="filter-belt"
                aria-label="Filter divisions by belt level"
                value={filter.beltLevel}
                onChange={(e) =>
                  setFilter({ ...filter, beltLevel: e.target.value })
                }
              >
                <option value="">All</option>
                <option value="BB">Black Belt</option>
                <option value="CB">Colored Belt</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="filter-gender">Gender</Label>
              <Select
                id="filter-gender"
                aria-label="Filter divisions by gender"
                value={filter.gender}
                onChange={(e) =>
                  setFilter({ ...filter, gender: e.target.value })
                }
              >
                <option value="">All</option>
                <option value="M">Males</option>
                <option value="F">Females</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="filter-event">Event</Label>
              <Select
                id="filter-event"
                aria-label="Filter divisions by event type"
                value={filter.eventType}
                onChange={(e) =>
                  setFilter({ ...filter, eventType: e.target.value })
                }
              >
                <option value="">All</option>
                {sportProfile.eventTypes.map((et, i) => (
                  <option key={et.id} value={i === 0 ? 'patterns' : 'sparring'}>{et.name}</option>
                ))}
              </Select>
            </div>
            {divisions?.length ? (
              <div className="ml-auto flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    // Prompt for basic division parameters for exception case
                    const createParams: DivisionCreateParams = {
                      type: 'create',
                      tournamentId: id as string,
                      suggestedName: `Manual Division ${(divisions?.length || 0) + 1}`,
                      eventType: 'patterns',
                      beltLevel: 'CB',
                      gender: 'M',
                      ageMin: 6,
                      ageMax: 99,
                    };
                    setDivisionExceptionParams(createParams);
                  }}
                  className="text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create Division
                </Button>
                {selectedDivisionsForMerge.size >= 2 && (
                  <Button
                    variant="secondary"
                    onClick={handleMergeSelected}
                    className="text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20"
                  >
                    <Merge className="h-4 w-4 mr-2" />
                    Merge {selectedDivisionsForMerge.size} Selected
                  </Button>
                )}
                <Button
                  variant="secondary"
                  onClick={() => setClearConfirm(true)}
                  className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear All
                </Button>
              </div>
            ) : null}
          </div>
        </CardBody>
      </Card>

      {/* Backup / Restore — L4 from the UI audit. Closes the
          "no way to roll back" complaint. Backups are auto-created
          before every auto-generate + clear-all (see the server-side
          backup-recovery service). Director sees the last backup
          timestamp + a Restore button if a backup exists. */}
      <BackupRestoreCard tournamentId={id || ''} hasDivisions={!!divisions?.length} />

      {/* Warnings */}
      {(stats.smallDivisions > 0 || stats.largeDivisions > 0 || stats.emptyDivisions > 0) && (
        <div className="mb-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <div className="flex items-start">
            <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mr-3 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-yellow-800 dark:text-yellow-200">Division Warnings</h3>
              <ul className="mt-1 text-sm text-yellow-700 dark:text-yellow-300 list-disc list-inside">
                {stats.emptyDivisions > 0 && (
                  <li>{stats.emptyDivisions} division(s) with no competitors</li>
                )}
                {stats.smallDivisions > 0 && (
                  <li>{stats.smallDivisions} division(s) with fewer than 3 competitors (consider merging)</li>
                )}
                {stats.largeDivisions > 0 && (
                  <li>{stats.largeDivisions} division(s) with more than 8 competitors (consider splitting)</li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Stats Summary */}
      {divisions && divisions.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <StatTile
            label="Total Divisions"
            value={stats.total}
            accent="default"
          />
          <StatTile
            label="With Brackets"
            value={stats.withBrackets}
            accent="success"
          />
          <StatTile
            label="Without Brackets"
            value={stats.total - stats.withBrackets}
            accent="default"
          />
          <StatTile
            label="Small (<3)"
            value={stats.smallDivisions}
            accent={stats.smallDivisions > 0 ? 'warning' : 'default'}
          />
          <StatTile
            label="Large (>8)"
            value={stats.largeDivisions}
            accent={stats.largeDivisions > 0 ? 'warning' : 'default'}
          />
        </div>
      )}

      {/* Divisions */}
      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : divisionsError ? (
        <OperationStatus
          state="rejected"
          message="Could not load divisions. Check your connection and try again."
          actionLabel="Retry"
          onAction={() => void retryDivisions()}
        />
      ) : divisions && divisions.length > 0 ? (
        <div className="space-y-6">
          {Object.entries(groupedDivisions || {}).length === 0 ? (
            <EmptyState
              icon={<LayoutGrid className="h-12 w-12 text-gray-400" />}
              title="No matches found"
              description="No divisions match your current filters. Try adjusting your search criteria."
            />
          ) : (
            Object.entries(groupedDivisions || {}).map(([category, divs]) => (
              <Card key={category}>
                <CardHeader>
                  <div className="flex items-center justify-between w-full">
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-white">{category}</h3>
                      <span className="text-sm text-gray-600 dark:text-gray-400">
                        {divs.length} division{divs.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                </CardHeader>
                <div className="divide-y divide-gray-200 dark:divide-gray-700">
                  <SortableContext items={divs.map((d) => d.id)} strategy={verticalListSortingStrategy}>
                    {divs.map((div) => (
                      <SortableDivisionRow
                        key={div.id}
                        div={div}
                        tournamentId={id || ''}
                        onManageCompetitors={() => setAssignTarget(div)}
                        onSplit={() => setSplitTarget(div)}
                        onDelete={() => setDeleteTarget(div)}
                        isSelected={selectedDivisionsForMerge.has(div.id)}
                        onToggleSelect={(divisionId) => {
                          const newSelection = new Set(selectedDivisionsForMerge);
                          if (newSelection.has(divisionId)) {
                            newSelection.delete(divisionId);
                          } else {
                            newSelection.add(divisionId);
                          }
                          setSelectedDivisionsForMerge(newSelection);
                        }}
                      />
                    ))}
                  </SortableContext>
                </div>
              </Card>
            ))
          )}
        </div>
      ) : (
        <Card>
          <CardBody className="p-0">
            <EmptyState
              icon={LayoutGrid}
              title="No divisions yet"
              description="Auto-generate divisions based on tournament rules."
              action={{
                label: 'Auto-Generate Divisions',
                onClick: () => autoGenerateMutation.mutate(),
              }}
            />
          </CardBody>
        </Card>
      )}

      {/* preview Modal */}
      {showPreview && previewData && (
        <Modal
          isOpen={showPreview}
          onClose={() => setShowPreview(false)}
          title="Division Preview"
          subtitle={`${previewData.divisions.length} divisions • ${previewData.totalCompetitors} competitors`}
          size="full"
          panelClassName="max-h-[90vh]"
          noBodyPadding
          footer={
            <>
              <Button variant="secondary" onClick={() => setShowPreview(false)} className="w-full sm:w-auto">
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={confirmGenerate}
                disabled={autoGenerateMutation.isPending}
                className="w-full sm:w-auto flex items-center justify-center"
              >
                {autoGenerateMutation.isPending ? (
                  <>
                    <Spinner size="sm" className="mr-2" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Confirm & Generate
                  </>
                )}
              </Button>
            </>
          }
        >
          {previewData.warnings.length > 0 && (
            <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-800">
              <div className="flex items-start">
                <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mr-2 flex-shrink-0" />
                <div>
                  <p className="font-medium text-yellow-800 dark:text-yellow-200">Warnings:</p>
                  <ul className="text-sm text-yellow-700 dark:text-yellow-300 list-disc list-inside">
                    {previewData.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          <div className="p-4 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
            <div>
              <div className="text-xl font-bold text-gray-900 dark:text-white">{previewData.divisions.length}</div>
              <div className="text-xs text-gray-600 dark:text-gray-400">Total Divisions</div>
            </div>
            <div>
              <div className="text-xl font-bold text-green-600 dark:text-green-400">
                {previewData.divisions.filter(d => d.competitorCount >= 3 && d.competitorCount <= 8).length}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">Optimal Size (3-8)</div>
            </div>
            <div>
              <div className="text-xl font-bold text-yellow-600 dark:text-yellow-400">
                {previewData.divisions.filter(d => d.competitorCount > 0 && d.competitorCount < 3).length}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">Small (&lt;3)</div>
            </div>
            <div>
              <div className="text-xl font-bold text-orange-600 dark:text-orange-400">
                {previewData.divisions.filter(d => d.competitorCount > 8).length}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">Large (&gt;8)</div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="space-y-3">
              {previewData.divisions.map((div, index) => (
                <div
                  key={index}
                  className={`p-4 rounded-lg border ${
                    div.competitorCount === 0 ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20' :
                    div.competitorCount < 3 ? 'border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20' :
                    div.competitorCount > 8 ? 'border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20' :
                    'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium text-gray-900 dark:text-white">{div.name}</h4>
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${
                        div.competitorCount === 0 ? 'text-red-600 dark:text-red-400' :
                        div.competitorCount < 3 ? 'text-yellow-600 dark:text-yellow-400' :
                        div.competitorCount > 8 ? 'text-orange-600 dark:text-orange-400' :
                        'text-green-600 dark:text-green-400'
                      }`}>
                        {div.competitorCount} competitors
                      </span>
                      {div.competitorCount === 0 && (
                        <span className="text-xs bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 px-2 py-0.5 rounded">Empty</span>
                      )}
                      {div.competitorCount > 0 && div.competitorCount < 3 && (
                        <span className="text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 px-2 py-0.5 rounded">Needs merge</span>
                      )}
                      {div.competitorCount > 8 && (
                        <span className="text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300 px-2 py-0.5 rounded">Will be split</span>
                      )}
                    </div>
                  </div>
                  {div.competitors.length > 0 && (
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      {div.competitors.slice(0, 5).map((c, i) => (
                        <span key={i}>
                          {c.name}{c.school && ` (${c.school})`}
                          {i < Math.min(div.competitors.length - 1, 4) && ', '}
                        </span>
                      ))}
                      {div.competitors.length > 5 && (
                        <span className="text-gray-600 dark:text-gray-500"> +{div.competitors.length - 5} more</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}

      {/* Delete Division Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteDivisionMutation.mutate(deleteTarget.id)}
        title="Delete Division"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This will remove all competitor assignments in this division.`}
        confirmText="Delete Division"
        isLoading={deleteDivisionMutation.isPending}
      />

      {/* Split Division Confirmation */}
      <ConfirmDialog
        isOpen={!!splitTarget}
        onClose={() => setSplitTarget(null)}
        onConfirm={() => splitTarget && splitDivisionMutation.mutate(splitTarget.id)}
        title="Split Division"
        message={`Split "${splitTarget?.name}" into 2 divisions? Competitors will be distributed evenly.`}
        confirmText="Split Division"
        variant="warning"
        isLoading={splitDivisionMutation.isPending}
      />

      {/* Clear All Confirmation */}
      <ConfirmDialog
        isOpen={clearConfirm}
        onClose={() => setClearConfirm(false)}
        onConfirm={() => clearDivisionsMutation.mutate()}
        title="Clear All Divisions"
        message="Are you sure you want to delete all divisions? This will remove all competitor assignments and brackets. This action cannot be undone."
        confirmText="Clear All"
        isLoading={clearDivisionsMutation.isPending}
      />

      {/* Regenerate Confirmation */}
      <ConfirmDialog
        isOpen={regenerateConfirm}
        onClose={() => setRegenerateConfirm(false)}
        onConfirm={() => {
          setRegenerateConfirm(false);
          autoGenerateMutation.mutate();
        }}
        title="Regenerate Divisions"
        message="This will replace all existing divisions. Any existing brackets will be deleted. Continue?"
        confirmText="Regenerate"
        variant="warning"
        isLoading={autoGenerateMutation.isPending}
      />

      {/* Result Message Modal */}
      {resultMessage && (
        <Modal
          isOpen={!!resultMessage}
          onClose={() => setResultMessage(null)}
          title={resultMessage.title}
          footer={
            <Button variant="primary" onClick={() => setResultMessage(null)} className="w-full sm:w-auto">
              OK
            </Button>
          }
        >
          <p className="text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{resultMessage.message}</p>
        </Modal>
      )}

      {/* Manage Competitors modal — #50. Two columns: left = currently
          assigned (with unassign buttons), right = unassigned competitors
          filtered by event type + search (with checkboxes). Save commits
          the new assignments via POST /:id/assign. */}
      {assignTarget && (
        <Modal
          isOpen={!!assignTarget}
          onClose={closeAssignModal}
          title={`Manage Competitors — ${assignTarget.name}`}
          size="lg"
          footer={
            <>
              <Button variant="secondary" onClick={closeAssignModal} className="flex-1">
                Done
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                loading={assignCompetitorsMutation.isPending}
                disabled={selectedCompetitorIds.size === 0}
                onClick={() => assignCompetitorsMutation.mutate(Array.from(selectedCompetitorIds))}
              >
                Add {selectedCompetitorIds.size} Selected
              </Button>
            </>
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-h-[400px]">
            {/* LEFT: currently assigned */}
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
                In this division ({assignDivision?.assignments?.length ?? 0})
              </h3>
              {assignDivisionLoading ? (
                <CardSkeleton />
              ) : (assignDivision?.assignments ?? []).length === 0 ? (
                <p className="text-sm text-gray-600 dark:text-gray-400">No competitors assigned yet.</p>
              ) : (
                // `assignDivision` is narrowed from the `length === 0`
                // check above: if the length is > 0, the object is
                // defined. Re-declare as a non-null const inside the
                // JSX expression so downstream `.assignments` doesn't
                // need its own guard.
                <AssignedList 
                  division={assignDivision as AssignmentDivision} 
                  unassignMutation={unassignMutation}
                  onMove={(assignment) => setMoveTarget({ assignment, division: assignTarget! })}
                />
              )}
            </div>

            {/* RIGHT: available to add */}
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
                Available ({availableRegistrations.length})
              </h3>
              <div className="relative mb-2">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-600" />
                <Input
                  type="text"
                  value={assignmentSearch}
                  onChange={(e) => setAssignmentSearch(e.target.value)}
                  placeholder="Search name or school..."
                  inputClassName="pl-8 py-1.5 text-sm"
                />
              </div>
              {availableRegistrations.length === 0 ? (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {assignmentSearch ? 'No matches.' : 'All eligible competitors already assigned.'}
                </p>
              ) : (
                <div className="space-y-1 max-h-80 overflow-y-auto">
                  {availableRegistrations.map((r) => {
                    const c = r.competitor;
                    const checked = selectedCompetitorIds.has(r.id);
                    return (
                      <label
                        key={r.id}
                        className="flex items-center gap-2 py-1.5 px-2 hover:bg-gray-50 dark:hover:bg-gray-800/40 rounded cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const next = new Set(selectedCompetitorIds);
                            if (next.has(r.id)) next.delete(r.id);
                            else next.add(r.id);
                            setSelectedCompetitorIds(next);
                          }}
                          className="h-4 w-4"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                            {c.firstName} {c.lastName}
                          </p>
                          <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
                            {c.belt}{c.schoolDojang && ` · ${c.schoolDojang}`}
                            {c.weightLbs != null && ` · ${c.weightLbs} lbs`}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Move Competitor Modal */}
      {moveTarget && (
        <DivisionMoveCompetitorModal
          isOpen={!!moveTarget}
          onClose={() => setMoveTarget(null)}
          assignment={moveTarget.assignment}
          currentDivision={moveTarget.division}
          tournamentId={id as string}
        />
      )}

      {/* Division Exception Dialog (Create / Merge) */}
      <DivisionExceptionDialog
        isOpen={!!divisionExceptionParams}
        onClose={() => {
          setDivisionExceptionParams(null);
          setSelectedDivisionsForMerge(new Set());
        }}
        onConfirm={handleDivisionExceptionConfirm}
        params={divisionExceptionParams}
        isLoading={createDivisionMutation.isPending || mergeDivisionsMutation.isPending}
      />
    </div>
    </DndContext>
  );
}

// BackupRestoreCard — shows the last auto-backup timestamp (if any) and
// exposes a Restore button. Closes L4 from the UI audit. Backups are
// created automatically before destructive operations (auto-generate,
// clear-all) by the server-side backup-recovery service. The restore
// endpoint will reject if the backup structure no longer matches the
// current schema.
/**
 * Renders the list of currently-assigned competitors inside the
 * assignment modal. Pulled out of the inline ternary so the
 * surrounding JSX doesn't need an IIFE just to satisfy TS's
 * control-flow narrowing on `assignDivision`.
 */
function AssignedList({
  division,
  unassignMutation,
  onMove,
}: {
  division: AssignmentDivision;
  unassignMutation: { mutate: (id: string) => void; isPending: boolean };
  onMove: (assignment: AssignmentDivision['assignments'][0]) => void;
}) {
  return (
    <div className="space-y-1 max-h-96 overflow-y-auto">
      {division.assignments.map((a) => {
        const c = a.registration?.competitor;
        if (!c) return null;
        return (
          <div key={a.id} className="flex items-center justify-between gap-2 py-1.5 px-2 hover:bg-gray-50 dark:hover:bg-gray-800/40 rounded">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                {c.firstName} {c.lastName}
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
                {c.belt}{c.schoolDojang && ` · ${c.schoolDojang}`}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => onMove(a)}
                disabled={unassignMutation.isPending}
                className="text-gray-600 hover:text-blue-600 dark:hover:text-blue-400 p-1"
                title="Move to another division"
                aria-label={`Move ${c.firstName} ${c.lastName} to another division`}
              >
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                onClick={() => unassignMutation.mutate(a.id)}
                disabled={unassignMutation.isPending}
                className="text-gray-600 hover:text-red-600 dark:hover:text-red-400 p-1"
                title="Remove from division"
                aria-label={`Remove ${c.firstName} ${c.lastName}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BackupRestoreCard({ tournamentId, hasDivisions }: { tournamentId: string; hasDivisions: boolean }) {
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const { data: backup, isLoading } = useQuery<{
    tournamentId: string;
    timestamp: string;
    divisionCount: number;
  } | null>({
    queryKey: ['tournament-backup', tournamentId],
    queryFn: async () => {
      const res = await fetch(`/api/divisions/tournament/${tournamentId}/backup`, {
        headers: getAuthHeaders(),
      });
      if (res.status === 404) return null; // no backup yet
      if (!res.ok) throw new Error('Failed to load backup info');
      return res.json();
    },
    enabled: !!tournamentId,
    retry: false,
  });

  const restoreMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/divisions/tournament/${tournamentId}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Restore failed');
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['divisions'] });
      queryClient.invalidateQueries({ queryKey: ['tournament-backup', tournamentId] });
      addToast?.('Divisions restored from backup.', 'success');
    },
    onError: (err: Error) => addToast?.(err.message, 'error'),
  });

  return (
    <Card className="mb-6">
      <CardBody>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <Undo2 className="h-5 w-5 text-slate-600 dark:text-slate-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Backup &amp; Restore</h3>
              {isLoading ? (
                <p className="text-xs text-gray-600 dark:text-gray-400">Loading backup info…</p>
              ) : backup ? (
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Last backup: <span className="font-medium text-gray-900 dark:text-white">{new Date(backup.timestamp).toLocaleString()}</span> · {backup.divisionCount} division{backup.divisionCount === 1 ? '' : 's'}
                </p>
              ) : (
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  No backup yet. A backup is created automatically before auto-generating or clearing divisions.
                </p>
              )}
            </div>
          </div>
          {backup && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                if (hasDivisions && !confirm('Restoring will REPLACE all current divisions with the backup. Continue?')) return;
                restoreMutation.mutate();
              }}
              loading={restoreMutation.isPending}
              disabled={restoreMutation.isPending}
              aria-label="Restore divisions from last backup"
            >
              <Undo2 className="h-4 w-4 mr-1" />
              Restore from backup
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

// SortableDivisionRow — one row in the Divisions page list. Wrapped with
// @dnd-kit's useSortable so it can be dragged to reorder. The drag handle
// is the leftmost GripVertical icon (keyboard users can Tab to the row and
// press Space to grab, then arrows to move).
function SortableDivisionRow({
  div,
  tournamentId,
  onManageCompetitors,
  onSplit,
  onDelete,
  isSelected,
  onToggleSelect,
}: {
  div: Division;
  tournamentId: string;
  onManageCompetitors: () => void;
  onSplit: () => void;
  onDelete: () => void;
  isSelected?: boolean;
  onToggleSelect?: (divisionId: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: div.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 ${isDragging ? 'bg-primary-50 dark:bg-primary-900/20 shadow-lg z-10' : ''} ${isSelected ? 'bg-purple-50 dark:bg-purple-900/20 border-l-4 border-purple-500' : ''}`}
    >
      <div className="flex items-center min-w-0 flex-1">
        {onToggleSelect && (
          <input
            type="checkbox"
            checked={isSelected || false}
            onChange={() => onToggleSelect(div.id)}
            className="mr-3 h-4 w-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
            aria-label={`Select ${div.name} for merge`}
          />
        )}
        <button
          {...attributes}
          {...listeners}
          type="button"
          aria-label={`Drag to reorder ${div.name}. Or use Tab + Space + arrow keys.`}
          title="Drag to reorder"
          className="touch-target flex-shrink-0 mr-3 text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 cursor-grab active:cursor-grabbing focus:outline-none focus:ring-2 focus:ring-primary-500 rounded"
        >
          <GripVertical className="h-5 w-5" aria-hidden="true" />
        </button>
        <LayoutGrid className="h-5 w-5 text-gray-600 dark:text-gray-500 mr-3 flex-shrink-0" />
        <div className="min-w-0">
          <p className="font-medium text-gray-900 dark:text-white">{div.name}</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {div.ageMin}-{div.ageMax} years
            {div.weightClass && ` • ${div.weightClass}`}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-end">
        <div className={`flex items-center text-sm ${
          div._count.assignments === 0 ? 'text-red-500 dark:text-red-400' :
          div._count.assignments < 3 ? 'text-yellow-600 dark:text-yellow-400' :
          div._count.assignments > 8 ? 'text-orange-600 dark:text-orange-400' :
          'text-gray-500 dark:text-gray-400'
        }`}>
          <Users className="h-4 w-4 mr-1" />
          {div._count.assignments}
        </div>
        {div._count.assignments === 0 && (
          <span className="badge bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300">Empty</span>
        )}
        {div._count.assignments > 0 && div._count.assignments < 3 && (
          <span className="badge bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300">Small</span>
        )}
        {div._count.assignments > 8 && (
          <span className="badge bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300">Large</span>
        )}
        <span className={`badge ${div.bracket ? 'badge-green' : 'badge-gray'}`}>
          {div.bracket ? 'Ready' : 'No Bracket'}
        </span>
        <button
          onClick={onManageCompetitors}
          className="text-gray-600 hover:text-primary-600 dark:hover:text-primary-400 touch-target"
          title="Manage Competitors"
          aria-label={`Manage competitors in ${div.name}`}
        >
          <UserPlus className="h-4 w-4" />
        </button>
        {div._count.assignments > 8 && (
          <button
            onClick={onSplit}
            className="text-gray-600 hover:text-primary-600 dark:hover:text-primary-400 touch-target"
            title="Split Division"
          >
            <Scissors className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={onDelete}
          className="text-gray-600 hover:text-red-600 dark:hover:text-red-400 touch-target"
          title="Delete Division"
        >
          <Trash2 className="h-4 w-4" />
        </button>
        <Link
          to={`/tournaments/${tournamentId}/divisions/${div.id}/bracket`}
          className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 flex items-center touch-target"
        >
          View
          <ChevronRight className="h-4 w-4 ml-1" />
        </Link>
      </div>
    </div>
  );
}
