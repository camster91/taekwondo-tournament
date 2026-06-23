import type { ComponentProps, ReactNode, MouseEvent } from 'react';

type Variant =
  | 'default' // neutral gray, color-shift on hover
  | 'ghost' // adds subtle filled background on hover
  | 'primary' // indigo accent
  | 'danger' // red accent for destructive actions
  | 'success'; // green accent for positive/active toggle state

type Size = 'sm' | 'md' | 'lg';

const sizeClasses: Record<Size, string> = {
  // Mobile-first: 44x44 minimum hit area. Desktop override keeps the icon
  // visually compact (24-28px) without shrinking the tap target.
  sm: 'h-11 w-11 sm:h-8 sm:w-8 p-1.5',
  md: 'h-11 w-11 sm:h-9 sm:w-9 p-2',
  lg: 'h-11 w-11 sm:h-10 sm:w-10 p-2.5',
};

const iconClasses: Record<Size, string> = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
};

const variantClasses: Record<Variant, string> = {
  default:
    'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
  ghost:
    'text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-700/50 rounded-md',
  primary:
    'text-slate-700 hover:text-indigo-600 hover:bg-indigo-50 dark:text-slate-400 dark:hover:text-indigo-400 dark:hover:bg-indigo-950/50 rounded-md',
  danger:
    'text-slate-500 hover:text-red-600 hover:bg-red-50 dark:text-slate-400 dark:hover:text-red-400 dark:hover:bg-red-950/50 rounded-md',
  success:
    'text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 dark:text-slate-400 dark:hover:text-emerald-400 dark:hover:bg-emerald-950/50 rounded-md',
};

export type IconButtonProps = Omit<ComponentProps<'button'>, 'children' | 'aria-label'> & {
  /** The icon to render. Must be a Lucide icon or similar sized SVG. */
  icon: ReactNode;
  /** Required accessible name. Rendered as aria-label. */
  label: string;
  /** Visual style. */
  variant?: Variant;
  /** Size of the icon and hit area. md = 44x44 mobile, 36x36 desktop. */
  size?: Size;
  /** Toggle state for aria-pressed. Omit for non-toggle buttons. */
  pressed?: boolean;
  /** When true, render the danger variant. */
  destructive?: boolean;
};

/**
 * Standardized icon-only button. Required `label` enforces an accessible name.
 * Mobile hit area is 44x44 (WCAG 2.5.5 AAA), desktop scales down for visual
 * compactness while keeping the click target intact.
 *
 * Use IconButton for any table-row action, list-row action, or toolbar icon
 * button. Use CloseButton only for modal/dialog dismissal.
 */
export default function IconButton({
  icon,
  label,
  variant = 'default',
  size = 'md',
  pressed,
  destructive = false,
  type = 'button',
  className = '',
  onClick,
  ...rest
}: IconButtonProps) {
  const finalVariant: Variant = destructive ? 'danger' : variant;
  const classes = [
    'inline-flex items-center justify-center flex-shrink-0 transition-colors',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    sizeClasses[size],
    variantClasses[finalVariant],
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type={type}
      onClick={onClick}
      className={classes}
      aria-label={label}
      aria-pressed={pressed}
      {...rest}
    >
      <span className={iconClasses[size]} aria-hidden="true">
        {icon}
      </span>
    </button>
  );
}
