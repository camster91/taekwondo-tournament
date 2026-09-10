import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import ConfirmDialog from './ui/ConfirmDialog';
import { Label } from './ui';
import { Select } from './ui';

/**
 * Director override dialog for check-in and division exceptions (#139).
 * Provides clear confirmation workflow with audit-friendly messaging.
 * 
 * Usage:
 * - Check-in: Allow director to check in a competitor who doesn't meet automated rules
 * - Division: Allow director to manually override auto-categorization assignments
 */

export interface DirectorOverrideCheckInParams {
  type: 'check-in';
  competitorName: string;
  reason: string;
  currentWeight?: number;
  requireWeightOverride: boolean;
}

export interface DirectorOverrideDivisionParams {
  type: 'division';
  competitorName: string;
  fromDivision?: string;
  toDivision: string;
  reason: string;
}

export type DirectorOverrideParams = DirectorOverrideCheckInParams | DirectorOverrideDivisionParams;

interface DirectorOverrideDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (result: { overrideWeight?: number; overrideReason: string }) => void;
  params: DirectorOverrideParams | null;
  isLoading?: boolean;
}

const OVERRIDE_REASONS = [
  { value: 'medical', label: 'Medical accommodation' },
  { value: 'skill_level', label: 'Skill level assessment' },
  { value: 'safety', label: 'Safety consideration' },
  { value: 'registration_error', label: 'Registration data error' },
  { value: 'director_discretion', label: 'Director discretion' },
  { value: 'custom', label: 'Other (specify below)' },
] as const;

export default function DirectorOverrideDialog({
  isOpen,
  onClose,
  onConfirm,
  params,
  isLoading = false,
}: DirectorOverrideDialogProps) {
  const [selectedReason, setSelectedReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [overrideWeight, setOverrideWeight] = useState('');

  const handleConfirm = () => {
    const reason = selectedReason === 'custom' ? customReason : OVERRIDE_REASONS.find(r => r.value === selectedReason)?.label || '';
    const result: { overrideWeight?: number; overrideReason: string } = {
      overrideReason: reason,
    };

    if (params?.type === 'check-in' && params.requireWeightOverride && overrideWeight) {
      result.overrideWeight = Number(overrideWeight);
    }

    onConfirm(result);
  };

  if (!params) return null;

  const isValid = 
    selectedReason !== '' &&
    (selectedReason !== 'custom' || customReason.trim().length > 0) &&
    (!params.type || params.type !== 'check-in' || !params.requireWeightOverride || overrideWeight !== '');

  let title = '';
  let message: React.ReactNode = '';

  if (params.type === 'check-in') {
    title = 'Director Override: Check-In';
    message = (
      <>
        <p className="mb-3">
          You are about to check in <strong>{params.competitorName}</strong> with a director override.
        </p>
        {params.reason && (
          <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
            Automated check-in blocked: {params.reason}
          </p>
        )}
        {params.requireWeightOverride && (
          <p className="mb-3 text-amber-600 dark:text-amber-400 font-medium">
            This competitor has no recorded weight. You must provide a check-in weight to continue.
          </p>
        )}
        <p className="text-sm text-gray-600 dark:text-gray-400">
          This action will be logged in the audit trail with your director credentials and timestamp.
        </p>
      </>
    );
  } else {
    title = 'Director Override: Division Assignment';
    message = (
      <>
        <p className="mb-3">
          You are about to manually assign <strong>{params.competitorName}</strong> to{' '}
          <strong>{params.toDivision}</strong>
          {params.fromDivision && (
            <>
              {' '}(currently in <strong>{params.fromDivision}</strong>)
            </>
          )}.
        </p>
        {params.reason && (
          <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
            Auto-categorization result: {params.reason}
          </p>
        )}
        <p className="text-sm text-gray-600 dark:text-gray-400">
          This manual assignment will override the automatic categorization and will be marked in the system audit log.
        </p>
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
          {message}
          
          <div className="mt-4 space-y-4">
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

            {params.type === 'check-in' && params.requireWeightOverride && (
              <div>
                <Label htmlFor="override-weight">Check-in weight (lbs, required)</Label>
                <input
                  id="override-weight"
                  type="number"
                  min="0"
                  step="0.1"
                  value={overrideWeight}
                  onChange={(e) => setOverrideWeight(e.target.value)}
                  placeholder="Enter weight in pounds"
                  className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            )}
          </div>
        </div>
      }
      confirmText="Confirm Override"
      cancelText="Cancel"
      variant="warning"
      isLoading={isLoading}
      closeDisabled={!isValid}
    />
  );
}
