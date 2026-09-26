import { afterEach, describe, expect, it, vi } from 'vitest';

type Hook = (event: Record<string, unknown>) => Record<string, unknown> | null;
type InitOptions = { sendDefaultPii?: boolean; beforeSend?: Hook; beforeSendTransaction?: Hook; beforeBreadcrumb?: Hook };

const sentry = vi.hoisted(() => ({ init: vi.fn(), setUser: vi.fn() }));

vi.mock('@sentry/react', () => ({
  init: sentry.init,
  setUser: sentry.setUser,
  browserTracingIntegration: () => ({}),
  replayIntegration: () => ({}),
  withScope: vi.fn(),
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
  ErrorBoundary: () => null,
}));

async function initWithDsn() {
  vi.resetModules();
  vi.stubEnv('VITE_SENTRY_DSN', 'https://public@glitchtip.example.test/2');
  const mod = await import('./sentry');
  mod.initSentry();
  return { mod, options: sentry.init.mock.calls.at(-1)?.[0] as InitOptions };
}

describe('client Sentry PII redaction wiring', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('scrubs registration form data, user email and tokens before send', async () => {
    const { options } = await initWithDsn();
    expect(options.sendDefaultPii).toBe(false);
    const event = options.beforeSend?.({
      user: { id: 'u1', email: 'director@example.com' },
      request: { url: 'https://app.example.test/accept-invite?token=abc', data: { parentEmail: 'p@example.com' } },
      extra: { form: { guardianName: 'Jane', parentPhone: '555-123-4567', division: 'Juniors' } },
    });
    expect(event).toEqual({
      user: { id: 'u1' },
      request: { url: 'https://app.example.test/accept-invite?token=[REDACTED]' },
      extra: { form: { guardianName: '[REDACTED]', parentPhone: '[REDACTED]', division: 'Juniors' } },
    });
    expect(options.beforeSendTransaction?.({ user: { id: 'u1', email: 'a@b.co' } })).toEqual({ user: { id: 'u1' } });
  });

  it('scrubs fetch breadcrumbs (capability URLs, bodies) and console messages', async () => {
    const { options } = await initWithDsn();
    expect(options.beforeBreadcrumb?.({
      category: 'fetch',
      data: { url: '/api/public/check-registration?email=a@b.co&code=123456', method: 'GET', request_body: '{}' },
    })).toEqual({
      category: 'fetch',
      data: { url: '/api/public/check-registration?email=[REDACTED]&code=[REDACTED]', method: 'GET', request_body: '[REDACTED]' },
    });
    expect(options.beforeBreadcrumb?.({ category: 'console', message: 'login a@b.co' })).toEqual({ category: 'console', message: 'login [EMAIL]' });
  });

  it('sends only the opaque user id', async () => {
    const { mod } = await initWithDsn();
    mod.setUser({ id: 'u1', email: 'a@b.co', role: 'admin' });
    expect(sentry.setUser).toHaveBeenCalledWith({ id: 'u1' });
  });
});
