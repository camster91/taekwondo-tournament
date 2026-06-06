import type { ReactNode } from 'react';

interface CardBodyProps {
  children: ReactNode;
  className?: string;
}

export default function CardBody({ children, className = '' }: CardBodyProps) {
  return (
    <div className={['space-y-4', className].filter(Boolean).join(' ')}>
      {children}
    </div>
  );
}