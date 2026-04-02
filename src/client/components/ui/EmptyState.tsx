import { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
}

export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
}: EmptyStateProps) {
  return (
    <div className="text-center py-12 px-6">
      <div className="mx-auto w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mb-4">
        <Icon className="h-8 w-8 text-gray-400 dark:text-gray-500" />
      </div>
      <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm mx-auto mb-6">
          {description}
        </p>
      )}
      {(action || secondaryAction) && (
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          {action && (
            <button onClick={action.onClick} className="btn btn-primary">
              {action.label}
            </button>
          )}
          {secondaryAction && (
            <button onClick={secondaryAction.onClick} className="btn btn-secondary">
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
