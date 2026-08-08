import { ReactNode, useEffect, useRef } from 'react';
import { activateDialogFocus } from '../../utils/dialog-focus';

interface AccessibleDialogProps {
  children: ReactNode;
  label: string;
  onClose: () => void;
  className?: string;
}

export default function AccessibleDialog({ children, label, onClose, className }: AccessibleDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dialogRef.current) return;
    return activateDialogFocus(dialogRef.current, onClose);
  }, [onClose]);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className={className}
    >
      {children}
    </div>
  );
}
