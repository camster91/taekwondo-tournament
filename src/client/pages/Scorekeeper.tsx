import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Trophy,
  ChevronLeft,
  ChevronRight,
  Check,
  AlertTriangle,
  Clock,
  Users,
  Award,
  Keyboard,
  Timer,
  Monitor,
  X,
} from 'lucide-react';
import MatchTimer from '../components/MatchTimer';
import SpecialNeedsBadge from '../components/SpecialNeedsBadge';
import { getAuthHeaders, useAuth } from '../context/AuthContext';
import CloseButton from '../components/ui/CloseButton';
import { useToast } from '../context/ToastContext';
import { getSportProfile } from '../../shared/constants/sport-profiles';
import { Card, CardBody, ConfirmDialog } from '../components/ui';
import { Button } from '../components/ui';
import { StatTile } from '../components/ui';
import { activateDialogFocus } from '../utils/dialog-focus';
import { makeScoreOperation } from '../utils/offline-operation-queue';
import { useOfflineOperations } from '../hooks/useOfflineOperations';
import AccessibleDialog from '../components/ui/AccessibleDialog';
import OperationStatus from '../components/ui/OperationStatus';
import { buildDeliveryUncertainMessage, buildOfflineOperationStatuses, buildOfflineReviewMessage, pendingOfflineTargetIds } from '../utils/offline-operation-status';
import { readAdminOperationError } from '../utils/admin-operation-error';
import { latestCompletedMatchId } from '../utils/scorekeeper-undo';
import { browserVenueDataSnapshotStore, loadVenueData } from '../utils/venue-data-snapshot';
import { isScorekeeperDivisionData } from '../utils/venue-data-contracts';
import { shouldQueueOfflineMutation } from '../utils/offline-delivery';
import { useBracketWebSocket } from '../hooks/useBracketWebSocket';

interface Match {
  id: string;
  matchNumber: number;
  roundNumber: number;
  bracketType: string;
  ringNumber?: number | null;
  status: string;
  score1: string | null;
  score2: string | null;
  winnerId: string | null;
  videoUrl?: string | null; // P2-9
  competitor1: {
    id: string;
    specialNeeds?: string | null;
    competeWithOlder?: boolean;
    competitor: {
      firstName: string;
      lastName: string;
      schoolDojang: string | null;
      specialNeeds?: string | null;
    };
  } | null;
  competitor2: {
    id: string;
    specialNeeds?: string | null;
    competeWithOlder?: boolean;
    competitor: {
      firstName: string;
      lastName: string;
      schoolDojang: string | null;
      specialNeeds?: string | null;
    };
  } | null;
}

interface Division {
  id: string;
  name: string;
  eventType: string;
  bracket: {
    id: string;
    matches: Match[];
  } | null;
}

interface Tournament {
  id: string;
  sportProfileSlug: string | null;
}

type ResultType = 'win' | 'dq' | 'forfeit' | 'injury';

interface ScoreSubmission {
  matchId: string;
  winnerId: string;
  score1: string;
  score2: string;
  notes: string;
}

/**
 * Validates scorekeeper result submission before showing confirmation dialog.
 * Prevents invalid results from reaching the server.
 * 
 * Rules:
 * - Win: requires valid non-tied scores, winner must match higher score
 * - Forfeit/Injury/DQ: winner selection required, scores optional
 * - All: both competitors must be assigned
 */
function validateResult(
  resultType: ResultType,
  selectedWinner: string | null,
  match: Match | undefined,
  score1: string,
  score2: string,
): string | null {
  // Must have a match and winner selected
  if (!match) return 'No match selected.';
  if (!selectedWinner) return 'Select a winner before recording the result.';
  
  // Both competitors must be assigned
  if (!match.competitor1 || !match.competitor2) {
    return 'This match has an empty slot. Assign both competitors before scoring.';
  }
  
  // Winner must be one of the two competitors
  if (selectedWinner !== match.competitor1.id && selectedWinner !== match.competitor2.id) {
    return 'Selected winner is not a competitor in this match.';
  }

  // Win-specific validation: scores must be valid and non-tied
  if (resultType === 'win') {
    if (!score1.trim() || !score2.trim()) {
      return 'Enter scores for both competitors when recording a win.';
    }
    
    const first = Number(score1);
    const second = Number(score2);
    
    if (
      !/^\d{1,3}$/.test(score1) ||
      !/^\d{1,3}$/.test(score2) ||
      !Number.isInteger(first) ||
      !Number.isInteger(second)
    ) {
      return 'Scores must be whole numbers from 0 to 999.';
    }
    
    if (first === second) {
      return 'A win cannot end in a tie. Enter non-tied scores or choose Forfeit/Injury/DQ.';
    }

    const scoreWinnerId = first > second ? match.competitor1.id : match.competitor2.id;
    if (scoreWinnerId !== selectedWinner) {
      return 'The winner must have the higher score. Check your scores or winner selection.';
    }
  }
  
  // Forfeit/Injury/DQ: winner required, scores optional (no validation)
  
  return null; // Valid
}

export default function Scorekeeper() {
  const { tournamentId } = useParams();
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { user, isOfflineSession } = useAuth();
  const venueSnapshots = useMemo(browserVenueDataSnapshotStore, []);
  const [cachedSnapshotAt, setCachedSnapshotAt] = useState<string | null>(null);
  const offlineOperations = useOfflineOperations(tournamentId, 'score_result');
  const [discardOfflineId, setDiscardOfflineId] = useState<string | null>(null);
  const [discardOfflineError, setDiscardOfflineError] = useState('');
  const [unpersistedDeliveryWarning, setUnpersistedDeliveryWarning] = useState('');

  const [selectedRing, setSelectedRing] = useState<number | null>(null);
  const [selectedDivision, setSelectedDivision] = useState<string | null>(null);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [score1, setScore1] = useState('');
  const [score2, setScore2] = useState('');
  const [selectedWinner, setSelectedWinner] = useState<string | null>(null);
  const [resultType, setResultType] = useState<ResultType>('win');
  const [notes, setNotes] = useState('');
  const [videoUrl, setVideoUrl] = useState(''); // P2-9
  const [showConfirm, setShowConfirm] = useState(false);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const [showTimer, setShowTimer] = useState(true);
  const [penalties1, setPenalties1] = useState(0);
  const [penalties2, setPenalties2] = useState(0);
  const [divisionSearch, setDivisionSearch] = useState('');
  // Ref to the live region for announcing match navigation + undo status.
  const liveRegionRef = useRef<HTMLDivElement>(null);
  // Ref to the active match heading — moved on keyboard nav so SR users
  // can follow the scorekeeper through a division without losing their place.
  const matchHeadingRef = useRef<HTMLDivElement>(null);
  const userNavigatedRef = useRef<'keyboard' | 'auto' | null>(null);
  const [announce, setAnnounce] = useState('');
  const [showIncidentModal, setShowIncidentModal] = useState(false);
  const [incidentType, setIncidentType] = useState<string>('injury');
  const [incidentSeverity, setIncidentSeverity] = useState<string>('minor');
  const [incidentDescription, setIncidentDescription] = useState('');
  const [pendingUndoId, setPendingUndoId] = useState<string | null>(null);
  const [undoError, setUndoError] = useState('');
  const [undoAcknowledged, setUndoAcknowledged] = useState(false);
  const [undoChecking, setUndoChecking] = useState(false);
  const [incidentAction, setIncidentAction] = useState<string>('');
  const incidentDialogRef = useRef<HTMLDivElement>(null);
  const incidentOpenerRef = useRef<HTMLButtonElement>(null);
  const incidentWasOpenRef = useRef(false);

  const { data: tournament } = useQuery<Tournament>({
    queryKey: ['tournament', tournamentId],
    queryFn: async () => {
      const res = await fetch(`/api/tournaments/${tournamentId}`, { headers: getAuthHeaders() });
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
    queryKey: ['scorekeeper-divisions', tournamentId],
    queryFn: async () => {
      if (!user || !tournamentId) throw new Error('Authenticated tournament context is required');
      const result = await loadVenueData<Division[]>({
        scope: { ownerId: user.id, tournamentId, kind: 'scorekeeper' },
        store: venueSnapshots,
        validate: (value): value is Division[] => isScorekeeperDivisionData(value),
        request: () => fetch(`/api/divisions/tournament/${tournamentId}?withMatches=true`, { headers: getAuthHeaders() }),
      });
      setCachedSnapshotAt(result.source === 'snapshot' ? result.savedAt : null);
      return result.data;
    },
    enabled: Boolean(user && tournamentId),
    refetchInterval: 10000,
  refetchIntervalInBackground: false,
  });

  const availableRings = useMemo(() => Array.from(new Set(
    (divisions || []).flatMap((division) => division.bracket?.matches || [])
      .map((match) => match.ringNumber)
      .filter((ring): ring is number => ring != null),
  )).sort((a, b) => a - b), [divisions]);
  const stagedScoreIds = useMemo(
    () => pendingOfflineTargetIds(offlineOperations.operations, 'score_result'),
    [offlineOperations.operations],
  );

  // Get ready matches for selected division — safe with optional chaining
  const readyMatches = useMemo(() => {
    const div = divisions?.find((d) => d.id === selectedDivision);
    return div?.bracket?.matches
      ?.filter((m) => (m.status === 'ready' || m.status === 'in_progress')
        && (selectedRing == null || m.ringNumber === selectedRing)
        && !stagedScoreIds.has(m.id))
      .sort((a, b) => a.matchNumber - b.matchNumber) || [];
  }, [divisions, selectedDivision, selectedRing, stagedScoreIds]);

  // Total + completed counts for the selected division. Used to distinguish
  // "all done" (truly complete) from "no ready match yet" (still pending/in-progress
  // elsewhere). Closes #36 / #44 where a division with 14 pending matches
  // showed "All Matches Complete!" because no match was in 'ready' state.
  const divisionMatchCounts = useMemo(() => {
    const div = divisions?.find((d) => d.id === selectedDivision);
    const matches = div?.bracket?.matches ?? [];
    return {
      total: matches.length,
      completed: matches.filter((m) => m.status === 'completed').length,
    };
  }, [divisions, selectedDivision]);

  const currentMatch = readyMatches[currentMatchIndex];
  const resultValidationError = useMemo(
    () => validateResult(resultType, selectedWinner, currentMatch, score1, score2),
    [currentMatch, resultType, score1, score2, selectedWinner],
  );
  const selectedDivisionMatches = useMemo(() => (
    divisions?.find((division) => division.id === selectedDivision)?.bracket?.matches || []
  ), [divisions, selectedDivision]);

  const finishResultEntry = (queued: boolean) => {
    const wasLast = currentMatchIndex >= readyMatches.length - 1;
    resetForm();
    setShowConfirm(false);
    if (!wasLast && !queued) setCurrentMatchIndex((prev) => prev + 1);
    const state = queued ? 'staged offline' : 'recorded';
    setAnnounce(wasLast
      ? `Result ${state}. No more ready matches in this division.`
      : `Result ${state}. Advanced to next match.`);
  };

  const stageScoreResult = (data: ScoreSubmission, deliveryUncertain = false) => {
    if (!tournamentId || !user) return;
    try {
      offlineOperations.enqueue(makeScoreOperation(user.id, tournamentId, data.matchId, {
        winnerId: data.winnerId,
        score1: data.score1,
        score2: data.score2,
        status: 'completed',
        notes: data.notes,
      }, deliveryUncertain ? 'delivery_uncertain' : 'pending'));
    } catch {
      if (deliveryUncertain) {
        const division = divisions?.find((candidate) => candidate.id === selectedDivision);
        const match = currentMatch?.id === data.matchId ? currentMatch : undefined;
        const name = (entry: Match['competitor1']) => entry ? `${entry.competitor.firstName} ${entry.competitor.lastName}` : 'TBD';
        const winner = match?.competitor1?.id === data.winnerId ? name(match.competitor1) : match?.competitor2?.id === data.winnerId ? name(match.competitor2) : `Registration #${data.winnerId.slice(0, 8)}`;
        const target = match ? `${division?.name || 'Division'}, match #${match.matchNumber} (${name(match.competitor1)} vs ${name(match.competitor2)})` : `Match #${data.matchId.slice(0, 8)}`;
        setUnpersistedDeliveryWarning(`${target} may already be saved on the server. Attempted winner: ${winner}, score ${data.score1 || '0'}–${data.score2 || '0'}, sent ${new Date().toLocaleTimeString()}. This device could not retain the safety record. Do not resubmit it. Review the refreshed match first.`);
        void queryClient.invalidateQueries({ queryKey: ['scorekeeper-divisions'] });
        finishResultEntry(true);
        setAnnounce('Result delivery is uncertain. Do not resubmit it; review the refreshed match first.');
        return;
      }
      addToast('Result was not saved on this device. Keep this match open, free device storage, and try again.', 'error');
      setAnnounce('Result was not saved on this device. The current match remains open.');
      return;
    }
    if (deliveryUncertain) {
      void queryClient.invalidateQueries({ queryKey: ['scorekeeper-divisions'] });
      addToast('Result delivery is uncertain. The request may have reached the server; review the refreshed match before taking action.', 'error');
    } else {
      addToast('Result saved on this device and will sync when the connection returns.', 'warning');
    }
    finishResultEntry(true);
    if (deliveryUncertain) setAnnounce('Result delivery is uncertain. Review the refreshed match before taking action.');
  };

  // Real-time WebSocket updates for bracket collaboration (P2-7)
  const { isConnected: wsConnected } = useBracketWebSocket({
    tournamentId: tournamentId || '',
    divisionId: selectedDivision || '',
    enabled: Boolean(tournamentId && selectedDivision),
    onMatchUpdate: (matchId) => {
      console.log(`[scorekeeper] Match ${matchId} updated by another user`);
    },
    onBracketRegenerated: () => {
      console.log('[scorekeeper] Bracket regenerated by another user');
    },
  });

  const recordResult = useMutation({
    mutationFn: async (data: ScoreSubmission) => {
      const res = await fetch(`/api/brackets/match/${data.matchId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          winnerId: data.winnerId,
          score1: data.score1,
          score2: data.score2,
          status: 'completed',
          notes: data.notes,
        }),
      });
      if (!res.ok) throw new Error('Failed to record match result');
      return res.json();
    },
    onSuccess: async (_result, data) => {
      // P2-9: Save video URL if provided (separate endpoint)
      if (videoUrl.trim()) {
        try {
          const videoRes = await fetch(`/api/brackets/match/${data.matchId}/video`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify({ videoUrl: videoUrl.trim() }),
          });
          if (!videoRes.ok) {
            console.warn('Failed to save video URL:', videoRes.statusText);
          }
        } catch (error) {
          console.warn('Failed to save video URL:', error);
        }
      }

      queryClient.invalidateQueries({ queryKey: ['scorekeeper-divisions'] });
      queryClient.invalidateQueries({ queryKey: ['director-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['divisions'] });
      finishResultEntry(false);
    },
    onError: (error: Error, data) => {
      if (error instanceof TypeError) {
        stageScoreResult(data, true);
        return;
      }
      addToast(error.message || 'Operation failed', 'error');
      setAnnounce(`Error recording result: ${error.message || 'Operation failed'}`);
    },
  });

  const undoMatchResult = useMutation({
    mutationFn: async (matchId: string) => {
      const res = await fetch(`/api/brackets/match/${matchId}/undo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      });
      if (!res.ok) throw new Error(await readAdminOperationError(res, 'Failed to undo match result'));
      return res.json();
    },
    onMutate: () => {
      setUndoError('');
      setUndoAcknowledged(false);
      setAnnounce('Undoing match result.');
    },
    onSuccess: async () => {
      try {
        await queryClient.refetchQueries({ queryKey: ['scorekeeper-divisions'] }, { throwOnError: true });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['director-dashboard'] }),
          queryClient.invalidateQueries({ queryKey: ['divisions'] }),
        ]);
        setPendingUndoId(null);
        addToast('Match result undone', 'success');
        setAnnounce('Last result undone.');
      } catch {
        setUndoAcknowledged(true);
        setUndoError('Undo may have succeeded, but server state could not be refreshed. Check status before taking another action.');
        setAnnounce('Undo acknowledgement received, but updated match status could not be loaded.');
      }
    },
    onError: (error: Error) => {
      setUndoError(error.message || 'Operation failed');
      addToast(error.message || 'Operation failed', 'error');
      setAnnounce(`Undo failed: ${error.message || 'Operation failed'}`);
    },
  });

  const closeUndoDialog = useCallback(() => {
    if (undoMatchResult.isPending || undoChecking || undoAcknowledged) return;
    setPendingUndoId(null);
    setUndoError('');
  }, [undoMatchResult.isPending, undoChecking, undoAcknowledged]);

  const checkUndoStatus = useCallback(async () => {
    setUndoChecking(true);
    setUndoError('');
    try {
      await queryClient.refetchQueries({ queryKey: ['scorekeeper-divisions'] }, { throwOnError: true });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['director-dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['divisions'] }),
      ]);
      setUndoAcknowledged(false);
      setPendingUndoId(null);
      addToast('Match result undone', 'success');
      setAnnounce('Last result undone.');
    } catch {
      setUndoError('Updated match status is still unavailable. Check status again before taking another action.');
    } finally {
      setUndoChecking(false);
    }
  }, [addToast, queryClient]);

  // Report incident mutation
  const reportIncident = useMutation({
    mutationFn: async (data: {
      tournamentId: string;
      matchId?: string;
      registrationId?: string;
      type: string;
      severity: string;
      description: string;
      actionTaken?: string;
    }) => {
      const res = await fetch('/api/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to report incident');
      return res.json();
    },
    onSuccess: () => {
      addToast('Incident reported successfully', 'success');
      setShowIncidentModal(false);
      setIncidentType('injury');
      setIncidentSeverity('minor');
      setIncidentDescription('');
      setIncidentAction('');
    },
    onError: (error: Error) => {
      addToast(error.message || 'Failed to report incident', 'error');
    },
  });

  const handleIncidentSubmit = () => {
    if (!tournamentId || !incidentDescription.trim()) return;
    reportIncident.mutate({
      tournamentId,
      matchId: currentMatch?.id,
      registrationId: currentMatch?.competitor1?.id || undefined,
      type: incidentType,
      severity: incidentSeverity,
      description: incidentDescription,
      actionTaken: incidentAction || undefined,
    });
  };

  const resetForm = () => {
    setScore1('');
    setScore2('');
    setSelectedWinner(null);
    setResultType('win');
    setNotes('');
    setVideoUrl(''); // P2-9
    setPenalties1(0);
    setPenalties2(0);
  };

  const handleSubmit = () => {
    if (!currentMatch || !selectedWinner) return;
    if (resultValidationError) {
      setShowConfirm(false);
      setAnnounce(resultValidationError);
      addToast(resultValidationError, 'error');
      return;
    }

    let noteText = '';
    if (penalties1 > 0 || penalties2 > 0) {
      const penaltyNotes = [];
      const penaltyName = sportProfile.scoringConfig.penaltyName.toLowerCase();
      if (penalties1 > 0) penaltyNotes.push(`${getCompetitorName(currentMatch.competitor1).split(' ')[0]}: ${penalties1} ${penaltyName}`);
      if (penalties2 > 0) penaltyNotes.push(`${getCompetitorName(currentMatch.competitor2).split(' ')[0]}: ${penalties2} ${penaltyName}`);
      noteText = `Penalties: ${penaltyNotes.join(', ')}`;
    }
    if (resultType !== 'win') {
      noteText = noteText ? `${noteText}. ${resultType.toUpperCase()}` : resultType.toUpperCase();
    }
    if (notes) {
      noteText = noteText ? `${noteText}. ${notes}` : notes;
    }

    const submission = {
      matchId: currentMatch.id,
      winnerId: selectedWinner,
      score1,
      score2,
      notes: noteText,
    };
    if (shouldQueueOfflineMutation({ isOfflineSession, navigatorOnline: navigator.onLine })) stageScoreResult(submission);
    else recordResult.mutate(submission);
  };

  const getCompetitorName = (competitor: Match['competitor1']) => {
    if (!competitor) return 'BYE';
    return `${competitor.competitor.firstName} ${competitor.competitor.lastName}`;
  };

  const getCompetitorSchool = (competitor: Match['competitor1']) => {
    if (!competitor) return '';
    return competitor.competitor.schoolDojang || 'No School';
  };

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;

    if (showIncidentModal || showKeyboardHelp || pendingUndoId) return;

    if (showConfirm) {
      if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); }
      else if (e.key === 'Escape') { e.preventDefault(); setShowConfirm(false); }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && selectedDivision) {
      e.preventDefault();
      const lastCompletedId = latestCompletedMatchId(selectedDivisionMatches);
      if (lastCompletedId && !undoMatchResult.isPending) {
        setUndoError('');
        setPendingUndoId(lastCompletedId);
      }
      return;
    }

    if (selectedDivision && currentMatch) {
      switch (e.key) {
        case '1':
        case 'ArrowUp':
          e.preventDefault();
          if (currentMatch.competitor1) setSelectedWinner(currentMatch.competitor1.id);
          break;
        case '2':
        case 'ArrowDown':
          e.preventDefault();
          if (currentMatch.competitor2) setSelectedWinner(currentMatch.competitor2.id);
          break;
        case 'ArrowLeft':
        case 'k':  // F8: vim-style alias for prev match (k = up = back, matches vim)
        case 'K':
          e.preventDefault();
          setCurrentMatchIndex((prev) => {
            if (prev > 0) {
              userNavigatedRef.current = 'keyboard';
              setAnnounce(`Previous match. ${prev} of ${readyMatches.length}.`);
            }
            return Math.max(0, prev - 1);
          });
          break;
        case 'ArrowRight':
        case 'j':  // F8: vim-style alias for next match (j = down = forward, matches vim)
        case 'J':
          e.preventDefault();
          setCurrentMatchIndex((prev) => {
            if (prev < readyMatches.length - 1) {
              userNavigatedRef.current = 'keyboard';
              setAnnounce(`Next match. ${prev + 2} of ${readyMatches.length}.`);
            }
            return Math.min(readyMatches.length - 1, prev + 1);
          });
          break;
        case 'Enter':
          e.preventDefault();
          if (selectedWinner) setShowConfirm(true);
          break;
        case 'Escape':
          e.preventDefault();
          setSelectedDivision(null);
          break;
        case 'w':
          e.preventDefault();
          setResultType('win');
          break;
        case 'd':
          e.preventDefault();
          setResultType('dq');
          break;
        case 'f':
          e.preventDefault();
          setResultType('forfeit');
          break;
        case 'i':
          e.preventDefault();
          setResultType('injury');
          break;
        case '?':
          e.preventDefault();
          setShowKeyboardHelp((prev) => !prev);
          break;
        case 't':
          e.preventDefault();
          setShowTimer((prev) => !prev);
          break;
        // Ctrl/Cmd+Z: undo the most recently completed match in the
        // current division. Closes M7 from the UI audit — scorekeepers
        // shouldn't have to scroll to find the per-match Undo button
        // after confirming the wrong winner. Skipped when typing in an
        // input field (already handled above).
        case 'ArrowLeft':
          // Navigate to previous match (if not in an input field)
          if (selectedDivision && currentMatchIndex > 0) {
            e.preventDefault();
            setCurrentMatchIndex((prev) => Math.max(0, prev - 1));
            userNavigatedRef.current = 'keyboard';
          }
          break;
        case 'ArrowRight':
          // Navigate to next match (if not in an input field)
          if (selectedDivision && currentMatchIndex < readyMatches.length - 1) {
            e.preventDefault();
            setCurrentMatchIndex((prev) => Math.min(readyMatches.length - 1, prev + 1));
            userNavigatedRef.current = 'keyboard';
          }
          break;
      }
    }
  }, [showConfirm, showIncidentModal, showKeyboardHelp, pendingUndoId, selectedDivision, currentMatch, selectedWinner, readyMatches, selectedDivisionMatches, undoMatchResult.isPending, currentMatchIndex]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (!showIncidentModal || !incidentDialogRef.current) return;
    return activateDialogFocus(incidentDialogRef.current, () => setShowIncidentModal(false));
  }, [showIncidentModal]);

  useEffect(() => {
    if (showIncidentModal) {
      incidentWasOpenRef.current = true;
      return;
    }
    if (!incidentWasOpenRef.current) return;
    incidentWasOpenRef.current = false;
    const frame = requestAnimationFrame(() => incidentOpenerRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [showIncidentModal]);

  // After arrow-key navigation, move focus to the active match heading so
  // screen reader and keyboard users follow the scorekeeper through a division.
  // Auto-advance after submit does NOT steal focus — only keyboard navigation does.
  useEffect(() => {
    if (userNavigatedRef.current === 'keyboard' && matchHeadingRef.current) {
      matchHeadingRef.current.focus({ preventScroll: false });
    }
    userNavigatedRef.current = null;
  }, [currentMatchIndex]);

  const syncStagedResults = async () => {
    const result = await offlineOperations.sync();
    if (!result) return;
    if (result.synced > 0) {
      await queryClient.invalidateQueries({ queryKey: ['scorekeeper-divisions'] });
      addToast(`${result.synced} staged result${result.synced === 1 ? '' : 's'} synced.`, 'success');
    }
    if (result.newlyRejected > 0) {
      addToast('A staged result conflicts with server state and needs director review.', 'error');
    }
    if (result.persistenceFailuresBeforeSend > 0) {
      addToast('Nothing was sent because this device could not safely prepare the sync. Free device storage and try again.', 'error');
    }
    if (result.persistenceFailuresAfterSend > 0) {
      addToast('The server may have accepted a result, but this device could not clear its local copy. Refresh and review before syncing again.', 'error');
    }
    if (result.persistenceFailuresAfterRejection > 0) {
      addToast('A result was rejected, but this device could not save the rejection details. It has been quarantined from retry; refresh and review it.', 'error');
    }
  };

  const retryStagedResult = async (id: string) => {
    const result = await offlineOperations.retry(id);
    if (!result) return;
    if (result.outcome === 'synced') {
      await queryClient.invalidateQueries({ queryKey: ['scorekeeper-divisions'] });
      addToast('Staged result synced.', 'success');
    } else if (result.outcome === 'rejected') {
      addToast('The staged result was rejected again. Review the server message before retrying.', 'error');
    } else if (result.outcome === 'offline') {
      addToast('Reconnect to retry this staged result.', 'warning');
    } else if (result.outcome === 'superseded') {
      addToast('A newer local result replaced this retry. The newer result remains queued.', 'warning');
    } else if (result.outcome === 'persistence_failed_after_send') {
      addToast('The server may have accepted this result, but this device could not clear the local copy. Refresh and review the match before retrying.', 'error');
    } else if (result.outcome === 'delivery_uncertain' || result.outcome === 'persistence_failed_after_rejection') {
      addToast('Delivery is uncertain. Refresh and verify the server match; retry is disabled for this local copy.', 'error');
    } else if (result.outcome === 'persistence_failed_before_send') {
      addToast('This device could not safely prepare the retry, so nothing was sent. Free device storage and try again.', 'error');
    }
  };

  const offlineStatus = (offlineOperations.operations.length > 0 || unpersistedDeliveryWarning) && (
    <>
    <div className="mx-auto mb-4 max-w-4xl space-y-2">
      {unpersistedDeliveryWarning && <OperationStatus state="rejected" message={unpersistedDeliveryWarning} actionLabel="I verified server state" onAction={() => setUnpersistedDeliveryWarning('')} />}
      {buildOfflineOperationStatuses('result', offlineOperations.pending.length, offlineOperations.needsReview.length, offlineOperations.syncing)
        .map((status) => <OperationStatus key={status.state} {...status} />)}
      {offlineOperations.pending.length > 0 && (
        <Button size="sm" variant="secondary" onClick={() => void syncStagedResults()} loading={offlineOperations.syncing} disabled={offlineOperations.queueBusy}>Sync pending results</Button>
      )}
      {offlineOperations.needsReview.map((operation) => {
        const retrying = offlineOperations.retryingIds.has(operation.id);
        const retryable = operation.status === 'needs_review' && !retrying;
        const division = divisions?.find((candidate) => candidate.bracket?.matches.some((match) => match.id === operation.targetId));
        const match = division?.bracket?.matches.find((candidate) => candidate.id === operation.targetId);
        const name = (entry: Match['competitor1']) => entry
          ? `${entry.competitor.firstName} ${entry.competitor.lastName}`
          : 'TBD';
        const label = match
          ? `${division?.name || 'Division'} · Match ${match.matchNumber} · ${name(match.competitor1)} vs ${name(match.competitor2)}`
          : `Result #${operation.targetId.slice(0, 8)}`;
        const winnerId = operation.payload.winnerId;
        let winner = 'selected winner';
        if (match) {
          if (match.competitor1?.id === winnerId) winner = name(match.competitor1);
          else if (match.competitor2?.id === winnerId) winner = name(match.competitor2);
        }
        const message = operation.status === 'delivery_uncertain'
          ? buildDeliveryUncertainMessage('result', label)
          : buildOfflineReviewMessage('result', operation.targetId, operation.lastError, {
            label,
            attempted: `${winner}, ${String(operation.payload.score1 ?? '-')}–${String(operation.payload.score2 ?? '-')}`,
            createdAt: operation.createdAt,
          });
        return (
        <OperationStatus
          key={operation.id}
          state={retrying ? 'retrying' : 'rejected'}
          message={message}
          actionLabel={retryable ? 'Retry' : undefined}
          onAction={retryable ? () => void retryStagedResult(operation.id) : undefined}
        >
          <Button size="sm" variant="secondary" onClick={() => { setDiscardOfflineError(''); setDiscardOfflineId(operation.id); }} disabled={retrying}>
            Discard local change
          </Button>
        </OperationStatus>
        );
      })}
    </div>
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
      title="Discard unsynced result?"
      message={<>
        <span className="block">This permanently removes the local score change. The server match will remain unchanged.</span>
        {discardOfflineError && <span role="alert" className="mt-2 block text-red-300">{discardOfflineError}</span>}
      </>}
      confirmText="Discard local change"
      variant="danger"
    />
    </>
  );

  const cachedDataStatus = cachedSnapshotAt && (
    <div role="status" className="mx-auto mb-4 max-w-4xl rounded border border-amber-600 bg-amber-950 px-4 py-3 text-sm text-amber-100">
      Cached scorekeeper data from {new Date(cachedSnapshotAt).toLocaleTimeString()}. Server results may be newer; offline results remain queued until reconnection.
    </div>
  );

  // Division selector view
  if (!selectedDivision) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-4">
        {/* Live region — exists on the division-list view too so SR users hear
            announcements regardless of which view they're in. */}
        <div
          ref={liveRegionRef}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          {announce}
        </div>
        {cachedDataStatus}
        {offlineStatus}
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center">
              <Trophy className="h-8 w-8 text-yellow-500 mr-3" />
              <h1 className="text-2xl font-bold">Scorekeeper</h1>
            </div>
            <div className="flex items-center gap-3">
              <Link
                to={`/display/${tournamentId}`}
                target="_blank"
                className="flex items-center text-sm text-gray-400 hover:text-white"
                title="Open public display in new tab"
              >
                <Monitor className="h-4 w-4 mr-1" aria-hidden="true" />
                <span className="hidden sm:inline">Public Display</span>
              </Link>
              <Link to={`/tournaments/${tournamentId}`} className="text-gray-600 hover:text-white">
                Exit
              </Link>
            </div>
          </div>

          {isLoading ? (
            <div className="text-center py-12 text-gray-600">Loading divisions...</div>
          ) : divisionsError ? (
            <div role="alert" className="text-center py-12 text-red-300">
              <p className="mb-4">Could not load divisions. Check the venue connection and try again.</p>
              <Button onClick={() => void retryDivisions()}>Retry</Button>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold mb-4 text-gray-300">Select Division</h2>
              {availableRings.length > 0 && (
                <div className="mb-4">
                  <label htmlFor="scorekeeper-ring" className="block text-sm text-gray-300 mb-1">Assigned ring</label>
                  <select id="scorekeeper-ring" value={selectedRing ?? ''} onChange={(event) => setSelectedRing(event.target.value ? Number(event.target.value) : null)} className="w-full px-4 py-2 rounded-lg bg-gray-800 text-white border border-gray-700">
                    <option value="">All rings</option>
                    {availableRings.map((ring) => <option key={ring} value={ring}>Ring {ring}</option>)}
                  </select>
                </div>
              )}
              <div className="relative mb-4">
                <label htmlFor="division-search" className="sr-only">
                  Search divisions
                </label>
                <input
                  id="division-search"
                  type="text"
                  placeholder="Search divisions..."
                  value={divisionSearch}
                  onChange={(e) => setDivisionSearch(e.target.value)}
                  className="w-full px-4 py-2 rounded-lg bg-gray-800 text-white border border-gray-700 focus:border-yellow-500 focus:outline-none"
                />
              </div>
              <div className="grid gap-3">
                {divisions && divisions.length === 0 && (
                  <div className="text-center py-12 text-gray-600">
                    <Trophy className="h-12 w-12 mx-auto mb-3 text-gray-600" aria-hidden="true" />
                    <p className="text-base font-medium mb-1">No divisions to score yet</p>
                    <p className="text-sm text-gray-600 mb-4">
                      Divisions need to be created before matches can be scored.
                    </p>
                  </div>
                )}
                {divisions && divisions.length > 0 && divisions.every((d) => !d.bracket) && (
                  <div className="text-center py-12 text-gray-600">
                    <Trophy className="h-12 w-12 mx-auto mb-3 text-gray-600" aria-hidden="true" />
                    <p className="text-base font-medium mb-1">No brackets generated yet</p>
                    <p className="text-sm text-gray-600 mb-4">
                      {divisions.length} {divisions.length === 1 ? 'division exists' : 'divisions exist'} but no brackets have been generated. Go to the Divisions page to generate a bracket for each one.
                    </p>
                    <Link
                      to={`/tournaments/${tournamentId}/divisions`}
                      className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
                    >
                      Go to Divisions →
                    </Link>
                  </div>
                )}
                {divisions
                  ?.filter((d) => d.bracket
                    && (selectedRing == null || d.bracket.matches.some((match) => match.ringNumber === selectedRing))
                    && (!divisionSearch || d.name.toLowerCase().includes(divisionSearch.toLowerCase())))
                  .map((division) => {
                    const readyCount = division.bracket?.matches?.filter((m) => m.status === 'ready' || m.status === 'in_progress').length || 0;
                    const completedCount = division.bracket?.matches?.filter((m) => m.status === 'completed').length || 0;
                    const totalCount = division.bracket?.matches?.length || 0;

                    return (
                      <button
                        key={division.id}
                        onClick={() => { setSelectedDivision(division.id); setCurrentMatchIndex(0); resetForm(); }}
                        aria-label={
                          `${division.name}, ${getEventLabel(division.eventType)}, ` +
                          (readyCount > 0
                            ? `${readyCount} ready, ${completedCount} of ${totalCount} complete`
                            : totalCount === 0
                            ? `no matches scheduled`
                            : completedCount === totalCount
                            ? `complete, all ${totalCount} matches done`
                            : `no ready matches, ${completedCount} of ${totalCount} complete`)
                        }
                        className={`p-4 rounded-lg text-left transition-colors ${
                          readyCount > 0
                            ? 'bg-green-900 hover:bg-green-800 border-2 border-green-500'
                            : totalCount > 0 && completedCount === totalCount
                            ? 'bg-gray-800 hover:bg-gray-700 opacity-50'
                            : 'bg-gray-800 hover:bg-gray-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-semibold text-lg">{division.name}</div>
                            <div className="text-sm text-gray-600 mt-1">{getEventLabel(division.eventType)}</div>
                          </div>
                          <div className="text-right">
                            {readyCount > 0 ? (
                              <span className="text-green-400 font-bold">{readyCount} ready</span>
                            ) : totalCount > 0 && completedCount === totalCount ? (
                              <span className="text-gray-600">Complete</span>
                            ) : totalCount === 0 ? (
                              <span className="text-yellow-500">No bracket</span>
                            ) : (
                              <span className="text-blue-400">No ready</span>
                            )}
                            <div className="text-xs text-gray-600 mt-1">
                              {completedCount}/{totalCount} done
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // Match scoring view
  const division = divisions?.find((d) => d.id === selectedDivision);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Live region for keyboard nav / undo / result announcements.
          aria-live="polite" lets the SR finish reading current content first.
          Lives at the top of the page so it exists on every view (division list + match view). */}
      <div
        ref={liveRegionRef}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announce}
      </div>
      {cachedDataStatus}
      {offlineStatus}
      {/* Header */}
      <div className="bg-gray-800 p-4">
        <div className="flex items-center justify-between">
          <button onClick={() => setSelectedDivision(null)} className="flex items-center text-gray-600 hover:text-white">
            <ChevronLeft className="h-5 w-5 mr-1" /> Back
          </button>
          <div className="text-center">
            <div
              ref={matchHeadingRef}
              tabIndex={-1}
              className="font-semibold focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-offset-2 focus:ring-offset-gray-800 rounded px-2"
              aria-label={`${division?.name} match ${currentMatchIndex + 1} of ${readyMatches.length}`}
            >
              {division?.name}
            </div>
            <div className="text-sm text-gray-600" aria-live="polite">
              Match {currentMatchIndex + 1} of {readyMatches.length}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowTimer(!showTimer)}
              className={`flex items-center text-sm px-2 py-1 rounded ${showTimer ? 'bg-green-600' : 'bg-gray-700'}`}
              title="Toggle timer"
              aria-label={showTimer ? 'Hide match timer' : 'Show match timer'}
              aria-pressed={showTimer}
            >
              <Timer className="h-4 w-4 mr-1" aria-hidden="true" /> Timer
            </button>
            <button
              onClick={() => setShowKeyboardHelp(true)}
              className="flex items-center gap-1 text-gray-600 hover:text-white text-sm"
              title="Keyboard shortcuts (?)"
              aria-label="Show keyboard shortcuts"
            >
              <Keyboard className="h-5 w-5" aria-hidden="true" />
              <span className="hidden lg:inline text-xs">Shortcuts</span>
            </button>
          </div>
        </div>
      </div>

      {/* Match Timer — visible by default for sparring (combat) divisions.
          Also shown for patterns when the scorekeeper explicitly opens it
          (Toggle button in the header). Round count and duration come
          from sportProfile.scoringConfig so multi-sport installs get the
          right defaults instead of the TKD-only values that used to be
          hardcoded here (2 min × 2 rounds for sparring, 3 min single for
          patterns). Patterns stay a single round; sparring gets the
          configured multi-round count with a 30s break between rounds. */}
      {showTimer && division && (() => {
        const cfg = sportProfile.scoringConfig;
        const isCombat = sportProfile.eventTypes[1]?.isCombat ?? false;
        const isSparring = division.eventType === 'sparring' && isCombat;
        const isPatterns = division.eventType === 'patterns';
        if (!isSparring && !isPatterns) return null;

        // Combat events use the sport's configured round count + duration
        // with a 30s break. Patterns (forms) stay a single round — single
        // performance, no inter-round break — but cap the round duration
        // so forms are long enough to be useful (≥ 120s) but don't run
        // longer than 5 minutes.
        const rounds = isSparring ? cfg.defaultRounds : 1;
        const roundTime = isSparring
          ? cfg.defaultRoundDurationSeconds
          : Math.min(300, Math.max(cfg.defaultRoundDurationSeconds, 120));
        const breakTime = isSparring ? 30 : 0;
        return (
          <div className="p-4 border-b border-gray-800">
            <MatchTimer
              defaultRoundTime={roundTime}
              defaultRounds={rounds}
              defaultBreakTime={breakTime}
            />
          </div>
        );
      })()}

      {!currentMatch ? (
        <div className="p-8 text-center">
          {divisionMatchCounts.total > 0 && divisionMatchCounts.completed === divisionMatchCounts.total ? (
            <>
              <Check className="h-16 w-16 text-green-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold mb-2">All Matches Complete!</h2>
              <p className="text-gray-600 mb-6">
                {divisionMatchCounts.completed} of {divisionMatchCounts.total} matches done.
              </p>
              <Button variant="primary" className="px-8 py-3" onClick={() => setSelectedDivision(null)}>
                Select Another Division
              </Button>
            </>
          ) : divisionMatchCounts.total === 0 ? (
            <>
              <AlertTriangle className="h-16 w-16 text-yellow-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold mb-2">No bracket generated</h2>
              <p className="text-gray-600 mb-6">
                This division doesn't have a bracket yet. Generate brackets from the Divisions page.
              </p>
              <Button variant="primary" className="px-8 py-3" onClick={() => setSelectedDivision(null)}>
                Select Another Division
              </Button>
            </>
          ) : (
            <>
              <Clock className="h-16 w-16 text-blue-400 mx-auto mb-4" />
              <h2 className="text-xl font-semibold mb-2">No ready matches</h2>
              <p className="text-gray-600 mb-6">
                {divisionMatchCounts.completed} of {divisionMatchCounts.total} done — matches are pending or being seeded from prior rounds. Check back shortly.
              </p>
              <Button variant="primary" className="px-8 py-3" onClick={() => setSelectedDivision(null)}>
                Select Another Division
              </Button>
            </>
          )}
        </div>
      ) : (
        <>
          {/* Match Navigation */}
          <div className="flex items-center justify-between p-2 bg-gray-800/50">
            <button
              onClick={() => setCurrentMatchIndex((prev) => Math.max(0, prev - 1))}
              disabled={currentMatchIndex === 0}
              className="p-2 rounded-lg bg-gray-700 disabled:opacity-30"
              aria-label="Previous match"
            >
              <ChevronLeft className="h-6 w-6" aria-hidden="true" />
            </button>
            <div className="text-sm text-gray-600" aria-hidden="true">
              Match #{currentMatch.matchNumber} - Round {currentMatch.roundNumber} ({currentMatch.bracketType})
            </div>
            <button
              onClick={() => setCurrentMatchIndex((prev) => Math.min(readyMatches.length - 1, prev + 1))}
              disabled={currentMatchIndex === readyMatches.length - 1}
              className="p-2 rounded-lg bg-gray-700 disabled:opacity-30"
              aria-label="Next match"
            >
              <ChevronRight className="h-6 w-6" aria-hidden="true" />
            </button>
          </div>

          {/* Competitor Cards */}
          <div className="p-4 space-y-4">
            {/* Competitor 1 */}
            <div className="flex gap-3">
              <button
                onClick={() => { if (currentMatch.competitor1) setSelectedWinner(currentMatch.competitor1.id); }}
                disabled={!currentMatch.competitor1}
                aria-pressed={selectedWinner === currentMatch.competitor1?.id}
                aria-label={`${getCompetitorName(currentMatch.competitor1)} — select as winner (press 1)`}
                className={`flex-1 p-6 rounded-xl text-left transition-all ${
                  selectedWinner === currentMatch.competitor1?.id
                    ? 'bg-green-600 ring-4 ring-green-400'
                    : 'bg-gray-800 hover:bg-gray-700'
                } ${!currentMatch.competitor1 ? 'opacity-50' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="text-2xl font-bold">{getCompetitorName(currentMatch.competitor1)}</div>
                    <div className="text-gray-600 mt-1">{getCompetitorSchool(currentMatch.competitor1)}</div>
                    {currentMatch.competitor1 && (
                      <div className="mt-2">
                        <SpecialNeedsBadge
                          competitorNotes={currentMatch.competitor1.competitor.specialNeeds}
                          registrationNotes={currentMatch.competitor1.specialNeeds}
                          competeWithOlder={currentMatch.competitor1.competeWithOlder}
                          size="md"
                        />
                      </div>
                    )}
                    {penalties1 > 0 && (
                      <div className="text-red-400 text-sm mt-1">
                        {penalties1} {sportProfile.scoringConfig.penaltyName} ({penalties1} pts to opponent)
                      </div>
                    )}
                  </div>
                  {selectedWinner === currentMatch.competitor1?.id && (
                    <Award className="h-10 w-10 text-yellow-400" aria-hidden="true" />
                  )}
                </div>
              </button>
              {/* Penalty Controls for Competitor 1 */}
              <div className="flex flex-col gap-2" role="group" aria-label={`${getCompetitorName(currentMatch.competitor1)} penalty controls`}>
                <button
                  onClick={(e) => { e.stopPropagation(); setPenalties1(p => p + 1); }}
                  className="px-3 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-bold"
                  title={`Add ${sportProfile.scoringConfig.penaltyName}`}
                  aria-label={`Add ${sportProfile.scoringConfig.penaltyName} to ${getCompetitorName(currentMatch.competitor1)}`}
                >
                  +{sportProfile.scoringConfig.penaltyName.slice(0, 3).toUpperCase()}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setPenalties1(p => Math.max(0, p - 1)); }}
                  disabled={penalties1 === 0}
                  className="px-3 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-sm disabled:opacity-50"
                  title={`Remove ${sportProfile.scoringConfig.penaltyName}`}
                  aria-label={`Remove ${sportProfile.scoringConfig.penaltyName} from ${getCompetitorName(currentMatch.competitor1)}`}
                >
                  -{sportProfile.scoringConfig.penaltyName.slice(0, 3).toUpperCase()}
                </button>
                <div className={`text-center text-xl font-bold ${penalties1 > 0 ? 'text-red-400' : 'text-gray-500'}`} aria-live="polite" aria-atomic="true">
                  {penalties1}
                </div>
              </div>
            </div>

            <div className="text-center text-gray-600 font-bold">VS</div>

            {/* Competitor 2 */}
            <div className="flex gap-3">
              <button
                onClick={() => { if (currentMatch.competitor2) setSelectedWinner(currentMatch.competitor2.id); }}
                disabled={!currentMatch.competitor2}
                aria-pressed={selectedWinner === currentMatch.competitor2?.id}
                aria-label={`${getCompetitorName(currentMatch.competitor2)} — select as winner (press 2)`}
                className={`flex-1 p-6 rounded-xl text-left transition-all ${
                  selectedWinner === currentMatch.competitor2?.id
                    ? 'bg-green-600 ring-4 ring-green-400'
                    : 'bg-gray-800 hover:bg-gray-700'
                } ${!currentMatch.competitor2 ? 'opacity-50' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="text-2xl font-bold">{getCompetitorName(currentMatch.competitor2)}</div>
                    <div className="text-gray-600 mt-1">{getCompetitorSchool(currentMatch.competitor2)}</div>
                    {currentMatch.competitor2 && (
                      <div className="mt-2">
                        <SpecialNeedsBadge
                          competitorNotes={currentMatch.competitor2.competitor.specialNeeds}
                          registrationNotes={currentMatch.competitor2.specialNeeds}
                          competeWithOlder={currentMatch.competitor2.competeWithOlder}
                          size="md"
                        />
                      </div>
                    )}
                    {penalties2 > 0 && (
                      <div className="text-red-400 text-sm mt-1">
                        {penalties2} {sportProfile.scoringConfig.penaltyName} ({penalties2} pts to opponent)
                      </div>
                    )}
                  </div>
                  {selectedWinner === currentMatch.competitor2?.id && (
                    <Award className="h-10 w-10 text-yellow-400" aria-hidden="true" />
                  )}
                </div>
              </button>
              {/* Penalty Controls for Competitor 2 */}
              <div className="flex flex-col gap-2" role="group" aria-label={`${getCompetitorName(currentMatch.competitor2)} penalty controls`}>
                <button
                  onClick={(e) => { e.stopPropagation(); setPenalties2(p => p + 1); }}
                  className="px-3 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-bold"
                  title={`Add ${sportProfile.scoringConfig.penaltyName}`}
                  aria-label={`Add ${sportProfile.scoringConfig.penaltyName} to ${getCompetitorName(currentMatch.competitor2)}`}
                >
                  +{sportProfile.scoringConfig.penaltyName.slice(0, 3).toUpperCase()}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setPenalties2(p => Math.max(0, p - 1)); }}
                  disabled={penalties2 === 0}
                  className="px-3 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-sm disabled:opacity-50"
                  title={`Remove ${sportProfile.scoringConfig.penaltyName}`}
                  aria-label={`Remove ${sportProfile.scoringConfig.penaltyName} from ${getCompetitorName(currentMatch.competitor2)}`}
                >
                  -{sportProfile.scoringConfig.penaltyName.slice(0, 3).toUpperCase()}
                </button>
                <div className={`text-center text-xl font-bold ${penalties2 > 0 ? 'text-red-400' : 'text-gray-500'}`} aria-live="polite" aria-atomic="true">
                  {penalties2}
                </div>
              </div>
            </div>
          </div>

          {/* Score Entry */}
          <div className="p-4 bg-gray-800/50">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label htmlFor="scorekeeper-score1" className="block text-sm text-gray-600 mb-1">
                  {getCompetitorName(currentMatch.competitor1)} Score
                </label>
                <input
                  id="scorekeeper-score1"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="999"
                  step="1"
                  value={score1}
                  onChange={(e) => setScore1(e.target.value)}
                  className="w-full p-4 text-2xl text-center bg-gray-700 rounded-lg"
                  placeholder="0"
                />
              </div>
              <div>
                <label htmlFor="scorekeeper-score2" className="block text-sm text-gray-600 mb-1">
                  {getCompetitorName(currentMatch.competitor2)} Score
                </label>
                <input
                  id="scorekeeper-score2"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="999"
                  step="1"
                  value={score2}
                  onChange={(e) => setScore2(e.target.value)}
                  className="w-full p-4 text-2xl text-center bg-gray-700 rounded-lg"
                  placeholder="0"
                />
              </div>
            </div>

            {/* Result Type — only matters for non-WIN results (DQ, FORFEIT,
                INJURY all imply a winner). Show a hint next to the group
                indicating which competitor "won" via this result. */}
            <fieldset className="border-0 p-0 m-0 mb-4">
              <legend className="sr-only">Result type</legend>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-600 uppercase tracking-wider">Result</span>
                {selectedWinner && resultType !== 'win' && (
                  <span className="text-xs text-gray-600">
                    {getCompetitorName(
                      currentMatch.competitor1?.id === selectedWinner
                        ? currentMatch.competitor1
                        : currentMatch.competitor2
                    )}
                    {' wins by '}
                    <span className="text-red-400 font-semibold uppercase">{resultType}</span>
                  </span>
                )}
              </div>
              <div className="flex gap-2" role="radiogroup" aria-label={`Result type${selectedWinner ? ' — winner: ' + getCompetitorName(selectedWinner === currentMatch.competitor1?.id ? currentMatch.competitor1 : currentMatch.competitor2) : ''}`}>
                {(['win', 'dq', 'forfeit', 'injury'] as ResultType[]).map((type) => (
                  <button
                    key={type}
                    onClick={() => setResultType(type)}
                    aria-pressed={resultType === type}
                    aria-label={`Result type: ${type.toUpperCase()}`}
                    className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                      resultType === type
                        ? type === 'win'
                          ? 'bg-green-600'
                          : 'bg-red-600'
                        : 'bg-gray-700 hover:bg-gray-600'
                    }`}
                  >
                    {type.toUpperCase()}
                  </button>
                ))}
              </div>
            </fieldset>

            {/* Notes */}
            {resultType !== 'win' && (
              <div>
                <label htmlFor="scorekeeper-notes" className="sr-only">
                  Notes
                </label>
                <input
                  id="scorekeeper-notes"
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add notes (optional)"
                  className="w-full p-3 bg-gray-700 rounded-lg mb-4"
                />
              </div>
            )}

            {/* Video Review URL - P2-9 enhanced */}
            <div className="mb-4">
              <label htmlFor="scorekeeper-video-url" className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                <Monitor className="h-4 w-4" />
                Video Review URL (Optional)
              </label>
              <input
                id="scorekeeper-video-url"
                type="url"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="YouTube, Vimeo, or direct video link"
                className="w-full p-3 bg-gray-700 rounded-lg border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                aria-describedby="video-url-help"
              />
              <p id="video-url-help" className="text-xs text-gray-400 mt-1">
                Attach video evidence for review or replay. Links appear in results.
              </p>
            </div>

            {/* Submit Button */}
            <button
              onClick={() => setShowConfirm(true)}
              disabled={!selectedWinner || Boolean(resultValidationError)}
              aria-describedby={resultValidationError ? 'scorekeeper-result-validation' : undefined}
              className="w-full py-4 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-xl text-xl font-bold transition-colors"
            >
              Record Result
            </button>
            {resultValidationError && (
              <p id="scorekeeper-result-validation" role="alert" className="mt-2 text-sm text-red-300">
                {resultValidationError}
              </p>
            )}

            {/* Report Incident Button */}
            <button
              ref={incidentOpenerRef}
              onClick={() => setShowIncidentModal(true)}
              className="w-full mt-2 py-3 bg-orange-600 hover:bg-orange-500 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              <AlertTriangle className="h-4 w-4" />
              Report Incident
            </button>
          </div>

          {/* On Deck Section */}
          {readyMatches.length > 1 && (
            <div className="p-4 border-t border-gray-700">
              <h3 className="text-sm font-semibold text-blue-400 mb-3 flex items-center gap-2">
                <Clock className="h-4 w-4" />
                ON DECK
              </h3>
              <div className="space-y-2">
                {readyMatches.slice(currentMatchIndex + 1, currentMatchIndex + 3).map((match, idx) => (
                  <div
                    key={match.id}
                    className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                      idx === 0 ? 'bg-blue-900/40 border border-blue-500/40' : 'bg-gray-800'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                        idx === 0 ? 'bg-blue-600 text-white' : 'bg-gray-600 text-gray-300'
                      }`}>
                        {idx === 0 ? 'Next' : 'After'}
                      </span>
                      <div className="text-sm">
                        <span className="font-medium">{getCompetitorName(match.competitor1)}</span>
                        <span className="text-gray-500 mx-1">vs</span>
                        <span className="font-medium">{getCompetitorName(match.competitor2)}</span>
                      </div>
                    </div>
                    <span className="text-xs text-gray-500">Match #{match.matchNumber}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Recent Results */}
      {(() => {
        const div = divisions?.find((d) => d.id === selectedDivision);
        const completedMatches = div?.bracket?.matches
          ?.filter((m) => m.status === 'completed')
          .slice(-5)
          .reverse() || [];

        if (completedMatches.length === 0) return null;

        return (
          <div className="p-4 border-t border-gray-700">
            <h3 className="text-sm font-semibold text-gray-600 mb-3">Recent Results</h3>
            <div className="space-y-2">
              {completedMatches.map((match) => {
                const winnerName =
                  match.winnerId === match.competitor1?.id
                    ? getCompetitorName(match.competitor1)
                    : getCompetitorName(match.competitor2);
                const loserName =
                  match.winnerId === match.competitor1?.id
                    ? getCompetitorName(match.competitor2)
                    : getCompetitorName(match.competitor1);

                return (
                  <div key={match.id} className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
                    <div className="text-sm">
                      <span className="text-gray-600 mr-2">#{match.matchNumber}</span>
                      <span className="text-green-400 font-medium">{winnerName}</span>
                      <span className="text-gray-600 mx-1">def.</span>
                      <span className="text-gray-600">{loserName}</span>
                      {match.score1 && match.score2 && (
                        <span className="text-gray-600 ml-2">({match.score1}-{match.score2})</span>
                      )}
                    </div>
                    <button
                      onClick={() => setPendingUndoId(match.id)}
                      disabled={undoMatchResult.isPending}
                      aria-label={`Undo result: ${winnerName} defeated ${loserName} (match ${match.matchNumber})`}
                      className="px-3 py-1 text-xs bg-red-600 hover:bg-red-500 disabled:bg-gray-600 rounded font-medium"
                    >
                      Undo
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Confirmation Modal */}
      {showConfirm && currentMatch && (
        <AccessibleDialog
          label="Confirm Result"
          onClose={() => setShowConfirm(false)}
          className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50"
        >
          <div
            className="bg-gray-800 rounded-xl p-6 max-w-md w-full"
          >
            <h3 id="confirm-result-title" className="text-xl font-bold mb-4">Confirm Result</h3>
            <div className="bg-gray-700 rounded-lg p-4 mb-4">
              <div className="text-lg font-semibold text-green-400">
                Winner:{' '}
                {selectedWinner === currentMatch.competitor1?.id
                  ? getCompetitorName(currentMatch.competitor1)
                  : getCompetitorName(currentMatch.competitor2)}
              </div>
              <div className="text-gray-600 mt-2">Score: {score1 || '0'} - {score2 || '0'}</div>
              {resultType !== 'win' && (
                <div className="text-red-400 mt-1">Result: {resultType.toUpperCase()}</div>
              )}
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => setShowConfirm(false)}>
                Cancel <span className="text-xs text-gray-600" aria-hidden="true">(Esc)</span>
              </Button>
              <Button variant="primary" className="flex-1" loading={recordResult.isPending} disabled={Boolean(resultValidationError)} onClick={handleSubmit}>
                Confirm <span className="text-xs text-green-200" aria-hidden="true">(Enter)</span>
              </Button>
            </div>
          </div>
        </AccessibleDialog>
      )}

      {/* Incident Report Modal */}
      {showIncidentModal && (
        <div
          ref={incidentDialogRef}
          className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="incident-modal-title"
        >
          <div className="bg-gray-800 rounded-xl p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 id="incident-modal-title" className="text-xl font-bold flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-orange-400" />
                Report Incident
              </h3>
              <button
                onClick={() => setShowIncidentModal(false)}
                className="text-gray-400 hover:text-white"
                aria-label="Close incident report dialog"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {currentMatch && (
              <div className="text-sm text-gray-400 mb-4">
                Match #{currentMatch.matchNumber}: {getCompetitorName(currentMatch.competitor1)} vs {getCompetitorName(currentMatch.competitor2)}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label htmlFor="incident-type" className="block text-sm text-gray-400 mb-1">Type</label>
                <select
                  id="incident-type"
                  value={incidentType}
                  onChange={(e) => setIncidentType(e.target.value)}
                  className="w-full p-3 bg-gray-700 rounded-lg text-white"
                >
                  <option value="injury">Injury</option>
                  <option value="disqualification">Disqualification</option>
                  <option value="medical">Medical</option>
                  <option value="equipment">Equipment</option>
                  <option value="conduct">Conduct</option>
                </select>
              </div>

              <div>
                <label htmlFor="incident-severity" className="block text-sm text-gray-400 mb-1">Severity</label>
                <select
                  id="incident-severity"
                  value={incidentSeverity}
                  onChange={(e) => setIncidentSeverity(e.target.value)}
                  className="w-full p-3 bg-gray-700 rounded-lg text-white"
                >
                  <option value="minor">Minor</option>
                  <option value="moderate">Moderate</option>
                  <option value="serious">Serious</option>
                </select>
              </div>

              <div>
                <label htmlFor="incident-description" className="block text-sm text-gray-400 mb-1">Description</label>
                <textarea
                  id="incident-description"
                  value={incidentDescription}
                  onChange={(e) => setIncidentDescription(e.target.value)}
                  placeholder="Describe the incident..."
                  rows={3}
                  className="w-full p-3 bg-gray-700 rounded-lg text-white resize-none"
                />
              </div>

              <div>
                <label htmlFor="incident-action" className="block text-sm text-gray-400 mb-1">Action Taken</label>
                <select
                  id="incident-action"
                  value={incidentAction}
                  onChange={(e) => setIncidentAction(e.target.value)}
                  className="w-full p-3 bg-gray-700 rounded-lg text-white"
                >
                  <option value="">-- Select --</option>
                  <option value="first_aid">First Aid</option>
                  <option value="withdrawn">Withdrawn</option>
                  <option value="continued">Continued match</option>
                  <option value="ambulance">Ambulance</option>
                </select>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowIncidentModal(false)}
                  className="flex-1 py-3 bg-gray-600 hover:bg-gray-500 rounded-lg font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={handleIncidentSubmit}
                  disabled={!incidentDescription.trim() || reportIncident.isPending}
                  className="flex-1 py-3 bg-orange-600 hover:bg-orange-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-semibold"
                >
                  {reportIncident.isPending ? 'Saving...' : 'Save Incident'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Help Modal */}
      {showKeyboardHelp && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50"
          onKeyDown={(e) => {
            if (e.key === 'Tab') {
              const focusables = (e.currentTarget as HTMLDivElement).querySelectorAll<HTMLElement>(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
              );
              if (focusables.length === 0) return;
              const first = focusables[0];
              const last = focusables[focusables.length - 1];
              if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
              } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
              }
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="keyboard-help-title"
            className="bg-gray-800 rounded-xl p-6 max-w-md w-full"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 id="keyboard-help-title" className="text-xl font-bold flex items-center">
                <Keyboard className="h-5 w-5 mr-2" aria-hidden="true" /> Keyboard Shortcuts
              </h3>
              <CloseButton
                onClose={() => setShowKeyboardHelp(false)}
                label="Close keyboard shortcuts"
                className="!text-gray-600 hover:!text-white"
              />
            </div>
            <div className="space-y-4">
              <div>
                <div className="text-sm text-gray-600 mb-2">Select Winner</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between">
                    <span>Competitor 1</span><kbd className="bg-gray-600 px-2 py-1 rounded text-xs">1</kbd>
                  </div>
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between">
                    <span>Competitor 2</span><kbd className="bg-gray-600 px-2 py-1 rounded text-xs">2</kbd>
                  </div>
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-600 mb-2">Navigation</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between">
                    <span>Previous match</span><kbd className="bg-gray-600 px-2 py-1 rounded text-xs">← / K</kbd>
                  </div>
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between">
                    <span>Next match</span><kbd className="bg-gray-600 px-2 py-1 rounded text-xs">→ / J</kbd>
                  </div>
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-600 mb-2">Result Type</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between"><span>Win</span><kbd className="bg-gray-600 px-2 py-1 rounded text-xs">W</kbd></div>
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between"><span>DQ</span><kbd className="bg-gray-600 px-2 py-1 rounded text-xs">D</kbd></div>
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between"><span>Forfeit</span><kbd className="bg-gray-600 px-2 py-1 rounded text-xs">F</kbd></div>
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between"><span>Injury</span><kbd className="bg-gray-600 px-2 py-1 rounded text-xs">I</kbd></div>
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-600 mb-2">Timer (sparring only)</div>
                <div className="grid grid-cols-1 gap-2">
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between"><span>Start / pause timer</span><kbd className="bg-gray-600 px-2 py-1 rounded text-xs">Space</kbd></div>
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between"><span>Show / hide timer panel</span><kbd className="bg-gray-600 px-2 py-1 rounded text-xs">T</kbd></div>
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-600 mb-2">Actions</div>
                <div className="grid grid-cols-1 gap-2">
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between"><span>Submit / Confirm</span><kbd className="bg-gray-600 px-2 py-1 rounded text-xs">Enter</kbd></div>
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between"><span>Cancel / Back</span><kbd className="bg-gray-600 px-2 py-1 rounded text-xs">Esc</kbd></div>
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between"><span>Undo last result</span><kbd className="bg-gray-600 px-2 py-1 rounded text-xs">Ctrl+Z</kbd></div>
                  <div className="bg-gray-700 p-2 rounded flex items-center justify-between"><span>Show this help</span><kbd className="bg-gray-600 px-2 py-1 rounded text-xs">?</kbd></div>
                </div>
              </div>
            </div>
            <Button variant="secondary" className="w-full mt-4" onClick={() => setShowKeyboardHelp(false)}>
              Close
            </Button>
          </div>
        </div>
      )}

      {/* Undo result confirmation */}
      <ConfirmDialog
        isOpen={Boolean(pendingUndoId)}
        onClose={closeUndoDialog}
        onConfirm={() => {
          if (undoAcknowledged) void checkUndoStatus();
          else if (pendingUndoId && !undoMatchResult.isPending) undoMatchResult.mutate(pendingUndoId);
        }}
        title="Undo this result?"
        message={(
          <>
            <span className="block">This reverses the recorded winner. Downstream matches may need review or replay.</span>
            {undoError && <span role="alert" className="block mt-2 text-red-600 dark:text-red-300">{undoError}</span>}
          </>
        )}
        confirmText={undoAcknowledged ? 'Check status' : 'Undo result'}
        variant="danger"
        isLoading={undoMatchResult.isPending || undoChecking}
        closeDisabled={undoAcknowledged}
      />
    </div>
  );
}
