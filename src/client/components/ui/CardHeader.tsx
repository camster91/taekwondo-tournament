import type { ReactNode, ComponentType } from 'react';

interface CardHeaderProps {
  title?: string;
  description?: string;
  action?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  children?: ReactNode;
  className?: string;
}

export default function CardHeader({
  title,
  description,
  action,
  icon: Icon,
  children,
  className = '',
}: CardHeaderProps) {
  const hasContentBelow = action || description;

  return (
    <div className={['mb-4', hasContentBelow ? 'border-b border-slate-200 dark:border-slate-800 pb-4' : '', className].filter(Boolean).join(' ')}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {(title || Icon) && (
            <h3 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
              {Icon && <Icon className="h-5 w-5 text-slate-500" />}
              {title}
            </h3>
          )}
          {description && (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              {description}
            </p>
          )}
          {children}
        </div>
        {action && (
          <div className="flex items-center gap-2 flex-shrink-0">
            {action}
          </div>
        )}
      </div>
    </div>
  );
}