import { describe, expect, it } from 'vitest';
import { loadPendingCheckout, managementUrlFor, savePendingCheckout, type PendingCheckout } from './pending-checkout.js';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

const registration: PendingCheckout = {
  id: '11111111-1111-4111-8111-111111111111',
  confirmationCode: '11111111',
  managementToken: 'T'.repeat(43),
  competitorName: 'Kim Lee',
  tournamentName: 'Open',
  tournamentDate: '2027-01-01T00:00:00.000Z',
  events: { patterns: true, sparring: false },
  ageGroup: '12-14',
  paymentStatus: 'pending',
  paymentAmountCents: 2500,
};

describe('pending checkout handoff across the Stripe redirect', () => {
  it('restores the confirmation with its management token on return', () => {
    const storage = memoryStorage();
    savePendingCheckout(registration, storage);
    expect(loadPendingCheckout(registration.id, storage)).toEqual(registration);
    expect(managementUrlFor(registration.managementToken)).toBe(`/manage-registration?token=${'T'.repeat(43)}`);
  });

  it('returns null for another registration id, corrupt data, or no storage', () => {
    const storage = memoryStorage();
    savePendingCheckout(registration, storage);
    expect(loadPendingCheckout('22222222-2222-4222-8222-222222222222', storage)).toBeNull();
    storage.setItem(`bowin_pending_checkout:${registration.id}`, '{not json');
    expect(loadPendingCheckout(registration.id, storage)).toBeNull();
    storage.setItem(`bowin_pending_checkout:${registration.id}`, JSON.stringify({ ...registration, managementToken: '' }));
    expect(loadPendingCheckout(registration.id, storage)).toBeNull();
    expect(loadPendingCheckout(registration.id, null)).toBeNull();
  });
});
