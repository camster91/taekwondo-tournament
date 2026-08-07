import { describe, expect, it } from 'vitest';
import { publicAppUrlFromEnv, validateProductionServiceConfig } from './production-config.js';

const valid = {
  DATABASE_URL: 'postgresql://user:password@db:5432/bowin',
  JWT_SECRET: 'a-production-secret-with-at-least-32-characters',
  ALLOWED_ORIGINS: 'https://app.example.com',
  PUBLIC_APP_URL: 'https://app.example.com',
  MAILGUN_API_KEY: 'key-example',
  MAILGUN_DOMAIN: 'mg.example.com',
  EMAIL_FROM_ADDRESS: 'support@mg.example.com',
  METRICS_TOKEN: 'metrics-token-with-at-least-32-characters',
  REGISTRATION_CONSENT_VERSION: 'pilot-v1',
  PRIVACY_NOTICE_URL: 'https://example.com/privacy/v1',
  TOURNAMENT_TERMS_URL: 'https://example.com/terms/v1',
};

describe('validateProductionServiceConfig', () => {
  it('requires transactional email because passwordless sign-in depends on it', () => {
    expect(() => validateProductionServiceConfig({ ...valid, MAILGUN_API_KEY: '' })).toThrow(/MAILGUN_API_KEY/);
    expect(() => validateProductionServiceConfig({ ...valid, MAILGUN_DOMAIN: '' })).toThrow(/MAILGUN_DOMAIN/);
    expect(() => validateProductionServiceConfig({ ...valid, EMAIL_FROM_ADDRESS: '' })).toThrow(/EMAIL_FROM_ADDRESS/);
  });

  it('requires canonical and allowed origins to use HTTPS', () => {
    expect(() => validateProductionServiceConfig({ ...valid, PUBLIC_APP_URL: 'http://app.example.com' })).toThrow(/PUBLIC_APP_URL/);
    expect(() => validateProductionServiceConfig({ ...valid, ALLOWED_ORIGINS: 'http://app.example.com' })).toThrow(/ALLOWED_ORIGINS/);
  });

  it('rejects a production JWT secret shorter than 32 characters', () => {
    expect(() => validateProductionServiceConfig({ ...valid, JWT_SECRET: 'too-short' })).toThrow(/JWT_SECRET/);
  });

  it('accepts a complete production configuration', () => {
    expect(validateProductionServiceConfig(valid)).toEqual({
      publicAppUrl: 'https://app.example.com',
      allowedOrigins: ['https://app.example.com'],
    });
  });
});

describe('publicAppUrlFromEnv', () => {
  it('uses the canonical URL instead of guessing from the CORS list', () => {
    expect(publicAppUrlFromEnv({
      PUBLIC_APP_URL: 'https://app.example.com/',
      ALLOWED_ORIGINS: 'https://admin.example.com,https://app.example.com',
    })).toBe('https://app.example.com');
  });

  it('uses localhost only when no canonical URL is configured outside production', () => {
    expect(publicAppUrlFromEnv({})).toBe('http://localhost:5173');
  });
});
