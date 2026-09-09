/**
 * Move Competitor Between Divisions Modal
 * 
 * Allows moving a competitor from one division to another with safety checks
 * for existing brackets.
 */

import { useState } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { ArrowRight, AlertTriangle } from 'lucide-react';
import { getAuthHeaders } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Modal } from '../components/ui';
import { Button } from '../components/ui';
import { Label } from '../components/ui';
import { Select } from '../components/ui';
import Spinner from '../components/ui/Spinner';

interface Division {
  id: string;
  name: string;
  eventType: string;
  bracket: { id: string } | null;
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
  const [targetDivisionId, setTargetDivisionId] = useState('');

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

  const moveMutation = useMutation({
    mutationFn: async ({ assignmentId, toDivisionId }: { assignmentId: string; toDivisionId: string }) => {
      const res = await fetch(`/api/divisions/move/${assignmentId}`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ toDivisionId }),
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
      setTargetDivisionId('');
    },
    onError: (error: Error) => {
      showToast(error.message, 'error');
    },
  });

  const handleMove = () => {
    if (!targetDivisionId) {
      showToast('Please select a target division', 'error');
      return;
    }
    moveMutation.mutate({ assignmentId: assignment.id, toDivisionId: targetDivisionId });
  };

  const targetDivision = divisions?.find(d => d.id === targetDivisionId);
  const hasBracketWarning = currentDivision.bracket || targetDivision?.bracket;

  // Filter divisions by same event type
  const compatibleDivisions = divisions?.filter(
    d => d.id !== currentDivision.id && d.eventType === currentDivision.eventType
  ) || [];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Move Competitor to Another Division"
      size="md"
    >
      <div className="space-y-4">
        <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
          <div className="text-sm">
            <div className="font-semibold text-gray-900 dark:text-white">
              {assignment.registration.competitor.firstName} {assignment.registration.competitor.lastName}
            </div>
            <div className="text-gray-600 dark:text-gray-400 mt-1">
              Current division: {currentDivision.name}
            </div>
          </div>
        </div>

        {hasBracketWarning && (
          <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-yellow-800 dark:text-yellow-200">
                <p className="font-semibold">Warning: Existing bracket detected</p>
                <p className="mt-1">
                  {currentDivision.bracket && targetDivision?.bracket
                    ? 'Both the source and target divisions have brackets. Moving this competitor may corrupt both brackets.'
                    : currentDivision.bracket
                    ? 'The current division has a bracket. Moving this competitor may corrupt the bracket.'
                    : 'The target division has a bracket. Moving this competitor may corrupt the bracket.'}
                </p>
                <p className="mt-1 font-medium">
                  Consider regenerating brackets after this move.
                </p>
              </div>
            </div>
          </div>
        )}

        <div>
          <Label htmlFor="target-division">Target Division</Label>
          <Select
            id="target-division"
            value={targetDivisionId}
            onChange={(e) => setTargetDivisionId(e.target.value)}
            className="mt-1"
          >
            <option value="">Select a division...</option>
            {compatibleDivisions.map((division) => (
              <option key={division.id} value={division.id}>
                {division.name}
                {division.bracket ? ' (has bracket)' : ''}
              </option>
            ))}
          </Select>
          {compatibleDivisions.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              No compatible divisions available for the same event type ({currentDivision.eventType}).
            </p>
          )}
        </div>

        {targetDivision && (
          <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800">
            <div className="flex-1 text-sm">
              <div className="font-medium text-gray-900 dark:text-white">
                {currentDivision.name}
              </div>
              <div className="text-gray-600 dark:text-gray-400 text-xs">
                Source
              </div>
            </div>
            <ArrowRight className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <div className="flex-1 text-sm">
              <div className="font-medium text-gray-900 dark:text-white">
                {targetDivision.name}
              </div>
              <div className="text-gray-600 dark:text-gray-400 text-xs">
                Target
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="secondary" onClick={onClose} disabled={moveMutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleMove}
            disabled={!targetDivisionId || moveMutation.isPending || compatibleDivisions.length === 0}
          >
            {moveMutation.isPending ? (
              <>
                <Spinner className="w-4 h-4 mr-2" />
                Moving...
              </>
            ) : (
              <>
                <ArrowRight className="w-4 h-4 mr-2" />
                Move Competitor
              </>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
