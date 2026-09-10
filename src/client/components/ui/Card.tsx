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
        'rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 shadow-sm',
        padded && 'p-6',
        interactive && 'cursor-pointer transition-all duration-base hover:shadow-md hover:-translate-y-0.5',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}