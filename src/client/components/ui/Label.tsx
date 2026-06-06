import type { ReactNode } from 'react';

interface LabelProps {
  children: ReactNode;
  required?: boolean;
  className?: string;
}

export default function Label({
  children,
  required = false,
  className = '',
}: LabelProps) {
  return (
    <label
      className={['block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5', className].filter(Boolean).join(' ')}
    >
      {children}
      {required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );
}