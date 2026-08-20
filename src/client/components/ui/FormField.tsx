import { useId, type ReactNode } from 'react';
import Label from './Label';

export interface FormFieldProps {
  id?: string;
  label?: ReactNode;
  required?: boolean;
  error?: ReactNode;
  helperText?: ReactNode;
  children: ReactNode;
  className?: string;
}

export default function FormField({
  id: explicitId,
  label,
  required = false,
  error,
  helperText,
  children,
  className = '',
}: FormFieldProps) {
  const generatedId = useId();
  const fieldId = explicitId || `field-${generatedId}`;
  const errorId = `${fieldId}-error`;
  const helperId = `${fieldId}-helper`;

  const hasErrorMessage = Boolean(error) && (typeof error !== 'boolean' || error === true);

  return (
    <div className={['space-y-1.5', className].filter(Boolean).join(' ')}>
      {label && (
        <Label htmlFor={fieldId} required={required}>
          {label}
        </Label>
      )}
      {children}
      {hasErrorMessage && typeof error !== 'boolean' && (
        <p id={errorId} role="alert" className="text-xs text-red-600 dark:text-red-400 font-medium">
          {error}
        </p>
      )}
      {helperText && (
        <p id={helperId} className="text-xs text-slate-500 dark:text-slate-400">
          {helperText}
        </p>
      )}
    </div>
  );
}
