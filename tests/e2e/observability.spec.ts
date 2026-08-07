import { expect, test } from '@playwright/test';

const METRICS_TOKEN = ['metrics', 'e2e', 'bowin', 'private', 'monitoring', 'token'].join('-');

test('request correlation and private metrics are available to monitoring only', async ({ request }) => {
  const health = await request.get('/api/health', {
    headers: { 'X-Request-ID': 'e2e-request-correlation' },
  });
  expect(health.ok()).toBeTruthy();
  expect(health.headers()['x-request-id']).toBe('e2e-request-correlation');

  const unauthorized = await request.get('/api/internal/metrics');
  expect(unauthorized.status()).toBe(401);

  const metrics = await request.get('/api/internal/metrics', {
    headers: { Authorization: `Bearer ${METRICS_TOKEN}` },
  });
  expect(metrics.ok()).toBeTruthy();
  expect(metrics.headers()['content-type']).toContain('text/plain');
  expect(await metrics.text()).toContain('bowin_http_requests_total');
});
