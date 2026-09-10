interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple';
  size?: 'sm' | 'md';
  dot?: boolean;
  className?: string;
  /** Optional tooltip text (rendered as native title attribute). */
  title?: string;
}

const variants = {
  default: 'bg-surface-100 text-surface-800 dark:bg-surface-700 dark:text-surface-300',
  success: 'bg-success/10 text-success dark:bg-success/20 dark:text-success',
  warning: 'bg-warning/10 text-warning dark:bg-warning/20 dark:text-warning',
  danger: 'bg-danger/10 text-danger dark:bg-danger/20 dark:text-danger',
  info: 'bg-info/10 text-info dark:bg-info/20 dark:text-info',
  purple: 'bg-accent-100 text-accent-800 dark:bg-accent-900/30 dark:text-accent-400',
};

const dotColors = {
  default: 'bg-surface-400',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  purple: 'bg-accent-500',
};

const sizes = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-0.5 text-sm',
};

export default function Badge({
  children,
  variant = 'default',
  size = 'sm',
  dot = false,
  className = '',
  title,
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center font-medium rounded-full ${variants[variant]} ${sizes[size]} ${className}`}
      title={title}
    >
      {dot && (
        <span
          className={`w-1.5 h-1.5 rounded-full mr-1.5 ${dotColors[variant]}`}
        />
      )}
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const statusConfig: Record<string, { variant: BadgeProps['variant']; label: string }> = {
    draft: { variant: 'default', label: 'Draft' },
    registration: { variant: 'info', label: 'Registration' },
    brackets: { variant: 'purple', label: 'Brackets' },
    active: { variant: 'warning', label: 'Active' },
    in_progress: { variant: 'warning', label: 'In Progress' },
    completed: { variant: 'success', label: 'Completed' },
    pending: { variant: 'default', label: 'Pending' },
    ready: { variant: 'info', label: 'Ready' },
  };

  const config = statusConfig[status] || { variant: 'default' as const, label: status };

  return (
    <Badge variant={config.variant} dot>
      {config.label}
    </Badge>
  );
}
