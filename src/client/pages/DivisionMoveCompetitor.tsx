/**
 * Move Competitor Between Divisions Modal
 * 
 * Allows moving a competitor from one division to another with safety checks
 * for existing brackets. Uses DivisionExceptionDialog for audit trail.
 */

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { getAuthHeaders } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import DivisionExceptionDialog, {
  type DivisionMoveParams,
} from '../components/DivisionExceptionDialog';

interface Division {
  id: string;
  name: string;
  eventType: string;
  bracket: { id: string; matches?: { id: string; status: string }[] } | null;
}

interface Assignment {
  id: string;
  divisionId: string;
  registration: {
    id: string;
    competitor: {
      firstName: string;
      lastName: string;
    };
  };
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  assignment: Assignment;
  currentDivision: Division;
  tournamentId: string;
}

export default function DivisionMoveCompetitorModal({
  isOpen,
  onClose,
  assignment,
  currentDivision,
  tournamentId,
}: Props) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [dialogParams, setDialogParams] = useState<DivisionMoveParams | null>(null);

  // Fetch all divisions in the tournament
  const { data: divisions } = useQuery<Division[]>({
    queryKey: ['divisions', tournamentId],
    queryFn: async () => {
      const res = await fetch(`/api/divisions/tournament/${tournamentId}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch divisions');
      return res.json();
    },
    enabled: isOpen,
  });

  useEffect(() => {
    if (isOpen && divisions) {
      // Filter divisions by same event type
      const compatibleDivisions = divisions
        .filter((d) => d.id !== currentDivision.id && d.eventType === currentDivision.eventType)
        .map((d) => ({
          id: d.id,
          name: d.name,
          hasActiveBracket: Boolean(
            d.bracket?.matches && d.bracket.matches.some((m) => m.status === 'completed' || m.status === 'in_progress')
          ),
        }));

      setDialogParams({
        type: 'move',
        competitorName: `${assignment.registration.competitor.firstName} ${assignment.registration.competitor.lastName}`,
        fromDivisionId: currentDivision.id,
        fromDivisionName: currentDivision.name,
        availableDivisions: compatibleDivisions,
        assignmentId: assignment.id,
      });
    } else {
      setDialogParams(null);
    }
  }, [isOpen, divisions, currentDivision, assignment]);

  const moveMutation = useMutation({
    mutationFn: async ({
      assignmentId,
      toDivisionId,
    }: {
      assignmentId: string;
      toDivisionId: string;
    }) => {
      const res = await fetch(`/api/divisions/${currentDivision.id}/move`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignmentId, toDivisionId }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to move competitor');
      }
      return res.json();
    },
    onSuccess: () => {
      showToast('Competitor moved successfully', 'success');
      queryClient.invalidateQueries({ queryKey: ['divisions', tournamentId] });
      queryClient.invalidateQueries({ queryKey: ['division-assignments'] });
      onClose();
    },
    onError: (error: Error) => {
      showToast(error.message, 'error');
    },
  });

  const handleConfirm = (result: {
    type: 'move';
    auditReason: string;
    toDivisionId?: string;
    assignmentId?: string;
  }) => {
    if (!result.toDivisionId || !result.assignmentId) {
      showToast('Invalid move parameters', 'error');
      return;
    }
    moveMutation.mutate({
      assignmentId: result.assignmentId,
      toDivisionId: result.toDivisionId,
    });
  };

  return (
    <DivisionExceptionDialog
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={handleConfirm}
      params={dialogParams}
      isLoading={moveMutation.isPending}
    />
  );
}
