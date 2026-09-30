import { describe, expect, it } from 'vitest';
import { buildRevisionFromEnv, createAppMetrics, createHttpMetrics, metricsTokenFromEnv } from './observability.js';

describe('HTTP observability', () => {
  it('renders bounded Prometheus counters and latency totals', () => {
    const metrics = createHttpMetrics();
    metrics.record({ method: 'GET', route: '/api/health/ready', statusCode: 200, durationMs: 12 });
    metrics.record({ method: 'POST', route: '/api/billing/webhook', statusCode: 500, durationMs: 8 });

    const output = metrics.render();
    expect(output).toContain('bowin_http_requests_total{method="GET",route="/api/health/ready",status="2xx"} 1');
    expect(output).toContain('bowin_http_requests_total{method="POST",route="/api/billing/webhook",status="5xx"} 1');
    expect(output).toContain('bowin_http_request_duration_milliseconds_sum{method="GET",route="/api/health/ready"} 12');
  });

  it('requires a strong metrics token in production', () => {
    expect(metricsTokenFromEnv({}, false)).toBeNull();
    expect(() => metricsTokenFromEnv({}, true)).toThrow(/METRICS_TOKEN/);
    expect(() => metricsTokenFromEnv({ METRICS_TOKEN: 'short' }, true)).toThrow(/32/);
    expect(metricsTokenFromEnv({ METRICS_TOKEN: 'm'.repeat(32) }, true)).toBe('m'.repeat(32));
  });
});

describe('createAppMetrics (#165)', () => {
  it('counts email sends and failures', () => {
    const metrics = createAppMetrics();
    metrics.recordEmail(true);
    metrics.recordEmail(false);
    metrics.recordEmail(false);
    const text = metrics.render();
    expect(text).toContain('bowin_email_sends_total 1');
    expect(text).toContain('bowin_email_send_failures_total 2');
  });

  it('classifies Stripe webhook outcomes by status and tracks the last success', () => {
    let now = 1_790_000_000_000;
    const metrics = createAppMetrics(() => now);
    expect(metrics.render()).toContain('bowin_stripe_webhook_last_success_timestamp_seconds 0');
    metrics.recordStripeWebhook(200);
    now += 5_000;
    metrics.recordStripeWebhook(400);
    metrics.recordStripeWebhook(503);
    const text = metrics.render();
    expect(text).toContain('bowin_stripe_webhook_events_total{outcome="success"} 1');
    expect(text).toContain('bowin_stripe_webhook_events_total{outcome="rejected"} 1');
    expect(text).toContain('bowin_stripe_webhook_events_total{outcome="failure"} 1');
    // Only the 2xx updates the timestamp.
    expect(text).toContain('bowin_stripe_webhook_last_success_timestamp_seconds 1790000000');
  });
});

describe('buildRevisionFromEnv', () => {
  it('reports a git SHA and refuses anything else', () => {
    expect(buildRevisionFromEnv({ BUILD_SHA: 'b91e9625adaf2c329b2412f9e34bebc181cdd398' })).toBe('b91e9625adaf2c329b2412f9e34bebc181cdd398');
    expect(buildRevisionFromEnv({})).toBe('unknown');
    expect(buildRevisionFromEnv({ BUILD_SHA: 'unknown' })).toBe('unknown');
    expect(buildRevisionFromEnv({ BUILD_SHA: '<script>' })).toBe('unknown');
  });
});
