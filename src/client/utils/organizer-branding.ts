// Organizer branding on parent-facing pages: name, colour and logo set by the
// organization (or overridden per tournament). Values come from public API
// responses, so only a #RRGGBB colour and a same-site or https logo are used.

export const DEFAULT_BRAND_COLOR = '#DC2626';
const DARK_TEXT = '#0F172A';
const LIGHT_TEXT = '#FFFFFF';
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export function safeBrandColor(value: unknown): string {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value : DEFAULT_BRAND_COLOR;
}

/** Uploaded logos are /logos/... paths; external logos must be https. */
export function safeBrandLogoUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  if (/^https:\/\//i.test(value)) return value;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  return null;
}

function relativeLuminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** White or dark text, whichever reads better on the brand colour. */
export function readableTextColor(background: string): string {
  const bg = safeBrandColor(background);
  return contrastRatio(LIGHT_TEXT, bg) >= contrastRatio(DARK_TEXT, bg) ? LIGHT_TEXT : DARK_TEXT;
}

export interface OrganizerBranding {
  name: string | null;
  color: string;
  textColor: string;
  logoUrl: string | null;
}

export function resolveOrganizerBranding(input: {
  name?: unknown;
  color?: unknown;
  logoUrl?: unknown;
}): OrganizerBranding {
  const color = safeBrandColor(input.color);
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : null;
  return { name, color, textColor: readableTextColor(color), logoUrl: safeBrandLogoUrl(input.logoUrl) };
}
