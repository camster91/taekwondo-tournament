import crypto from 'node:crypto';
import { expect, test } from '@playwright/test';

const WEBHOOK_SECRET = 'whsec_e2e_bowin_webhook_secret';

function stripeSignature(payload: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

test('Stripe subscription webhooks are verified, idempotent, and activate entitlements', async ({ request }) => {
  const suffix = Date.now();
  const login = await request.post('/api/auth/demo');
  const { token } = await login.json() as { token: string };
  const state = await request.storageState();
  const csrf = state.cookies.find((cookie) => cookie.name === 'bowin_csrf')?.value;
  const headers = { Authorization: `Bearer ${token}`, 'X-CSRF-Token': csrf! };
  const organizationResponse = await request.post('/api/organizations', {
    headers,
    data: { name: `E2E Stripe ${suffix}` },
  });
  expect(organizationResponse.status()).toBe(201);
  const { organization } = await organizationResponse.json();

  const event = JSON.stringify({
    id: `evt_e2e_${suffix}`,
    object: 'event',
    api_version: '2025-12-15.clover',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: `sub_e2e_${suffix}`,
        object: 'subscription',
        customer: `cus_e2e_${suffix}`,
        status: 'active',
        cancel_at_period_end: false,
        current_period_end: 1_900_000_000,
        metadata: { organizationId: organization.id },
        items: { data: [{ price: { id: 'price_e2e_starter' } }] },
      },
    },
  });
  const webhookHeaders = {
    'Content-Type': 'application/json',
    'Stripe-Signature': stripeSignature(event),
  };

  const first = await request.post('/api/billing/webhook', { headers: webhookHeaders, data: event });
  expect(first.ok()).toBeTruthy();
  await expect(first.json()).resolves.toMatchObject({ processed: true });

  const replay = await request.post('/api/billing/webhook', { headers: webhookHeaders, data: event });
  expect(replay.ok()).toBeTruthy();
  await expect(replay.json()).resolves.toMatchObject({ duplicate: true });

  const current = await request.get('/api/organizations/current', { headers });
  const currentBody = await current.json();
  const updated = currentBody.organizations.find((item: { id: string }) => item.id === organization.id);
  expect(updated.plan).toBe('starter');
  expect(updated.billingSubscription.status).toBe('active');
});
