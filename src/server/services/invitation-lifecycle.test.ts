import { describe, expect, it } from 'vitest';
import { checkInvitationToken, deliveryFields } from './invitation-lifecycle.js';

const now = new Date('2026-10-01T12:00:00Z');
const future = new Date('2026-10-02T12:00:00Z');
const past = new Date('2026-09-30T12:00:00Z');

describe('checkInvitationToken', () => {
  it('accepts a pending, unexpired token', () => {
    expect(checkInvitationToken({ status: 'pending', tokenExpiry: future }, now)).toEqual({ ok: true });
  });

  it.each([
    [{ status: 'accepted', tokenExpiry: future }, 'accepted'],
    [{ status: 'cancelled', tokenExpiry: future }, 'cancelled'],
    [{ status: 'expired', tokenExpiry: future }, 'expired'],
    [{ status: 'pending', tokenExpiry: past }, 'expired'],
    [{ status: 'pending', tokenExpiry: now }, 'expired'],
    [{ status: 'something-else', tokenExpiry: future }, 'cancelled'],
  ])('rejects %o as %s with 410', (row, code) => {
    const result = checkInvitationToken(row, now);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.httpStatus).toBe(410);
      expect(result.code).toBe(code);
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it('reports a used token as accepted even after it expired', () => {
    const result = checkInvitationToken({ status: 'accepted', tokenExpiry: past }, now);
    expect(result.ok || result.code).toBe('accepted');
  });
});

describe('deliveryFields', () => {
  it('clears the error after a successful send', () => {
    expect(deliveryFields({ success: true }, now)).toEqual({
      deliveryStatus: 'sent', lastDeliveryError: null, lastSentAt: now,
    });
  });

  it('distinguishes an unconfigured mailer from a provider failure', () => {
    expect(deliveryFields({ success: false, error: 'Email not configured' }, now).deliveryStatus)
      .toBe('not_configured');
    expect(deliveryFields({ success: false, error: 'Mailgun error: 500' }, now)).toEqual({
      deliveryStatus: 'failed', lastDeliveryError: 'Mailgun error: 500', lastSentAt: now,
    });
  });

  it('bounds the stored error text', () => {
    const fields = deliveryFields({ success: false, error: 'x'.repeat(2000) }, now);
    expect(fields.lastDeliveryError).toHaveLength(500);
    expect(deliveryFields({ success: false }, now).lastDeliveryError).toBe('Unknown delivery error');
  });
});
