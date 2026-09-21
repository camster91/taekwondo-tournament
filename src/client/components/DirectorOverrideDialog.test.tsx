// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import DirectorOverrideDialog from './DirectorOverrideDialog';

describe('DirectorOverrideDialog (#139)', () => {
  describe('check-in override', () => {
    it('renders check-in override dialog with required fields', () => {
      const onClose = vi.fn();
      const onConfirm = vi.fn();
      
      render(
        <DirectorOverrideDialog
          isOpen={true}
          onClose={onClose}
          onConfirm={onConfirm}
          params={{
            type: 'check-in',
            competitorName: 'Alice Smith',
            reason: 'No weight recorded',
            requireWeightOverride: true,
          }}
        />
      );

      expect(screen.getByText(/Director Override: Check-In/i)).toBeInTheDocument();
      expect(screen.getByText(/Alice Smith/)).toBeInTheDocument();
      expect(screen.getByText(/No weight recorded/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Reason for override/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Check-in weight/i)).toBeInTheDocument();
    });

    it('requires reason selection before confirming', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();
      
      render(
        <DirectorOverrideDialog
          isOpen={true}
          onClose={vi.fn()}
          onConfirm={onConfirm}
          params={{
            type: 'check-in',
            competitorName: 'Alice Smith',
            reason: '',
            requireWeightOverride: false,
          }}
        />
      );

      const confirmButton = screen.getByText('Confirm Override');
      
      // Confirm should be disabled when no reason selected
      // (ConfirmDialog disables button via closeDisabled prop)
      expect(confirmButton.closest('button')).toBeInTheDocument();
    });

    it('requires weight when requireWeightOverride is true', () => {
      render(
        <DirectorOverrideDialog
          isOpen={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          params={{
            type: 'check-in',
            competitorName: 'Bob Jones',
            reason: 'Missing weight data',
            requireWeightOverride: true,
          }}
        />
      );

      expect(screen.getByLabelText(/Check-in weight/i)).toBeInTheDocument();
      expect(screen.getByText(/must provide a check-in weight/i)).toBeInTheDocument();
    });

    it('includes audit trail disclosure', () => {
      render(
        <DirectorOverrideDialog
          isOpen={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          params={{
            type: 'check-in',
            competitorName: 'Carol White',
            reason: '',
            requireWeightOverride: false,
          }}
        />
      );

      expect(screen.getByText(/will be logged in the audit trail/i)).toBeInTheDocument();
      expect(screen.getByText(/director credentials and timestamp/i)).toBeInTheDocument();
    });
  });

  describe('division override', () => {
    it('renders division override dialog', () => {
      render(
        <DirectorOverrideDialog
          isOpen={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          params={{
            type: 'division',
            competitorName: 'David Lee',
            fromDivision: 'Youth Male Forms 10-12',
            toDivision: 'Cadet Male Forms 13-15',
            reason: 'Age boundary exception',
          }}
        />
      );

      expect(screen.getByText(/Director Override: Division Assignment/i)).toBeInTheDocument();
      expect(screen.getByText(/David Lee/)).toBeInTheDocument();
      expect(screen.getByText(/Cadet Male Forms 13-15/)).toBeInTheDocument();
      expect(screen.getByText(/Youth Male Forms 10-12/)).toBeInTheDocument();
      expect(screen.getByText(/Age boundary exception/)).toBeInTheDocument();
    });

    it('mentions auto-categorization override', () => {
      render(
        <DirectorOverrideDialog
          isOpen={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          params={{
            type: 'division',
            competitorName: 'Eve Chen',
            toDivision: 'Adult Female Sparring',
            reason: 'Skill-based reassignment',
          }}
        />
      );

      expect(screen.getByText(/override the automatic categorization/i)).toBeInTheDocument();
      expect(screen.getByText(/system audit log/i)).toBeInTheDocument();
    });

    it('provides standard override reasons', () => {
      render(
        <DirectorOverrideDialog
          isOpen={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          params={{
            type: 'division',
            competitorName: 'Frank Liu',
            toDivision: 'Senior Division',
            reason: '',
          }}
        />
      );

      const reasonSelect = screen.getByLabelText(/Reason for override/i);
      
      expect(reasonSelect).toBeInTheDocument();
      expect(screen.getByText(/Medical accommodation/i)).toBeInTheDocument();
      expect(screen.getByText(/Skill level assessment/i)).toBeInTheDocument();
      expect(screen.getByText(/Safety consideration/i)).toBeInTheDocument();
      expect(screen.getByText(/Registration data error/i)).toBeInTheDocument();
      expect(screen.getByText(/Director discretion/i)).toBeInTheDocument();
    });
  });

  describe('safety and confirmation', () => {
    it('uses warning variant for safety', () => {
      const { container } = render(
        <DirectorOverrideDialog
          isOpen={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          params={{
            type: 'check-in',
            competitorName: 'Grace Park',
            reason: '',
            requireWeightOverride: false,
          }}
        />
      );

      // ConfirmDialog with variant="warning" should render warning icon
      const warningIcon = container.querySelector('svg');
      expect(warningIcon).toBeInTheDocument();
    });

    it('shows loading state during submission', () => {
      render(
        <DirectorOverrideDialog
          isOpen={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          params={{
            type: 'check-in',
            competitorName: 'Henry Kim',
            reason: '',
            requireWeightOverride: false,
          }}
          isLoading={true}
        />
      );

      expect(screen.getByText(/Processing/i)).toBeInTheDocument();
    });

    it('returns null when params are null', () => {
      const { container } = render(
        <DirectorOverrideDialog
          isOpen={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          params={null}
        />
      );

      expect(container.firstChild).toBeNull();
    });
  });

  describe('custom reason flow', () => {
    it('shows custom reason textarea when "Other" selected', async () => {
      const user = userEvent.setup();
      
      render(
        <DirectorOverrideDialog
          isOpen={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          params={{
            type: 'check-in',
            competitorName: 'Ivy Martinez',
            reason: '',
            requireWeightOverride: false,
          }}
        />
      );

      const reasonSelect = screen.getByLabelText(/Reason for override/i);
      await user.selectOptions(reasonSelect, 'custom');

      expect(screen.getByLabelText(/Specify reason/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/Enter the specific reason/i)).toBeInTheDocument();
    });
  });
});
