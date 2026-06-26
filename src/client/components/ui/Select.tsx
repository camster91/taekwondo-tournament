import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: string;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ error, className = '', children, ...props }, ref) => {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={[
            /* h-10 (40px) on both mobile + desktop — matches Input + Button `md`. */
            'h-10 px-3 pr-10 rounded-lg border border-slate-200 dark:border-slate-700',
            'bg-white dark:bg-slate-900',
            'text-sm text-slate-900 dark:text-slate-100',
            'focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500',
            'transition-all appearance-none w-full',
            error && 'border-red-500 focus:ring-red-500/30 focus:border-red-500',
            className,
          ]
            .filter(Boolean)
            .join(' ')}
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
  },
);

Select.displayName = 'Select';

export default Select;