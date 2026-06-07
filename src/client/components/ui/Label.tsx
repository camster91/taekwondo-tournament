import type { ReactNode, LabelHTMLAttributes } from 'react';

interface LabelProps extends Omit<LabelHTMLAttributes<HTMLLabelElement>, 'children'> {
  children: ReactNode;
  required?: boolean;
}

export default function Label({
  children,
  required = false,
  className = '',
  ...rest
}: LabelProps) {
  return (
    <label
      className={['block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5', className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
      {required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );
}