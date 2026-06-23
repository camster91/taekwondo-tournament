// Small inline badge that surfaces a competitor's special-needs notes
// and the registration-level competeWithOlder flag.
//
// Designed for the scorekeeper screen: the scorekeeper should never
// call a match for a kid with a medical note they didn't see. The
// badge is amber, has a tooltip with the full text, and uses an
// accessible label so screen-readers announce it.
//
// Two flags are surfaced:
//   - Competitor-level (the kid's permanent medical notes)
//   - Registration-level (per-tournament notes + competeWithOlder override)
import { Heart, AlertTriangle } from 'lucide-react';
import { useState } from 'react';

interface SpecialNeedsBadgeProps {
  /** Competitor-level notes (from Competitor.specialNeeds) */
  competitorNotes?: string | null;
  /** Registration-level notes (from Registration.specialNeeds) */
  registrationNotes?: string | null;
  /** True if parent opted in to compete in older age band */
  competeWithOlder?: boolean;
  /** Visual size: 'sm' for compact rows, 'md' for the match view */
  size?: 'sm' | 'md';
}

export default function SpecialNeedsBadge({
  competitorNotes,
  registrationNotes,
  competeWithOlder = false,
  size = 'sm',
}: SpecialNeedsBadgeProps) {
  const [expanded, setExpanded] = useState(false);

  const hasNotes = !!(competitorNotes || registrationNotes || competeWithOlder);
  if (!hasNotes) return null;

  // Combine notes into a single readable string for the tooltip.
  const tooltipText = [
    competitorNotes && `Permanent: ${competitorNotes}`,
    registrationNotes && `This event: ${registrationNotes}`,
    competeWithOlder && 'Parent opted to compete in older age band',
  ]
    .filter(Boolean)
    .join('\n');

  // Pick icon: AlertTriangle when there's a real note, Heart for the
  // age-band opt-in (informational, not medical).
  const Icon = competitorNotes || registrationNotes ? AlertTriangle : Heart;

  const iconClass = size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5';
  const textClass = size === 'md' ? 'text-sm' : 'text-xs';
  const padding = size === 'md' ? 'px-2.5 py-1' : 'px-2 py-0.5';

  return (
    <span
      className={`inline-flex items-center gap-1 ${padding} rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 ${textClass} font-medium max-w-full`}
      title={tooltipText}
      aria-label={`Special considerations: ${tooltipText.replace(/\n/g, '; ')}`}
      role="note"
      onClick={(e) => {
        e.stopPropagation();
        setExpanded(!expanded);
      }}
    >
      <Icon className={iconClass} aria-hidden="true" />
      <span className="truncate">
        {competitorNotes || registrationNotes || 'Older age band'}
      </span>
      {expanded && (competitorNotes || registrationNotes) && (
        <span className="block max-w-[280px] truncate ml-1 font-normal">
          {competitorNotes || registrationNotes}
        </span>
      )}
    </span>
  );
}
