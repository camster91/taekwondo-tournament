import { afterEach, describe, expect, it, vi } from 'vitest';

type InitOptions = {
  sendDefaultPii?: boolean;
  beforeSend?: (event: Record<string, unknown>) => Record<string, unknown> | null;
  beforeSendTransaction?: (event: Record<string, unknown>) => Record<string, unknown> | null;
  beforeBreadcrumb?: (crumb: Record<string, unknown>) => Record<string, unknown> | null;
};

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  setUser: vi.fn(),
}));

vi.mock('@sentry/node', () => ({
  init: sentry.init,
  setUser: sentry.setUser,
  httpIntegration: () => ({}),
  expressIntegration: () => ({}),
  setupExpressErrorHandler: vi.fn(),
  withScope: vi.fn(),
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

async function initWithDsn(): Promise<{ options: InitOptions; mod: typeof import('./sentry.js') }> {
  vi.resetModules();
  vi.stubEnv('SENTRY_DSN', 'https://public@glitchtip.example.test/1');
  const mod = await import('./sentry.js');
  const app = { use: vi.fn() };
  mod.initSentry(app as unknown as Parameters<typeof mod.initSentry>[0]);
  const options = sentry.init.mock.calls.at(-1)?.[0] as InitOptions;
  return { options, mod };
}

describe('server Sentry PII redaction wiring', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('registers beforeSend that strips user email, cookies, auth headers and bodies', async () => {
    const { options } = await initWithDsn();
    expect(options.sendDefaultPii).toBe(false);
    const event = options.beforeSend?.({
      user: { id: 'u1', email: 'director@example.com' },
      request: {
        headers: { authorization: 'Bearer abc', cookie: 'bowin_session=abc', 'x-csrf-token': 't' },
        data: { parentEmail: 'p@example.com', parentPhone: '555-123-4567' },
      },
      message: 'failed for p@example.com',
    });
    expect(event).toEqual({
      user: { id: 'u1' },
      request: { headers: {} },
      message: 'failed for [EMAIL]',
    });
  });

  it('keeps URL scrubbing on transactions and adds full event redaction', async () => {
    const { options } = await initWithDsn();
    const event = options.beforeSendTransaction?.({
      transaction: '/api/public/scoreboard/abcdefghijklmnop',
      request: { url: 'https://app.example.test/verify?token=secret', headers: { cookie: 'x' } },
      user: { id: 'u1', email: 'a@b.co' },
    });
    expect(event).toEqual({
      transaction: '/api/public/scoreboard/[SLUG]',
      request: { url: 'https://app.example.test/verify?token=[REDACTED]', headers: {} },
      user: { id: 'u1' },
    });
  });

  it('redacts breadcrumbs', async () => {
    const { options } = await initWithDsn();
    const crumb = options.beforeBreadcrumb?.({
      category: 'http',
      message: 'mail to p@example.com',
      data: { headers: { authorization: 'Bearer x', accept: '*/*' } },
    });
    expect(crumb).toEqual({ category: 'http', message: 'mail to [EMAIL]', data: { headers: { accept: '*/*' } } });
  });

  it('attaches only the opaque user id', async () => {
    const { mod } = await initWithDsn();
    mod.setUser({ id: 'u1', email: 'a@b.co', role: 'director' });
    expect(sentry.setUser).toHaveBeenCalledWith({ id: 'u1' });

    const app = { use: vi.fn() };
    mod.mountSentryRequestHandler(app as unknown as Parameters<typeof mod.mountSentryRequestHandler>[0]);
    const middleware = app.use.mock.calls[0][0] as (req: unknown, res: unknown, next: () => void) => void;
    const next = vi.fn();
    middleware({ user: { id: 'u2', email: 'b@c.co', role: 'viewer' } }, {}, next);
    expect(sentry.setUser).toHaveBeenLastCalledWith({ id: 'u2' });
    expect(next).toHaveBeenCalled();
  });
});
