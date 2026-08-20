import { forwardRef, useId, type ReactNode, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'error'> {
  error?: ReactNode;
  helperText?: ReactNode;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      id: explicitId,
      error,
      helperText,
      className = '',
      children,
      'aria-invalid': explicitAriaInvalid,
      'aria-describedby': explicitAriaDescribedBy,
      ...props
    },
    ref,
  ) => {
    const generatedId = useId();
    const id = explicitId || (error || helperText ? `select-${generatedId}` : undefined);
    const errorId = id && error && typeof error !== 'boolean' ? `${id}-error` : undefined;
    const helperId = id && helperText ? `${id}-helper` : undefined;

    const describedBy = [
      explicitAriaDescribedBy,
      errorId,
      helperId,
    ]
      .filter(Boolean)
      .join(' ') || undefined;

    const isInvalid = explicitAriaInvalid !== undefined ? explicitAriaInvalid : (Boolean(error) || undefined);

    const selectClasses = [
      /* 44px on every viewport: consistent alignment and a mobile-safe target. */
      'h-11 px-3 pr-10 rounded-lg border border-slate-200 dark:border-slate-700',
      'bg-white dark:bg-slate-900',
      'text-sm text-slate-900 dark:text-slate-100',
      'focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500',
      'transition-all appearance-none w-full',
      error && 'border-red-500 focus:ring-red-500/30 focus:border-red-500',
    ]
      .filter(Boolean)
      .join(' ');

    const hasMessageSlot = Boolean(error && typeof error !== 'boolean') || Boolean(helperText);

    const selectElement = (
      <div className={['relative w-full', !hasMessageSlot && className].filter(Boolean).join(' ')}>
        <select
          ref={ref}
          id={id}
          aria-invalid={isInvalid}
          aria-describedby={describedBy}
          className={selectClasses}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
          aria-hidden="true"
        />
      </div>
    );

    if (!hasMessageSlot) {
      return selectElement;
    }

    return (
      <div className={['w-full', className].filter(Boolean).join(' ')}>
        {selectElement}
        {error && typeof error !== 'boolean' && (
          <p id={errorId} role="alert" className="mt-1.5 text-xs text-red-600 dark:text-red-400 font-medium">
            {error}
          </p>
        )}
        {helperText && (
          <p id={helperId} className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {helperText}
          </p>
        )}
      </div>
    );
  },
);

Select.displayName = 'Select';

export default Select;
