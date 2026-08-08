import type { ReactNode } from 'react';

interface ToolbarProps {
  children: ReactNode;
  slideIn?: boolean;
  className?: string;
}

export default function Toolbar({
  children,
  slideIn = false,
  className = '',
}: ToolbarProps) {
  if (slideIn) {
    return (
      <div
        className={[
          'animate-slide-down px-4 py-3',
          'bg-gradient-to-r from-primary-50/80 via-white to-white',
          'dark:from-primary-950/40 dark:via-slate-900 dark:to-slate-900',
          'border-b border-slate-200 dark:border-slate-800',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="flex items-center gap-3">{children}</div>
      </div>
    );
  }

  return (
    <div
      className={['flex items-center gap-3 px-4 py-3', className].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  );
}