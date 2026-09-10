import { forwardRef, type ReactNode, type ElementType } from 'react';
import Spinner from './Spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'gradient';
type Size = 'sm' | 'md' | 'lg';

const variantClasses: Record<Variant, string> = {
  primary: 'bg-primary-600 hover:bg-primary-700 text-white shadow-sm',
  secondary:
    'bg-surface-100 hover:bg-surface-200 text-surface-900 dark:bg-surface-800 dark:hover:bg-surface-700 dark:text-white border border-surface-200 dark:border-surface-700',
  ghost: 'bg-transparent hover:bg-surface-100 text-surface-700 dark:hover:bg-surface-800 dark:text-surface-200',
  danger: 'bg-danger hover:bg-danger/90 text-white shadow-sm',
  success: 'bg-success hover:bg-success/90 text-white shadow-sm',
  gradient: 'btn-gradient text-white shadow-sm',
};

/* Size scale: 36 / 44 / 48. The default meets the mobile target-size floor
   and stays aligned with Input/Select. */
const sizeClasses: Record<Size, string> = {
  sm: 'h-9 px-3 text-xs',
  md: 'h-11 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};

const baseClasses =
  'btn inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-all duration-fast ' +
  'disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]';

function buildClassName(
  variant: Variant,
  size: Size,
  className: string | undefined,
  isLocked: boolean,
): string {
  return [
    baseClasses,
    variantClasses[variant],
    sizeClasses[size],
    isLocked && 'pointer-events-none',
    className,
  ]
    .filter(Boolean)
    .join(' ');
}

// Polymorphic: render as <button> by default, or as any element/component via `as`.
// Usage:
//   <Button>Click</Button>
//   <Button as={Link} to="/path">Go</Button>
//   <Button as="a" href="...">External</Button>
export type ButtonProps = {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  asChild?: boolean;
  as?: ElementType;
  className?: string;
  children?: ReactNode;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  [key: string]: unknown;
};

const Button = forwardRef<HTMLElement, ButtonProps>(
  function Button(props, ref) {
    const variant: Variant = (props.variant as Variant) ?? 'primary';
    const size: Size = (props.size as Size) ?? 'md';
    const {
      loading = false,
      className,
      disabled,
      children,
      as,
      type,
      ...rest
    } = props;

    const Component: ElementType = (as as ElementType) ?? 'button';
    const isNativeButton = Component === 'button';
    const isLocked = Boolean(disabled || loading);
    const classes = buildClassName(variant, size, className as string | undefined, isLocked);

    // For non-button elements, "disabled" is invalid — drop it.
    const restProps: Record<string, unknown> = { ...rest };
    if (!isNativeButton) {
      delete restProps.disabled;
    }

    return (
      <Component
        ref={ref}
        disabled={isNativeButton ? isLocked : undefined}
        aria-disabled={!isNativeButton && isLocked ? true : undefined}
        type={isNativeButton ? (type ?? 'button') : undefined}
        className={classes}
        {...restProps}
      >
        {loading && <Spinner size="sm" />}
        {children}
      </Component>
    );
  },
);

export default Button;
