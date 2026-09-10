/**
 * Integration test for Sentry/GlitchTip initialization.
 * 
 * Verifies that initSentry() works with both Sentry.io and GlitchTip DSNs,
 * and gracefully handles missing DSN (no-op mode).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';

describe('Sentry/GlitchTip initialization integration', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalEnv = { ...process.env };
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    consoleInfoSpy.mockRestore();
    // Clear module cache to allow re-import with new env vars
    vi.resetModules();
  });

  it('initializes with GlitchTip DSN', async () => {
    // Set a valid GlitchTip DSN format (synthetic example)
    process.env.SENTRY_DSN = 'https://aaaabbbb-cccc-4ddd-8eee-ffff00001111@glitchtip.example.com/2';
    process.env.SENTRY_ENVIRONMENT = 'test';

    // Re-import the module with new env vars
    const { initSentry } = await import('./sentry.js');
    
    const app = express();
    
    // Should not throw
    expect(() => initSentry(app)).not.toThrow();
    
    // Should log initialization message
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[sentry\] Initialized.*test.*aaaabbbb/)
    );
  });

  it('initializes with Sentry.io DSN', async () => {
    // Set a valid Sentry.io DSN format
    process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/123456';
    process.env.SENTRY_ENVIRONMENT = 'test';

    const { initSentry } = await import('./sentry.js');
    
    const app = express();
    
    // Should not throw
    expect(() => initSentry(app)).not.toThrow();
    
    // Should log initialization message (DSN is truncated in the log)
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[sentry\] Initialized.*env: test.*DSN: https:\/\/examplePubl/)
    );
  });

  it('gracefully handles missing DSN (no-op mode)', async () => {
    // Unset SENTRY_DSN
    delete process.env.SENTRY_DSN;

    const { initSentry, isSentryEnabled } = await import('./sentry.js');
    
    const app = express();
    
    // Should not throw
    expect(() => initSentry(app)).not.toThrow();
    
    // Should log that error tracking is disabled
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      '[sentry] SENTRY_DSN not set — error tracking disabled'
    );

    // isSentryEnabled should return false
    expect(isSentryEnabled()).toBe(false);
  });

  it('uses NODE_ENV as default environment', async () => {
    process.env.SENTRY_DSN = 'https://key@host.example.com/1';
    process.env.NODE_ENV = 'production';
    delete process.env.SENTRY_ENVIRONMENT;

    const { initSentry } = await import('./sentry.js');
    
    const app = express();
    initSentry(app);
    
    // Should use NODE_ENV as the environment
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[sentry\] Initialized.*production/)
    );
  });

  it('handles various valid DSN formats', async () => {
    const validDSNs = [
      'https://abc@errors.example.com/1',
      'https://aaaabbbb-cccc-4ddd-8eee-ffff00001111@glitchtip.example.com/2',
      'https://key123@o0.ingest.sentry.io/456789',
      'https://a1b2c3d4e5f6@self-hosted.local/999',
    ];

    for (const dsn of validDSNs) {
      // Reset modules and console spy for each iteration
      vi.resetModules();
      consoleInfoSpy.mockClear();
      
      process.env.SENTRY_DSN = dsn;
      process.env.SENTRY_ENVIRONMENT = 'test';

      const { initSentry } = await import('./sentry.js');
      const app = express();
      
      expect(() => initSentry(app), `Should handle DSN: ${dsn}`).not.toThrow();
      expect(consoleInfoSpy).toHaveBeenCalled();
    }
  });
});

describe('Client-side Sentry initialization (documentation)', () => {
  it('documents client-side GlitchTip compatibility', () => {
    // Client uses the same Sentry SDK (@sentry/react)
    // The DSN format is identical: https://key@host/project-id
    // Set via VITE_SENTRY_DSN at build time
    
    const clientGlitchTipDSN = 'https://aaaabbbb-cccc-4ddd-8eee-ffff00001111@glitchtip.example.com/2';
    const clientSentryDSN = 'https://key@o0.ingest.sentry.io/123';

    // Both should match the DSN pattern
    const dsnPattern = /^https:\/\/[^@]+@[^/]+\/\d+$/;
    expect(clientGlitchTipDSN).toMatch(dsnPattern);
    expect(clientSentryDSN).toMatch(dsnPattern);

    // Document that VITE_SENTRY_DSN accepts both formats
    expect(clientGlitchTipDSN).toContain('glitchtip.example.com');
    expect(clientSentryDSN).toContain('sentry.io');
  });

  it('documents that client and server use the same DSN format', () => {
    // Server: SENTRY_DSN
    // Client: VITE_SENTRY_DSN
    // Both use the same format and can point to the same GlitchTip project
    
    const sharedDSN = 'https://aaaabbbb-cccc-4ddd-8eee-ffff00001111@glitchtip.example.com/2';
    
    // Both server and client can use this same DSN
    expect(sharedDSN).toMatch(/^https:\/\/[^@]+@[^/]+\/\d+$/);
    
    // The only difference is the env var name:
    // - Server reads process.env.SENTRY_DSN
    // - Client reads import.meta.env.VITE_SENTRY_DSN (at build time)
  });
});
