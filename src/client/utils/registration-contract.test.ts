import { describe, expect, it } from 'vitest';
import { parseRegistrationLegalConfig, parseRegistrationResult } from './registration-contract.js';

const legal = {
  consentVersion: '2026-08',
  privacyNoticeUrl: '/privacy',
  tournamentTermsUrl: '/terms',
};

const confirmation = {
  success: true,
  message: 'Registration successful!',
  registration: {
    id: '00000000-0000-4000-8000-000000000001',
    confirmationCode: '00000000',
    managementToken: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    competitorName: 'Amina Kim',
    tournamentName: 'Fabricated Open',
    tournamentDate: '2027-04-18T14:00:00.000Z',
    events: { patterns: true, sparring: false },
    ageGroup: 'Youth',
  },
};

describe('public registration runtime contracts', () => {
  it('accepts complete legal configuration', () => {
    expect(parseRegistrationLegalConfig(legal)).toEqual(legal);
  });

  it.each([
    { ...legal, consentVersion: '' },
    { ...legal, privacyNoticeUrl: '' },
    { ...legal, tournamentTermsUrl: null },
    { ...legal, privacyNoticeUrl: 'javascript:alert(1)' },
    { ...legal, privacyNoticeUrl: '//evil.example/privacy' },
    { ...legal, privacyNoticeUrl: 'http://example.com/privacy' },
    { ...legal, privacyNoticeUrl: ' not-a-url ' },
  ])('rejects incomplete legal configuration %#', (payload) => {
    expect(() => parseRegistrationLegalConfig(payload)).toThrow('Required registration terms are unavailable');
  });

  it('accepts a complete registration confirmation', () => {
    expect(parseRegistrationResult(confirmation)).toEqual(confirmation);
  });

  it.each([
    null,
    { ...confirmation, success: false },
    { ...confirmation, registration: { ...confirmation.registration, managementToken: '' } },
    { ...confirmation, registration: { ...confirmation.registration, id: 'not-a-uuid' } },
    { ...confirmation, registration: { ...confirmation.registration, confirmationCode: 'mismatch' } },
    { ...confirmation, registration: { ...confirmation.registration, managementToken: 'too-short' } },
    { ...confirmation, registration: { ...confirmation.registration, tournamentDate: 'not-a-date' } },
    { ...confirmation, registration: { ...confirmation.registration, events: { patterns: 'yes', sparring: false } } },
  ])('rejects malformed registration confirmation %#', (payload) => {
    expect(() => parseRegistrationResult(payload)).toThrow('Registration confirmation could not be verified');
  });

  it('accepts HTTPS legal-document URLs', () => {
    const config = { ...legal, privacyNoticeUrl: 'https://bowin.example/privacy' };
    expect(parseRegistrationLegalConfig(config)).toEqual(config);
  });
});
