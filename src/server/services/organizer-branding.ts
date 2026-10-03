// Organizer branding for parent-facing pages (family portal, manage
// registration): the tournament's own settings win, then its organization's.
// Only safe values leave the server: a #RRGGBB colour and a logo that is
// either an uploaded /logos/... path or an https URL.

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
/** The database default for Tournament.brandPrimaryColor and Organization.brandPrimaryColor. */
const DEFAULT_COLUMN_COLOR = '#DC2626';

/**
 * Tournament colour, then organization colour. Every tournament row carries
 * the column default (#DC2626) unless someone picked a colour, so that value
 * at tournament level means "not overridden" and the organization's own
 * colour wins.
 */
export function effectiveBrandColor(
  tournamentColor: string | null | undefined,
  organizationColor: string | null | undefined,
): string | null {
  const tournamentOverride = tournamentColor && tournamentColor.toUpperCase() !== DEFAULT_COLUMN_COLOR ? tournamentColor : null;
  return tournamentOverride || organizationColor || tournamentColor || null;
}

interface BrandSource {
  brandName?: string | null;
  brandPrimaryColor?: string | null;
  brandLogoUrl?: string | null;
}

export interface PublicOrganizerBranding {
  organizerName: string | null;
  brandPrimaryColor: string | null;
  brandLogoUrl: string | null;
}

export function safePublicLogoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https:\/\//i.test(url)) return url;
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  return null;
}

export function publicOrganizerBranding(
  tournament: BrandSource & { organization?: (BrandSource & { name?: string | null }) | null },
): PublicOrganizerBranding {
  const org = tournament.organization;
  const color = effectiveBrandColor(tournament.brandPrimaryColor, org?.brandPrimaryColor);
  return {
    organizerName: tournament.brandName?.trim() || org?.brandName?.trim() || org?.name?.trim() || null,
    brandPrimaryColor: color && HEX_COLOR.test(color) ? color : null,
    brandLogoUrl: safePublicLogoUrl(tournament.brandLogoUrl || org?.brandLogoUrl),
  };
}
