// Director-facing special-needs line (#15): icon + the full note, wrapping
// rather than truncating so it can actually be read. For the dark
// scorekeeper screen use SpecialNeedsBadge instead. Never render this on
// public pages.
import { AlertTriangle } from 'lucide-react';

export default function SpecialNeedsNote({ note, name, className = '' }: { note: string; name?: string; className?: string }) {
  return (
    <p
      data-testid="special-needs-note"
      className={`flex items-start gap-1 text-xs text-amber-800 dark:text-amber-300 ${className}`}
    >
      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">
        <span className="font-semibold">{name ? `${name}: ` : 'Special needs: '}</span>
        {note}
      </span>
    </p>
  );
}
