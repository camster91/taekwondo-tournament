import type { ReactNode } from 'react';

interface PageHeaderProps {
  title?: string;
  description?: string;
  count?: number | string;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export default function PageHeader({
  title,
  description,
  count,
  actions,
  children,
  className = '',
}: PageHeaderProps) {
  return (
    <div
      className={['flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className].filter(Boolean).join(' ')}
    >
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2 flex-wrap">
          {title}
          {count !== undefined && (
            <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-sm font-medium text-slate-500 dark:text-slate-400">
              ({count})
            </span>
          )}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 flex-shrink-0">
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}