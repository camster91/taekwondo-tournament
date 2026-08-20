import { forwardRef, useId, type ReactNode, type TextareaHTMLAttributes } from 'react';

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'error'> {
  error?: ReactNode;
  helperText?: ReactNode;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      id: explicitId,
      error,
      helperText,
      className = '',
      'aria-invalid': explicitAriaInvalid,
      'aria-describedby': explicitAriaDescribedBy,
      ...props
    },
    ref,
  ) => {
    const generatedId = useId();
    const id = explicitId || (error || helperText ? `textarea-${generatedId}` : undefined);
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

    const textareaClasses = [
      'min-h-[88px] py-2.5 px-3 rounded-lg border border-slate-200 dark:border-slate-700',
      'bg-white dark:bg-slate-900',
      'text-sm text-slate-900 dark:text-slate-100',
      'placeholder:text-slate-400',
      'focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500',
      'transition-all resize-y w-full',
      error && 'border-red-500 focus:ring-red-500/30 focus:border-red-500',
    ]
      .filter(Boolean)
      .join(' ');

    const hasMessageSlot = Boolean(error && typeof error !== 'boolean') || Boolean(helperText);

    const textareaElement = (
      <textarea
        ref={ref}
        id={id}
        aria-invalid={isInvalid}
        aria-describedby={describedBy}
        className={[textareaClasses, !hasMessageSlot && className].filter(Boolean).join(' ')}
        {...props}
      />
    );

    if (!hasMessageSlot) {
      return textareaElement;
    }

    return (
      <div className={['w-full', className].filter(Boolean).join(' ')}>
        {textareaElement}
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

Textarea.displayName = 'Textarea';

export default Textarea;