import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BRAND_COLOR,
  contrastRatio,
  readableTextColor,
  resolveOrganizerBranding,
  safeBrandColor,
  safeBrandLogoUrl,
} from './organizer-branding';

describe('organizer branding', () => {
  it('only accepts #RRGGBB colours', () => {
    expect(safeBrandColor('#1d4ed8')).toBe('#1d4ed8');
    for (const bad of ['red', '#fff', '#12345g', 'url(x)', '#123456;color:red', null, undefined, 42]) {
      expect(safeBrandColor(bad)).toBe(DEFAULT_BRAND_COLOR);
    }
  });

  it('only accepts same-site paths and https logos', () => {
    expect(safeBrandLogoUrl('/logos/org.png')).toBe('/logos/org.png');
    expect(safeBrandLogoUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
    for (const bad of ['//evil.example.com/a.png', 'http://example.com/a.png', 'javascript:alert(1)', 'data:image/png;base64,AA', '', null]) {
      expect(safeBrandLogoUrl(bad)).toBeNull();
    }
  });

  it('measures WCAG contrast', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 0);
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
  });

  it('picks white text on dark colours and dark text on light ones', () => {
    expect(readableTextColor('#DC2626')).toBe('#FFFFFF');
    expect(readableTextColor('#1D4ED8')).toBe('#FFFFFF');
    expect(readableTextColor('#0F172A')).toBe('#FFFFFF');
    expect(readableTextColor('#FFFF00')).toBe('#0F172A');
    expect(readableTextColor('#FDE68A')).toBe('#0F172A');
    expect(readableTextColor('#FFFFFF')).toBe('#0F172A');
  });

  it('resolves a full branding with safe fallbacks', () => {
    expect(resolveOrganizerBranding({ name: '  Newtons TKD ', color: '#FFFF00', logoUrl: '/logos/n.png' })).toEqual({
      name: 'Newtons TKD', color: '#FFFF00', textColor: '#0F172A', logoUrl: '/logos/n.png',
    });
    expect(resolveOrganizerBranding({ name: '', color: 'nope', logoUrl: 'http://x' })).toEqual({
      name: null, color: DEFAULT_BRAND_COLOR, textColor: '#FFFFFF', logoUrl: null,
    });
  });
});
