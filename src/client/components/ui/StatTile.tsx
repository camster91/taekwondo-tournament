import type { ReactNode } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface StatTileProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  trend?: {
    value: string;
    direction: 'up' | 'down' | 'flat';
  };
  accent?: 'default' | 'success' | 'warning' | 'danger' | 'indigo';
  className?: string;
}

const accentValueClasses: Record<NonNullable<StatTileProps['accent']>, string> = {
  default: 'text-slate-900 dark:text-white',
  success: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-400',
  danger: 'text-red-600 dark:text-red-400',
  indigo: 'text-indigo-600 dark:text-indigo-400',
};

const accentIconBgClasses: Record<NonNullable<StatTileProps['accent']>, string> = {
  default: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400',
  success: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
  warning: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
  danger: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
  indigo: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400',
};

export default function StatTile({
  label,
  value,
  icon,
  trend,
  accent = 'default',
  className = '',
}: StatTileProps) {
  return (
    <div
      className={[
        'rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-5',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {label}
          </p>
          <p
            className={[
              'mt-1 text-3xl font-bold tabular-nums tracking-tight',
              accentValueClasses[accent],
            ].join(' ')}
          >
            {value}
          </p>
        </div>
        {icon && (
          <div
            className={[
              'flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center',
              accentIconBgClasses[accent],
            ].join(' ')}
          >
            {icon}
          </div>
        )}
      </div>
      {trend && (
        <div className="mt-3 flex items-center gap-1">
          {trend.direction === 'up' && (
            <TrendingUp className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          )}
          {trend.direction === 'down' && (
            <TrendingDown className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
          )}
          {trend.direction === 'flat' && (
            <Minus className="h-3.5 w-3.5 text-slate-400" />
          )}
          <span
            className={[
              'text-xs font-medium',
              trend.direction === 'up' && 'text-emerald-600 dark:text-emerald-400',
              trend.direction === 'down' && 'text-red-600 dark:text-red-400',
              trend.direction === 'flat' && 'text-slate-400',
            ].join(' ')}
          >
            {trend.value}
          </span>
        </div>
      )}
    </div>
  );
}