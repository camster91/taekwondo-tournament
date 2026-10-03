import { describe, expect, it } from 'vitest';
import { effectiveBrandColor, publicOrganizerBranding, safePublicLogoUrl } from './organizer-branding';

describe('publicOrganizerBranding', () => {
  it('prefers the tournament, then the organization', () => {
    expect(publicOrganizerBranding({
      brandName: 'Spring Cup Hosts',
      brandPrimaryColor: '#1D4ED8',
      brandLogoUrl: null,
      organization: { name: 'Org', brandName: 'Org Brand', brandPrimaryColor: '#000000', brandLogoUrl: '/logos/org.png' },
    })).toEqual({ organizerName: 'Spring Cup Hosts', brandPrimaryColor: '#1D4ED8', brandLogoUrl: '/logos/org.png' });
  });

  it('falls back to the organization name, and to nothing', () => {
    expect(publicOrganizerBranding({ organization: { name: 'Newtons TKD' } }).organizerName).toBe('Newtons TKD');
    expect(publicOrganizerBranding({ organization: null })).toEqual({
      organizerName: null, brandPrimaryColor: null, brandLogoUrl: null,
    });
  });

  it('drops colours that are not #RRGGBB', () => {
    expect(publicOrganizerBranding({ brandPrimaryColor: 'red' }).brandPrimaryColor).toBeNull();
    expect(publicOrganizerBranding({ brandPrimaryColor: '#fff' }).brandPrimaryColor).toBeNull();
    expect(publicOrganizerBranding({ brandPrimaryColor: '#123abc;x' }).brandPrimaryColor).toBeNull();
  });
});

describe('effectiveBrandColor', () => {
  it('treats the tournament column default as "not overridden"', () => {
    expect(effectiveBrandColor('#DC2626', '#1D4ED8')).toBe('#1D4ED8');
    expect(effectiveBrandColor('#dc2626', '#1D4ED8')).toBe('#1D4ED8');
    expect(effectiveBrandColor('#047857', '#1D4ED8')).toBe('#047857');
    expect(effectiveBrandColor('#DC2626', null)).toBe('#DC2626');
    expect(effectiveBrandColor(null, '#1D4ED8')).toBe('#1D4ED8');
    expect(effectiveBrandColor(null, null)).toBeNull();
  });
});

describe('safePublicLogoUrl', () => {
  it('keeps uploaded paths and https links only', () => {
    expect(safePublicLogoUrl('/logos/a.png')).toBe('/logos/a.png');
    expect(safePublicLogoUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
    expect(safePublicLogoUrl('//evil.example.com/a.png')).toBeNull();
    expect(safePublicLogoUrl('http://example.com/a.png')).toBeNull();
    expect(safePublicLogoUrl('javascript:alert(1)')).toBeNull();
    expect(safePublicLogoUrl('')).toBeNull();
  });
});
