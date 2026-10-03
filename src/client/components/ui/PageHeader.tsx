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
      <div className="min-w-0 sm:flex-1 sm:min-w-[12rem]">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2 flex-wrap [overflow-wrap:anywhere]">
          {title}
          {count !== undefined && (
            <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-400">
              ({count})
            </span>
          )}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {description}
          </p>
        )}
      </div>
      {/* Buttons wrap rather than squeezing the title to nothing. */}
      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}