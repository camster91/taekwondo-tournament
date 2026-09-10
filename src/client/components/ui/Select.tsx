import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: string;
  errorId?: string;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ error, errorId, className = '', children, ...props }, ref) => {
    const ariaInvalid = error ? true : props['aria-invalid'];
    const ariaDescribedBy = errorId && error ? errorId : props['aria-describedby'];
    return (
      <div className="relative">
        <select
          ref={ref}
          className={[
            'h-11 px-3 pr-10 rounded-lg border border-surface-200 dark:border-surface-700',
            'bg-white dark:bg-surface-900',
            'text-sm text-surface-900 dark:text-surface-100',
            'focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500',
            'transition-all appearance-none w-full',
            error && 'border-danger focus:ring-danger/30 focus:border-danger',
            className,
          ]
            .filter(Boolean)
            .join(' ')}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-400"
          aria-hidden="true"
        />
      </div>
    );
  },
);

Select.displayName = 'Select';

export default Select;
