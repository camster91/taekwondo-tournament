import { ReactNode, useEffect, useRef } from 'react';
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
  /** Prevent Escape, backdrop, and close-button dismissal while work is pending. */
  closeDisabled?: boolean;
}

const FOCUSABLE_SELECTOR =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Reusable modal dialog built on the global `.modal-*` CSS classes.
 * Handles backdrop click + escape key + body scroll lock +
 * keyboard focus trap + focus return to the trigger element on close.
 *
 * a11y contract:
 *  - Tab / Shift+Tab cycle inside the panel (focus trap).
 *  - Escape closes the modal.
 *  - On open, the first focusable element in the panel is focused,
 *    falling back to the panel itself.
 *  - On close, focus returns to whichever element was focused when
 *    the modal opened (typically the trigger button).
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
  closeDisabled = false,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<Element | null>(null);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);

  useEffect(() => {
    onCloseRef.current = onClose;
    closeDisabledRef.current = closeDisabled;
  }, [onClose, closeDisabled]);

  useEffect(() => {
    if (!isOpen) return;
    previouslyFocusedRef.current = typeof document !== 'undefined'
      ? document.activeElement
      : null;
    const id = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const first = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? panel).focus();
    }, 0);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (!closeDisabledRef.current) onCloseRef.current();
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
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="modal-container flex items-center justify-center p-4">
      <div className="modal-backdrop" onClick={() => { if (!closeDisabledRef.current) onCloseRef.current(); }} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
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
            <h2 className="text-lg font-semibold text-surface-900 dark:text-white truncate">
              {title}
            </h2>
            {subtitle && (
              <p className="text-sm text-surface-600 dark:text-surface-400 mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
          <CloseButton onClose={() => onCloseRef.current()} size="lg" disabled={closeDisabled} />
        </div>
        <div className={noBodyPadding ? 'flex-1 overflow-hidden' : 'modal-body'}>
          {children}
        </div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
