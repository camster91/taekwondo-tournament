import { forwardRef, type TextareaHTMLAttributes } from 'react';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ error, className = '', ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={[
          'min-h-[88px] py-2.5 px-3 rounded-lg border border-slate-200 dark:border-slate-700',
          'bg-white dark:bg-slate-900',
          'text-sm text-slate-900 dark:text-slate-100',
          'placeholder:text-slate-400',
          'focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500',
          'transition-all resize-y',
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

Textarea.displayName = 'Textarea';

export default Textarea;