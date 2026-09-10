import { useState, useEffect } from 'react';
import { AlertTriangle, Users, Plus, Merge } from 'lucide-react';
import ConfirmDialog from './ui/ConfirmDialog';
import { Label } from './ui';
import { Select } from './ui';
import { Input } from './ui';

/**
 * Division exception dialog for director overrides (#139).
 * Handles move, create, and merge operations with conflict detection.
 */

export interface DivisionMoveParams {
  type: 'move';
  competitorName: string;
  fromDivisionId: string;
  fromDivisionName: string;
  availableDivisions: Array<{ id: string; name: string; hasActiveBracket: boolean }>;
  assignmentId: string;
}

export interface DivisionCreateParams {
  type: 'create';
  tournamentId: string;
  suggestedName?: string;
  eventType: 'patterns' | 'sparring';
  beltLevel: string;
  gender: string;
  ageMin: number;
  ageMax: number;
  weightClass?: string | null;
}

export interface DivisionMergeParams {
  type: 'merge';
  sourceDivisions: Array<{
    id: string;
    name: string;
    competitorCount: number;
    hasActiveBracket: boolean;
  }>;
  availableTargets: Array<{ id: string; name: string; hasActiveBracket: boolean }>;
}

export type DivisionExceptionParams =
  | DivisionMoveParams
  | DivisionCreateParams
  | DivisionMergeParams;

interface DivisionExceptionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (result: {
    type: 'move' | 'create' | 'merge';
    auditReason: string;
    // Move-specific
    toDivisionId?: string;
    assignmentId?: string;
    // Create-specific
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
    // Merge-specific
    sourceDivisionIds?: string[];
    targetDivisionId?: string;
  }) => void;
  params: DivisionExceptionParams | null;
  isLoading?: boolean;
}

const OVERRIDE_REASONS = [
  { value: 'skill_mismatch', label: 'Skill level mismatch' },
  { value: 'safety', label: 'Safety consideration' },
  { value: 'fairness', label: 'Competitive fairness' },
  { value: 'registration_error', label: 'Registration data error' },
  { value: 'parent_request', label: 'Parent/guardian request' },
  { value: 'balancing', label: 'Division balancing' },
  { value: 'custom', label: 'Other (specify below)' },
] as const;

export default function DivisionExceptionDialog({
  isOpen,
  onClose,
  onConfirm,
  params,
  isLoading = false,
}: DivisionExceptionDialogProps) {
  const [selectedReason, setSelectedReason] = useState('');
  const [customReason, setCustomReason] = useState('');

  // Move state
  const [selectedTargetDivisionId, setSelectedTargetDivisionId] = useState('');

  // Create state
  const [divisionName, setDivisionName] = useState('');

  // Merge state
  const [selectedMergeTargetId, setSelectedMergeTargetId] = useState('');

  useEffect(() => {
    if (isOpen && params) {
      // Reset form state when dialog opens
      setSelectedReason('');
      setCustomReason('');
      setSelectedTargetDivisionId('');
      setSelectedMergeTargetId('');

      if (params.type === 'create' && params.suggestedName) {
        setDivisionName(params.suggestedName);
      } else {
        setDivisionName('');
      }
    }
  }, [isOpen, params]);

  const handleConfirm = () => {
    if (!params) return;

    const reason =
      selectedReason === 'custom'
        ? customReason
        : OVERRIDE_REASONS.find((r) => r.value === selectedReason)?.label || '';

    if (params.type === 'move') {
      onConfirm({
        type: 'move',
        auditReason: reason,
        toDivisionId: selectedTargetDivisionId,
        assignmentId: params.assignmentId,
      });
    } else if (params.type === 'create') {
      onConfirm({
        type: 'create',
        auditReason: reason,
        divisionData: {
          name: divisionName,
          beltLevel: params.beltLevel,
          gender: params.gender,
          eventType: params.eventType,
          ageMin: params.ageMin,
          ageMax: params.ageMax,
          weightClass: params.weightClass,
          tournamentId: params.tournamentId,
        },
      });
    } else if (params.type === 'merge') {
      onConfirm({
        type: 'merge',
        auditReason: reason,
        sourceDivisionIds: params.sourceDivisions.map((d) => d.id),
        targetDivisionId: selectedMergeTargetId,
      });
    }
  };

  if (!params) return null;

  let isValid = false;
  let title = '';
  let message: React.ReactNode = '';
  let icon: React.ReactNode = null;
  let hasConflict = false;
  let conflictMessage = '';

  if (params.type === 'move') {
    title = 'Move Competitor to Different Division';
    icon = <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />;

    const selectedDivision = params.availableDivisions.find(
      (d) => d.id === selectedTargetDivisionId
    );
    hasConflict = selectedDivision?.hasActiveBracket || false;
    if (hasConflict) {
      conflictMessage =
        'Target division has an active bracket. Move will invalidate existing matches.';
    }

    isValid =
      selectedReason !== '' &&
      (selectedReason !== 'custom' || customReason.trim().length > 0) &&
      selectedTargetDivisionId !== '';

    message = (
      <>
        <p className="mb-3">
          Move <strong>{params.competitorName}</strong> from{' '}
          <strong>{params.fromDivisionName}</strong> to a different division.
        </p>
        <div className="mb-4">
          <Label htmlFor="target-division">Target Division</Label>
          <Select
            id="target-division"
            value={selectedTargetDivisionId}
            onChange={(e) => setSelectedTargetDivisionId(e.target.value)}
            className="mt-1"
          >
            <option value="">Select target division...</option>
            {params.availableDivisions
              .filter((d) => d.id !== params.fromDivisionId)
              .map((division) => (
                <option key={division.id} value={division.id}>
                  {division.name}
                  {division.hasActiveBracket ? ' ⚠️ (active bracket)' : ''}
                </option>
              ))}
          </Select>
        </div>
      </>
    );
  } else if (params.type === 'create') {
    title = 'Create New Division';
    icon = <Plus className="h-5 w-5 text-green-600 dark:text-green-400" />;

    isValid =
      selectedReason !== '' &&
      (selectedReason !== 'custom' || customReason.trim().length > 0) &&
      divisionName.trim().length > 0;

    message = (
      <>
        <p className="mb-3">
          Create a new division for competitors who don't fit existing categories.
        </p>
        <div className="mb-4">
          <Label htmlFor="division-name">Division Name</Label>
          <Input
            id="division-name"
            type="text"
            value={divisionName}
            onChange={(e) => setDivisionName(e.target.value)}
            placeholder="e.g., 10-12 Male Color Belt Patterns"
            className="mt-1"
          />
        </div>
        <div className="mb-3 text-sm text-gray-600 dark:text-gray-400 space-y-1">
          <p>
            • <strong>Belt:</strong> {params.beltLevel}
          </p>
          <p>
            • <strong>Gender:</strong> {params.gender}
          </p>
          <p>
            • <strong>Age:</strong> {params.ageMin}-{params.ageMax}
          </p>
          <p>
            • <strong>Event:</strong> {params.eventType}
          </p>
          {params.weightClass && (
            <p>
              • <strong>Weight Class:</strong> {params.weightClass}
            </p>
          )}
        </div>
      </>
    );
  } else if (params.type === 'merge') {
    title = 'Merge Divisions';
    icon = <Merge className="h-5 w-5 text-purple-600 dark:text-purple-400" />;

    const selectedTarget = params.availableTargets.find(
      (d) => d.id === selectedMergeTargetId
    );
    const anySourceHasBracket = params.sourceDivisions.some((d) => d.hasActiveBracket);
    const targetHasBracket = selectedTarget?.hasActiveBracket || false;
    hasConflict = anySourceHasBracket || targetHasBracket;

    if (hasConflict) {
      const bracketDivisions = [
        ...params.sourceDivisions.filter((d) => d.hasActiveBracket).map((d) => d.name),
        ...(targetHasBracket && selectedTarget ? [selectedTarget.name] : []),
      ];
      conflictMessage = `${bracketDivisions.length} division(s) have active brackets: ${bracketDivisions.join(', ')}. All brackets will be cleared.`;
    }

    isValid =
      selectedReason !== '' &&
      (selectedReason !== 'custom' || customReason.trim().length > 0) &&
      selectedMergeTargetId !== '';

    const totalCompetitors = params.sourceDivisions.reduce(
      (sum, d) => sum + d.competitorCount,
      0
    );

    message = (
      <>
        <p className="mb-3">
          Merge <strong>{params.sourceDivisions.length}</strong> division
          {params.sourceDivisions.length === 1 ? '' : 's'} (
          <strong>{totalCompetitors}</strong> total competitors) into a single division.
        </p>
        <div className="mb-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Divisions to merge:
          </p>
          <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
            {params.sourceDivisions.map((div) => (
              <li key={div.id}>
                • {div.name} ({div.competitorCount} competitor
                {div.competitorCount === 1 ? '' : 's'})
                {div.hasActiveBracket && (
                  <span className="text-amber-600 dark:text-amber-400"> ⚠️ active bracket</span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div className="mb-4">
          <Label htmlFor="merge-target">Target Division (all competitors will move here)</Label>
          <Select
            id="merge-target"
            value={selectedMergeTargetId}
            onChange={(e) => setSelectedMergeTargetId(e.target.value)}
            className="mt-1"
          >
            <option value="">Select target division...</option>
            {params.availableTargets.map((division) => (
              <option key={division.id} value={division.id}>
                {division.name}
                {division.hasActiveBracket ? ' ⚠️ (active bracket)' : ''}
              </option>
            ))}
          </Select>
        </div>
      </>
    );
  }

  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={handleConfirm}
      title={title}
      message={
        <div>
          <div className="flex items-start mb-4">
            {icon && <div className="mr-3 mt-1">{icon}</div>}
            <div className="flex-1">{message}</div>
          </div>

          {hasConflict && (
            <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg flex items-start">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mr-2 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800 dark:text-amber-200">{conflictMessage}</div>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <Label htmlFor="override-reason">Reason for override (required)</Label>
              <Select
                id="override-reason"
                value={selectedReason}
                onChange={(e) => setSelectedReason(e.target.value)}
                className="mt-1"
              >
                <option value="">Select a reason...</option>
                {OVERRIDE_REASONS.map((reason) => (
                  <option key={reason.value} value={reason.value}>
                    {reason.label}
                  </option>
                ))}
              </Select>
            </div>

            {selectedReason === 'custom' && (
              <div>
                <Label htmlFor="custom-reason">Specify reason</Label>
                <textarea
                  id="custom-reason"
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  placeholder="Enter the specific reason for this override..."
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            )}

            <p className="text-sm text-gray-600 dark:text-gray-400">
              This action will be logged in the audit trail with your director credentials and
              timestamp.
            </p>
          </div>
        </div>
      }
      confirmText={params.type === 'merge' ? 'Merge Divisions' : 'Confirm Override'}
      cancelText="Cancel"
      variant="warning"
      isLoading={isLoading}
      closeDisabled={!isValid}
    />
  );
}
