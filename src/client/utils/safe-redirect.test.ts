import { describe, it, expect } from 'vitest';
import { getSafeRedirectUrl } from './safe-redirect';

describe('getSafeRedirectUrl', () => {
  it('returns valid relative paths', () => {
    expect(getSafeRedirectUrl('/tournaments/123/scorekeeper')).toBe('/tournaments/123/scorekeeper');
    expect(getSafeRedirectUrl('/dashboard')).toBe('/dashboard');
    expect(getSafeRedirectUrl('/settings?tab=rules')).toBe('/settings?tab=rules');
  });

  it('rejects null, undefined, and empty strings with fallback', () => {
    expect(getSafeRedirectUrl(null)).toBe('/');
    expect(getSafeRedirectUrl(undefined)).toBe('/');
    expect(getSafeRedirectUrl('')).toBe('/');
    expect(getSafeRedirectUrl('   ', '/custom')).toBe('/custom');
  });

  it('rejects external URLs and protocol schemes', () => {
    expect(getSafeRedirectUrl('https://evil.com')).toBe('/');
    expect(getSafeRedirectUrl('http://evil.com/phish')).toBe('/');
    expect(getSafeRedirectUrl('javascript:alert(1)')).toBe('/');
    expect(getSafeRedirectUrl('data:text/html,evil')).toBe('/');
  });

  it('rejects protocol-relative and backslash bypass attempts', () => {
    expect(getSafeRedirectUrl('//evil.com')).toBe('/');
    expect(getSafeRedirectUrl('///evil.com')).toBe('/');
    expect(getSafeRedirectUrl('/\\evil.com')).toBe('/');
  });
});
