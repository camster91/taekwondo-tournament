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
          'min-h-[88px] py-2.5 px-3 rounded-lg border border-surface-200 dark:border-surface-700',
          'bg-white dark:bg-surface-900',
          'text-sm text-surface-900 dark:text-surface-100',
          'placeholder:text-surface-400',
          'focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500',
          'transition-all resize-y',
          error && 'border-danger focus:ring-danger/30 focus:border-danger',
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