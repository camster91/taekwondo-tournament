import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  errorId?: string;
  inputClassName?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      error,
      errorId,
      className = '',
      inputClassName = '',
      leftIcon,
      rightIcon,
      ...props
    },
    ref,
  ) => {
    const inputClasses = [
      'w-full h-11 px-3 rounded-lg border border-surface-200 dark:border-surface-700',
      'bg-white dark:bg-surface-900',
      'text-sm text-surface-900 dark:text-surface-100',
      'placeholder:text-surface-400',
      'focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500',
      'transition-all',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      error && 'border-danger focus:ring-danger/30 focus:border-danger',
      leftIcon && 'pl-9',
      rightIcon && 'pr-9',
      inputClassName,
    ]
      .filter(Boolean)
      .join(' ');

    const ariaInvalid = error ? true : props['aria-invalid'];
    const ariaDescribedBy = errorId && error ? errorId : props['aria-describedby'];

    if (!leftIcon && !rightIcon) {
      return (
        <input
          ref={ref}
          className={[inputClasses, className].filter(Boolean).join(' ')}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          {...props}
        />
      );
    }

    return (
      <div className={['relative w-full', className].filter(Boolean).join(' ')}>
        {leftIcon && (
          <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-surface-400">
            {leftIcon}
          </div>
        )}
        <input
          ref={ref}
          className={inputClasses}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          {...props}
        />
        {rightIcon && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-surface-400">
            {rightIcon}
          </div>
        )}
      </div>
    );
  },
);

Input.displayName = 'Input';

export default Input;
