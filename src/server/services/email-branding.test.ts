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
