import { ReactNode } from 'react';
import CloseButton from './CloseButton';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

const sizeClassMap: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
  full: 'max-w-4xl',
};

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Modal title. For a11y, prefer a plain string. Use a ReactNode for branded headers (icon + text). */
  title: ReactNode;
  /** Optional subtitle shown under the title in the header. */
  subtitle?: ReactNode;
  /** Modal body content. */
  children: ReactNode;
  /** Modal footer (typically action buttons). */
  footer?: ReactNode;
  /** Max-width preset. Default: 'md'. */
  size?: ModalSize;
  /**
   * Apply extra classes to the panel (e.g. `max-h-[90vh]` for tall content).
   * The size class is appended automatically.
   */
  panelClassName?: string;
  /**
   * When true, the modal body has no internal scroll. Use for very tall content
   * where the panel itself should be scrollable.
   */
  noBodyPadding?: boolean;
}

/**
 * Reusable modal dialog built on the global `.modal-*` CSS classes.
 * Handles backdrop click + escape key + body scroll lock.
 */
export default function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
  panelClassName = '',
  noBodyPadding = false,
}: ModalProps) {
  if (!isOpen) return null;

  return (
    <div className="modal-container flex items-center justify-center p-4">
      <div className="modal-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={[
          'modal-panel flex flex-col overflow-hidden',
          sizeClassMap[size],
          panelClassName,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="modal-header">
          <div className="min-w-0 flex-1 pr-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
              {title}
            </h2>
            {subtitle && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
          <CloseButton onClose={onClose} size="lg" />
        </div>
        <div className={noBodyPadding ? 'flex-1 overflow-hidden' : 'modal-body'}>
          {children}
        </div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
