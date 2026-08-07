import { describe, expect, it } from 'vitest';
import { createHttpMetrics, metricsTokenFromEnv } from './observability.js';

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
