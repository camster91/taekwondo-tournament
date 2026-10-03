// A strip in the organizer's colour with their logo and name, shown on
// parent-facing pages (family portal, manage registration, lookup,
// scoreboards). Renders nothing when there is no name or logo to show.
import { useState, type ReactNode } from 'react';
import { resolveOrganizerBranding } from '../utils/organizer-branding';

interface Props {
  name?: string | null;
  color?: string | null;
  logoUrl?: string | null;
  /** Small line above the name, e.g. "Hosted by". */
  label?: string;
  /** Extra content under the name (e.g. the tournament name). */
  children?: ReactNode;
  className?: string;
  /** Classes for the inner row, e.g. to centre it on a full-width strip. */
  contentClassName?: string;
  /** Slimmer strip for sticky headers. */
  compact?: boolean;
}

export default function OrganizerBrandHeader({
  name, color, logoUrl, label, children, className = '', contentClassName = '', compact = false,
}: Props) {
  const brand = resolveOrganizerBranding({ name, color, logoUrl });
  const [logoFailed, setLogoFailed] = useState(false);
  const showLogo = Boolean(brand.logoUrl) && !logoFailed;
  if (!brand.name && !showLogo) return null;

  return (
    <div
      data-testid="organizer-brand-header"
      className={`px-4 ${compact ? 'py-2' : 'py-3'} ${className}`}
      style={{ backgroundColor: brand.color, color: brand.textColor }}
    >
      <div className={`flex min-w-0 items-center gap-3 ${contentClassName}`}>
        {showLogo && (
          <span
            className={`flex ${compact ? 'h-8 w-8' : 'h-11 w-11'} flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-1`}
          >
            <img
              src={brand.logoUrl!}
              // The name is written next to the logo; without a name the logo
              // is the only way to tell who runs the event.
              alt={brand.name ? '' : 'Organizer logo'}
              className="max-h-full max-w-full object-contain"
              onError={() => setLogoFailed(true)}
            />
          </span>
        )}
        <div className="min-w-0">
          {label && brand.name && <p className="text-xs font-medium opacity-90">{label}</p>}
          {brand.name && <p className="font-semibold leading-tight [overflow-wrap:anywhere]">{brand.name}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}
