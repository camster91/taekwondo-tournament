import { describe, expect, it } from 'vitest';
import { validateOrganizationDeletion } from './organization-closure.js';

describe('organization deletion policy', () => {
  it('requires the exact slug and an acknowledged export', () => {
    expect(validateOrganizationDeletion({
      slug: 'northside-tkd',
      confirmation: 'Northside TKD',
      exportAcknowledged: true,
      billingStatus: null,
    })).toMatchObject({ ok: false, status: 400 });
    expect(validateOrganizationDeletion({
      slug: 'northside-tkd',
      confirmation: 'northside-tkd',
      exportAcknowledged: false,
      billingStatus: null,
    })).toMatchObject({ ok: false, status: 400 });
  });

  it('blocks deletion until an attached subscription is inactive or canceled', () => {
    for (const billingStatus of ['active', 'trialing', 'past_due', 'unpaid']) {
      expect(validateOrganizationDeletion({
        slug: 'northside-tkd',
        confirmation: 'northside-tkd',
        exportAcknowledged: true,
        billingStatus,
      })).toMatchObject({ ok: false, status: 409 });
    }
  });

  it('allows confirmed deletion without billing or after provider cancellation', () => {
    for (const billingStatus of [null, 'inactive', 'canceled']) {
      expect(validateOrganizationDeletion({
        slug: 'northside-tkd',
        confirmation: 'northside-tkd',
        exportAcknowledged: true,
        billingStatus,
      })).toEqual({ ok: true });
    }
  });
});
