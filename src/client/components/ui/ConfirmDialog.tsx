import { AlertTriangle } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import Button from './Button';
import CloseButton from './CloseButton';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
  isLoading?: boolean;
}

const FOCUSABLE_SELECTOR =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Confirm dialog with accessible contract and destructive action safety:
 *  - Title & message connected via aria-labelledby and aria-describedby.
 *  - For danger/warning, initial focus is directed to Cancel (safest action).
 *  - For info, initial focus is directed to Confirm.
 *  - When isLoading is true, dismiss (backdrop, Escape, close button) is locked to prevent double submits.
 *  - Body scroll is locked while dialog is open.
 *  - Focus is trapped inside the panel and returned to previous element on close.
 */
export default function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  isLoading = false,
}: ConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<Element | null>(null);
  const baseId = useId();
  const titleId = `confirm-dialog-title-${baseId}`;
  const descId = `confirm-dialog-desc-${baseId}`;

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocusedRef.current = typeof document !== 'undefined'
      ? document.activeElement
      : null;

    // Lock body scroll
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const id = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      // For destructive/warning dialogs, focus the safe Cancel button first.
      // For info dialogs, focus the Confirm button.
      const isDangerous = variant === 'danger' || variant === 'warning';
      const safeBtn = isDangerous
        ? panel.querySelector<HTMLButtonElement>('[data-cancel-button]')
        : panel.querySelector<HTMLButtonElement>('[data-confirm-button]');
      const target = safeBtn ?? panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (target ?? panel).focus();
    }, 0);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (!isLoading) {
          onClose();
        }
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);
      if (focusables.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !panel.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.clearTimeout(id);
      document.removeEventListener('keydown', handleKeyDown, true);
      const prev = previouslyFocusedRef.current;
      if (prev && typeof (prev as HTMLElement).focus === 'function') {
        (prev as HTMLElement).focus();
      }
    };
  }, [isOpen, onClose, isLoading, variant]);

  if (!isOpen) return null;

  const confirmVariant =
    variant === 'danger'
      ? 'danger'
      : variant === 'warning'
        ? 'primary'
        : 'primary';

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          className="fixed inset-0 bg-black/50 transition-opacity"
          onClick={() => {
            if (!isLoading) onClose();
          }}
          aria-hidden="true"
        />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descId}
          aria-busy={isLoading ? 'true' : undefined}
          tabIndex={-1}
          className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full transform transition-all"
        >
          <div className="p-6">
            <div className="flex items-start gap-4">
              <div
                className={`p-3 rounded-full flex-shrink-0 ${
                  variant === 'danger'
                    ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                    : variant === 'warning'
                      ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400'
                      : 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                }`}
                aria-hidden="true"
              >
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div className="flex-1 pt-1 min-w-0">
                <h3 id={titleId} className="text-lg font-semibold text-gray-900 dark:text-white">
                  {title}
                </h3>
                <div id={descId} className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                  {message}
                </div>
              </div>
              <CloseButton
                onClose={() => {
                  if (!isLoading) onClose();
                }}
                disabled={isLoading}
                label="Close dialog"
              />
            </div>
          </div>
          <div className="px-6 py-4 bg-gray-50 dark:bg-gray-700/50 rounded-b-lg flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
            <Button
              variant="secondary"
              onClick={onClose}
              disabled={isLoading}
              data-cancel-button
              className="w-full sm:w-auto min-h-[44px]"
            >
              {cancelText}
            </Button>
            <Button
              variant={confirmVariant}
              onClick={onConfirm}
              loading={isLoading}
              disabled={isLoading}
              data-confirm-button
              className="w-full sm:w-auto min-h-[44px]"
            >
              {isLoading ? 'Processing...' : confirmText}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
