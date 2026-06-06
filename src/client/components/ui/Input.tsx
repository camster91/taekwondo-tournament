import { forwardRef, type InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ error, className = '', ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={[
          'h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700',
          'bg-white dark:bg-slate-900',
          'text-sm text-slate-900 dark:text-slate-100',
          'placeholder:text-slate-400',
          'focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500',
          'transition-all',
          error && 'border-red-500 focus:ring-red-500/30 focus:border-red-500',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        {...props}
      />
    );
  },
);

Input.displayName = 'Input';

export default Input;