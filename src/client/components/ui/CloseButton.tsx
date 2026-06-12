import type { ComponentProps, MouseEvent } from 'react';
import { X } from 'lucide-react';

type Variant = 'default' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

const sizeClasses: Record<Size, string> = {
  sm: 'p-1',
  md: 'p-1.5',
  lg: 'p-2',
};

const iconClasses: Record<Size, string> = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
};

const variantClasses: Record<Variant, string> = {
  // Color-shift (default): used inside modals, toasts, header bars
  default:
    'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300',
  // Filled ghost: for use on bare backgrounds where color shift is too subtle
  ghost:
    'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 rounded-md',
};

export type CloseButtonProps = Omit<ComponentProps<'button'>, 'children' | 'aria-label'> & {
  /** Visual style. `default` = color shift only; `ghost` = adds a subtle filled background on hover. */
  variant?: Variant;
  /** Size of the X icon and hit area. `md` matches the existing ConfirmDialog. */
  size?: Size;
  /** Accessible label. Defaults to "Close". */
  label?: string;
  /** Click handler. The X event is stopped to prevent click-through to underlying surfaces. */
  onClose?: (e: MouseEvent<HTMLButtonElement>) => void;
};

export default function CloseButton({
  variant = 'default',
  size = 'md',
  label = 'Close',
  onClose,
  onClick,
  className = '',
  type = 'button',
  ...rest
}: CloseButtonProps) {
  const classes = [
    'inline-flex items-center justify-center flex-shrink-0 transition-colors',
    sizeClasses[size],
    variantClasses[variant],
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type={type}
      onClick={(e) => {
        if (onClose) onClose(e);
        else if (onClick) onClick(e);
      }}
      className={classes}
      aria-label={label}
      {...rest}
    >
      <X className={iconClasses[size]} aria-hidden="true" />
    </button>
  );
}
