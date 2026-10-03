import { describe, expect, it } from 'vitest';
import { absoluteEmailLogoUrl, emailBrandingFor, registrationConfirmationEmail } from './email-templates';

describe('email branding', () => {
  it('prefers tournament branding, then the organization', () => {
    expect(emailBrandingFor({
      brandName: null,
      brandPrimaryColor: '#1D4ED8',
      brandLogoUrl: null,
      organization: { brandName: 'Newton TKD', brandPrimaryColor: '#000000', brandLogoUrl: 'https://cdn.example.com/l.png' },
    })).toEqual({ organizerBrandName: 'Newton TKD', brandPrimaryColor: '#1D4ED8', brandLogoUrl: 'https://cdn.example.com/l.png' });
  });

  it('lets the organization colour win over the untouched tournament default', () => {
    expect(emailBrandingFor({
      brandPrimaryColor: '#DC2626',
      organization: { brandPrimaryColor: '#1D4ED8' },
    }).brandPrimaryColor).toBe('#1D4ED8');
  });

  it('makes stored /logos paths absolute and drops anything else', () => {
    expect(absoluteEmailLogoUrl('/logos/acme.png', 'https://tkd.example.com/')).toBe('https://tkd.example.com/logos/acme.png');
    expect(absoluteEmailLogoUrl('/logos/acme.png', '')).toBeUndefined();
    expect(absoluteEmailLogoUrl('//evil.example/x.png', 'https://tkd.example.com')).toBeUndefined();
    expect(absoluteEmailLogoUrl('javascript:alert(1)', 'https://tkd.example.com')).toBeUndefined();
    expect(absoluteEmailLogoUrl('http://insecure.example/x.png', 'https://tkd.example.com')).toBeUndefined();
  });

  it('uses the organizer colour in the email and ignores a non-hex value', () => {
    const base = {
      competitorName: 'A B', tournamentName: 'Open', tournamentDate: new Date('2027-01-01'), tournamentLocation: null,
      events: 'Patterns', ageGroup: '8-9', parentName: 'P', confirmationCode: 'abcd1234', managementUrl: 'https://x/m',
      organizerBrandName: 'Newton TKD',
    };
    const branded = registrationConfirmationEmail({ ...base, brandPrimaryColor: '#1D4ED8' }).html;
    expect(branded).toContain('#1D4ED8');
    const bad = registrationConfirmationEmail({ ...base, brandPrimaryColor: 'red;}</style><script>x</script>' }).html;
    expect(bad).not.toContain('<script>x');
    expect(bad).toContain('#DC2626');
  });
});

describe('white-label email footer', () => {
  const base = {
    competitorName: 'A B', tournamentName: 'Spring Open', tournamentDate: new Date('2027-01-01'), tournamentLocation: null,
    events: 'Patterns', ageGroup: '8-9', parentName: 'P', confirmationCode: 'abcd1234', managementUrl: 'https://x/m',
  };

  it('keeps the bowin header and footer for a free plan with no brand name', () => {
    const branding = emailBrandingFor({ organization: { name: 'Newton TKD', plan: 'free' } });
    expect(branding.hidePlatformBranding).toBeUndefined();
    expect(branding.organizerBrandName).toBeUndefined();
    const html = registrationConfirmationEmail({ ...base, ...branding }).html;
    expect(html).toContain('<h1>bowin</h1>');
    expect(html).toContain('bowin &middot; tournament management for martial arts schools');
  });

  it('never says bowin for a pro organization, using the organization name instead', () => {
    const branding = emailBrandingFor({ organization: { name: 'Newton TKD', plan: 'pro' } });
    expect(branding).toMatchObject({ organizerBrandName: 'Newton TKD', hidePlatformBranding: true });
    const html = registrationConfirmationEmail({ ...base, ...branding }).html;
    expect(html).toContain('<h1>Newton TKD</h1>');
    expect(html.toLowerCase()).not.toContain('bowin');
    expect(html).not.toContain('run like a black belt');
  });

  it('falls back to the tournament name when a pro organization has no name to show', () => {
    const html = registrationConfirmationEmail({ ...base, hidePlatformBranding: true }).html;
    expect(html).toContain('<h1>Spring Open</h1>');
    expect(html.toLowerCase()).not.toContain('bowin');
  });

  it('keeps the organizer brand name over the organization name', () => {
    expect(emailBrandingFor({ brandName: 'Spring Cup', organization: { name: 'Newton TKD', brandName: 'Newton', plan: 'pro' } }).organizerBrandName)
      .toBe('Spring Cup');
  });
});
