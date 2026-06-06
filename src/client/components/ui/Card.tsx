import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  interactive?: boolean;
}

export default function Card({
  children,
  className = '',
  padded = true,
  interactive = false,
}: CardProps) {
  return (
    <div
      className={[
        'rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm',
        padded && 'p-6',
        interactive && 'cursor-pointer transition-all duration-150 hover:shadow-md hover:-translate-y-0.5',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}