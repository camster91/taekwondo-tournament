import { afterEach, describe, expect, it } from 'vitest';
import { decryptSetting, encryptSetting, toEmailConfig } from './email-settings.js';
import { activeEmailConfig, isEmailConfigured, setSavedEmailConfig } from './email.js';
import { emailSettingsSchema } from '../routes/admin-email.js';

describe('email settings encryption', () => {
  it('round-trips and never stores the key in plain text', () => {
    const stored = encryptSetting(JSON.stringify({ apiKey: 'key-1234567890abcdef' }));
    expect(stored).not.toContain('key-1234567890abcdef');
    expect(JSON.parse(decryptSetting(stored)!)).toEqual({ apiKey: 'key-1234567890abcdef' });
  });

  it('returns null for tampered or foreign values', () => {
    const stored = encryptSetting('secret');
    const parts = stored.split(':');
    parts[3] = Buffer.from('other').toString('base64');
    expect(decryptSetting(parts.join(':'))).toBeNull();
    expect(decryptSetting('not-encrypted')).toBeNull();
  });
});

describe('which email settings are used', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    setSavedEmailConfig(null);
  });

  it('uses saved settings over the environment', () => {
    process.env.MAILGUN_API_KEY = 'env-key-123456';
    setSavedEmailConfig(toEmailConfig({ apiKey: 'saved-key-123456', domain: 'mg.example.com', region: 'eu', fromName: 'Club', fromAddress: 'noreply@mg.example.com' }));
    expect(activeEmailConfig()).toMatchObject({ source: 'saved', apiKey: 'saved-key-123456', baseUrl: 'https://api.eu.mailgun.net/v3' });
  });

  it('falls back to the environment, and is off with neither', () => {
    process.env.MAILGUN_API_KEY = 'env-key-123456';
    expect(activeEmailConfig()).toMatchObject({ source: 'environment', apiKey: 'env-key-123456' });
    delete process.env.MAILGUN_API_KEY;
    expect(isEmailConfigured()).toBe(false);
  });
});

describe('emailSettingsSchema', () => {
  it('accepts a normal Mailgun setup and allows keeping the saved key', () => {
    expect(emailSettingsSchema.safeParse({ apiKey: '', domain: 'MG.Example.com', region: 'us', fromName: 'bowin', fromAddress: 'noreply@mg.example.com' }).success).toBe(true);
  });

  it('rejects a bad domain, region or sender', () => {
    expect(emailSettingsSchema.safeParse({ domain: 'not a domain', region: 'us', fromName: 'x', fromAddress: 'a@b.co' }).success).toBe(false);
    expect(emailSettingsSchema.safeParse({ domain: 'mg.example.com', region: 'asia', fromName: 'x', fromAddress: 'a@b.co' }).success).toBe(false);
    expect(emailSettingsSchema.safeParse({ domain: 'mg.example.com', region: 'us', fromName: 'x', fromAddress: 'nope' }).success).toBe(false);
  });
});
