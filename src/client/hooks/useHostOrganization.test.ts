import { describe, expect, it } from 'vitest';
import { parseHostLookup } from './useHostOrganization';
import { shareLinkHint } from '../components/ShareKitPanel';

describe('parseHostLookup', () => {
  it('reads the organizer that owns a custom domain', () => {
    expect(parseHostLookup({
      organization: { slug: 'newton-tkd', name: 'Newton TKD', brandPrimaryColor: '#1D4ED8', brandLogoUrl: null },
      hidePlatformBranding: true,
    })).toEqual({
      status: 'ready',
      organization: { slug: 'newton-tkd', name: 'Newton TKD', brandPrimaryColor: '#1D4ED8', brandLogoUrl: null },
      hidePlatformBranding: true,
    });
  });

  it('treats the normal app address, errors and odd answers as "no organizer"', () => {
    const none = { status: 'ready', organization: null, hidePlatformBranding: false };
    expect(parseHostLookup({ organization: null, hidePlatformBranding: false })).toEqual(none);
    expect(parseHostLookup(null)).toEqual(none);
    expect(parseHostLookup('<html>')).toEqual(none);
    expect(parseHostLookup({ organization: { slug: '', name: 'X' } })).toEqual(none);
  });
});

describe('shareLinkHint', () => {
  it('says in plain words where the link goes', () => {
    expect(shareLinkHint({ kind: 'custom_domain', customDomainHostname: 'register.newtontkd.ca' }))
      .toBe('This link uses your own web address (register.newtontkd.ca).');
    expect(shareLinkHint({ kind: 'event_page', customDomainHostname: null })).toBe('This link opens your event page.');
    expect(shareLinkHint({ kind: 'direct', customDomainHostname: null })).toContain('Organization settings');
  });
});
