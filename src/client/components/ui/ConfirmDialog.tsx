import { AlertTriangle, X } from 'lucide-react';
import type { ReactNode } from 'react';
import Button from './Button';

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
  if (!isOpen) return null;

  // Maps the dialog variant to a Button variant for the confirm action.
  // Cancel always uses secondary.
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
        <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full transform transition-all">
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
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          <div className="px-6 py-4 bg-gray-50 dark:bg-gray-700/50 rounded-b-lg flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
            <Button
              variant="secondary"
              onClick={onClose}
              disabled={isLoading}
              className="w-full sm:w-auto"
            >
              {cancelText}
            </Button>
            <Button
              variant={confirmVariant}
              onClick={onConfirm}
              loading={isLoading}
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
