import { AlertTriangle } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
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
  closeDisabled?: boolean;
}

const FOCUSABLE_SELECTOR =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Confirm dialog with the same a11y contract as Modal:
 *  - Escape closes (treated as Cancel).
 *  - Tab / Shift+Tab cycle inside the panel.
 *  - On open, focus moves to the confirm button.
 *  - On close, focus returns to the element that was focused
 *    before the dialog opened.
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
  closeDisabled = false,
}: ConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    previouslyFocusedRef.current = typeof document !== 'undefined'
      ? document.activeElement
      : null;
    const id = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      // Prefer the confirm button as the focus target — it's the
      // action the user is being asked to take.
      const confirmBtn = panel.querySelector<HTMLButtonElement>('[data-confirm-button]');
      const target = confirmBtn ?? panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (target ?? panel).focus();
    }, 0);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
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
      window.clearTimeout(id);
      document.removeEventListener('keydown', handleKeyDown, true);
      const prev = previouslyFocusedRef.current;
      if (prev && typeof (prev as HTMLElement).focus === 'function') {
        (prev as HTMLElement).focus();
      }
    };
  }, [isOpen, onClose]);

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
          onClick={onClose}
        />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          tabIndex={-1}
          className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full transform transition-all"
        >
          <div className="p-6">
            <div className="flex items-start gap-4">
              <div
                className={`p-3 rounded-full ${
                  variant === 'danger'
                    ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                    : variant === 'warning'
                      ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400'
                      : 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                }`}
              >
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div className="flex-1 pt-1">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {title}
                </h3>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                  {message}
                </p>
              </div>
              <CloseButton onClose={onClose} disabled={closeDisabled || isLoading} />
            </div>
          </div>
          <div className="px-6 py-4 bg-gray-50 dark:bg-gray-700/50 rounded-b-lg flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
            <Button
              variant="secondary"
              onClick={onClose}
              disabled={isLoading || closeDisabled}
              className="w-full sm:w-auto"
            >
              {cancelText}
            </Button>
            <Button
              variant={confirmVariant}
              onClick={onConfirm}
              loading={isLoading}
              data-confirm-button
              className="w-full sm:w-auto"
            >
              {isLoading ? 'Processing...' : confirmText}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
