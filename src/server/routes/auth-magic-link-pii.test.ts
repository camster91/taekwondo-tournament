/**
 * Regression test for the PII leak in the magic-link email failure
 * log (auth.ts:259 before the fix).
 *
 * Background: the previous code was
 *   console.error(`Magic link requested for ${email} — email failed: ${...}`);
 * which writes the full email address to the application log on
 * every delivery failure. Operators only need to know that
 * delivery failed and roughly which account, not the address
 * itself. The fix hashes the address with sha256 so logs are
 * joinable by ops for a specific request but not readable at a
 * glance, and routes the line through the structured audit
 * logger so it carries a stable `event` name.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';

const captureLog = vi.hoisted(() => ({ calls: [] as Array<unknown[]> }));

vi.mock('../utils/structured-logger.js', () => ({
  auditLog: (...args: unknown[]) => {
    captureLog.calls.push(args);
  },
}));

// The route uses `sendEmail` to deliver the magic link. To trigger
// the failure path we need `sendEmail` to resolve `{ success: false,
// error: '...' }`. Stub the email service module so the test does
// not depend on a real SMTP/Resend configuration.
vi.mock('../services/email.js', () => ({
  sendEmail: vi.fn(),
  isEmailConfigured: vi.fn(() => true),
}));

// auth.ts imports a long list of services. Stub the ones touched by
// the /magic-link route so the module loads without a real DB.
vi.mock('../middleware/auth.js', () => ({
  authenticate: vi.fn(),
  requireRole: vi.fn(() => vi.fn()),
  invalidateAuthCache: vi.fn(),
  DEMO_ORG_ID: 'demo',
  DEMO_ROLE: 'admin',
  SESSION_COOKIE: 'sid',
  SESSION_COOKIE_OPTIONS: {},
  setCsrfCookie: vi.fn(),
  createToken: vi.fn(),
}));
vi.mock('../services/email-templates.js', () => ({
  magicLinkEmail: vi.fn(() => ({ subject: 'Your magic link', html: '<p>test</p>' })),
  welcomeEmail: vi.fn(() => ({ subject: 'Welcome', html: '<p>test</p>' })),
}));
vi.mock('../services/production-config.js', () => ({
  publicAppUrlFromEnv: () => 'http://localhost:3000',
}));
vi.mock('../services/offline-capability.js', () => ({
  maybeIssueOfflineCapability: vi.fn(),
}));
vi.mock('../services/audit-log.js', () => ({
  createAuditLog: vi.fn(),
  getClientIp: () => '127.0.0.1',
  getUserAgent: () => 'test',
}));

import authRouter from './auth.js';
import express from 'express';
import request from 'supertest';
import { sendEmail } from '../services/email.js';

describe('magic-link email failure — PII-safe logging', () => {
  let app: express.Express;

  beforeEach(() => {
    process.env.RATE_LIMIT_DISABLED = '1';
    captureLog.calls.length = 0;
    app = express();
    app.use(express.json());
    // auth.ts registers a real Prisma client from app.locals.prisma.
    // The /magic-link route only touches prisma inside the try
    // block; for this test the success path returns before any DB
    // call because sendEmail resolves `{ success: false }`. We give
    // it a stub so any unexpected access throws a clear error.
    app.locals.prisma = {
      magicLink: {
        deleteMany: vi.fn(),
        create: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      user: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    };
    app.use('/api/auth', authRouter);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('logs the sha256 hash of the email, never the raw address', async () => {
    const email = 'parent@example.com';
    // The route short-circuits with a generic 200 when the email
    // doesn't match an existing user (enumeration-safe). For this
    // test we want it to actually call sendEmail and exercise the
    // failure-path log, so stub a real user.
    (app.locals.prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'user-1',
      email,
      firstName: 'Parent',
      isActive: true,
      role: 'viewer',
    });
    (app.locals.prisma.magicLink.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (sendEmail as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      error: 'smtp connection refused',
    });

    const res = await request(app)
      .post('/api/auth/request-magic-link')
      .send({ email });

    // Endpoint always answers 200 with the standard "if an account
    // exists" body, regardless of delivery success.
    expect(res.status).toBe(200);

    expect(captureLog.calls.length).toBe(1);
    const payload = captureLog.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).toBeDefined();
    expect(payload.event).toBe('magic_link.email_failed');
    expect(payload.level).toBe('error');

    // The raw email is NOT in the payload.
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(email);

    // The emailHash is the sha256 hex of the email.
    const expected = crypto
      .createHash('sha256')
      .update(email, 'utf8')
      .digest('hex');
    expect(payload.emailHash).toBe(expected);

    // The underlying send-failure error is preserved so ops can
    // diagnose delivery problems.
    expect(payload.error).toBe('smtp connection refused');
  });
});
