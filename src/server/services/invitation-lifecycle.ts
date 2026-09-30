/**
 * Invitation lifecycle rules shared by the invite routes and
 * `POST /api/auth/accept-invite` (issue #46).
 *
 * status:          pending → accepted | expired | cancelled
 * deliveryStatus:  sent | failed | not_configured (last send attempt)
 */

export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'cancelled';
export type DeliveryStatus = 'sent' | 'failed' | 'not_configured';

export interface InvitationTokenRow {
  status: string;
  tokenExpiry: Date;
}

export type TokenCheck =
  | { ok: true }
  | { ok: false; httpStatus: 410; code: 'accepted' | 'expired' | 'cancelled'; error: string };

/**
 * Decide whether an invitation token can still be used. Every dead
 * token answers 410 Gone with a code the acceptance page can explain;
 * an unknown token stays a 404/400 at the call site so tokens can't
 * be probed for their state beyond "not usable".
 */
export function checkInvitationToken(row: InvitationTokenRow, now: Date = new Date()): TokenCheck {
  if (row.status === 'accepted') {
    return { ok: false, httpStatus: 410, code: 'accepted', error: 'This invitation has already been used. Sign in instead.' };
  }
  if (row.status === 'cancelled') {
    return { ok: false, httpStatus: 410, code: 'cancelled', error: 'This invitation was cancelled. Ask an administrator for a new one.' };
  }
  if (row.status === 'expired' || row.tokenExpiry.getTime() <= now.getTime()) {
    return { ok: false, httpStatus: 410, code: 'expired', error: 'This invitation has expired. Ask an administrator to resend it.' };
  }
  if (row.status !== 'pending') {
    return { ok: false, httpStatus: 410, code: 'cancelled', error: 'This invitation is no longer valid.' };
  }
  return { ok: true };
}

const MAX_DELIVERY_ERROR_LENGTH = 500;

/** Columns recorded after each send / resend attempt. */
export function deliveryFields(
  result: { success: boolean; error?: string },
  now: Date = new Date(),
): { deliveryStatus: DeliveryStatus; lastDeliveryError: string | null; lastSentAt: Date } {
  if (result.success) {
    return { deliveryStatus: 'sent', lastDeliveryError: null, lastSentAt: now };
  }
  const error = (result.error || 'Unknown delivery error').slice(0, MAX_DELIVERY_ERROR_LENGTH);
  return {
    deliveryStatus: error === 'Email not configured' ? 'not_configured' : 'failed',
    lastDeliveryError: error,
    lastSentAt: now,
  };
}

/** Thrown inside the accept transaction when another request won the race. */
export class InvitationAlreadyClaimedError extends Error {
  constructor() {
    super('Invitation already claimed');
    this.name = 'InvitationAlreadyClaimedError';
  }
}
