import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'error'> {
  error?: ReactNode;
  helperText?: ReactNode;
  /** Class on the inner <input>. Use to override padding/typography (e.g. icon-prefixed searches). */
  inputClassName?: string;
  /** Optional icon rendered inside a left-padded wrapper (auto-adjusts input padding). */
  leftIcon?: ReactNode;
  /** Optional icon rendered inside a right-padded wrapper. */
  rightIcon?: ReactNode;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      id: explicitId,
      error,
      helperText,
      className = '',
      inputClassName = '',
      leftIcon,
      rightIcon,
      'aria-invalid': explicitAriaInvalid,
      'aria-describedby': explicitAriaDescribedBy,
      ...props
    },
    ref,
  ) => {
    const generatedId = useId();
    const id = explicitId || (error || helperText ? `input-${generatedId}` : undefined);
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

    const inputClasses = [
      /* 44px on every viewport: consistent alignment and a mobile-safe target. */
      'w-full h-11 px-3 rounded-lg border border-slate-200 dark:border-slate-700',
      'bg-white dark:bg-slate-900',
      'text-sm text-slate-900 dark:text-slate-100',
      'placeholder:text-slate-400',
      'focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500',
      'transition-all',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      error && 'border-red-500 focus:ring-red-500/30 focus:border-red-500',
      leftIcon && 'pl-9',
      rightIcon && 'pr-9',
      inputClassName,
    ]
      .filter(Boolean)
      .join(' ');

    const hasMessageSlot = Boolean(error && typeof error !== 'boolean') || Boolean(helperText);

    const inputElement = !leftIcon && !rightIcon ? (
      <input
        ref={ref}
        id={id}
        aria-invalid={isInvalid}
        aria-describedby={describedBy}
        className={[inputClasses, !hasMessageSlot && className].filter(Boolean).join(' ')}
        {...props}
      />
    ) : (
      <div className={['relative w-full', !hasMessageSlot && className].filter(Boolean).join(' ')}>
        {leftIcon && (
          <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
            {leftIcon}
          </div>
        )}
        <input
          ref={ref}
          id={id}
          aria-invalid={isInvalid}
          aria-describedby={describedBy}
          className={inputClasses}
          {...props}
        />
        {rightIcon && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-slate-400">
            {rightIcon}
          </div>
        )}
      </div>
    );

    if (!hasMessageSlot) {
      return inputElement;
    }

    return (
      <div className={['w-full', className].filter(Boolean).join(' ')}>
        {inputElement}
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

Input.displayName = 'Input';

export default Input;
