/**
 * A self-service withdrawal frees a spot and promotes the next waitlisted
 * registration. The promoted family must be told, exactly as when a
 * director promotes manually: their management token is rotated in the
 * promotion transaction and the waitlist-promotion email (with the new
 * management link and any entry fee now due) is sent after commit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const emailMock = vi.hoisted(() => ({ configured: true, send: vi.fn() }));

vi.mock('../services/email.js', () => ({
  isEmailConfigured: () => emailMock.configured,
  sendEmail: emailMock.send,
}));

const { default: publicRouter } = await import('./public.js');
const { hashManagementToken } = await import('../utils/registration-management-token.js');

const TOKEN = 'd'.repeat(43);
const FEE_SETTINGS = JSON.stringify({ tournamentFeeCents: 2500 });

describe('DELETE /api/public/registrations/:token promotes and notifies the next waitlisted family', () => {
  let app: express.Express;
  let update: ReturnType<typeof vi.fn>;
  let next: Record<string, unknown> | null;

  beforeEach(() => {
    vi.stubEnv('RATE_LIMIT_DISABLED', '1');
    vi.stubEnv('PUBLIC_APP_URL', 'https://app.test');
    emailMock.configured = true;
    emailMock.send.mockReset().mockResolvedValue(undefined);
    update = vi.fn(async () => ({}));
    next = {
      id: 'abcdef12-0000-4000-8000-000000000000',
      paymentStatus: 'not_required',
      paymentAmountCents: null,
      parentEmail: 'parent@example.com',
      competitor: { firstName: 'Kim', lastName: 'Lee' },
      tournament: {
        settings: FEE_SETTINGS,
        name: 'Spring Open',
        date: new Date('2027-06-01'),
        brandName: null,
        organization: { brandName: 'Master Kim Academy' },
      },
    };
    const registration = {
      id: '11111111-1111-4111-8111-111111111111',
      tournamentId: 't-1',
      checkedIn: false,
      paymentStatus: 'not_required',
      paymentIntentId: null,
      managementTokenExpiresAt: null,
      managementTokenRevokedAt: null,
      tournament: { status: 'registration' },
    };
    const tx = {
      $queryRaw: vi.fn(async () => [{ id: 't-1', maxCapacity: 2, waitlistEnabled: true }]),
      divisionAssignment: { count: vi.fn(async () => 0), deleteMany: vi.fn(async () => ({ count: 0 })) },
      registration: {
        delete: vi.fn(async () => ({})),
        count: vi.fn(async () => 1),
        findFirst: vi.fn(async () => next),
        findMany: vi.fn(async () => []),
        update,
      },
    };
    app = express();
    app.use(express.json());
    app.locals.prisma = {
      registration: { findFirst: vi.fn(async () => registration) },
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    };
    app.use('/api/public', publicRouter);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('rotates the promoted token and emails the new management link with the fee due', async () => {
    const res = await request(app).delete(`/api/public/registrations/${TOKEN}`);
    expect(res.status).toBe(200);

    expect(update).toHaveBeenCalledOnce();
    const data = (update.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data).toMatchObject({
      waitlistStatus: 'promoted',
      paymentStatus: 'pending',
      paymentAmountCents: 2500,
      managementTokenRevokedAt: null,
    });
    expect(data.managementTokenExpiresAt).toBeInstanceOf(Date);

    expect(emailMock.send).toHaveBeenCalledOnce();
    const [to, subject, html] = emailMock.send.mock.calls[0] as [string, string, string];
    expect(to).toBe('parent@example.com');
    expect(subject).toMatch(/Spring Open/);
    expect(html).toContain('$25.00');
    expect(html).toContain('Master Kim Academy');

    // The emailed link carries the raw token whose digest was stored.
    const match = html.match(/manage-registration\?token=([A-Za-z0-9_%-]+)/);
    expect(match).not.toBeNull();
    expect(hashManagementToken(decodeURIComponent(match![1]))).toBe(data.managementTokenHash);
  });

  it('sends nothing when no one was promoted', async () => {
    next = null;
    const res = await request(app).delete(`/api/public/registrations/${TOKEN}`);
    expect(res.status).toBe(200);
    expect(update).not.toHaveBeenCalled();
    expect(emailMock.send).not.toHaveBeenCalled();
  });

  it('still succeeds when the promotion email fails', async () => {
    emailMock.send.mockRejectedValue(new Error('mailgun down'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await request(app).delete(`/api/public/registrations/${TOKEN}`);
    expect(res.status).toBe(200);
    expect(emailMock.send).toHaveBeenCalledOnce();
  });
});
